import { ZoomIn } from 'lucide-react';
import { useId, useMemo, type ReactNode } from 'react';

import { Panel } from '@/components/ui/Panel';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { SeriesPoint } from '@/types/domain';

const VIEW_WIDTH = 900;
const VIEW_HEIGHT = 215;
const PLOT_BOTTOM = 205;
const PLOT_TOP = 10;
const GRIDLINES = [10, 59, 108, 157] as const;

interface Geometry {
  readonly line: string;
  readonly area: string;
  readonly profit: string;
}

/** Builds both series as SVG paths in one pass over the data. */
function buildGeometry(points: readonly SeriesPoint[]): Geometry {
  if (points.length === 0) return { line: '', area: '', profit: '' };

  const max = Math.max(...points.map((point) => point.revenue), 1);
  const step = VIEW_WIDTH / Math.max(points.length - 1, 1);
  const y = (value: number): number =>
    PLOT_BOTTOM - (value / max) * (PLOT_BOTTOM - PLOT_TOP);

  const revenue = points.map((point, index) => `${index * step},${y(point.revenue)}`);
  const profit = points.map((point, index) => `${index * step},${y(point.profit)}`);

  return {
    line: `M ${revenue.join(' L ')}`,
    area: `M 0,${PLOT_BOTTOM} L ${revenue.join(' L ')} L ${VIEW_WIDTH},${PLOT_BOTTOM} Z`,
    profit: `M ${profit.join(' L ')}`,
  };
}

interface RevenueChartProps {
  readonly points: readonly SeriesPoint[];
  readonly onDrill: () => void;
}

/**
 * Revenue and profit over the selected window.
 *
 * Hand-drawn SVG rather than a charting dependency: two polylines and a
 * gradient fill is all the design asks for, and a library would add ~90 kB plus
 * its own theming layer for a shape we already have the geometry for. The
 * `<title>` and the data table below keep it readable to assistive tech.
 */
export function RevenueChart({ points, onDrill }: RevenueChartProps): ReactNode {
  const { t } = useTranslation();
  const gradientId = useId();

  const geometry = useMemo(() => buildGeometry(points), [points]);
  const labels = points.filter((point) => point.label !== '').map((point) => point.label);

  return (
    <Panel className="flex min-w-0 flex-col gap-9 px-14 pb-9 pt-13">
      <div className="flex items-center gap-10">
        <span className="text-base font-medium">{t('chartTitle')}</span>
        <span data-numeric className="text-mini text-faint">
          {t('chartBuckets', { n: points.length })}
        </span>
        <div className="flex-1" />

        <button
          type="button"
          onClick={onDrill}
          className="flex h-24 cursor-pointer items-center gap-5 rounded-7 border border-line-2 bg-transparent px-8 text-xs text-dim transition-colors hover:border-acc-line hover:text-acc-dim"
        >
          <ZoomIn aria-hidden className="size-12" />
          {t('drill')}
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={t('chartTitle')}
          className="block h-206 w-full"
        >
          <title>{t('chartTitle')}</title>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--s-acc)" stopOpacity="0.34" />
              <stop offset="100%" stopColor="var(--s-acc)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {GRIDLINES.map((y) => (
            <line key={y} x1="0" y1={y} x2={VIEW_WIDTH} y2={y} stroke="var(--s-grid)" strokeWidth="1" />
          ))}
          <line x1="0" y1={PLOT_BOTTOM} x2={VIEW_WIDTH} y2={PLOT_BOTTOM} stroke="var(--s-line)" strokeWidth="1" />

          <path d={geometry.area} fill={`url(#${gradientId})`} />
          <path
            d={geometry.line}
            fill="none"
            stroke="var(--s-acc)"
            strokeWidth="1.8"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={geometry.profit}
            fill="none"
            stroke="var(--s-pos)"
            strokeWidth="1.5"
            strokeLinejoin="round"
            opacity="0.9"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      <div data-numeric className="flex justify-between text-tiny text-faint">
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="flex items-center gap-16 border-t border-line pb-4 pt-8 text-xs text-dim">
        <span className="flex items-center gap-6">
          <span className="h-2 w-14 rounded-2 bg-acc" />
          {t('kRev')}
        </span>
        <span className="flex items-center gap-6">
          <span className="h-2 w-14 rounded-2 bg-pos" />
          {t('kProf')}
        </span>
        <div className="flex-1" />
        <span className="font-mono text-tiny text-faint">{t('srcFinOrdersLong')}</span>
      </div>
    </Panel>
  );
}
