import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PATH_BY_SCREEN } from '@/constants/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useToastStore } from '@/store/toast.store';
import {
  ALERT_CLEAR_PARAMS,
  ALERT_PARAMS,
  ASK_PARAMS,
  BARCODE_PARAMS,
  CANCEL_ORDER_PARAMS,
  COMPLETE_PARAMS,
  CONFIRM_PARAMS,
  INVOICE_PARAMS,
  LABEL_PARAMS,
  NAV_PARAMS,
  ORDER_PARAMS,
  PRICE_PARAMS,
  RANGE_PARAMS,
  resolveAction,
  STOCK_PARAMS,
  type ResolvedAction,
} from '@/services/insights/actions';
import { useUzumActions } from '@/services/queries/useUzumActions';
import { useAlertsStore } from '@/store/alerts.store';
import { useChatStore } from '@/store/chat.store';
import { useFiltersStore } from '@/store/filters.store';
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
 * `high` risk actions do not run on the first press. They are held, a dialog is
 * put in front of them, and the call goes out only after the seller has seen
 * the route and confirmed. A price write suggested by a language model and
 * applied by one click is exactly the failure this design exists to prevent —
 * the model's job ends at proposing, and a human takes it from there.
 *
 * `none` is the other end of the same principle: navigating a screen or moving
 * the period selector reaches no network and changes nothing at Uzum, so the
 * model may perform those itself and the chat says what it did.
 */
export interface InsightActionRunner {
  /** Runs the action, or holds it for confirmation if it writes. */
  readonly run: (action: ResolvedAction) => void;
  /** The write awaiting confirmation, if any. */
  readonly pending: ResolvedAction | null;
  /**
   * Perform the held action, optionally with narrowed parameters.
   *
   * The dialog lets the seller drop rows from a bulk write, and what goes out
   * has to be what they reviewed — so the narrowed set is passed here rather
   * than the original being re-read from the held action.
   */
  readonly confirm: (params?: unknown) => void;
  readonly cancel: () => void;
}

/**
 * How many things a write would change.
 *
 * Used to decide whether the seller sees a list before it goes out. One SKU is
 * a button press; eight is a decision, and a decision needs the eight in front
 * of it — see `ActionConfirmDialog`.
 */
function bulkSize(action: ResolvedAction): number {
  const params = action.params as Record<string, unknown> | null;
  if (params === null || typeof params !== 'object') return 0;

  for (const key of ['entries', 'orderIds', 'skus']) {
    const value = params[key];
    if (Array.isArray(value)) return value.length;
  }

  return 0;
}

export function useInsightActionRunner(): InsightActionRunner {
  const navigate = useNavigate();
  const actions = useUzumActions();
  const setChatOpen = useUiStore((state) => state.setChatOpen);
  const queue = useChatStore((state) => state.queue);
  const setRange = useFiltersStore((state) => state.setRange);
  const upsertAlert = useAlertsStore((state) => state.upsert);
  const clearAlerts = useAlertsStore((state) => state.remove);
  const { t } = useTranslation();
  const push = useToastStore((state) => state.push);

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
        case 'ui.range': {
          const { rangeKey } = RANGE_PARAMS.parse(action.params);
          setRange(rangeKey);
          return;
        }
        /* A rule is app state rather than a request, so it takes effect at
           once — and says so, because a silent change to what the bell will
           announce is a change the seller cannot see. */
        case 'alert.create': {
          const { kind, threshold } = ALERT_PARAMS.parse(action.params);
          const rule = upsertAlert(kind, threshold);
          push(t('alSet', { kind: rule.kind, t: rule.threshold }), { kind: 'ok' });
          return;
        }
        case 'alert.clear': {
          const { kind } = ALERT_CLEAR_PARAMS.parse(action.params);
          const removed = clearAlerts(kind ?? null);
          push(t('alCleared', { n: removed }), { kind: 'info' });
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
        case 'order.cancel': {
          const { orderId, reason, comment } = CANCEL_ORDER_PARAMS.parse(action.params);
          void actions.cancelOrder(orderId, reason, comment ?? '');
          return;
        }
        case 'dbs.deliver': {
          const { orderId } = ORDER_PARAMS.parse(action.params);
          void actions.deliverOrder(orderId);
          return;
        }
        case 'dbs.complete': {
          const { orderId, issueCode } = COMPLETE_PARAMS.parse(action.params);
          void actions.completeOrder(orderId, issueCode);
          return;
        }
        case 'dbs.refund': {
          const { orderId } = ORDER_PARAMS.parse(action.params);
          void actions.refundOrder(orderId);
          return;
        }
        case 'invoice.cancel': {
          const { invoiceId } = INVOICE_PARAMS.parse(action.params);
          void actions.cancelInvoice(invoiceId);
          return;
        }
        case 'print.orderLabel': {
          const { orderId, size } = LABEL_PARAMS.parse(action.params);
          void actions.printOrderLabel(orderId, size);
          return;
        }
        case 'print.skuLabels': {
          const { shopId, barcodeTypeId, skus } = BARCODE_PARAMS.parse(action.params);
          void actions.printSkuLabels(shopId, barcodeTypeId, skus);
          return;
        }
        case 'print.supplyAct': {
          const { invoiceId } = INVOICE_PARAMS.parse(action.params);
          void actions.printSupplyAct(invoiceId);
          return;
        }
        case 'print.acceptanceAct': {
          const { invoiceId } = INVOICE_PARAMS.parse(action.params);
          void actions.printAcceptanceAct(invoiceId);
          return;
        }
      }
    },
    [actions, clearAlerts, navigate, push, queue, setChatOpen, setRange, t, upsertAlert],
  );

  const run = useCallback(
    (action: ResolvedAction) => {
      /* High risk always asks. So does any write carrying more than one entry,
         whatever its risk: confirming forty orders in one press is reversible
         in principle and unreviewable in practice. */
      if (action.definition.risk === 'high' || bulkSize(action) > 1) {
        setPending(action);
        return;
      }
      perform(action);
    },
    [perform],
  );

  const confirm = useCallback(
    (params?: unknown) => {
      setPending((held) => {
        if (held !== null) {
          /* Re-validated against the registry, because the dialog narrowed the
             parameters and a set narrowed to nothing must not go out. */
          const narrowed =
            params === undefined ? held : resolveAction(held.actionId, params);
          if (narrowed !== null) perform(narrowed);
        }
        return null;
      });
    },
    [perform],
  );

  const cancel = useCallback(() => setPending(null), []);

  return { run, pending, confirm, cancel };
}
