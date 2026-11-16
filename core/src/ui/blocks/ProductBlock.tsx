import { useState, type ReactNode } from 'react';

import { isProductImage, type ProductBlock } from '@core/agent/blocks';
import { formatFigure } from '@core/agent/figures';
import { phrase } from '@core/agent/phrase';
import type { Translator } from '@core/i18n/useTranslation';
import { cn } from '@core/lib/utils';
import type { Language } from '@core/types/common';
import { Pill } from '@core/ui/kit/Pill';

import { TONE_TEXT } from './tones';

/**
 * One product, shown the way a seller recognises it.
 *
 * The picture and the title lead, because that is how a product is known; the
 * figures that describe it sit underneath as a short definition list, wrapping
 * two to a row on a 320px rail and as many as fit in a wide panel.
 *
 * ## The picture
 *
 * It is the only thing in the block language that makes the browser fetch
 * something, so it is asked about twice: the wire refuses an address outside
 * Uzum's image host, and this component asks `isProductImage` again before it
 * renders an `<img>` — a block a rule authored never passed the wire. It is sent
 * without a referrer, so the image host learns that a picture was shown and not
 * which page showed it.
 *
 * A product with no picture, or one whose picture fails to load, is drawn
 * without the slot. A grey square where a photo should be says "something is
 * missing" about a card that is complete without it.
 */
export interface ProductBlockViewProps {
  readonly block: ProductBlock;
  readonly t: Translator;
  readonly language: Language;
}

export function ProductBlockView({ block, t, language }: ProductBlockViewProps): ReactNode {
  const [broken, setBroken] = useState(false);

  const title = phrase(t, block.title);
  const image =
    block.image !== undefined && !broken && isProductImage(block.image) ? block.image : null;
  const figures = block.figures ?? [];

  return (
    <article className="flex flex-col gap-8 rounded-8 border border-line bg-grid/30 px-9 py-8">
      <div className="flex flex-wrap items-start gap-x-9 gap-y-5">
        {image !== null && (
          <img
            src={image}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
            className="size-44 shrink-0 rounded-6 border border-line bg-grid object-cover"
          />
        )}

        <div className="flex min-w-0 flex-1 basis-120 flex-col gap-2">
          <span
            className="line-clamp-2 text-sm font-medium leading-[1.4] text-text"
            title={title}
          >
            {title}
          </span>
          {block.note !== undefined && (
            <span className="truncate text-tiny text-faint">{phrase(t, block.note)}</span>
          )}
        </div>

        {block.status !== undefined && (
          <Pill size="sm" tone={block.status.tone ?? 'neutral'} className="shrink-0">
            {phrase(t, block.status.text)}
          </Pill>
        )}
      </div>

      {figures.length > 0 && (
        <dl className="m-0 flex flex-wrap gap-x-12 gap-y-7 border-t border-line pt-8">
          {figures.map((figure, index) => (
            <div key={index} className="flex grow basis-100 flex-col gap-1">
              <dt className="text-tiny text-faint">{phrase(t, figure.label)}</dt>
              <dd
                data-numeric
                className={cn(
                  'm-0 whitespace-nowrap text-xs-plus',
                  figure.tone === undefined ? 'text-text' : TONE_TEXT[figure.tone],
                )}
              >
                {formatFigure(figure.value, figure.format, language)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}
