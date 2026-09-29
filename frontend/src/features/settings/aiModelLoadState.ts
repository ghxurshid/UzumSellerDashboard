import type { ProviderModel } from '@/services/ai/connection';

/**
 * One provider's own "Load models" cache — kept apart from the component
 * files so `AiProviderCard.tsx` and `AiSettings.tsx` can both import the type
 * and the empty sentinel without either file losing its "only exports
 * components" shape that fast refresh depends on.
 */
export interface ModelLoadState {
  readonly models: readonly ProviderModel[];
  readonly loading: boolean;
  readonly error: string | null;
}

export const EMPTY_LOAD_STATE: ModelLoadState = { models: [], loading: false, error: null };
