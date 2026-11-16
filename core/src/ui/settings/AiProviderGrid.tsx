import type { ReactNode } from 'react';

import { Icon } from '@core/ui/kit/Icon';
import { Pill } from '@core/ui/kit/Pill';
import { AI_PROVIDERS } from '@core/constants/settings';
import type { TranslationKey } from '@core/i18n/dictionary';
import { useTranslation } from '@core/i18n/useTranslation';
import { cn } from '@core/lib/utils';
import { resolveAiSettings } from '@core/settings/aiConnections';
import { isAiConfigured, requiresApiKey } from '@core/ai/modelRules';
import type { Tone } from '@core/types/common';
import type { AiProvider, AiProviderDefinition, AiSection } from '@core/types/settings';

/**
 * The nine-card provider navigator.
 *
 * Clicking a tile only opens that provider's card below for editing — it does
 * not make the provider active. Every provider now keeps its own complete,
 * independent configuration (`AiSection.providers`), so a card's state is read
 * straight off that provider's own connection, never off a fixed catalogue
 * label and never off a side table of "providers touched earlier": there is no
 * such table any more, which is exactly the fix for the bug this grid used to
 * paper over (a key typed for one provider showing up under another's card).
 */

type CardState = 'configured' | 'keyMissing' | 'noKeyNeeded';

const TONE: Readonly<Record<CardState, Tone>> = {
  configured: 'positive',
  keyMissing: 'warning',
  noKeyNeeded: 'neutral',
};

const LABEL: Readonly<Record<CardState, TranslationKey>> = {
  configured: 'aiStateConfigured',
  keyMissing: 'aiStateKeyMissing',
  noKeyNeeded: 'aiStateNoKeyNeeded',
};

function cardState(provider: AiProviderDefinition, section: AiSection): CardState {
  if (isAiConfigured(resolveAiSettings(section, provider.id))) return 'configured';
  return requiresApiKey(provider.id) ? 'keyMissing' : 'noKeyNeeded';
}

interface AiProviderGridProps {
  readonly section: AiSection;
  /** The card currently open below — independent of which provider is active. */
  readonly selected: AiProvider;
  readonly onSelect: (id: AiProvider) => void;
}

export function AiProviderGrid({ section, selected, onSelect }: AiProviderGridProps): ReactNode {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-5 gap-8 max-[860px]:grid-cols-3 max-[560px]:grid-cols-2">
      {AI_PROVIDERS.map((provider) => {
        const isOpen = provider.id === selected;
        const isActive = provider.id === section.provider;
        const state = cardState(provider, section);

        return (
          <button
            key={provider.id}
            type="button"
            aria-current={isOpen ? 'true' : undefined}
            onClick={() => onSelect(provider.id)}
            className={cn(
              'flex cursor-pointer flex-col items-start gap-6 rounded-10 border px-10 py-9 text-left',
              'transition-colors hover:border-acc-line',
              isOpen ? 'border-acc bg-acc-soft' : 'border-line bg-panel',
            )}
          >
            <div className="flex w-full items-center gap-7">
              <Icon
                name={provider.icon}
                className={cn('size-14 shrink-0', isOpen ? 'text-acc-dim' : 'text-faint')}
              />
              <span className="truncate text-sm font-medium">{provider.label}</span>
              {isActive && (
                <span className="ml-auto flex shrink-0 items-center gap-3 text-acc-dim">
                  <Icon name="circle-check" className="size-13 shrink-0" />
                  <span className="sr-only">{t('aiActiveProviderSr')}</span>
                </span>
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
