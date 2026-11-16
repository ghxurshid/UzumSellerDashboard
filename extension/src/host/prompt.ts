import { buildSystemPrompt, type PromptHost } from '@core/agent/systemPrompt';
import type { Language } from '@core/types/common';

import type { SellerSession } from '@ext/uzum/session';

/**
 * The extension's system prompt: the generic protocol prompt with the parts
 * only this host can say.
 *
 * The site's model sits on an archive the seller has synced, over a period the
 * seller has selected. This one sits in a panel inside the seller cabinet and
 * has neither: every lookup is a live request through the cabinet tab, nothing
 * is kept between questions, and the cabinet API's response fields are
 * documented nowhere. What is known of them was read from recorded traffic —
 * for the product list, two requests and ONE response holding one product with
 * five SKUs — and is stated, with that strength, in the toolkit's field legend.
 * So what differs from the site is mostly *what the model may claim*: that a
 * figure is so'm, that a list is complete, that a counter is this month's, that
 * it can see the page. Each of those is a confident sentence the evidence does
 * not support, and this file is where the model is told so.
 *
 * The prompt describes the situation, never the catalogue. Which lookups exist,
 * and what one sample showed about their fields, is the toolkit document's
 * business (`@ext/tools`); the prompt only tells the model to hold that legend
 * to the strength it states. So a lookup added there needs no word changed
 * here, and the legend is never said twice.
 *
 * What the session contributes is deliberately narrow: whether the seller is
 * signed in, the shop ids, and the shop the page is showing. `sellerId`,
 * `accountId` and the permission codes stay out — nothing the model does needs
 * them, and an identifier sent to an LLM provider without a reason is one sent
 * for none.
 */

const EXT_IDENTITY: readonly string[] = [
  'You are the analyst inside Savdo Copilot, a panel one Uzum Market seller has opened inside',
  'their own seller cabinet. You are talking to that seller, about their own business, while',
  'they work in the cabinet.',
];

const EXT_TOPICS: readonly string[] = [
  'Their products and catalogue, prices, stock and supply, sales and revenue, orders and',
  'deliveries, returns, commission and logistics, profit and unit economics — and what to do',
  'about any of it. Operational questions about running the shop count: what is out of stock,',
  'what needs attention today, what to reprice, what to reorder.',
  'Everything else is outside. Politics, medicine, law, general programming, world knowledge,',
  'other sellers\' data, and anything about evading marketplace rules, taxes or customs. Say',
  'in one sentence that it is not what you are here for, offer the nearest thing you can',
  'actually help with, and stop. Do not argue and do not lecture.',
];

/*
 * Three sentences here answer what the recorded response turned out to carry,
 * without naming a field of it:
 *
 *   - Counters with no dates (`quantitySold`, `quantityReturned`): the request
 *     sends no period and the response states none, so "sold 8" is not "sold 8
 *     this month", however much the question invites it.
 *   - The response's own total (`totalProductsAmount`) is a count of products.
 *     Knowing there are 38 does not make a sum over 24 rows a shop figure, which
 *     the old wording ("unless a result states how many there are") let it be.
 *   - The payload carries flags and grades of the API's own (`forecastOutOfStock`,
 *     `rankInfo.rank`), so "the cabinet API returns no such data" stopped being
 *     true. What stays true is that the model makes none of its own.
 *
 * `"money"` prints so'm beside the number. The recorded price has the magnitude
 * of so'm and no unit, and the legend says exactly that; a format that prints
 * the currency would turn the legend's "looks like" into a statement.
 */
const EXT_PROVENANCE: readonly string[] = [
  'Every lookup is a live request to the cabinet\'s own API, sent through this browser tab with',
  'the seller\'s own sign-in, one at a time. Nothing is kept between questions and no period is',
  'chosen for you: what you know is what a result contains, as of the moment it was read. A',
  'trend, a comparison with an earlier period or "since last week" exists only if a result',
  'carries the dated figures for it. A counter with no dates beside it — sold, returned —',
  'covers a period the result does not name: never present it as this week\'s or this month\'s.',
  'You do not see the cabinet page — only what a lookup hands back. When the seller points at',
  'something on screen ("this product", "that number"), look it up or ask which one; never',
  'describe a page you have not read.',
  'The cabinet API is not documented. Read every field by the name the result gives it, and',
  'do not assume a unit, a currency or a meaning that neither the result nor the toolkit',
  'states. What the toolkit says of a field was read from recorded samples, not from any',
  'documentation: repeat it with the strength the toolkit gives it — a "probably" stays',
  'probably. When a figure could mean more than one thing, show it under its field name and',
  'say, once, that the cabinet does not label it. A format is a claim about the unit:',
  '"money" prints so\'m beside the number, so use it only for a figure a result or the toolkit',
  'states is so\'m — a size that looks like so\'m is not that statement — and "percent" only',
  'for a figure stated to be a percentage. Otherwise use "number", or "count" for items.',
  'You analyse what comes back: every figure you state is either copied from a result or',
  'calculated by you from figures in results, and you do that arithmetic carefully. When a',
  'figure you show is your own calculation, say how you reached it. A result may be one page',
  'of a longer list. A count it states for the whole list says how many there are, not what',
  'they add up to: a sum or an "all products" figure covers only the rows you read, and the',
  'whole list only once you have read every row of that count — say how many of how many, and',
  'read further pages only when the question needs them. If the data you need is not in a',
  'result, look it up or say it is not there — never fill the gap with a plausible number. If',
  'no lookup can read it, say that this version cannot read it yet.',
  'A lookup refused because the sign-in expired or the account lacks access to that shop will',
  'not succeed on a retry. Tell the seller what would fix it — signing in to the cabinet again,',
  'or access to that shop — rather than running it again.',
  'You do not forecast, predict, score or rank against other sellers. A flag or a grade the',
  'API itself returns is reported as the API\'s, under its field name, with no prediction or',
  'comparison of your own built on it. You say what the results show.',
];

/*
 * In place of the protocol's "a write is a button you place": no lookup here
 * writes and no button changes anything, so that sentence would have the model
 * promise a button it cannot draw. When the extension gains a write action — a
 * route the content script performs behind a confirmation — this paragraph is
 * the one that changes, deliberately, together with that action.
 */
const EXT_WRITES: readonly string[] = [
  'You never write anything to Uzum yourself, and in this version nothing does: every lookup',
  'only reads and no button changes anything. If the seller asks you to change something at',
  'Uzum — a price, stock, a product card, an order — say plainly that you cannot do that from',
  'here yet, and offer what you can read instead. Never describe a change as made.',
];

/**
 * The ids the prompt may print.
 *
 * The session crosses a `MessagePort` from the content script and is typed,
 * not validated, on this side. It is printed into instructions the model
 * obeys, so anything that is not a positive whole number is dropped rather
 * than interpolated — the same rule as text inside data, applied one step
 * earlier.
 */
function shopIdsOf(session: SellerSession): readonly number[] {
  const ids = Array.isArray(session.shopIds) ? session.shopIds : [];
  return ids.filter((id): id is number => Number.isSafeInteger(id) && id > 0);
}

function currentShopOf(session: SellerSession, shopIds: readonly number[]): number | null {
  const current = session.currentShopId;
  return typeof current === 'number' && shopIds.includes(current) ? current : null;
}

interface ZoneClock {
  /** The zone's canonical IANA name, as `Intl` resolved it — never the raw setting. */
  readonly zone: string;
  /** Today's calendar date in that zone, `YYYY-MM-DD`. */
  readonly date: string;
  /** The zone's offset from UTC at `now`, in whole minutes. */
  readonly offsetMinutes: number;
  /** The setting could not be used and UTC stands in for it. */
  readonly fallback: boolean;
}

function clockIn(now: number, timeZone: string): ZoneClock | null {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return null;
  }
  const parts = formatter.formatToParts(new Date(now));
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? Number.NaN);
  const year = read('year');
  const month = read('month');
  const day = read('day');
  /* The wall clock's digits read as though they were UTC, minus the instant, is
     the offset — no hand-kept table, so it is right for any zone `Intl` knows. */
  const wall = Date.UTC(year, month - 1, day, read('hour'), read('minute'), read('second'));
  if (!Number.isFinite(wall)) return null;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return {
    zone: formatter.resolvedOptions().timeZone,
    date: `${year}-${pad(month)}-${pad(day)}`,
    offsetMinutes: Math.round((wall - Math.floor(now / 1000) * 1000) / 60_000),
    fallback: false,
  };
}

/**
 * The seller's zone, from the General setting, read through `Intl`.
 *
 * The setting is persisted text and is printed into instructions the model
 * obeys, so it is never interpolated as given: only a name `Intl` accepts is
 * used, and the name printed is the one `Intl` resolved, not the stored string.
 * Anything else falls back to UTC — and the line then says UTC, not a zone the
 * seller did not get.
 */
function zoneClock(now: number, timeZone: string): ZoneClock {
  const chosen = typeof timeZone === 'string' && timeZone.trim() !== '' ? clockIn(now, timeZone.trim()) : null;
  if (chosen !== null) return chosen;
  const utc = clockIn(now, 'UTC');
  return {
    zone: 'UTC',
    date: utc?.date ?? new Date(now).toISOString().slice(0, 10),
    offsetMinutes: 0,
    fallback: true,
  };
}

function offsetLabel(minutes: number): string {
  if (minutes === 0) return 'UTC';
  const sign = minutes > 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const rest = abs % 60;
  return `UTC${sign}${Math.floor(abs / 60)}${rest === 0 ? '' : `:${String(rest).padStart(2, '0')}`}`;
}

function offsetWords(minutes: number): string {
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  const words = [
    hours === 0 ? null : `${hours} ${hours === 1 ? 'hour' : 'hours'}`,
    rest === 0 ? null : `${rest} ${rest === 1 ? 'minute' : 'minutes'}`,
  ].filter((word): word is string => word !== null);
  return `a UTC time ${minutes > 0 ? 'plus' : 'minus'} ${words.join(' ')}`;
}

/**
 * The seller's date and clock, in the zone the seller chose.
 *
 * A result prints a timestamp as UTC beside its epoch value; the seller reads
 * every timestamp in the panel in the zone set under General (Asia/Tashkent by
 * default — and the cabinet keeps Tashkent time too: the recorded promotion's
 * end fell on 23:59 Tashkent, the date in its own name). A model told "times in
 * UTC" would quote 18:59 for a promotion that ends at midnight, and a model told
 * Tashkent while the seller chose UTC would contradict every timestamp on the
 * seller's screen. So the date is the zone's, and the conversion from a result's
 * UTC is said once here, where it holds for every lookup that returns a time.
 *
 * The offset is the one in effect today. Both zones offered keep one offset all
 * year; a zone with daylight saving would make it exact only for times near now.
 */
function today(now: number, timeZone: string): string {
  const clock = zoneClock(now, timeZone);
  const whose = clock.fallback ? '' : ", the seller's setting";
  if (clock.offsetMinutes === 0) {
    const name = clock.zone === 'UTC' ? 'UTC' : `${clock.zone} (UTC)`;
    return `Today: ${clock.date} in ${name} · quote times in ${name}${whose}: a result's UTC times are already in it`;
  }
  return (
    `Today: ${clock.date} in ${clock.zone} · quote times in ${clock.zone} time (${offsetLabel(clock.offsetMinutes)})` +
    `${whose}: ${offsetWords(clock.offsetMinutes)}`
  );
}

/**
 * CONTEXT — the facts of this question.
 *
 * A signed-out tab is said here, in the one section that changes per question,
 * so the rest of the prompt stays byte-identical and a provider's cache keeps
 * serving it. The instruction rides with the fact because the protocol above it
 * says "ask for the toolkit first", and a model that obeys that in a signed-out
 * tab spends a round on a lookup the cabinet will refuse.
 */
function extensionContext(session: SellerSession, now: number, timeZone: string): readonly string[] {
  if (session.signedIn !== true) {
    return [
      'Cabinet: the seller is NOT signed in to the Uzum seller cabinet in this tab.',
      'No lookup can run. Do not open the toolkit and do not call a lookup — each would be',
      'refused. Tell the seller to sign in to the cabinet in this tab and ask again. A question',
      'that needs no data can still be answered.',
      today(now, timeZone),
    ];
  }

  const shopIds = shopIdsOf(session);

  if (shopIds.length === 0) {
    return [
      'Cabinet: signed in, in this browser tab.',
      'Shops: none. The account has no shop it can act on, so no lookup has a shop to read. Do',
      'not call one; tell the seller that this account shows no shop, and that access to a shop',
      'is granted in the cabinet.',
      today(now, timeZone),
    ];
  }

  const current = currentShopOf(session, shopIds);
  const only = shopIds.length === 1 ? shopIds[0] : undefined;

  const scope =
    only !== undefined
      ? `A question that names no shop is about shop ${only}.`
      : current !== null
        ? `A question that names no shop is about shop ${current}, the one on screen.`
        : 'A question that names no shop: ask which one, unless it is plainly about all of them.';

  return [
    'Cabinet: signed in, in this browser tab.',
    `Shops: ${shopIds.join(', ')} — ids only; a name is known only if a result gives it.`,
    current === null ? 'On screen: no particular shop.' : `On screen: shop ${current}.`,
    scope,
    today(now, timeZone),
  ];
}

/** The extension's parts for one question. */
export function extensionPromptHost(session: SellerSession, now: number, timeZone: string): PromptHost {
  return {
    identity: EXT_IDENTITY,
    topics: EXT_TOPICS,
    provenance: EXT_PROVENANCE,
    writes: EXT_WRITES,
    /* No `fieldNames`, by choice now rather than for want of evidence. One
       response has been recorded, so `quantityAvailable` or `returnedPercentage`
       could be quoted — but only as the product list's names, and only from one
       sample. An example in the system prompt is heard as "results carry these":
       a product-view result has no `paidStorageAmount`, a response the reader
       does not recognise has none of them, and the next lookup has its own. The
       gain is small: the rule is stated without examples, and every result
       already prints its column names before the model writes a word. The names
       stay in the toolkit's legend, beside the evidence for each. */
    context: extensionContext(session, now, timeZone),
  };
}

export interface ExtensionSystemInput {
  readonly language: Language;
  /** Whether the provider carries tool calls itself — see `PromptProtocol.native`. */
  readonly native: boolean;
  /** Read fresh for this question; a sign-in in another tab is picked up on the next one. */
  readonly session: SellerSession;
  readonly now: number;
  /**
   * The seller's time zone, an IANA name — the General setting the panel shows
   * every timestamp in. Passed in, not read here, so this module stays pure. An
   * unknown name falls back to UTC, and the prompt then says UTC.
   */
  readonly timeZone: string;
}

export function buildExtensionSystem(input: ExtensionSystemInput): string {
  return buildSystemPrompt(extensionPromptHost(input.session, input.now, input.timeZone), {
    language: input.language,
    native: input.native,
  });
}
