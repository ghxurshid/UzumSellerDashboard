import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PATH_BY_SCREEN } from '@/constants/navigation';
import {
  ASK_PARAMS,
  CONFIRM_PARAMS,
  NAV_PARAMS,
  PRICE_PARAMS,
  STOCK_PARAMS,
  type ResolvedAction,
} from '@/services/insights/actions';
import { useUzumActions } from '@/services/queries/useUzumActions';
import { useChatStore } from '@/store/chat.store';
import { useUiStore } from '@/store/ui.store';

/**
 * Turning a card's button into the thing it says it does.
 *
 * The writes already existed — `useUzumActions` owns every request this
 * application can send, with its progress bar, its toast, its notification and
 * its cache invalidation. Nothing about that is re-implemented here; this maps
 * a validated `actionId` onto one of them, which is the whole reason the
 * registry is a registry.
 *
 * ## The gate in front of the writes
 *
 * `high` risk actions do not run on the first press. They are held, the rail
 * puts a dialog in front of them, and the call goes out only after the seller
 * has seen the route and confirmed. A price write suggested by a language model
 * and applied by one click is exactly the failure this design exists to
 * prevent — the model's job ends at proposing, and a human takes it from there.
 */
export interface InsightActionRunner {
  /** Runs the action, or holds it for confirmation if it writes. */
  readonly run: (action: ResolvedAction) => void;
  /** The write awaiting confirmation, if any. */
  readonly pending: ResolvedAction | null;
  readonly confirm: () => void;
  readonly cancel: () => void;
}

export function useInsightActionRunner(): InsightActionRunner {
  const navigate = useNavigate();
  const actions = useUzumActions();
  const setChatOpen = useUiStore((state) => state.setChatOpen);
  const queue = useChatStore((state) => state.queue);

  const [pending, setPending] = useState<ResolvedAction | null>(null);

  /**
   * Parameters are re-parsed rather than cast.
   *
   * `resolveAction` already validated them, so this cannot fail in practice —
   * but a `parse` costs nothing here and gives each branch a real type instead
   * of an assertion that would silently rot if a schema changed.
   */
  const perform = useCallback(
    (action: ResolvedAction) => {
      switch (action.actionId) {
        case 'nav.open': {
          const { screen } = NAV_PARAMS.parse(action.params);
          void navigate(PATH_BY_SCREEN[screen]);
          return;
        }
        case 'copilot.ask': {
          const { question } = ASK_PARAMS.parse(action.params);
          queue(question);
          setChatOpen(true);
          return;
        }
        case 'product.price': {
          const { shopId, entries } = PRICE_PARAMS.parse(action.params);
          void actions.updatePrice(shopId, entries);
          return;
        }
        case 'stock.update': {
          const { entries } = STOCK_PARAMS.parse(action.params);
          void actions.updateStock(entries);
          return;
        }
        case 'order.confirm': {
          const { orderIds } = CONFIRM_PARAMS.parse(action.params);
          void actions.confirmOrders(orderIds);
          return;
        }
      }
    },
    [actions, navigate, queue, setChatOpen],
  );

  const run = useCallback(
    (action: ResolvedAction) => {
      if (action.definition.risk === 'high') {
        setPending(action);
        return;
      }
      perform(action);
    },
    [perform],
  );

  const confirm = useCallback(() => {
    setPending((held) => {
      if (held !== null) perform(held);
      return null;
    });
  }, [perform]);

  const cancel = useCallback(() => setPending(null), []);

  return { run, pending, confirm, cancel };
}
