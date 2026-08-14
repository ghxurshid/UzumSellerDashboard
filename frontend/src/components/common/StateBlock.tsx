import {
  CloudOff,
  FolderOpen,
  Lock,
  Plug,
  RefreshCw,
  SearchX,
  ShieldAlert,
  Sparkles,
  TimerOff,
  TriangleAlert,
} from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import type { TranslationKey } from '@/lib/i18n/dictionary';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/store/ui.store';
import type { ScreenState } from '@/types/domain';

interface BlockDefinition {
  readonly icon: ComponentType<{ className?: string }>;
  readonly titleKey: TranslationKey;
  readonly bodyKey: TranslationKey;
  readonly ctaKey: TranslationKey;
  readonly tone: 'accent' | 'warn' | 'neg';
}

/**
 * Full-pane states.
 *
 * Each of these is a place the application can genuinely end up, so each gets a
 * cause, a consequence and a way out. The `meta` line underneath carries the
 * evidence — the status code, the timeout, the time of the last successful
 * sync — because "something went wrong" is not a diagnosis.
 */
const BLOCKS: Readonly<Partial<Record<ScreenState, BlockDefinition>>> = {
  initial: { icon: Plug, titleKey: 'blInitT', bodyKey: 'blInitB', ctaKey: 'blInitC', tone: 'accent' },
  empty: { icon: FolderOpen, titleKey: 'blEmptyT', bodyKey: 'blEmptyB', ctaKey: 'blEmptyC', tone: 'accent' },
  noSearch: { icon: SearchX, titleKey: 'blSearchT', bodyKey: 'blSearchB', ctaKey: 'blSearchC', tone: 'accent' },
  noFilter: { icon: SearchX, titleKey: 'blFilterT', bodyKey: 'blFilterB', ctaKey: 'blFilterC', tone: 'accent' },
  error: { icon: TriangleAlert, titleKey: 'blErrT', bodyKey: 'blErrB', ctaKey: 'blErrC', tone: 'neg' },
  offline: { icon: CloudOff, titleKey: 'blOffT', bodyKey: 'blOffB', ctaKey: 'blOffC', tone: 'warn' },
  timeout: { icon: TimerOff, titleKey: 'blTimeT', bodyKey: 'blTimeB', ctaKey: 'blTimeC', tone: 'warn' },
  unauth: { icon: Lock, titleKey: 'blUnauthT', bodyKey: 'blUnauthB', ctaKey: 'blUnauthC', tone: 'accent' },
  forbidden: { icon: ShieldAlert, titleKey: 'blForbT', bodyKey: 'blForbB', ctaKey: 'blForbC', tone: 'neg' },
};

const TONE_CLASS = {
  accent: 'border-acc-line bg-acc-soft text-acc-dim',
  warn: 'border-warn-line bg-warn-soft text-warn',
  neg: 'border-neg-line bg-neg-soft text-neg',
} as const;

export interface StateBlockProps {
  readonly state: ScreenState;
  readonly onPrimaryAction: () => void;
  /** Values for the body copy's placeholders, e.g. the query that found nothing. */
  readonly vars?: Readonly<Record<string, string | number>>;
  readonly secondaryLabel?: string;
  readonly onSecondaryAction?: () => void;
  /** The evidence line: status code, timing, or the last successful sync. */
  readonly meta?: string | null;
}

export function StateBlock({
  state,
  onPrimaryAction,
  vars,
  secondaryLabel,
  onSecondaryAction,
  meta,
}: StateBlockProps): ReactNode {
  const { t } = useTranslation();
  const toggleChat = useUiStore((store) => store.toggleChat);

  const block = BLOCKS[state];
  if (block === undefined) return null;

  const Icon = block.icon;

  return (
    <div className="flex h-full items-center justify-center p-40">
      <div className="flex max-w-430 flex-col items-start gap-12">
        <span
          className={cn(
            'flex size-44 items-center justify-center rounded-11 border',
            TONE_CLASS[block.tone],
          )}
        >
          <Icon aria-hidden className="size-20" />
        </span>

        <h2 className="text-xl font-medium tracking-[-0.02em]">{t(block.titleKey)}</h2>
        <p className="text-sm-plus leading-[1.6] text-dim">{t(block.bodyKey, vars)}</p>

        <div className="mt-2 flex flex-wrap gap-7">
          <Button
            variant="primary"
            size="lg"
            icon={<RefreshCw aria-hidden className="size-12" />}
            onClick={onPrimaryAction}
          >
            {t(block.ctaKey)}
          </Button>

          {secondaryLabel !== undefined && onSecondaryAction !== undefined && (
            <Button size="lg" onClick={onSecondaryAction}>
              {secondaryLabel}
            </Button>
          )}

          <Button
            size="lg"
            icon={<Sparkles aria-hidden className="size-11" />}
            onClick={toggleChat}
          >
            {t('askCopilot')}
          </Button>
        </div>

        {meta !== undefined && meta !== null && meta !== '' && (
          <p className="w-full border-t border-line pt-10 font-mono text-mini leading-[1.5] text-faint">
            {meta}
          </p>
        )}
      </div>
    </div>
  );
}
