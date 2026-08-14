import { Copy, ExternalLink, EyeOff, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { ScreenFrame } from '@/components/common/ScreenFrame';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { resolveIcon } from '@/components/ui/iconRegistry';
import { SkeletonTable, SkeletonTiles } from '@/components/ui/Skeleton';
import type { RowMenuAction } from '@/components/ui/RowContextMenu';
import { ActionDrawer } from '@/features/module/ActionDrawer';
import { isFormAction, type ActionContext } from '@/features/module/actionContext';
import { ModuleBulkBar, type BulkAction } from '@/features/module/ModuleBulkBar';
import { ModuleKpiStrip } from '@/features/module/ModuleKpiStrip';
import { ModuleTable } from '@/features/module/ModuleTable';
import { ModuleToolbar } from '@/features/module/ModuleToolbar';
import { RowDetailDrawer } from '@/features/module/RowDetailDrawer';
import { useModuleTableState } from '@/features/module/useModuleTableState';
import { useRowSelection } from '@/features/module/useRowSelection';
import { useActionGuard } from '@/hooks/useActionGuard';
import { useProgressTask } from '@/hooks/useProgressTask';
import { useScreenStatus } from '@/hooks/useScreenStatus';
import { buildCsv, downloadBlob, timestampedName } from '@/lib/download';
import type { TranslationKey } from '@/lib/i18n/dictionary';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useModuleQuery } from '@/services/queries/useModuleQuery';
import { useUzumActions } from '@/services/queries/useUzumActions';
import { useDialogStore } from '@/store/dialog.store';
import { useToastStore } from '@/store/toast.store';
import type { ModuleKey, ModuleRow, ModuleRowAction } from '@/types/domain';

/**
 * The generic data screen — stocks, orders, invoices and finance all render
 * through it, differing only in the definition the query builds.
 *
 * Actions are the module's own: each one names the endpoint it calls, is gated
 * by the same write guard, and either opens the form that endpoint needs or
 * asks for confirmation first. Nothing here can be triggered that the seller
 * API cannot carry out.
 */
export default function ModulePage({ moduleKey }: { readonly moduleKey: ModuleKey }): ReactNode {
  const { t } = useTranslation();
  const push = useToastStore((state) => state.push);
  const requestConfirm = useDialogStore((state) => state.requestConfirm);
  const { allow, readOnly } = useActionGuard();
  const actions = useUzumActions();
  const progress = useProgressTask();

  const { definition, queries, refetch } = useModuleQuery(moduleKey);

  const [drawerRow, setDrawerRow] = useState<ModuleRow | null>(null);
  const [actionContext, setActionContext] = useState<ActionContext | null>(null);

  const table = useModuleTableState(definition);
  const selection = useRowSelection(table.visibleIds);

  const status = useScreenStatus({
    queries,
    total: table.totalRows,
    visible: table.rows.length,
    searchActive: table.isSearching,
    filterActive: table.isFiltered,
  });

  /* ── export ───────────────────────────────────────────────────────────── */

  const runExport = useCallback(
    (rows: readonly ModuleRow[]) => {
      if (definition === null || rows.length === 0) return;

      void progress.run({
        label: t('prExport'),
        sub: `csv · ${rows.length} rows`,
        kind: 'down',
        task: ({ report, signal }) =>
          buildCsv({
            rows: [...rows],
            columns: definition.columns.map((column, index) => ({
              header: column.label,
              value: (row: ModuleRow) => row.cells[index]?.value ?? '',
            })),
            report,
            signal,
          }),
        onDone: (blob) => {
          downloadBlob(blob, timestampedName(moduleKey, 'csv'));
          push(t('tExport'), { kind: 'ok' });
        },
        onError: () => push(t('tFail'), { kind: 'err' }),
      });
    },
    [definition, moduleKey, progress, push, t],
  );

  /* ── writes ───────────────────────────────────────────────────────────── */

  const openForm = useCallback(
    (action: ModuleRowAction, row: ModuleRow | null, ids: readonly string[]) => {
      if (!isFormAction(action.act)) return;
      setActionContext({
        action: action.act,
        label: row?.id ?? ids.join(', '),
        endpoint: action.endpoint,
        raw: row?.raw ?? {},
        ids,
        moduleKey,
      });
      setDrawerRow(null);
    },
    [moduleKey],
  );

  const runAction = useCallback(
    (row: ModuleRow | null, action: ModuleRowAction, ids: readonly string[] = []) => {
      if (action.act === 'export') {
        runExport(row === null ? table.rows : [row]);
        return;
      }
      if (!allow()) return;

      if (isFormAction(action.act)) {
        openForm(action, row, ids);
        return;
      }

      const orderId = Number(row?.raw['orderId'] ?? 0);
      const invoiceId = Number(row?.raw['invoiceId'] ?? 0);

      switch (action.act) {
        case 'confirm': {
          const targets = ids.length > 0 ? ids.map(Number) : [orderId];
          requestConfirm(
            {
              title: t('cfConfirmT', { n: targets.length }),
              body: t('cfConfirmB'),
              cta: t('aConfirm'),
              tone: 'accent',
            },
            () => {
              void actions.confirmOrders(targets.filter(Number.isFinite));
              selection.clear();
            },
          );
          return;
        }

        case 'deliver':
          requestConfirm(
            { title: t('cfDeliverT'), body: t('cfDeliverB'), cta: t('aDeliver'), tone: 'accent' },
            () => void actions.deliverOrder(orderId),
          );
          return;

        case 'refund':
          requestConfirm(
            { title: t('cfRefundT'), body: t('cfRefundB'), cta: t('aRefund'), tone: 'warn' },
            () => void actions.refundOrder(orderId),
          );
          return;

        case 'cancelInvoice':
          requestConfirm(
            { title: t('cfInvCancelT'), body: t('cfInvCancelB'), cta: t('aCancelInv'), tone: 'warn' },
            () => void actions.cancelInvoice(invoiceId),
          );
          return;

        case 'printSupply':
          void actions.printSupplyAct(invoiceId);
          return;

        case 'printAcceptance':
          void actions.printAcceptanceAct(invoiceId);
          return;

        default:
          return;
      }
    },
    [actions, allow, openForm, requestConfirm, runExport, selection, t, table.rows],
  );

  /* ── row menu ─────────────────────────────────────────────────────────── */

  const buildRowActions = useCallback(
    (row: ModuleRow): readonly RowMenuAction[] => [
      { key: 'open', label: t('openRow'), icon: ExternalLink, run: () => setDrawerRow(row) },
      {
        key: 'copy',
        label: t('copySku'),
        icon: Copy,
        run: () => {
          void navigator.clipboard?.writeText(row.id);
          push(t('tSkuCopied'), { kind: 'ok' });
        },
      },
      { key: 'export', label: t('bulkExport'), icon: FileSpreadsheet, run: () => runExport([row]) },
      {
        key: 'hide',
        label: t('hideRow'),
        icon: EyeOff,
        danger: true,
        run: () =>
          requestConfirm(
            { title: t('cfHideT'), body: t('cfHideB'), cta: t('hideRow'), tone: 'warn' },
            () => {
              table.hideRow(row.id);
              push(t('tHidden'), { kind: 'info' });
            },
          ),
      },
    ],
    [push, requestConfirm, runExport, t, table],
  );

  const bulkActions = useMemo<readonly BulkAction[]>(
    () =>
      (definition?.bulkActions ?? []).map((action) => ({
        key: action.act,
        labelKey: action.labelKey as TranslationKey,
        icon: action.icon,
        ...(action.primary === true ? { primary: true } : {}),
        run: () => {
          const ids = [...selection.selectedIds];
          if (action.act === 'export') {
            runExport(table.rows.filter((row) => ids.includes(row.id)));
            return;
          }
          const first = table.rows.find((row) => row.id === ids[0]) ?? null;
          runAction(first, action, ids);
        },
      })),
    [definition, runAction, runExport, selection.selectedIds, table.rows],
  );

  const HeaderIcon = resolveIcon(definition?.icon ?? 'layers');

  return (
    <ScreenFrame
      status={status}
      onRetry={refetch}
      onClearSearch={table.clearSearch}
      onClearFilters={table.reset}
      searchQuery={table.search}
      rowsRead={table.totalRows}
      skeleton={
        <div className="flex flex-col gap-12 px-14 pb-22 pt-12">
          <SkeletonTiles count={5} />
          <SkeletonTable rows={9} />
        </div>
      }
    >
      {definition !== null && (
        <div className="flex flex-col gap-11 px-14 pb-22 pt-12">
          <header className="flex items-center gap-9">
            <span className="flex size-26 shrink-0 items-center justify-center rounded-7 border border-acc-line bg-acc-soft text-acc-dim">
              <HeaderIcon aria-hidden className="size-14" />
            </span>
            <span className="flex min-w-0 flex-col leading-[1.3]">
              <h1 className="m-0 text-md font-medium tracking-[-0.015em]">
                {t(definition.titleKey as TranslationKey)}
              </h1>
              <span className="truncate font-mono text-mini text-faint">{definition.source}</span>
            </span>

            <div className="flex-1" />

            <Button
              size="md"
              icon={<RefreshCw aria-hidden className={status.refreshing ? 'size-12 animate-spin' : 'size-12'} />}
              onClick={refetch}
            >
              {t('refreshL')}
            </Button>
            <Button
              size="md"
              icon={<FileSpreadsheet aria-hidden className="size-12" />}
              onClick={() => runExport(table.rows)}
            >
              {t('exportCsv')}
            </Button>
            {definition.bulkActions[0] !== undefined && (
              <Button
                variant="primary"
                size="md"
                disabled={readOnly}
                icon={<Icon name={definition.bulkActions[0].icon} className="size-12" />}
                onClick={() => runAction(null, definition.bulkActions[0] as ModuleRowAction, [
                  ...selection.selectedIds,
                ])}
              >
                {t(definition.bulkActions[0].labelKey as TranslationKey)}
              </Button>
            )}
          </header>

          <ModuleKpiStrip kpis={definition.kpis} />

          {definition.truncated && (
            <p className="m-0 rounded-8 border border-warn-line bg-warn-soft px-11 py-8 text-xs text-warn">
              {t('bnTruncT', { n: definition.rows.length, total: definition.total })}
            </p>
          )}

          <ModuleToolbar
            tabs={definition.tabs}
            activeTab={table.activeTab}
            search={table.search}
            searchable={definition.searchable}
            searchPlaceholder={definition.searchPlaceholder}
            onTabChange={table.setActiveTab}
            onSearchChange={table.setSearch}
            onExpandAll={table.expandAll}
            onCollapseAll={table.collapseAll}
          />

          <div className="overflow-hidden rounded-11 border border-line bg-panel">
            <ModuleBulkBar
              count={selection.count}
              actions={bulkActions}
              disabled={readOnly}
              onClear={selection.clear}
            />

            <ModuleTable
              columns={definition.columns}
              rows={table.rows}
              page={table.page}
              pageSize={table.pageSize}
              pageCount={table.pageCount}
              sortKey={table.sortKey}
              sortDirection={table.sortDirection}
              expandedIds={table.expandedIds}
              headerState={selection.headerState}
              isSelected={selection.isSelected}
              buildActions={buildRowActions}
              onSort={table.sortBy}
              onToggleExpand={table.toggleExpand}
              onToggleSelect={selection.toggle}
              onToggleAll={selection.toggleAll}
              onRunRowAction={(row, action) => runAction(row, action)}
              onPageChange={table.setPage}
              onPageSizeChange={table.setPageSize}
              onClearFilters={table.reset}
            />
          </div>

          <RowDetailDrawer
            row={drawerRow}
            onClose={() => setDrawerRow(null)}
            onRunAction={(row, action) => runAction(row, action)}
          />

          <ActionDrawer context={actionContext} onClose={() => setActionContext(null)} />
        </div>
      )}
    </ScreenFrame>
  );
}
