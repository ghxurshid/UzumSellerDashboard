import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Dialog } from '@/components/ui/Dialog';
import { formatNumber } from '@/lib/format';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { ResolvedAction } from '@/services/insights/actions';

import type { InsightActionRunner } from './useInsightActionRunner';

/**
 * The last thing between a proposed write and the marketplace.
 *
 * A button that says "Change price" and a request that changes eight prices are
 * not the same claim, and the gap between them is where an automated
 * suggestion becomes an accident. So a bulk write is shown as what it is: one
 * row per SKU or order, with the values that will be sent, each of which the
 * seller can drop before applying.
 *
 * That is also why the dialog opens for any write carrying more than one entry
 * rather than only for the high-risk ones. Confirming forty orders in a single
 * press is reversible in principle and unreviewable in practice; seeing the
 * forty is the point.
 *
 * Dropping rows edits the parameters that go out — the runner is handed the
 * narrowed set, not the original — so what the seller reviewed is exactly what
 * is sent.
 */

interface Row {
  readonly key: string;
  readonly label: string;
  readonly detail: string;
}

/** The entries a bulk write carries, as rows to review. */
function rowsOf(action: ResolvedAction | null, t: (key: 'cSku' | 'cOrder') => string): readonly Row[] {
  if (action === null) return [];
  const params = action.params as Record<string, unknown>;

  if (action.actionId === 'product.price') {
    const entries = (params['entries'] ?? []) as ReadonlyArray<{
      skuId: number;
      fullPrice: number;
      sellPrice: number;
    }>;
    return entries.map((entry) => ({
      key: String(entry.skuId),
      label: `${t('cSku')} ${entry.skuId}`,
      detail: `${formatNumber(entry.sellPrice)} / ${formatNumber(entry.fullPrice)}`,
    }));
  }

  if (action.actionId === 'stock.update') {
    const entries = (params['entries'] ?? []) as ReadonlyArray<{
      skuId: number;
      barcode: string;
      amount: number;
    }>;
    return entries.map((entry) => ({
      key: String(entry.skuId),
      label: `${t('cSku')} ${entry.skuId}`,
      detail: `${entry.barcode} → ${formatNumber(entry.amount)}`,
    }));
  }

  if (action.actionId === 'order.confirm') {
    const ids = (params['orderIds'] ?? []) as readonly number[];
    return ids.map((id) => ({ key: String(id), label: `${t('cOrder')} ${id}`, detail: '' }));
  }

  return [];
}

/** The parameters, narrowed to the rows still ticked. */
function narrow(action: ResolvedAction, keep: ReadonlySet<string>): unknown {
  const params = action.params as Record<string, unknown>;

  if (action.actionId === 'product.price' || action.actionId === 'stock.update') {
    const entries = (params['entries'] ?? []) as ReadonlyArray<{ skuId: number }>;
    return { ...params, entries: entries.filter((entry) => keep.has(String(entry.skuId))) };
  }

  if (action.actionId === 'order.confirm') {
    const ids = (params['orderIds'] ?? []) as readonly number[];
    return { ...params, orderIds: ids.filter((id) => keep.has(String(id))) };
  }

  return params;
}

export function ActionConfirmDialog({
  runner,
}: {
  readonly runner: InsightActionRunner;
}): ReactNode {
  const { t } = useTranslation();
  const held = runner.pending;

  const rows = useMemo(() => rowsOf(held, t), [held, t]);
  const [dropped, setDropped] = useState<ReadonlySet<string>>(new Set());

  /* Every dialog opens with everything ticked: the proposal is the default and
     the seller subtracts from it. Reset on the held action rather than on open,
     so a second proposal never inherits the first one's exclusions. */
  useEffect(() => {
    setDropped(new Set());
  }, [held]);

  const kept = rows.filter((row) => !dropped.has(row.key));
  const nothingLeft = rows.length > 0 && kept.length === 0;

  const toggle = (key: string): void => {
    setDropped((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = (): void => {
    setDropped((current) =>
      current.size === rows.length ? new Set() : new Set(rows.map((row) => row.key)),
    );
  };

  return (
    <Dialog
      open={held !== null}
      onOpenChange={(open) => {
        if (!open) runner.cancel();
      }}
      title={t('insConfirmT')}
      description={t('insConfirmB')}
      footer={
        <>
          <Button variant="secondary" onClick={runner.cancel}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={nothingLeft}
            onClick={() => {
              if (held === null) return;
              runner.confirm(
                rows.length === 0
                  ? undefined
                  : narrow(held, new Set(kept.map((row) => row.key))),
              );
            }}
          >
            {t('apply')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-9">
        {held !== null && held.definition.endpoint !== null && (
          <span className="font-mono text-xs text-faint">{held.definition.endpoint}</span>
        )}

        {rows.length > 0 && (
          <>
            <div className="flex items-center gap-8">
              <Checkbox
                state={
                  dropped.size === 0 ? 'all' : dropped.size === rows.length ? 'none' : 'some'
                }
                label={t('selectAll')}
                onToggle={toggleAll}
              />
              <span className="text-tiny text-faint">
                {t('confirmRows', { n: kept.length, m: rows.length })}
              </span>
            </div>

            {/* Scrolls rather than growing: fifty SKUs is a legal proposal and
                a dialog taller than the window is not a review. */}
            <div className="scroll-box max-h-260 -mx-2 flex flex-col gap-4 px-2">
              {rows.map((row) => (
                <label
                  key={row.key}
                  className="flex cursor-pointer items-center gap-8 border-b border-line/60 py-5 text-xs last:border-b-0"
                >
                  <Checkbox
                    state={dropped.has(row.key) ? 'none' : 'all'}
                    label={row.label}
                    onToggle={() => toggle(row.key)}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-tiny text-dim">
                    {row.label}
                  </span>
                  <span data-numeric className="shrink-0 text-tiny text-text">
                    {row.detail}
                  </span>
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
