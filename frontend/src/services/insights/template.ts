import { formatFact, type FactTable } from './facts';
import type { Language } from '@/types/domain';

/**
 * Numbers inside a sentence, without the model writing one.
 *
 * A standalone `metric` block keeps a figure honest but reads like a form.
 * Prose wants the number in the middle of the clause — "net profit is 457 924
 * of 4 966 180 sellPrice (9.2%)" — and the moment the model is allowed to type
 * that, the whole guarantee in `facts.ts` is gone.
 *
 * So a text run is a template: `{{totals.netProfit}}` marks a hole, and the
 * application fills it from the fact table in the user's locale and currency.
 *
 * ## Why a template and not a span array
 *
 * The obvious alternative is a structured array — `[{t:'text'}, {t:'ref'}, …]`
 * — which is more explicit and three to four times more expensive. Every extra
 * token is latency the user watches accumulate during a stream and money they
 * are charged for. A model produces `{{ref}}` reliably, and an unresolved
 * placeholder degrades to a visible marker rather than a wrong number.
 */

export type Segment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'value'; readonly text: string }
  /** A placeholder naming a fact that does not exist. Rendered, not hidden. */
  | { readonly kind: 'missing'; readonly ref: string };

const PLACEHOLDER = /\{\{\s*([^}\s]+)\s*\}\}/g;

/**
 * Split a template into what to draw.
 *
 * A missing ref becomes a `missing` segment rather than being silently dropped:
 * a sentence whose figure quietly vanished reads as a complete sentence that
 * happens to be wrong, whereas a visible marker reads as what it is — a hole.
 */
export function resolveTemplate(
  text: string,
  facts: FactTable,
  language: Language,
): readonly Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  /* `matchAll` rather than `exec` in a loop: the regex is module-level and
     therefore stateful, and a shared `lastIndex` across calls is a classic way
     to lose every second match. */
  for (const match of text.matchAll(PLACEHOLDER)) {
    const at = match.index;
    const ref = match[1];
    if (at === undefined || ref === undefined) continue;

    if (at > cursor) segments.push({ kind: 'text', text: text.slice(cursor, at) });

    const fact = facts.get(ref);
    segments.push(
      fact === undefined
        ? { kind: 'missing', ref }
        : { kind: 'value', text: formatFact(fact, language) },
    );

    cursor = at + match[0].length;
  }

  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) });

  return segments;
}

/** The same resolution, flattened — for exports and for prompt history. */
export function renderTemplate(text: string, facts: FactTable, language: Language): string {
  return resolveTemplate(text, facts, language)
    .map((segment) => (segment.kind === 'missing' ? '—' : segment.text))
    .join('');
}

/** Every ref a template cites, for validating one before it is shown. */
export function templateRefs(text: string): readonly string[] {
  return [...text.matchAll(PLACEHOLDER)]
    .map((match) => match[1])
    .filter((ref): ref is string => ref !== undefined);
}
