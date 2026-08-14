import type { Scope } from '@/services/api/queryKeys';
import type { SourceProgressReporter } from '@/services/queries/progress';
import {
  readBuffer,
  scopeWindow,
  slotKey,
  writeBuffer,
  type BufferHit,
} from '@/services/storage/buffer/buffer.service';
import type { SourceCodec, StoredPayload } from '@/services/storage/buffer/sourceCodecs';
import type { ProgressReporter } from '@/services/uzum/http';
import { useSyncStore } from '@/store/sync.store';

/**
 * The one way a screen gets data.
 *
 * `Uzum API → IndexedDB → UI`, and this is the middle arrow. Every source
 * goes through it, so the rule holds without anybody having to remember it:
 *
 *   1. Look in the buffer for this source and this scope.
 *   2. If what is there is still inside the freshness window, **serve it** —
 *      no request is made, and switching between screens or back to a range
 *      visited a minute ago costs nothing.
 *   3. Otherwise fetch, write it to the buffer, and serve **what was written**.
 *
 * Step three matters more than it looks. The payload handed back is read out of
 * storage again rather than returned straight from the network, so the shape a
 * screen renders is identical on the fetch that filled the buffer and on every
 * read afterwards. A field the codec cannot store is therefore missing
 * immediately and visibly, rather than working until the first reload.
 *
 * A fetch here is a **lazy sync**, and it is reported to the sync store exactly
 * like one started from the sync button. That is what puts a range change on
 * the overview into the log in Settings while it happens.
 *
 * ## Two entry points, because there are two kinds of source
 *
 * `readThrough` is for routes with no shop of their own — FBS stock amounts,
 * supply invoices — whose answer is the same whichever store chip is selected.
 * They get one slot per account.
 *
 * `readThroughPerShop` is for everything the API partitions by shop, and it is
 * the reason changing the store chip is cheap: the payload is stored **one slot
 * per shop**, a scope is answered by merging the slots it names, and only the
 * shops whose slot is missing or stale are actually fetched. Selecting one shop
 * out of five that were just synced therefore costs no requests at all, where
 * a set-keyed slot would have made it a full refetch of rows already on disk.
 */

export interface ReadThroughOptions<T> {
  /** The source's id — also its key prefix and its row in the sync log. */
  readonly id: string;
  readonly scope: Scope;
  /** Whether the stored payload depends on the selected window. */
  readonly periodic: boolean;
  readonly codec: SourceCodec<T>;
  /** Go and get it. Called only when the buffer cannot answer. */
  readonly fetch: (context: {
    readonly signal: AbortSignal | undefined;
    readonly onProgress: ProgressReporter;
  }) => Promise<T>;
  readonly signal?: AbortSignal | undefined;
  /** Progress for a sync that planned this source; lazy reads report their own. */
  readonly onProgress?: SourceProgressReporter | undefined;
  /**
   * Ignore the freshness window and fetch anyway — what the sync button means.
   * The buffer is still written, and still what gets served.
   */
  readonly force?: boolean;
}

/**
 * Whether this source can be served without asking Uzum.
 *
 * Exported so the UI can answer "will changing the range cost a request?"
 * before the change is made, and so a screen can tell a fresh read from a
 * buffered one. For a per-shop source this is true only when **every** shop in
 * the scope is held, since a scope is served by merging its shops.
 */
export async function isBuffered(
  id: string,
  scope: Scope,
  periodic: boolean,
  perShop = false,
): Promise<boolean> {
  const window = scopeWindow(scope, periodic);

  if (!perShop) {
    const hit = await readBuffer(id, slotKey({ shopId: null, window }));
    return hit !== null && !hit.stale;
  }

  const hits = await Promise.all(
    scope.shopIds.map((shopId) => readBuffer(id, slotKey({ shopId, window }))),
  );

  return hits.length > 0 && hits.every((hit) => hit !== null && !hit.stale);
}

/* ── account-wide sources ───────────────────────────────────────────────── */

export async function readThrough<T>(options: ReadThroughOptions<T>): Promise<T> {
  const key = slotKey({ shopId: null, window: scopeWindow(options.scope, options.periodic) });
  const hit = await readBuffer(options.id, key);

  if (hit !== null && !hit.stale && options.force !== true) {
    return options.codec.fromStorage(hit.stored);
  }

  const log = announce(options.id);
  const report = pageReporter(options.id, options.onProgress, log.tracked);

  try {
    const fresh = await options.fetch({ signal: options.signal, onProgress: report });
    const stored = options.codec.toStorage(fresh);
    const written = await writeBuffer(options.id, key, stored);

    log.settle({ rows: countRows(stored.tables), truncated: !written });

    /* Read back through the codec so a buffered render and a fresh one are the
       same object shape. When the write failed there is nothing to read back,
       and the fetched payload is served directly. */
    return written ? options.codec.fromStorage(stored) : fresh;
  } catch (error) {
    log.fail(error);

    /**
     * Stale beats nothing.
     *
     * If the network refused and the buffer holds an older copy, that copy is
     * served rather than the screen collapsing to an error. It is labelled by
     * its own timestamp everywhere it is shown, so an old figure is never
     * mistaken for a current one — which is precisely the guarantee that makes
     * serving it the right call.
     */
    if (hit !== null) return options.codec.fromStorage(hit.stored);
    throw error;
  }
}

/* ── per-shop sources ───────────────────────────────────────────────────── */

export interface PerShopOptions<T> {
  readonly id: string;
  readonly scope: Scope;
  readonly periodic: boolean;
  readonly codec: SourceCodec<T>;
  /** Go and get one shop's payload. Called only for shops the buffer cannot answer. */
  readonly fetch: (
    shopId: number,
    context: {
      readonly signal: AbortSignal | undefined;
      readonly onProgress: ProgressReporter;
    },
  ) => Promise<T>;
  /**
   * Combine the shops' payloads into the one the screen asked for.
   *
   * Called with the parts in scope order, and with a single part when one shop
   * is selected — so a merge of one must equal that one, or a single-shop
   * selection would render differently from the same shop inside "all stores".
   */
  readonly merge: (parts: readonly T[]) => T;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: SourceProgressReporter | undefined;
  readonly force?: boolean;
}

/** One shop's answer, however it was arrived at. */
interface Part<T> {
  readonly shopId: number;
  readonly payload: T;
  /** The packed form, when there is one — used only to count rows for the log. */
  readonly stored: StoredPayload | null;
}

export async function readThroughPerShop<T>(options: PerShopOptions<T>): Promise<T> {
  const window = scopeWindow(options.scope, options.periodic);
  const keyOf = (shopId: number): string => slotKey({ shopId, window });

  const held = new Map<number, BufferHit>();
  await Promise.all(
    options.scope.shopIds.map(async (shopId) => {
      const hit = await readBuffer(options.id, keyOf(shopId));
      if (hit !== null) held.set(shopId, hit);
    }),
  );

  const missing = options.scope.shopIds.filter((shopId) => {
    if (options.force === true) return true;
    const hit = held.get(shopId);
    return hit === undefined || hit.stale;
  });

  /* The cheap path, and the common one after a sync: every shop in the
     selection is already held, so the store chip changes without a request. */
  if (missing.length === 0) {
    return options.merge(
      options.scope.shopIds.flatMap((shopId) => {
        const hit = held.get(shopId);
        return hit === undefined ? [] : [options.codec.fromStorage(hit.stored)];
      }),
    );
  }

  const log = announce(options.id);
  const report = pageReporter(options.id, options.onProgress, log.tracked);

  /* One part per shop that has to be fetched, so the bar advances shop by shop
     and then within the one in flight — rather than lurching backwards when a
     later shop turns out to be bigger than the first. */
  const progress = new ShopProgress(report);

  const fetched = new Map<number, Part<T>>();
  const failures: unknown[] = [];
  /** Set when a shop's payload would not fit and was served without being kept. */
  let unstored = false;

  /* Sequential on purpose: the seller API rate-limits per hour and the pacer in
     `api/rateLimit.ts` already queues everything through one channel, so firing
     shops in parallel would buy nothing but 429s. */
  for (const shopId of missing) {
    if (options.signal?.aborted === true) break;

    try {
      const payload = await options.fetch(shopId, {
        signal: options.signal,
        onProgress: progress.page,
      });

      const stored = options.codec.toStorage(payload);
      const written = await writeBuffer(options.id, keyOf(shopId), stored);

      /* A payload that would not fit is served in full this once and simply
         will not be there next time — worth noting, not worth failing. */
      unstored = unstored || !written;
      fetched.set(shopId, {
        shopId,
        payload: written ? options.codec.fromStorage(stored) : payload,
        stored,
      });
    } catch (error) {
      /* One shop's outage is not the screen's outage: the others still render,
         and this one falls back to whatever is stored for it, however old. */
      failures.push(error);
    }

    progress.finishShop();
  }

  const parts = options.scope.shopIds.flatMap((shopId): Part<T>[] => {
    const fresh = fetched.get(shopId);
    if (fresh !== undefined) return [fresh];

    const hit = held.get(shopId);
    if (hit === undefined) return [];
    return [{ shopId, payload: options.codec.fromStorage(hit.stored), stored: hit.stored }];
  });

  /* Nothing fetched and nothing stored is the one case with no answer to give.
     Anything less than that renders, because a partial scope with a labelled
     age beats an empty screen. */
  const failure = failures[0];
  if (parts.length === 0 && failure !== undefined) {
    log.fail(failure);
    throw failure;
  }

  const rows = parts.reduce(
    (sum, part) => sum + (part.stored === null ? 0 : countRows(part.stored.tables)),
    0,
  );

  if (failure !== undefined && fetched.size === 0) log.fail(failure);
  else log.settle({ rows, truncated: unstored });

  return options.merge(parts.map((part) => part.payload));
}

/* ── the sync log ───────────────────────────────────────────────────────── */

/**
 * A lazy read announces itself in the sync log.
 *
 * The store is the single place sync state lives, so a range change that
 * triggers a fetch shows up in Settings, in the topbar and on the screen's own
 * loading state — the same three places a full sync shows up, because it is the
 * same mechanism. A read the buffer answered announces nothing: it made no
 * request, and marking the row `running` for it is how a synced source ends up
 * looking like it is being fetched all over again.
 */
function announce(id: string): {
  readonly tracked: boolean;
  readonly settle: (result: { rows: number; truncated?: boolean }) => void;
  readonly fail: (error: unknown) => void;
} {
  const tracked = useSyncStore.getState().isTrackedSource(id);
  if (tracked) useSyncStore.getState().beginLazySource(id);

  return {
    tracked,
    settle: (result) => {
      if (tracked) useSyncStore.getState().settleLazySource(id, result);
    },
    fail: (error) => {
      if (!tracked) return;
      useSyncStore.getState().settleLazySource(id, {
        error: error instanceof Error ? error.message : 'Unexpected failure',
      });
    },
  };
}

function pageReporter(
  id: string,
  onProgress: SourceProgressReporter | undefined,
  tracked: boolean,
): ProgressReporter {
  return ({ loaded, total }) => {
    if (onProgress !== undefined) {
      onProgress({ loaded, total, fraction: total > 0 ? Math.min(1, loaded / total) : null });
      return;
    }
    if (tracked) useSyncStore.getState().reportSource(id, { loaded, total });
  };
}

/**
 * Row counts across a per-shop walk.
 *
 * The generic layer cannot count rows in a `T`, so what a shop contributed is
 * taken from the last page report it made — which is the figure the route
 * itself published — and banked when the shop finishes. Totals therefore only
 * ever grow, and the caption never claims more than was read.
 */
class ShopProgress {
  private bankedRows = 0;
  private bankedTotal = 0;
  private lastRows = 0;
  private lastTotal = 0;

  constructor(private readonly emit: ProgressReporter) {}

  readonly page: ProgressReporter = ({ loaded, total }) => {
    this.lastRows = loaded;
    this.lastTotal = total;
    this.emit({ loaded: this.bankedRows + loaded, total: this.bankedTotal + total });
  };

  finishShop(): void {
    this.bankedRows += this.lastRows;
    this.bankedTotal += Math.max(this.lastTotal, this.lastRows);
    this.lastRows = 0;
    this.lastTotal = 0;
    this.emit({ loaded: this.bankedRows, total: this.bankedTotal });
  }
}

function countRows(tables: Readonly<Record<string, { readonly d: readonly unknown[] }>>): number {
  return Object.values(tables).reduce((sum, table) => sum + table.d.length, 0);
}
