import type { ReactNode } from 'react';

import type { ChoiceBlock } from '@core/agent/blocks';
import { phrase } from '@core/agent/phrase';
import type { Translator } from '@core/i18n/useTranslation';

import { choiceState, type ChoiceContext } from './choiceState';

/**
 * A question the Copilot asked, as it stands in the transcript.
 *
 * Not the thing the seller answers — that is `ChoiceForm`, which takes the
 * composer's place while the question is open. This is what the conversation
 * keeps of it.
 *
 * ## While it is open, nothing
 *
 * The form holds the question, its options and the field for an answer in the
 * seller's own words. Drawing the same question a few pixels above it would put
 * two copies on screen and leave the eye to work out which one to press.
 *
 * ## Afterwards, one line
 *
 * Once it has been dealt with the question is a line of the conversation: the
 * Copilot asked, and the bubble under it is what the seller said. The options
 * are not listed. They were a way of answering, and the answer is already there
 * to read.
 *
 * A question that was closed says so, and while it can still be answered offers
 * to put it back — closing is one key, and a key gets pressed by mistake.
 *
 * ## Where there is no conversation
 *
 * A surface that passes no context has no form to hold the options and no reply
 * to read, so there the block is drawn whole: the question and what it offered.
 */
export interface ChoiceBlockViewProps {
  readonly block: ChoiceBlock;
  readonly t: Translator;
  /** Absent on a surface with no conversation; the block is then drawn whole. */
  readonly context: ChoiceContext | undefined;
}

export function ChoiceBlockView({ block, t, context }: ChoiceBlockViewProps): ReactNode {
  const labels = block.options.map((option) => phrase(t, option.label));
  const { phase } = choiceState(labels, context);

  /* Only the block the form is holding steps aside. A second question in the
     same answer cannot be asked at the same time, and vanishing would lose it. */
  const inForm = context?.docked === block;
  if (inForm && (phase === 'open' || phase === 'waiting')) return null;

  const listed = context === undefined || (!inForm && (phase === 'open' || phase === 'waiting'));

  return (
    <div data-choice={phase} className="flex flex-col gap-4">
      <p className="m-0 text-xs leading-[1.55] text-dim">{phrase(t, block.question)}</p>

      {listed && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {labels.map((label, index) => (
            <li key={index} className="text-xs leading-[1.5] text-faint">
              {label}
            </li>
          ))}
        </ul>
      )}

      {phase === 'dismissed' && (
        <p className="m-0 flex flex-wrap items-baseline gap-x-8 gap-y-2 text-tiny text-faint">
          {t('choiceDismissed')}
          {context?.onReopen !== undefined && (
            <button
              type="button"
              onClick={context.onReopen}
              className="tap cursor-pointer border-0 bg-transparent p-0 text-tiny text-acc-dim underline underline-offset-2"
            >
              {t('choiceReopen')}
            </button>
          )}
        </p>
      )}
    </div>
  );
}
