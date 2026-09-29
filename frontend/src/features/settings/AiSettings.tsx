import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { useTranslation } from '@/lib/i18n/useTranslation';
import { ApiError } from '@/services/api/client';
import { listModels } from '@/services/ai/connection';
import { canListModels } from '@/services/ai/modelRules';
import { useAiProviderSettings, useAiSection } from '@/store/settings.store';
import type { AiProvider, AiSettings as AiSettingsModel } from '@/types/settings';

import { AiProviderCard } from './AiProviderCard';
import { AiProviderGrid } from './AiProviderGrid';
import { EMPTY_LOAD_STATE, type ModelLoadState } from './aiModelLoadState';
import { describeAiError } from './aiErrors';

/**
 * AI provider configuration.
 *
 * The nine-card catalogue on top is a navigator, not a switch: opening a card
 * only decides which one is shown below for editing, never which provider the
 * Copilot uses — that is the card's own "Make active" button. Every provider
 * keeps its whole configuration independently (`AiSection.providers`), so
 * opening one card, then another, then back never carries a field from one
 * provider's card into another's; there is no shared draft anywhere in this
 * pane for that to happen through.
 *
 * The "Load models" cache is the one piece of state kept here rather than
 * inside the card: `AiProviderCard` mounts fresh (`key={selected}`) every time
 * a different card is opened, so a per-provider list this pane already fetched
 * this session would otherwise be thrown away and re-fetched on every visit.
 */
export function AiSettings(): ReactNode {
  const { t } = useTranslation();
  const section = useAiSection();

  const [selected, setSelected] = useState<AiProvider>(section.provider);
  const [loadState, setLoadState] = useState<Partial<Record<AiProvider, ModelLoadState>>>({});
  const loadControllerRef = useRef<AbortController | null>(null);

  const resolvedSelected = useAiProviderSettings(selected);

  // A pending "load models" probe belongs to the pane, not to whatever the seller does next.
  useEffect(() => {
    return () => {
      loadControllerRef.current?.abort();
    };
  }, []);

  const selectCard = (next: AiProvider): void => {
    if (next === selected) return;
    loadControllerRef.current?.abort();
    setSelected(next);
  };

  /* The models this key can actually see, in the same dialect the chat uses.
     `listModels` reuses `isAiConfigured`'s gate, which also asks for a chosen
     model — right for a connection test, which has to send one, but wrong for
     "show me what's available" before anything is chosen, so this gates on
     the weaker `canListModels` instead and, when the model field is still
     blank, sends a placeholder that only clears that gate: it is never put on
     the wire and never saved. */
  const loadModels = useCallback((): void => {
    if (!canListModels(resolvedSelected)) return;

    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;

    const target = selected;
    setLoadState((state) => ({
      ...state,
      [target]: { models: state[target]?.models ?? [], loading: true, error: null },
    }));

    const probe: AiSettingsModel =
      resolvedSelected.model.trim() === '' ? { ...resolvedSelected, model: '*' } : resolvedSelected;

    listModels(probe, controller.signal)
      .then((models) => {
        setLoadState((state) => ({ ...state, [target]: { models, loading: false, error: null } }));
      })
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? describeAiError(error, target, t) : t('aiErrUnknown');
        setLoadState((state) => ({
          ...state,
          [target]: { models: state[target]?.models ?? [], loading: false, error: message },
        }));
      });
  }, [resolvedSelected, selected, t]);

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-3">
        <h1 className="m-0 text-xl font-medium tracking-[-0.02em]">{t('sAi')}</h1>
        <p className="m-0 max-w-760 text-xs-plus leading-[1.6] text-dim">{t('aiSub')}</p>
      </header>

      <div className="flex flex-col gap-6">
        <AiProviderGrid section={section} selected={selected} onSelect={selectCard} />
        <p className="m-0 text-tiny leading-[1.5] text-faint">{t('aiGridHint')}</p>
      </div>

      <AiProviderCard
        key={selected}
        id={selected}
        active={selected === section.provider}
        loadState={loadState[selected] ?? EMPTY_LOAD_STATE}
        onLoadModels={loadModels}
      />
    </div>
  );
}
