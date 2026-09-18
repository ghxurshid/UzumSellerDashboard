import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { Skeleton } from '@/components/ui/Skeleton';
import { CONTROL, CONTROL_HEIGHT } from '@/components/ui/Field';
import { GEMINI_LIMITS_AS_OF } from '@/constants/settings';
import { useModelUsageLoaded, useNow, useProviderModelUsage } from '@/hooks/useModelUsage';
import { formatCalendarDate } from '@/lib/format';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import type { AiModelOption, AiProvider } from '@/types/settings';

import { optionSummaryText, toneForGauge } from './quotaText';

const FILL_TONE: Readonly<Record<'pos' | 'warn' | 'neg', string>> = {
  pos: 'bg-pos',
  warn: 'bg-warn',
  neg: 'bg-neg',
};

const TEXT_TONE: Readonly<Record<'pos' | 'warn' | 'neg', string>> = {
  pos: 'text-pos',
  warn: 'text-warn',
  neg: 'text-neg',
};

const ITEM = cn(
  'relative flex w-full cursor-pointer select-none flex-col gap-4 rounded-8 px-9 py-7',
  'text-left text-sm text-text outline-none transition-colors',
  'data-[highlighted]:bg-acc-soft',
  'data-[state=checked]:bg-acc-soft',
);

const VIEWPORT_BUTTON = 'flex h-20 cursor-default items-center justify-center text-faint';

interface ModelPickerProps {
  readonly label: string;
  readonly provider: AiProvider;
  readonly options: readonly AiModelOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}

/**
 * The model field for a provider whose catalogue publishes rate limits.
 *
 * A native `<select>` cannot draw a bar inside an `<option>`, so this is
 * Radix `Select` instead — it keeps the same listbox semantics, `Escape`,
 * roving focus and typeahead a native control gives for free, and only the
 * visuals of each row are custom. Every option stays selectable, exhausted
 * ones included: quota is a reason to pick a different model, not a reason
 * to hide one the seller already has configured elsewhere.
 */
export function ModelPicker({ label, provider, options, value, onChange }: ModelPickerProps): ReactNode {
  const { t } = useTranslation();
  const usage = useProviderModelUsage(provider);
  const loaded = useModelUsageLoaded();
  const now = useNow();
  const labelId = useId();

  const selected = options.find((option) => option.id === value);

  return (
    <div className="flex flex-col gap-5">
      <label id={labelId} className="text-sm text-dim">
        {label}
      </label>

      <Select.Root value={value} onValueChange={onChange}>
        <Select.Trigger
          aria-labelledby={labelId}
          className={cn(
            CONTROL,
            CONTROL_HEIGHT,
            'flex cursor-pointer items-center justify-between gap-8 border-line-2',
          )}
        >
          <Select.Value className="min-w-0 truncate">{selected?.label ?? value}</Select.Value>
          <Select.Icon>
            <ChevronDown aria-hidden className="size-14 shrink-0 text-faint" />
          </Select.Icon>
        </Select.Trigger>

        <Select.Portal>
          <Select.Content
            position="popper"
            sideOffset={6}
            className={cn(
              'z-50 w-[var(--radix-select-trigger-width)] overflow-hidden rounded-11',
              'border border-line-2 bg-panel shadow-[var(--shadow-menu)]',
              'data-[state=open]:animate-[pop_0.14s_ease]',
            )}
          >
            <Select.ScrollUpButton className={VIEWPORT_BUTTON}>
              <ChevronUp aria-hidden className="size-13" />
            </Select.ScrollUpButton>

            <Select.Viewport className="max-h-[min(360px,60vh)] p-5">
              {options.map((option) => {
                const hasLimits = option.limits !== undefined;
                const optionUsage = usage.get(option.id);
                /* Gated on `loaded` in addition to `optionUsage !== undefined`:
                   `useProviderModelUsage` computes a gauge from whatever is in
                   the store *right now*, restored or not, so before the ledger
                   has loaded the gauge would show a full bar rather than
                   nothing — the same "unknown shown as zero-used" the skeleton
                   below exists to avoid. */
                const resolved = loaded ? optionUsage : undefined;
                const tone = resolved === undefined ? null : toneForGauge(resolved[resolved.bottleneck]);
                const share =
                  resolved === undefined ? 0 : Math.max(0, Math.min(1, resolved.remainingShare));

                return (
                  <Select.Item key={option.id} value={option.id} className={ITEM}>
                    <span className="flex items-center gap-8">
                      <Select.ItemText>
                        <span className="flex min-w-0 flex-col gap-2">
                          <span className="truncate text-sm-plus text-text">{option.label}</span>
                          {hasLimits && !loaded && (
                            <Skeleton className="h-9 w-[70%]" />
                          )}
                          {resolved !== undefined && (
                            <span className={cn('truncate text-tiny', TEXT_TONE[tone ?? 'pos'])}>
                              {optionSummaryText(t, resolved, now)}
                            </span>
                          )}
                        </span>
                      </Select.ItemText>
                      <Select.ItemIndicator className="ml-auto shrink-0">
                        <Check aria-hidden className="size-12 text-acc-dim" />
                      </Select.ItemIndicator>
                    </span>

                    {hasLimits && !loaded && <Skeleton className="h-4 w-full" shimmer={false} />}

                    {resolved !== undefined && (
                      /* Decorative only — `optionSummaryText` above already carries
                         this bar's information as text, which is what a screen
                         reader announces for the option. */
                      <span
                        aria-hidden
                        className="relative block h-4 w-full overflow-hidden rounded-2 bg-grid"
                      >
                        <span
                          className={cn(
                            'absolute inset-y-0 left-0 block rounded-2',
                            FILL_TONE[tone ?? 'pos'],
                          )}
                          style={{ width: `${(share * 100).toFixed(1)}%` }}
                        />
                      </span>
                    )}
                  </Select.Item>
                );
              })}
            </Select.Viewport>

            <Select.ScrollDownButton className={VIEWPORT_BUTTON}>
              <ChevronDown aria-hidden className="size-13" />
            </Select.ScrollDownButton>

            {/* The trigger's own source note lives outside this portal, so a
                seller who never opens the closed panel never sees it — this is
                the only place the figures in this specific list carry their
                source. */}
            <div className="border-t border-line-2 px-9 py-6 text-tiny leading-[1.4] text-faint">
              {t('quotaSourceNoteShort', { date: formatCalendarDate(GEMINI_LIMITS_AS_OF) })}
            </div>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
