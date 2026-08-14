import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { ScreenFrame } from '@/components/common/ScreenFrame';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { SkeletonTiles } from '@/components/ui/Skeleton';
import { DemandHeatmap } from '@/features/overview/DemandHeatmap';
import { KpiStrip } from '@/features/overview/KpiStrip';
import { LiveTicker } from '@/features/overview/LiveTicker';
import { PortfolioRank } from '@/features/overview/PortfolioRank';
import { RevenueChart } from '@/features/overview/RevenueChart';
import { UnitEconomics } from '@/features/overview/UnitEconomics';
import { useScreenStatus } from '@/hooks/useScreenStatus';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useOverviewQuery } from '@/services/queries/useOverviewQuery';
import { useFiltersStore } from '@/store/filters.store';

/**
 * Overview — the default screen.
 *
 * Its state comes from the three queries behind it: nothing is drawn until they
 * have answered, and what they answered decides whether this is a dashboard, an
 * empty period, or a connection problem.
 */
export default function OverviewPage(): ReactNode {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { summary, queries, refetch } = useOverviewQuery();

  const setRankFilter = useFiltersStore((state) => state.setRankFilter);
  const rankFilter = useFiltersStore((state) => state.rankFilter);

  const [methodOpen, setMethodOpen] = useState(false);
  const [drillOpen, setDrillOpen] = useState(false);

  /* An account with no orders in the window still has a catalogue, so the
     screen is only "empty" when both are. */
  const rows = summary === null ? 0 : summary.reportedItems + summary.productTotal;

  const status = useScreenStatus({
    queries,
    total: rows,
    visible: rows,
    searchActive: false,
    filterActive: false,
  });

  const handleRankSelect = (code: string): void => {
    setRankFilter(rankFilter === code ? null : code);
    void navigate('/products');
  };

  return (
    <ScreenFrame
      status={status}
      onRetry={refetch}
      skeleton={
        <div className="flex flex-col gap-12 px-14 pb-22 pt-12">
          <SkeletonTiles count={7} />
          <div className="grid grid-cols-[296px_minmax(0,1fr)] gap-12">
            <div className="h-246 rounded-11 border border-line bg-panel" />
            <div className="skeleton h-246 rounded-11 border border-line" />
          </div>
        </div>
      }
    >
      {summary !== null && (
        <div className="flex flex-col gap-12 px-14 pb-22 pt-12">
          <KpiStrip kpis={summary.kpis} />
          <LiveTicker items={summary.ticker} />

          <div className="grid grid-cols-[296px_minmax(0,1fr)] gap-12 max-[900px]:grid-cols-1">
            <UnitEconomics rows={summary.economics} onOpenMethod={() => setMethodOpen(true)} />
            <RevenueChart points={summary.series} onDrill={() => setDrillOpen(true)} />
          </div>

          <div className="grid grid-cols-[296px_minmax(0,1fr)] gap-12 max-[900px]:grid-cols-1">
            <PortfolioRank
              buckets={summary.ranks}
              total={summary.productTotal}
              activeRank={rankFilter}
              onSelect={handleRankSelect}
            />
            <DemandHeatmap cells={summary.heatmap} sampleCount={summary.totals.liveItems} />
          </div>

          <Dialog
            open={methodOpen}
            onOpenChange={setMethodOpen}
            title={t('mMethod')}
            footer={
              <Button variant="primary" size="lg" onClick={() => setMethodOpen(false)}>
                {t('mClose')}
              </Button>
            }
          >
            <p>{t('mMethodBody')}</p>
          </Dialog>

          <Dialog
            open={drillOpen}
            onOpenChange={setDrillOpen}
            title={t('mDrill')}
            description={t('srcFinOrdersLong')}
            footer={
              <Button variant="primary" size="lg" onClick={() => setDrillOpen(false)}>
                {t('mClose')}
              </Button>
            }
          >
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-meta uppercase tracking-[0.08em] text-faint">
                  <th className="py-6 font-normal">{t('cLine')}</th>
                  <th className="py-6 text-right font-normal">{t('cThis')}</th>
                  <th className="py-6 text-right font-normal">{t('cShare')}</th>
                </tr>
              </thead>
              <tbody>
                {summary.economics.map((row) => (
                  <tr key={row.key} className="border-b border-line">
                    <td className="py-6">
                      <span className="font-mono text-mini text-faint">{row.field}</span>
                    </td>
                    <td data-numeric className="py-6 text-right">
                      {row.value}
                    </td>
                    <td data-numeric className="py-6 text-right text-dim">
                      {row.pct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Dialog>
        </div>
      )}
    </ScreenFrame>
  );
}
