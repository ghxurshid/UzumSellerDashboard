import { ChevronRight, ListTree, Sparkles, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { IconButton } from '@/components/ui/IconButton';
import { Pill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import type { TranslationKey } from '@/lib/i18n/dictionary';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { useInsightsQuery } from '@/services/queries/useInsightsQuery';
import { PATH_BY_SCREEN } from '@/constants/navigation';
import { useToastStore } from '@/store/toast.store';
import { useUiStore } from '@/store/ui.store';
import type { Insight, InsightSeverity, Tone } from '@/types/domain';

const SEVERITY_LABEL: Record<InsightSeverity, TranslationKey> = {
  critical: 'sevCritical',
  high: 'sevHigh',
  watch: 'sevWatch',
  idea: 'sevIdea',
};

const SEVERITY_TONE: Record<InsightSeverity, Tone> = {
  critical: 'negative',
  high: 'warning',
  watch: 'accent',
  idea: 'neutral',
};

/**
 * The AI insights rail.
 *
 * Every card states its signal — the expression the finding was derived from —
 * and the evidence behind it, because an unexplained recommendation in a
 * finance tool is one a seller cannot act on.
 */
export function InsightsRail(): ReactNode {
  const { t } = useTranslation();
  const toggleInsights = useUiStore((state) => state.toggleInsights);
  const setChatOpen = useUiStore((state) => state.setChatOpen);
  const push = useToastStore((state) => state.push);

  const navigate = useNavigate();
  const { insights, pending: isPending } = useInsightsQuery();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const visible = insights.filter((insight) => !dismissed.has(insight.id));

  return (
    <aside
      aria-label={t('aiInsights')}
      className="flex w-320 shrink-0 flex-col border-l border-line bg-chrome"
    >
      <header className="flex h-46 shrink-0 items-center gap-9 border-b border-line px-12">
        <Sparkles aria-hidden className="size-14 text-acc-dim" />
        <span className="text-sm font-medium">{t('aiInsights')}</span>
        <span data-numeric className="text-mini text-faint">
          {visible.length}
        </span>
        <div className="flex-1" />
        <IconButton label={t('mClose')} size="xs" onClick={toggleInsights}>
          <X aria-hidden className="size-12" />
        </IconButton>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-9 overflow-auto p-12">
        {isPending &&
          Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="flex flex-col gap-7 rounded-9 border border-line bg-panel p-11">
              <Skeleton className="h-9 w-[40%]" />
              <Skeleton className="h-12 w-[85%]" />
              <Skeleton className="h-24" shimmer={false} />
            </div>
          ))}

        {!isPending && visible.length === 0 && (
          <p className="m-0 px-4 py-14 text-center text-xs leading-[1.6] text-faint">
            {t('noInsights')}
          </p>
        )}

        {visible.map((insight) => (
          <InsightCard
            key={insight.id}
            insight={insight}
            expanded={expandedId === insight.id}
            onToggle={() => setExpandedId(expandedId === insight.id ? null : insight.id)}
            onOpen={() => {
              if (insight.target !== undefined) void navigate(PATH_BY_SCREEN[insight.target]);
            }}
            onDismiss={() => {
              push(t('tDismissed'), {
                kind: 'info',
                actionLabel: t('undoL'),
                onAction: () =>
                  setDismissed((current) => {
                    const next = new Set(current);
                    next.delete(insight.id);
                    return next;
                  }),
              });
              setDismissed((current) => new Set(current).add(insight.id));
            }}
            onAsk={() => setChatOpen(true)}
          />
        ))}
      </div>
    </aside>
  );
}

interface InsightCardProps {
  readonly insight: Insight;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onOpen: () => void;
  readonly onDismiss: () => void;
  readonly onAsk: () => void;
}

function InsightCard({
  insight,
  expanded,
  onToggle,
  onOpen,
  onDismiss,
  onAsk,
}: InsightCardProps): ReactNode {
  const { t } = useTranslation();

  return (
    <article className="flex flex-col gap-8 rounded-9 border border-line bg-panel p-11">
      <div className="flex items-center gap-6">
        <Pill tone={SEVERITY_TONE[insight.severity]} size="sm">
          {t(SEVERITY_LABEL[insight.severity])}
        </Pill>
        <span className="text-tiny uppercase tracking-[0.08em] text-faint">
          {t(insight.categoryKey as TranslationKey)}
        </span>
      </div>

      <h3 className="m-0 text-sm-plus font-medium leading-[1.35]">{insight.title}</h3>
      <p className="m-0 text-xs leading-[1.55] text-dim">{insight.body}</p>

      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex cursor-pointer items-center gap-5 border-0 bg-transparent p-0 text-tiny text-acc-dim"
      >
        <ChevronRight
          aria-hidden
          className={cn('size-10 transition-transform', expanded && 'rotate-90')}
        />
        {t('evidenceL')}
      </button>

      {expanded && (
        <div className="flex animate-[rise_0.14s_ease] flex-col gap-5 border-t border-line pt-8">
          <span className="font-mono text-tiny text-faint">{insight.signal}</span>
          {insight.evidence.map((item, index) => (
            <span
              key={`${insight.id}-ev-${index}`}
              className="flex items-baseline gap-8 text-xs text-dim"
            >
              {item.text}
              <span className="flex-1 border-b border-dashed border-line" />
              <span data-numeric className="text-text">
                {item.value}
              </span>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-5 border-t border-line pt-8">
        <button
          type="button"
          onClick={onOpen}
          disabled={insight.target === undefined}
          className="flex h-24 cursor-pointer items-center gap-5 rounded-6 border border-acc bg-acc-soft px-9 text-xs text-acc-dim hover:bg-acc-strong disabled:cursor-not-allowed disabled:opacity-45"
        >
          <ListTree aria-hidden className="size-11" />
          {t('openRows')}
        </button>
        <button
          type="button"
          onClick={onAsk}
          className="h-24 cursor-pointer rounded-6 border border-line-2 bg-transparent px-9 text-xs text-dim hover:border-acc-line hover:text-acc-dim"
        >
          {t('askWhy')}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="h-24 cursor-pointer rounded-6 border border-line-2 bg-transparent px-9 text-xs text-faint hover:border-neg-line hover:text-neg"
        >
          {t('dismissL')}
        </button>
      </div>
    </article>
  );
}
