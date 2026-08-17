import { Database, History, Layers, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Panel } from '@/components/ui/Panel';
import { FRESHNESS_OPTIONS } from '@/constants/settings';
import { formatDelta, formatNumber, formatPercent, formatStamp } from '@/lib/format';
import type { TranslationKey } from '@/lib/i18n/dictionary';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { useArchiveAnalysis } from '@/services/queries/useArchiveAnalysis';
import { useConnection } from '@/services/queries/useConnection';
import { clearShop } from '@/services/storage/archive/archive.service';
import { bufferUsage, clearBuffer, type BufferUsage } from '@/services/storage/buffer/buffer.service';
import { bounds, type Coverage } from '@/services/storage/archive/coverage';
import type { ChangeField } from '@/services/storage/archive/codec';
import { ENTITY_TYPES } from '@/services/storage/idb/schema';
import { formatBytes } from '@/services/storage/retention';
import { SETTLEMENT_LAG_MS } from '@/services/sync/archivePlan';
import { useArchiveStore, selectTotalRows, type ShopArchiveView } from '@/store/archive.store';
import { useDialogStore } from '@/store/dialog.store';
import { useSettingsStore } from '@/store/settings.store';
import { useToastStore } from '@/store/toast.store';

import { LazySyncPanel } from './LazySyncPanel';

/**
 * The archive, per store.
 *
 * This pane answers one question the rest of the application cannot: *what does
 * this machine actually hold, and for which dates?* Everywhere else shows the
 * window on screen; here the record itself is the subject — which periods have
 * been pulled, where the holes are, how much of the settled history is sealed,
 * and what it costs in storage.
 *
 * It lives in Settings rather than on a data screen deliberately. Coverage is
 * not a figure about the business, it is a fact about the tool, and mixing the
 * two on an overview would invite reading a gap in the archive as a slow week
 * in the shop.
 *
 * Since the move to IndexedDB the figures come from two different places, and
 * the pane is careful about which is which. **Row counts** are counted through
 * the index and are exact. **Bytes** come from `navigator.storage.estimate()`,
 * are origin-wide rather than per store, and are approximate — so they are shown
 * once at the top rather than repeated per shop as if each had been measured.
 */

const FIELD_LABEL: Readonly<Record<ChangeField, TranslationKey>> = {
  price: 'dFieldPrice',
  purchasePrice: 'dFieldPurchase',
  stock: 'dFieldStock',
  rank: 'dFieldRank',
  discount: 'dFieldDiscount',
};

export function DataSettings({
  onBackfill,
  backfilling,
}: {
  readonly onBackfill: () => void;
  readonly backfilling: boolean;
}): ReactNode {
  const { t } = useTranslation();
  const connection = useConnection();
  const shops = useArchiveStore((state) => state.shops);
  const loading = useArchiveStore((state) => state.loading);
  const refresh = useArchiveStore((state) => state.refresh);

  const push = useToastStore((state) => state.push);
  const requestConfirm = useDialogStore((state) => state.requestConfirm);

  const [selected, setSelected] = useState<number | null>(null);

  /* The store list is the account's, but the archive only knows the shops it
     has stored something for — a shop added to the token this morning has no
     partition until the first sync writes one. */
  const named = useMemo(
    () =>
      shops.map((shop) => ({
        ...shop,
        name:
          connection.shops.find((entry) => entry.id === shop.shopId)?.name ??
          `shop ${shop.shopId}`,
      })),
    [connection.shops, shops],
  );

  const active = selected ?? named[0]?.shopId ?? null;

  const handleClear = useCallback(
    (shopId: number) => {
      requestConfirm({ title: t('dClearQ'), body: t('dClearB'), cta: t('dClear'), tone: 'warn' }, () => {
        void clearShop(shopId).then(async () => {
          await refresh();
          setSelected(null);
          push(t('dCleared'), { kind: 'info' });
        });
      });
    },
    [push, refresh, requestConfirm, t],
  );

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-3">
        <h1 className="m-0 text-xl font-medium tracking-[-0.02em]">{t('sData')}</h1>
        <p className="m-0 text-xs-plus text-dim">{t('dSub')}</p>
      </header>

      <DatabasePanel />
      <BufferPanel />
      <LazySyncPanel />

      {named.length === 0 ? (
        <Panel className="flex items-center gap-9 px-11 py-13 sm:px-14 text-xs-plus text-dim">
          <Database aria-hidden className="size-14 shrink-0 text-faint" />
          {loading ? t('dLoading') : t('dNoStores')}
        </Panel>
      ) : (
        <>
          <div className="flex flex-col gap-9">
            {named.map((shop) => (
              <StoreCard
                key={shop.shopId}
                shop={shop}
                name={shop.name}
                expanded={shop.shopId === active}
                onSelect={() => setSelected(shop.shopId)}
                onClear={() => handleClear(shop.shopId)}
                onBackfill={onBackfill}
                backfilling={backfilling}
              />
            ))}
          </div>

          {active !== null && <ChangePanels shopId={active} />}
        </>
      )}
    </div>
  );
}

/* ── the database itself ────────────────────────────────────────────────── */

/**
 * What the browser says about this origin's storage.
 *
 * The localStorage version of this pane had to estimate: quota could not be
 * queried, so the application budgeted against a guess of five megabytes and
 * showed a percentage of its own budget rather than of anything real. The
 * figures here come from `navigator.storage.estimate()`, and where the browser
 * declines to answer the pane says so instead of inventing a number.
 *
 * The eviction line matters more than it looks. Without a persistence grant a
 * browser reclaiming disk space may drop this database silently — and a full
 * backfill is hundreds of rate-limited requests to rebuild. The grant is
 * requested once at startup; this reports which answer it got.
 */
function DatabasePanel(): ReactNode {
  const { t } = useTranslation();
  const estimate = useArchiveStore((state) => state.estimate);
  const totalRows = useArchiveStore(selectTotalRows);

  const usageLabel = ((): string => {
    if (estimate === null) return t('dLoading');
    if (estimate.usage === null || estimate.quota === null) return t('dbQuotaNone');
    return t('dbQuota', {
      used: formatBytes(estimate.usage),
      quota: formatBytes(estimate.quota),
    });
  })();

  const saturation = estimate?.saturation ?? 0;

  return (
    <Panel className="flex flex-col gap-11 px-11 py-13 sm:px-14">
      <div className="flex flex-wrap items-center gap-8">
        <Database aria-hidden className="size-14 shrink-0 text-acc-dim" />
        <span className="text-sm-plus font-medium">{t('dbLbl')}</span>
        <span className="text-mini text-faint">{t('dbHint')}</span>
        <div className="flex-1" />
        <span data-numeric className="text-mini text-dim">
          {t('dbRows', { n: formatNumber(totalRows) })}
        </span>
        <span data-numeric className="text-mini text-faint">
          {usageLabel}
        </span>
      </div>

      {estimate?.saturation !== null && estimate?.saturation !== undefined && (
        <div className="h-4 overflow-hidden rounded-3 bg-grid">
          <div
            className={cn('h-full rounded-3', saturation > 0.9 ? 'bg-warn' : 'bg-acc')}
            style={{ width: `${Math.max(0.5, saturation * 100).toFixed(1)}%` }}
          />
        </div>
      )}

      <div className="flex items-center gap-8 border-t border-line pt-10 text-tiny">
        <span className={cn(estimate?.persisted === true ? 'text-pos' : 'text-faint')}>
          {estimate?.persisted === true ? t('dbPersisted') : t('dbEvictable')}
        </span>
      </div>
    </Panel>
  );
}

/* ── the buffer ─────────────────────────────────────────────────────────── */

/**
 * The tier between Uzum and the screens, and the one dial that governs it.
 *
 * It sits above the archive panels because it is the first thing that decides
 * whether a range change costs a request: below the window, the answer is
 * already on this machine. The archive panels underneath answer the other half —
 * which *periods* are held at all.
 */
function BufferPanel(): ReactNode {
  const { t } = useTranslation();
  const push = useToastStore((state) => state.push);

  const freshnessMinutes = useSettingsStore((state) => state.settings.data.freshnessMinutes);
  const patch = useSettingsStore((state) => state.patch);

  /**
   * Read in an effect rather than during render.
   *
   * The usage figures now come from an indexed cursor walk, which is
   * asynchronous — the old version could call `bufferUsage()` inline because
   * localStorage answered synchronously. `tick` is what makes emptying the
   * buffer refresh the read-out, since nothing else publishes that change.
   */
  const [usage, setUsage] = useState<BufferUsage | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    void bufferUsage()
      .then((result) => {
        if (live) setUsage(result);
      })
      .catch(() => {
        if (live) setUsage(null);
      });

    return () => {
      live = false;
    };
  }, [tick]);

  const label = (minutes: number): string =>
    minutes >= 60 ? t('freshHour', { n: minutes / 60 }) : t('freshMin', { n: minutes });

  const saturation = usage?.saturation ?? 0;

  return (
    <Panel className="flex flex-col gap-11 px-11 py-13 sm:px-14">
      <div className="flex flex-wrap items-center gap-8">
        <Layers aria-hidden className="size-14 shrink-0 text-acc-dim" />
        <span className="text-sm-plus font-medium">{t('bufLbl')}</span>
        <span className="text-mini text-faint">{t('bufHint')}</span>
        <div className="flex-1" />
        <span data-numeric className="text-mini text-dim">
          {t('bufSlots', { n: usage?.slots ?? 0 })}
        </span>
        <span data-numeric className="text-mini text-faint">
          {formatBytes(usage?.bytes ?? 0)} · {formatPercent(saturation * 100, 0)}
        </span>
      </div>

      <div className="h-4 overflow-hidden rounded-3 bg-grid">
        <div
          className={cn('h-full rounded-3', saturation > 0.9 ? 'bg-warn' : 'bg-acc')}
          style={{ width: `${(saturation * 100).toFixed(1)}%` }}
        />
      </div>

      <div className="grid grid-cols-[220px_minmax(0,1fr)] items-center gap-14 max-[720px]:grid-cols-1">
        <div>
          <div className="text-sm-plus">{t('freshLbl')}</div>
          <div className="text-tiny leading-[1.5] text-faint">{t('freshHint')}</div>
        </div>

        <div role="radiogroup" aria-label={t('freshLbl')} className="flex flex-wrap gap-6">
          {FRESHNESS_OPTIONS.map((minutes) => {
            const active = freshnessMinutes === minutes;
            return (
              <button
                key={minutes}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => patch({ data: { freshnessMinutes: minutes } })}
                className={cn(
                  'tap h-36 cursor-pointer rounded-7 border px-11 text-xs-plus transition-colors md:h-26 md:px-10',
                  active
                    ? 'border-acc bg-acc-soft text-acc-dim'
                    : 'border-line-2 bg-transparent text-dim hover:border-acc-line',
                )}
              >
                {label(minutes)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-8 border-t border-line pt-10">
        <span className="text-tiny text-faint">
          {usage?.newestAt == null ? t('syncNever') : formatStamp(usage.newestAt)}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => {
            void clearBuffer().then(() => {
              setTick((value) => value + 1);
              push(t('bufCleared'), { kind: 'info' });
            });
          }}
          className={cn(
            'tap flex h-36 cursor-pointer items-center gap-6 rounded-7 border border-line-2 bg-transparent md:h-26',
            'px-10 text-xs-plus text-dim transition-colors hover:border-neg hover:text-neg',
          )}
        >
          <Trash2 aria-hidden className="size-12" />
          {t('bufClear')}
        </button>
      </div>
    </Panel>
  );
}

/* ── one store ──────────────────────────────────────────────────────────── */

function StoreCard({
  shop,
  name,
  expanded,
  onSelect,
  onClear,
  onBackfill,
  backfilling,
}: {
  readonly shop: ShopArchiveView;
  readonly name: string;
  readonly expanded: boolean;
  readonly onSelect: () => void;
  readonly onClear: () => void;
  readonly onBackfill: () => void;
  readonly backfilling: boolean;
}): ReactNode {
  const { t } = useTranslation();

  const sealedTo = Date.now() - SETTLEMENT_LAG_MS;
  const stored = shop.from !== null && shop.to !== null;

  const rows = shop.usage.rows;

  return (
    <Panel
      className={cn(
        'overflow-hidden transition-colors',
        expanded ? 'border-acc-line' : 'hover:border-line-2',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex w-full cursor-pointer items-center gap-9 border-0 bg-transparent px-11 py-11 sm:px-14 text-left',
        )}
      >
        <Layers aria-hidden className={cn('size-14 shrink-0', expanded ? 'text-acc-dim' : 'text-faint')} />
        <span className="text-sm-plus font-medium">{name}</span>
        <span data-numeric className="text-mini text-faint">
          {shop.shopId}
        </span>
        <div className="flex-1" />
        <span data-numeric className="text-mini text-faint">
          {t('dbRows', { n: formatNumber(shop.usage.totalRows) })}
        </span>
      </button>

      <div className="flex flex-col gap-11 border-t border-line px-11 py-12 sm:px-14">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-baseline gap-8">
            <span className="text-meta uppercase tracking-[0.09em] text-faint">
              {t('dCoverage')}
            </span>
            {stored ? (
              <>
                <span data-numeric className="text-sm-plus">
                  {formatStamp(shop.from ?? 0)} — {formatStamp(shop.to ?? 0)}
                </span>
                <span className="text-mini text-dim">
                  {t('dCovDays', { n: formatNumber(Math.round(shop.days)) })}
                </span>
                <span className={cn('text-mini', shop.density < 0.999 ? 'text-warn' : 'text-pos')}>
                  · {shop.density < 0.999 ? t('dCovGaps') : t('dCovWhole')}
                </span>
              </>
            ) : (
              <span className="text-xs text-faint">{t('dCovNone')}</span>
            )}
          </div>

          <CoverageBar ranges={shop.ledgerRanges} sealedTo={sealedTo} />

          {stored && (
            <div className="flex flex-wrap items-center gap-8 text-tiny text-faint">
              <span>
                {t('dSettled')}: <span data-numeric>{formatStamp(Math.min(sealedTo, shop.to ?? 0))}</span>
              </span>
              <span className="text-line-2">·</span>
              <span>{t('dPending')}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-4 gap-px overflow-hidden rounded-9 border border-line bg-line max-[820px]:grid-cols-2">
          <Metric label={t('dRows')} value={formatNumber(rows[ENTITY_TYPES.orderItem] ?? 0)} />
          <Metric label={t('dExpRows')} value={formatNumber(rows[ENTITY_TYPES.expense] ?? 0)} />
          <Metric label={t('dSkus')} value={formatNumber(rows[ENTITY_TYPES.productSku] ?? 0)} />
          <Metric
            label={t('dJournal')}
            value={formatNumber(rows[ENTITY_TYPES.changeEvent] ?? 0)}
            meta={shop.catalogAt === null ? undefined : formatStamp(shop.catalogAt)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-8">
          {shop.backfillComplete ? (
            <span className="flex items-center gap-6 text-xs text-pos">
              <History aria-hidden className="size-12" />
              {t('dBackfillDone')}
            </span>
          ) : (
            <button
              type="button"
              onClick={onBackfill}
              disabled={backfilling}
              className={cn(
                'tap flex h-36 cursor-pointer items-center gap-6 rounded-7 border border-acc bg-acc-soft md:h-26',
                'px-10 text-xs-plus font-medium text-acc-dim transition-colors hover:bg-acc-strong',
                'disabled:cursor-not-allowed disabled:opacity-45',
              )}
            >
              <History aria-hidden className={cn('size-12', backfilling && 'animate-spin')} />
              {backfilling ? t('dBackfillRun') : t('dBackfill')}
            </button>
          )}

          <div className="flex-1" />

          <button
            type="button"
            onClick={onClear}
            className={cn(
              'tap flex h-36 cursor-pointer items-center gap-6 rounded-7 border border-line-2 bg-transparent md:h-26',
              'px-10 text-xs-plus text-dim transition-colors hover:border-neg hover:text-neg',
            )}
          >
            <Trash2 aria-hidden className="size-12" />
            {t('dClear')}
          </button>
        </div>
      </div>
    </Panel>
  );
}

/**
 * The coverage record, drawn to scale.
 *
 * Each filled segment is a stretch actually held; the gaps between them are
 * periods the next request will plan for. The sealed portion is drawn solid and
 * the provisional tail lighter, because those are genuinely different claims:
 * one will never be read again, the other is re-read every run.
 */
function CoverageBar({
  ranges,
  sealedTo,
}: {
  readonly ranges: Coverage;
  readonly sealedTo: number;
}): ReactNode {
  const outer = bounds(ranges);
  if (outer === null) {
    return <div className="h-8 rounded-4 border border-dashed border-line-2" />;
  }

  const total = Math.max(1, outer.toMs - outer.fromMs);

  return (
    <div className="relative h-8 overflow-hidden rounded-4 bg-grid">
      {ranges.map((range) => {
        const left = ((range.fromMs - outer.fromMs) / total) * 100;
        const width = ((range.toMs - range.fromMs) / total) * 100;
        const settledEnd = Math.min(range.toMs, sealedTo);
        const settledWidth =
          settledEnd <= range.fromMs ? 0 : ((settledEnd - range.fromMs) / total) * 100;

        return (
          <div key={`${range.fromMs}-${range.toMs}`}>
            <div
              className="absolute inset-y-0 bg-acc-soft"
              style={{ left: `${left}%`, width: `${width}%` }}
            />
            <div
              className="absolute inset-y-0 bg-acc"
              style={{ left: `${left}%`, width: `${settledWidth}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

function Metric({
  label,
  value,
  meta,
}: {
  readonly label: string;
  readonly value: string;
  readonly meta?: string | undefined;
}): ReactNode {
  return (
    <div className="flex flex-col gap-2 bg-ground px-10 py-9">
      <span className="text-meta uppercase tracking-[0.09em] text-faint">{label}</span>
      <span data-numeric className="truncate text-md">
        {value}
      </span>
      {meta !== undefined && <span className="truncate text-mini text-dim">{meta}</span>}
    </div>
  );
}

/* ── group 3: what changed, and what it did ─────────────────────────────── */

function ChangePanels({ shopId }: { readonly shopId: number }): ReactNode {
  const { t } = useTranslation();
  const analysis = useArchiveAnalysis(shopId);

  return (
    <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-12 max-[980px]:grid-cols-1">
      <Panel className="flex flex-col gap-9 px-11 py-13 sm:px-14">
        <div className="flex flex-col gap-3">
          <span className="text-sm-plus font-medium">{t('dImpact')}</span>
          <p className="m-0 text-tiny leading-[1.5] text-faint">{t('dImpactNote')}</p>
        </div>

        {analysis.moves.length === 0 ? (
          <span className="text-xs text-faint">
            {analysis.loading ? t('dLoading') : t('dImpactEmpty')}
          </span>
        ) : (
          analysis.moves.slice(0, 8).map((move) => (
            <div
              key={move.id}
              className="flex flex-col gap-5 border-b border-line pb-8 last:border-b-0 last:pb-0"
            >
              <div className="flex items-baseline gap-8">
                <span className="min-w-0 flex-1 truncate text-xs-plus">{move.title}</span>
                <span data-numeric className="shrink-0 text-mini text-faint">
                  {formatStamp(move.at)}
                </span>
              </div>

              <div className="flex flex-wrap items-baseline gap-8 text-mini">
                <span
                  data-numeric
                  className={cn(move.movePct < 0 ? 'text-warn' : 'text-acc-dim')}
                >
                  {t('dFieldPrice')} {formatDelta(move.movePct)}
                </span>
                <span className="text-line-2">→</span>
                <span
                  data-numeric
                  className={cn(
                    !move.confident ? 'text-faint' : move.demandPct >= 0 ? 'text-pos' : 'text-neg',
                  )}
                >
                  {formatDelta(move.demandPct)}
                </span>
                <span className="text-faint">
                  {t('dImpactPerDay', { n: formatNumber(move.before.perDay, 2) })} →{' '}
                  {t('dImpactPerDay', { n: formatNumber(move.after.perDay, 2) })}
                </span>
                {!move.confident && (
                  <span className="text-tiny text-faint">· {t('dImpactWeak')}</span>
                )}
              </div>
            </div>
          ))
        )}
      </Panel>

      <Panel className="flex flex-col gap-8 px-11 py-13 sm:px-14">
        <div className="flex flex-col gap-3">
          <span className="text-sm-plus font-medium">{t('dJournal')}</span>
          <p className="m-0 text-tiny leading-[1.5] text-faint">{t('dJournalSub')}</p>
        </div>

        {analysis.changes.length === 0 ? (
          <span className="text-xs text-faint">
            {analysis.loading ? t('dLoading') : t('dJournalEmpty')}
          </span>
        ) : (
          <>
            <span className="text-tiny text-faint">
              {t('dJournalSince', { date: formatStamp(analysis.changes.at(-1)?.at ?? 0) })}
            </span>

            <div className="flex flex-col">
              {analysis.changes.slice(0, 14).map((event, index) => (
                <div
                  key={`${event.at}-${event.skuId}-${event.field}-${index}`}
                  className="flex items-center gap-8 border-b border-line py-5 text-mini last:border-b-0"
                >
                  <span className="w-52 shrink-0 text-dim">{t(FIELD_LABEL[event.field])}</span>
                  <span data-numeric className="min-w-0 flex-1 truncate font-mono text-faint">
                    {event.skuId}
                  </span>
                  <span data-numeric className="shrink-0 text-dim">
                    {describeValue(event.field, event.from, t('dOn'), t('dOff'))} →{' '}
                    {describeValue(event.field, event.to, t('dOn'), t('dOff'))}
                  </span>
                  <span data-numeric className="w-64 shrink-0 text-right text-tiny text-faint">
                    {formatStamp(event.at)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

/* ── formatting ─────────────────────────────────────────────────────────── */

/** A discount is a flag, a rank is an index, everything else is a number. */
function describeValue(field: ChangeField, value: number, on: string, off: string): string {
  if (field === 'discount') return value === 1 ? on : off;
  if (field === 'rank') return value < 0 ? '—' : ['A', 'B', 'C', 'D', 'E'][value] ?? '—';
  return formatNumber(value);
}
