import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';

import { useTranslation } from '@/lib/i18n/useTranslation';
import { summariseFinance } from '@/services/derive/finance';
import { toProducts } from '@/services/derive/products';
import { evaluateAlerts, type AlertRule } from '@/services/insights/alerts';
import { expensesQuery, financeQuery, ordersQuery, productsQuery } from '@/services/queries/sources';
import { useScope } from '@/services/queries/useScope';
import { useAlertsStore } from '@/store/alerts.store';
import { useNotificationsStore } from '@/store/notifications.store';
import { useToastStore } from '@/store/toast.store';

/**
 * The standing rules, checked wherever the seller happens to be.
 *
 * Mounted at the shell rather than on a screen, because a rule exists precisely
 * for the times nobody is looking at the screen that would have shown the
 * problem. It renders nothing.
 *
 * ## It watches; it does not fetch
 *
 * Every query below is a plain read of the archive — no `sync`. That is the
 * difference between a feature and a tax: a watcher that fetched would turn
 * "tell me when a SKU runs out" into a finance and catalogue request from every
 * screen in the application, including the ones that have nothing to do with
 * either. Rows arrive when a screen or a sync brings them, and the rules are
 * re-checked when they do.
 *
 * ## Nothing is mounted until a rule exists
 *
 * A seller with no rules pays nothing at all, which is why the queries live in
 * a child that is only rendered when there is something to check. Hooks cannot
 * be called conditionally; components can be rendered conditionally.
 */
export function AlertWatch(): ReactNode {
  const rules = useAlertsStore((state) => state.rules);
  return rules.length === 0 ? null : <Watcher rules={rules} />;
}

function Watcher({ rules }: { readonly rules: readonly AlertRule[] }): ReactNode {
  const { t } = useTranslation();
  const scope = useScope();
  const ready = scope.shopIds.length > 0;

  const markFired = useAlertsStore((state) => state.markFired);
  const notify = useNotificationsStore((state) => state.notify);
  const push = useToastStore((state) => state.push);

  /* What each rule actually needs, so a stock rule does not read the ledger. */
  const needsStock = rules.some((rule) => rule.kind.startsWith('stock.'));
  const needsOrders = rules.some((rule) => rule.kind === 'order.deadline');
  const needsMoney = rules.some(
    (rule) => rule.kind === 'margin.below' || rule.kind === 'cancel.above',
  );

  const catalogue = useQuery(productsQuery(scope, { enabled: ready && needsStock }));
  const orders = useQuery(ordersQuery(scope, { enabled: ready && needsOrders }));
  const finance = useQuery(financeQuery(scope, { enabled: ready && needsMoney }));
  const expenses = useQuery(expensesQuery(scope, { enabled: ready && needsMoney }));

  const products = useMemo(
    () => toProducts(catalogue.data?.products ?? []),
    [catalogue.data],
  );

  const totals = useMemo(() => {
    if (finance.data === undefined) return null;
    return summariseFinance(finance.data.items, expenses.data?.payments ?? [], {
      cancelledTotal: finance.data.cancelledTotal,
      reportedTotal: finance.data.total,
    });
  }, [expenses.data, finance.data]);

  /**
   * Findings already announced in this session.
   *
   * The store's own cooldown survives reloads and is the real gate; this is the
   * cheaper one in front of it, so a render caused by something unrelated
   * cannot re-announce a finding in the moment between the notification and the
   * store write.
   */
  const announced = useRef(new Set<string>());

  useEffect(() => {
    const now = Date.now();
    const firings = evaluateAlerts(rules, {
      products,
      orders: orders.data?.orders ?? [],
      totals,
      now,
    });

    for (const firing of firings) {
      const seen = `${firing.ruleId}:${firing.signature}`;
      if (announced.current.has(seen)) continue;
      announced.current.add(seen);

      const text = t(firing.key, firing.vars);
      notify(text, { icon: 'bell', tone: 'warning', dedupeKey: firing.ruleId });
      push(text, { kind: 'warn' });
      markFired(firing.ruleId, firing.signature, now);
    }
  }, [markFired, notify, orders.data, products, push, rules, t, totals]);

  return null;
}
