import { useQuery } from '@tanstack/react-query';
import { Pin, X } from 'lucide-react';
import { type ReactNode } from 'react';

import { IconButton } from '@/components/ui/IconButton';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { scopeSegment } from '@/services/api/queryKeys';
import { replayPlan, type PinnedAnswer, type ReplayResult } from '@/services/insights/pins';
import type { ToolContext } from '@/services/insights/toolkit';
import { useProductsQuery } from '@/services/queries/useProductsQuery';
import { useScope } from '@/services/queries/useScope';
import { useShops } from '@/services/queries/useConnection';
import { usePinsStore } from '@/store/pins.store';

import { BlockRenderer } from './BlockRenderer';

/**
 * Kept answers, on the dashboard.
 *
 * The card is not a screenshot of what the chat said. It holds the same blocks
 * the answer was composed from, and re-runs the lookups behind them against the
 * period that is selected *now* — so a seller who pinned "which products are
 * losing money" in August reads it in September about September.
 *
 * That is only affordable because of what is underneath. The lookups go through
 * the same door every screen uses: the archive answers when it holds the
 * window, which on the overview it already does, because the tiles above these
 * cards just loaded it.
 */
export function PinnedCards(): ReactNode {
  const pins = usePinsStore((state) => state.pins);
  if (pins.length === 0) return null;

  return (
    <section className="flex flex-col gap-9">
      {pins.map((pin) => (
        <PinnedCard key={pin.id} pin={pin} />
      ))}
    </section>
  );
}

function PinnedCard({ pin }: { readonly pin: PinnedAnswer }): ReactNode {
  const { t, language } = useTranslation();
  const scope = useScope();
  const shops = useShops();
  const { products } = useProductsQuery();
  const remove = usePinsStore((state) => state.remove);

  /**
   * Re-resolved per scope, not per render.
   *
   * The key carries the window and the shops, so moving the period selector
   * re-runs the lookups once and every card settles on the new figures. Two
   * cards built on the same lookup still pay for it twice — they are separate
   * queries — which is the price of keeping each card independent, and it is
   * paid against the archive rather than the network.
   */
  const replay = useQuery<ReplayResult>({
    queryKey: ['pin', pin.id, scopeSegment(scope)],
    enabled: scope.shopIds.length > 0 && pin.plan.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 30 * 60 * 1_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => {
      const context: ToolContext = {
        scope,
        products,
        shops: shops.map((shop) => ({ id: shop.id, name: shop.name })),
        language,
        now: Date.now(),
        signal,
      };
      return replayPlan(pin.plan, context);
    },
  });

  const facts = replay.data?.facts ?? new Map();
  const series = replay.data?.series ?? new Map();

  return (
    <article className="flex flex-col gap-9 rounded-11 border border-line bg-panel px-12 py-11">
      <header className="flex items-start gap-8">
        <Pin aria-hidden className="mt-1 size-12 shrink-0 text-acc-dim" />
        <span className="min-w-0 flex-1 text-xs-plus leading-[1.5] text-text">{pin.title}</span>
        <IconButton label={t('unpin')} size="xs" onClick={() => remove(pin.id)}>
          <X aria-hidden className="size-12" />
        </IconButton>
      </header>

      {replay.isPending && pin.plan.length > 0 ? (
        <span className="text-tiny text-faint">{t('pinLoading')}</span>
      ) : (
        <div className="flex flex-col gap-9">
          <BlockRenderer
            blocks={pin.blocks}
            facts={facts}
            series={series}
            t={t}
            language={language}
            /* A pinned card carries no buttons — `pinnableBlocks` strips them
               on the way in, because a write proposed three weeks ago carries
               parameters nobody has looked at since. */
            onAction={() => undefined}
          />
        </div>
      )}

      {/* A card whose figures could not be re-read says so. The alternative is
          a row of dashes that reads like a period with no sales. */}
      {replay.data !== undefined && replay.data.failures > 0 && (
        <span className="text-tiny text-warn">{t('pinStale')}</span>
      )}
    </article>
  );
}
