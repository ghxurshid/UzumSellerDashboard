import type { ReactNode } from 'react';

import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { AI_PROVIDERS } from '@/constants/settings';
import type { TranslationKey } from '@/lib/i18n/dictionary';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { isAiConfigured, requiresApiKey } from '@/services/ai/modelRules';
import type { Tone } from '@/types/domain';
import type { AiProvider, AiProviderDefinition, AiSettings } from '@/types/settings';

/**
 * The nine-card provider grid.
 *
 * Every card reads a fact this app actually holds — never a fixed "operational"
 * string the bundle shipped with and cannot know is still true. The active
 * card asks `isAiConfigured` about the connection on screen right now; every
 * other card asks whether a key for it is filed under `AiSettings.saved`, so a
 * seller who set up three providers and is trying a fourth can see which ones
 * they can switch back to without retyping a key.
 */

type CardState = 'configured' | 'notConfigured' | 'keySaved' | 'noKeyNeeded' | 'notSetUp';

const TONE: Readonly<Record<CardState, Tone>> = {
  configured: 'positive',
  notConfigured: 'warning',
  keySaved: 'accent',
  noKeyNeeded: 'neutral',
  notSetUp: 'neutral',
};

const LABEL: Readonly<Record<CardState, TranslationKey>> = {
  configured: 'aiStateConfigured',
  notConfigured: 'aiStateNotConfigured',
  keySaved: 'aiStateKeySaved',
  noKeyNeeded: 'aiStateNoKeyNeeded',
  notSetUp: 'aiStateNotSetUp',
};

function cardState(provider: AiProviderDefinition, ai: AiSettings): CardState {
  if (provider.id === ai.provider) return isAiConfigured(ai) ? 'configured' : 'notConfigured';

  const saved = ai.saved[provider.id];
  if (saved !== undefined && saved.apiKey.trim() !== '') return 'keySaved';
  if (!requiresApiKey(provider.id)) return 'noKeyNeeded';
  return 'notSetUp';
}

interface AiProviderGridProps {
  readonly ai: AiSettings;
  readonly onSelect: (id: AiProvider) => void;
}

export function AiProviderGrid({ ai, onSelect }: AiProviderGridProps): ReactNode {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-5 gap-8 max-[860px]:grid-cols-3 max-[560px]:grid-cols-2">
      {AI_PROVIDERS.map((provider) => {
        const active = provider.id === ai.provider;
        const state = cardState(provider, ai);

        return (
          <button
            key={provider.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(provider.id)}
            className={cn(
              'flex cursor-pointer flex-col items-start gap-6 rounded-10 border px-10 py-9 text-left',
              'transition-colors hover:border-acc-line',
              active ? 'border-acc bg-acc-soft' : 'border-line bg-panel',
            )}
          >
            <div className="flex w-full items-center gap-7">
              <Icon
                name={provider.icon}
                className={cn('size-14 shrink-0', active ? 'text-acc-dim' : 'text-faint')}
              />
              <span className="truncate text-sm font-medium">{provider.label}</span>
              {active && (
                <Icon name="circle-check" className="ml-auto size-13 shrink-0 text-acc-dim" />
              )}
            </div>
            <Pill tone={TONE[state]} size="sm">
              {t(LABEL[state])}
            </Pill>
          </button>
        );
      })}
    </div>
  );
}
