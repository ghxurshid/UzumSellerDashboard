import { ChevronRight, ListTree, Sparkles, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { IconButton } from '@/components/ui/IconButton';
import { Pill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import type { TranslationKey } from '@/lib/i18n/dictionary';
import { useTranslation, type Translator } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { resolveAction, type ResolvedAction } from '@/services/insights/actions';
import {
  INSIGHT_GROUPS,
  isImportant,
  type InsightCard,
  type InsightGroup,
} from '@/services/insights/blocks';
import { formatFact, type FactTable } from '@/services/insights/facts';
import { phrase } from '@/services/insights/phrase';
import { useInsightsQuery } from '@/services/queries/useInsightsQuery';
import { useToastStore } from '@/store/toast.store';
import { useUiStore } from '@/store/ui.store';
import type { InsightSeverity, Language, Tone } from '@/types/domain';

import { ActionConfirmDialog } from './ActionConfirmDialog';
import { BlockRenderer } from './BlockRenderer';
import { useInsightActionRunner } from './useInsightActionRunner';

/**
 * The AI insights rail.
 *
 * Every card states the route its claim rests on and the figures behind it,
 * because an unexplained recommendation in a finance tool is one a seller
 * cannot act on. What a card *contains* is no longer this component's business:
 * the body is a list of blocks composed by whoever authored the finding, and
 * `BlockRenderer` draws it. This file owns the envelope — the severity, the
 * filtering, the dismissals, and the gate in front of any action that writes.
 */

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

const GROUP_LABEL: Record<InsightGroup, TranslationKey> = {
  profit: 'grProfit',
  stockOps: 'grStockOps',
  anomaly: 'grAnomaly',
};

/** `all` and `important` are computed over every card; the rest are groups. */
type FilterKey = 'all' | 'important' | InsightGroup;

export function InsightsRail(): ReactNode {
  const { t, language } = useTranslation();
  const toggleInsights = useUiStore((state) => state.toggleInsights);
  const push = useToastStore((state) => state.push);

  const { cards, facts, pending, aiPending } = useInsightsQuery();
  const runner = useInsightActionRunner();

  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState<FilterKey>('all');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const visible = useMemo(
    () => cards.filter((card) => !dismissed.has(card.id)),
    [cards, dismissed],
  );

  /* Only chips with something behind them are drawn. A filter that can only
     ever return nothing is a control that lies about what is there. */
  const chips = useMemo<readonly { key: FilterKey; label: string; count: number | null }[]>(() => {
    const important = visible.filter(isImportant).length;
    const groups = INSIGHT_GROUPS.filter((group) =>
      visible.some((card) => card.group === group),
    ).map((group) => ({
      key: group as FilterKey,
      label: t(GROUP_LABEL[group]),
      count: null,
    }));

    return [
      { key: 'all' as FilterKey, label: t('insAll'), count: visible.length },
      ...(important > 0
        ? [{ key: 'important' as FilterKey, label: t('insImportant'), count: important }]
        : []),
      ...groups,
    ];
  }, [t, visible]);

  const shown = useMemo(() => {
    if (filter === 'all') return visible;
    if (filter === 'important') return visible.filter(isImportant);
    return visible.filter((card) => card.group === filter);
  }, [filter, visible]);

  const dismiss = (card: InsightCard): void => {
    push(t('tDismissed'), {
      kind: 'info',
      actionLabel: t('undoL'),
      onAction: () =>
        setDismissed((current) => {
          const next = new Set(current);
          next.delete(card.id);
          return next;
        }),
    });
    setDismissed((current) => new Set(current).add(card.id));
  };

  const toggle = (id: string): void =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <aside
      aria-label={t('aiInsights')}
      className="flex w-320 min-w-0 shrink-0 flex-col border-l border-line bg-chrome"
    >
      <header className="flex h-46 shrink-0 items-center gap-9 border-b border-line px-12">
        <Sparkles aria-hidden className="size-14 text-acc-dim" />
        <span className="text-sm font-medium">{t('aiInsights')}</span>
        {aiPending && (
          <Pill size="sm" tone="accent">
            {t('aiPending')}
          </Pill>
        )}
        <div className="flex-1" />
        <IconButton label={t('mClose')} size="xs" onClick={toggleInsights}>
          <X aria-hidden className="size-12" />
        </IconButton>
      </header>

      {visible.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-5 border-b border-line px-12 py-9">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              aria-pressed={filter === chip.key}
              onClick={() => setFilter(chip.key)}
              className={cn(
                'tap cursor-pointer rounded-5 border px-8 py-2 text-tiny transition-colors',
                filter === chip.key
                  ? 'border-acc bg-acc-soft text-acc-dim'
                  : 'border-line-2 bg-transparent text-faint hover:border-acc-line hover:text-acc-dim',
              )}
            >
              {chip.label}
              {chip.count !== null && (
                <span data-numeric className="ml-4 text-faint">
                  {chip.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-9 overflow-auto p-12">
        {pending &&
          Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              className="flex flex-col gap-7 rounded-9 border border-line bg-panel p-11"
            >
              <Skeleton className="h-9 w-[40%]" />
              <Skeleton className="h-12 w-[85%]" />
              <Skeleton className="h-24" shimmer={false} />
            </div>
          ))}

        {!pending && visible.length === 0 && (
          <p className="m-0 px-4 py-14 text-center text-xs leading-[1.6] text-faint">
            {t('noInsights')}
          </p>
        )}

        {!pending && visible.length > 0 && shown.length === 0 && (
          <p className="m-0 px-4 py-14 text-center text-xs leading-[1.6] text-faint">
            {t('insNoMatch')}
          </p>
        )}

        {shown.map((card, index) => {
          /* The first card opens: the rail is read top-down, and a column of
             collapsed headers makes the reader work for the finding. `toggled`
             flips whatever the default was, so pressing the header always does
             the opposite of what is on screen. */
          const openByDefault = index === 0;
          const toggled = expanded.has(card.id);

          return (
            <CardView
              key={card.id}
              card={card}
              facts={facts}
              t={t}
              language={language}
              expanded={openByDefault !== toggled}
              onToggle={() => toggle(card.id)}
              onAction={runner.run}
              onDismiss={() => dismiss(card)}
            />
          );
        })}
      </div>

      <ActionConfirmDialog runner={runner} />
    </aside>
  );
}

interface CardViewProps {
  readonly card: InsightCard;
  readonly facts: FactTable;
  readonly t: Translator;
  readonly language: Language;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onAction: (action: ResolvedAction) => void;
  readonly onDismiss: () => void;
}

function CardView({
  card,
  facts,
  t,
  language,
  expanded,
  onToggle,
  onAction,
  onDismiss,
}: CardViewProps): ReactNode {
  const signal = card.signalRef === undefined ? null : (facts.get(card.signalRef) ?? null);

  /* Built through the registry rather than hand-assembled, so the footer's two
     buttons are validated on exactly the path every other action takes. */
  const open =
    card.target === undefined ? null : resolveAction('nav.open', { screen: card.target });
  const ask = resolveAction('copilot.ask', { question: phrase(t, card.title) });

  return (
    <article className="flex flex-col gap-8 rounded-9 border border-line bg-panel p-11">
      <div className="flex items-center gap-6">
        <Pill tone={SEVERITY_TONE[card.severity]} size="sm">
          {t(SEVERITY_LABEL[card.severity])}
        </Pill>
        <span className="text-tiny uppercase tracking-[0.08em] text-faint">
          {t(card.categoryKey)}
        </span>
        <div className="flex-1" />
        <span
          title={card.source}
          className="min-w-0 truncate font-mono text-tiny text-faint"
        >
          {card.source}
        </span>
      </div>

      <h3 className="m-0 text-sm-plus font-medium leading-[1.35]">{phrase(t, card.title)}</h3>

      {/* The signal line doubles as the disclosure control: the headline figure
          is what a reader scans for, so it is also what they reach for. */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex cursor-pointer items-center gap-6 border-0 bg-transparent p-0 text-left"
      >
        <ChevronRight
          aria-hidden
          className={cn('size-10 shrink-0 text-acc-dim transition-transform', expanded && 'rotate-90')}
        />
        <span className="text-tiny uppercase tracking-[0.08em] text-faint">{t('insSignal')}</span>
        {signal !== null && (
          <span data-numeric className="text-xs text-text">
            {formatFact(signal, language)}
          </span>
        )}
      </button>

      {expanded && (
        <div className="flex animate-[rise_0.14s_ease] flex-col gap-8 border-t border-line pt-9">
          <BlockRenderer
            blocks={card.blocks}
            facts={facts}
            t={t}
            language={language}
            onAction={onAction}
          />
          {card.origin === 'ai' && (
            <span className="text-tiny text-faint">{t('aiWrote')}</span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-6 border-t border-line pt-8">
        {open !== null && (
          <button
            type="button"
            onClick={() => onAction(open)}
            className={cn(
              'tap flex h-28 cursor-pointer items-center gap-5 rounded-6 border border-acc',
              'bg-acc-soft px-9 text-xs text-acc-dim hover:bg-acc-strong',
            )}
          >
            <ListTree aria-hidden className="size-11" />
            {t('openRows')}
          </button>
        )}

        {ask !== null && (
          <button
            type="button"
            onClick={() => onAction(ask)}
            className={cn(
              'tap h-28 cursor-pointer rounded-6 border border-line-2 bg-transparent px-9',
              'text-xs text-dim hover:border-acc-line hover:text-acc-dim',
            )}
          >
            {t('askWhy')}
          </button>
        )}

        <div className="flex-1" />

        <IconButton label={t('dismissL')} size="xs" onClick={onDismiss}>
          <X aria-hidden className="size-12" />
        </IconButton>
      </div>
    </article>
  );
}


