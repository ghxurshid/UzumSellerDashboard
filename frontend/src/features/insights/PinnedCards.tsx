import { Pin, RotateCcw, X } from 'lucide-react';
import { type ReactNode } from 'react';

import { IconButton } from '@/components/ui/IconButton';
import { formatDay, formatStamp } from '@/lib/format';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { resolveAction } from '@/services/insights/actions';
import type { PinnedAnswer } from '@/services/insights/pins';
import { usePinsStore } from '@/store/pins.store';

import { BlockRenderer } from './BlockRenderer';
import { useInsightActionRunner } from './useInsightActionRunner';

/**
 * Kept answers, on the dashboard.
 *
 * A card is the answer as the Copilot wrote it — its sentences and the figures
 * it computed, together — and it says when that was and over which period. It
 * does not quietly re-read the rows underneath: an analysis is only true of the
 * data it was written over, and new figures under old sentences would be a card
 * that contradicts itself without looking stale.
 *
 * What it offers instead is the honest refresh: ask the question again. The
 * Copilot re-reads the archive for the period selected now and writes the
 * analysis again, and the seller can pin that one in place of this.
 */
export function PinnedCards(): ReactNode {
  const pins = usePinsStore((state) => state.pins);
  if (pins.length === 0) return null;

  return (
    <section className="flex flex-col gap-9">
      {pins.map((pin) => (
        <PinnedCard key={pin.id} pin={pin} />
      ))}
    </section>
  );
}

function PinnedCard({ pin }: { readonly pin: PinnedAnswer }): ReactNode {
  const { t, language } = useTranslation();
  const remove = usePinsStore((state) => state.remove);
  const runner = useInsightActionRunner();

  const ask = resolveAction('copilot.ask', { question: pin.title.slice(0, 300) });

  return (
    <article className="flex flex-col gap-9 rounded-11 border border-line bg-panel px-12 py-11">
      <header className="flex items-start gap-8">
        <Pin aria-hidden className="mt-1 size-12 shrink-0 text-acc-dim" />
        <span className="min-w-0 flex-1 text-xs-plus leading-[1.5] text-text">{pin.title}</span>
        {ask !== null && (
          <IconButton label={t('pinRefresh')} size="xs" onClick={() => runner.run(ask)}>
            <RotateCcw aria-hidden className="size-12" />
          </IconButton>
        )}
        <IconButton label={t('unpin')} size="xs" onClick={() => remove(pin.id)}>
          <X aria-hidden className="size-12" />
        </IconButton>
      </header>

      <div className="flex flex-col gap-9">
        <BlockRenderer
          blocks={pin.blocks}
          t={t}
          language={language}
          /* A pinned card carries no buttons — `pinnableBlocks` strips them on
             the way in, because a write proposed three weeks ago carries
             parameters nobody has looked at since. */
          onAction={() => undefined}
        />
      </div>

      {/* The card is a snapshot and says so, with the period it was about. */}
      <span className="text-tiny text-faint">
        {t('pinnedAt', {
          when: formatStamp(pin.createdAt),
          window:
            pin.window === undefined
              ? '—'
              : `${formatDay(pin.window.fromMs)}–${formatDay(pin.window.toMs)}`,
        })}
      </span>
    </article>
  );
}
