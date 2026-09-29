import type { ReactNode } from 'react';

import { Skeleton } from '@/components/ui/Skeleton';
import { findProvider } from '@/constants/settings';
import { useModelUsageLoaded, useProviderTokenUsage } from '@/hooks/useModelUsage';
import { formatNumber, formatStamp } from '@/lib/format';
import { useTranslation, type Translator } from '@/lib/i18n/useTranslation';
import { costOfTokens, formatCost } from '@/services/ai/pricing';
import type { ModelTokenTotals, TokenTotals } from '@/services/ai/usage';
import type { AiProvider } from '@/types/settings';

/**
 * What this provider has spent today, from this browser's own request log.
 *
 * A figure the provider never reported is never printed as zero — every count
 * below is gated on its own `*Reported` tally (`reported` for input/output,
 * `cachedReported`/`reasoningReported` for the two sub-figures Claude and
 * several OpenAI-compatible gateways leave out even when they do report the
 * rest), and reads "not reported" instead. A figure some but not all of the
 * reported requests stated (`0 < cachedReported < reported`, say) reads as a
 * floor — "≥ N", plus how many of the reported requests actually said so —
 * never silently as though every one of them had. `useProviderTokenUsage`
 * recomputes live as the ledger store gains events, so this panel updates
 * while the chat is still streaming, not only after Settings is reopened.
 */

/** `requests`/`input`/`output` — reported for every request that reported anything at all, or for none. */
function statLine(t: Translator, label: string, reportedCount: number, value: number): ReactNode {
  return (
    <div className="flex items-center gap-8 text-xs-plus">
      <span className="shrink-0 text-faint">{label}</span>
      <div className="mb-3 flex-1 border-b border-dotted border-line-2" />
      {reportedCount === 0 ? (
        <span className="text-mini text-faint">{`— · ${t('tokenPanelNotReported')}`}</span>
      ) : (
        <span data-numeric className="text-dim">
          {formatNumber(value)}
        </span>
      )}
    </div>
  );
}

/**
 * `cached`/`reasoning` — the two sub-figures a provider may state for only
 * *some* of the requests it reported the rest of (Claude never states
 * reasoning at all; several OpenAI-compatible gateways may state input/output
 * without stating cache). `denominator` is `reported`, how many requests said
 * anything; when `reportedCount` falls short of it the sum is a floor over an
 * unknown remainder, not the true total.
 */
function partialStatLine(
  t: Translator,
  label: string,
  reportedCount: number,
  denominator: number,
  value: number,
): ReactNode {
  const partial = reportedCount > 0 && reportedCount < denominator;

  return (
    <div className="flex items-center gap-8 text-xs-plus">
      <span className="shrink-0 text-faint">{label}</span>
      <div className="mb-3 flex-1 border-b border-dotted border-line-2" />
      {reportedCount === 0 ? (
        <span className="text-mini text-faint">{`— · ${t('tokenPanelNotReported')}`}</span>
      ) : partial ? (
        <span className="flex flex-col items-end gap-1">
          <span data-numeric className="text-dim">{`≥ ${formatNumber(value)}`}</span>
          <span className="text-mini text-faint">
            {t('tokenPanelPartialReported', { reported: reportedCount, of: denominator })}
          </span>
        </span>
      ) : (
        <span data-numeric className="text-dim">
          {formatNumber(value)}
        </span>
      )}
    </div>
  );
}

function modelLabel(provider: AiProvider, model: string): string {
  return findProvider(provider).models.find((entry) => entry.id === model)?.label ?? model;
}

/** One model's own four figures, in the same shape the total row above it uses. */
function ModelRow({ provider, entry }: { readonly provider: AiProvider; readonly entry: ModelTokenTotals }): ReactNode {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4 border-t border-line-2 pt-8 first:border-t-0 first:pt-0">
      <span className="truncate text-xs-plus font-medium">{modelLabel(provider, entry.model)}</span>
      {statLine(t, t('tokenPanelRequests'), entry.requests, entry.requests)}
      {statLine(t, t('tokenPanelInput'), entry.reported, entry.inputTokens)}
      {partialStatLine(t, t('tokenPanelCached'), entry.cachedReported, entry.reported, entry.cachedInputTokens)}
      {statLine(t, t('tokenPanelOutput'), entry.reported, entry.outputTokens)}
      {partialStatLine(t, t('tokenPanelReasoning'), entry.reasoningReported, entry.reported, entry.reasoningTokens)}
    </div>
  );
}

interface CostSummary {
  readonly dollars: number;
  readonly priced: number;
  readonly unpriced: number;
  /** At least one priced model's cache was not reported for every request its price was drawn from. */
  readonly upperBound: boolean;
  /** Requests on a priced model that reported no tokens at all, and so contributed nothing to `dollars`. */
  readonly excludedRequests: number;
}

/**
 * Dollars for the models this browser can actually price, and whether the
 * figure is exact, an upper bound, or missing some requests outright.
 *
 * `costOfTokens` prices an unreported cache as fully uncached — the correct
 * reading of "we don't know how much was cached", never "none was" — which is
 * why a model whose cache is not reported for every one of its priced
 * requests (`cachedReported < reported`) tips the sum from "≈" to "≤": the
 * true spend can only be the same or lower, never higher, than a cache-blind
 * price assumes. That only means something when a price was actually charged
 * — Ollama's `costOfTokens` is always exactly `0`, cache or not, so a `0`
 * entry never sets `upperBound` on its own. A request that reported no tokens
 * at all is a different problem: it never reaches `costOfTokens` in the first
 * place, so `excludedRequests` counts it separately rather than folding it
 * into the cache caveat.
 */
function costSummary(provider: AiProvider, byModel: readonly ModelTokenTotals[]): CostSummary {
  let dollars = 0;
  let priced = 0;
  let unpriced = 0;
  let upperBound = false;
  let excludedRequests = 0;

  for (const entry of byModel) {
    if (entry.reported === 0) continue;
    const cost = costOfTokens(provider, entry.model, entry);
    if (cost === null) {
      unpriced += 1;
      continue;
    }

    priced += 1;
    dollars += cost;
    if (cost > 0 && entry.cachedReported < entry.reported) upperBound = true;
    if (entry.reported < entry.requests) excludedRequests += entry.requests - entry.reported;
  }

  return { dollars, priced, unpriced, upperBound, excludedRequests };
}

function CostLine({ provider, byModel }: { readonly provider: AiProvider; readonly byModel: readonly ModelTokenTotals[] }): ReactNode {
  const { t } = useTranslation();
  const cost = costSummary(provider, byModel);
  if (cost.priced === 0) return null;

  return (
    <>
      <p className="m-0 text-xs-plus text-dim">
        {cost.upperBound
          ? t('tokenPanelCostAtMost', { cost: formatCost(cost.dollars) })
          : t('tokenPanelCostApprox', { cost: formatCost(cost.dollars) })}
        {cost.unpriced > 0 && ` · ${t('tokenPanelCostPartial')}`}
        {cost.excludedRequests > 0 &&
          ` · ${t('tokenPanelCostExcludesUnknown', { n: cost.excludedRequests })}`}
      </p>
      <p className="m-0 text-tiny leading-[1.5] text-faint">{t('tokenPanelCostSource')}</p>
    </>
  );
}

interface TokenUsagePanelProps {
  readonly provider: AiProvider;
}

export function TokenUsagePanel({ provider }: TokenUsagePanelProps): ReactNode {
  const { t } = useTranslation();
  const usage = useProviderTokenUsage(provider);
  const loaded = useModelUsageLoaded();

  const total: TokenTotals = usage.total;

  return (
    <div className="flex flex-col gap-11 rounded-11 border border-line bg-panel px-11 py-13 sm:px-14">
      <span className="text-sm-plus font-medium">{t('tokenPanelTitle')}</span>

      {!loaded ? (
        <div className="flex flex-col gap-6" aria-hidden>
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-[70%]" />
        </div>
      ) : total.requests === 0 ? (
        <p className="m-0 text-xs-plus text-faint">{t('tokenPanelEmpty')}</p>
      ) : (
        <>
          <div className="flex flex-col gap-6">
            {statLine(t, t('tokenPanelRequests'), total.requests, total.requests)}

            {total.reported === 0 ? (
              <p className="m-0 text-xs-plus text-faint">{t('tokenPanelNoneReported')}</p>
            ) : (
              <>
                {total.reported < total.requests && (
                  <p className="m-0 text-tiny text-faint">
                    {t('quotaUnknownTokens', { n: total.requests - total.reported })}
                  </p>
                )}
                {statLine(t, t('tokenPanelInput'), total.reported, total.inputTokens)}
                {partialStatLine(t, t('tokenPanelCached'), total.cachedReported, total.reported, total.cachedInputTokens)}
                {statLine(t, t('tokenPanelOutput'), total.reported, total.outputTokens)}
                {partialStatLine(
                  t,
                  t('tokenPanelReasoning'),
                  total.reasoningReported,
                  total.reported,
                  total.reasoningTokens,
                )}
              </>
            )}
          </div>

          {total.reported > 0 && usage.byModel.length > 1 && (
            <div className="flex flex-col gap-8 border-t border-line pt-10">
              <span className="text-mini uppercase tracking-[0.08em] text-faint">{t('tokenPanelByModel')}</span>
              {usage.byModel.map((entry) => (
                <ModelRow key={entry.model} provider={provider} entry={entry} />
              ))}
            </div>
          )}

          {usage.last !== null && (
            <div className="flex items-center gap-8 border-t border-line pt-10 text-xs-plus">
              <span className="shrink-0 text-faint">{t('tokenPanelLastReported')}</span>
              <div className="mb-3 flex-1 border-b border-dotted border-line-2" />
              <span className="text-dim">{formatStamp(usage.last.at)}</span>
              <span data-numeric className="shrink-0 text-dim">
                {t('tokenPanelLastFlow', {
                  input: formatNumber(usage.last.inputTokens ?? 0),
                  output: formatNumber(usage.last.outputTokens ?? 0),
                })}
              </span>
            </div>
          )}

          {total.reported > 0 && <CostLine provider={provider} byModel={usage.byModel} />}
        </>
      )}

      <p className="m-0 text-tiny leading-[1.5] text-faint">{t('tokenPanelSource')}</p>
    </div>
  );
}
