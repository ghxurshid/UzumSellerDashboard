import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import type { CopilotHost } from '@core/ui/chat/host';
import {
  useInsightActionRunner,
  type InsightActionRunner,
} from '@/features/insights/useInsightActionRunner';
import type { InsightActionId } from '@/services/insights/actions';
import { pinnableBlocks } from '@/services/insights/pins';
import { buildBaseSystem } from '@/services/insights/prompt';
import { SITE_TOOLKIT } from '@/services/insights/siteToolkit';
import type { ToolContext } from '@/services/insights/toolkit';
import { useShops } from '@/services/queries/useConnection';
import { useProductsQuery } from '@/services/queries/useProductsQuery';
import { useScope } from '@/services/queries/useScope';
import { usePinsStore } from '@/store/pins.store';

/** Opening questions for an empty thread. */
const SITE_SUGGESTIONS = ['explainQ', 'qStock', 'qOps'] as const;

export type SiteCopilotHost = CopilotHost<ToolContext, InsightActionId>;

/**
 * The site's side of the Copilot panel.
 *
 * Everything the shared panel may not import is assembled here, from the places
 * the site keeps it: the scope and shops the seller selected, the catalogue
 * already in the query cache, the site's prompt and lookups, the action runner
 * that owns the writes and their confirmation, the pin list and the router.
 * The runner is returned alongside the host because its confirmation dialog is
 * drawn by the site, into the panel's `overlays` slot.
 *
 * `prepare` reads the scope and catalogue as they were when the host was last
 * built, which is what the panel did before the split: a question uses the
 * period on screen when it is asked.
 */
export function useSiteCopilotHost(): {
  readonly host: SiteCopilotHost;
  readonly runner: InsightActionRunner;
} {
  const scope = useScope();
  const shops = useShops();
  const { products } = useProductsQuery();
  const runner = useInsightActionRunner();
  const navigate = useNavigate();

  const pins = usePinsStore((state) => state.pins);
  const addPin = usePinsStore((state) => state.add);

  const { run } = runner;

  const host = useMemo<SiteCopilotHost>(() => {
    const selected = new Set(scope.shopIds);
    const shopNames = shops.filter((shop) => selected.has(shop.id)).map((shop) => shop.name);

    return {
      toolkit: SITE_TOOLKIT,

      prepare: ({ language, now, native: nativeTools, signal }) =>
        Promise.resolve({
          system: buildBaseSystem({ language, scope, shopNames, now, native: nativeTools }),
          context: {
            scope,
            products,
            shops: shops.map((shop) => ({ id: shop.id, name: shop.name })),
            language,
            now,
            signal,
          },
          window: { fromMs: scope.fromMs, toMs: scope.toMs },
        }),

      runAction: run,
      openSettings: () => void navigate('/settings'),
      suggestions: SITE_SUGGESTIONS,

      pins: {
        isPinned: (id) => pins.some((pin) => pin.id === id),
        add: addPin,
        pinnable: pinnableBlocks,
      },
    };
  }, [addPin, navigate, pins, products, run, scope, shops]);

  return { host, runner };
}
