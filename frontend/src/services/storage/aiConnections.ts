import { findProvider } from '@/constants/settings';
import type { AiConnection, AiProvider, AiSettings } from '@/types/settings';

/**
 * Switching the active AI provider without losing or leaking a key.
 *
 * The active provider's connection lives in `AiSettings`'s flat fields, so
 * every consumer that talks to the model — `services/ai`, `services/insights`,
 * `services/queries` — reads one connection and never has to know the others
 * exist. This module is the one place that moves a connection between that
 * flat shape and `saved`, so the seller can switch providers back and forth
 * without a stray field ever crossing from one vendor's key to another's
 * endpoint.
 */

/**
 * The AI section after the seller picks `next`: the current connection is filed
 * under `saved[current]`, and `next`'s saved connection — or, when it has none,
 * its catalogue defaults (endpoint, default model, empty key and org id) —
 * becomes the active one. Selecting the active provider returns `ai` itself.
 */
export function switchAiProvider(ai: AiSettings, next: AiProvider): AiSettings {
  if (next === ai.provider) return ai;

  /* File the outgoing provider's connection away before anything else reads
     the flat fields. */
  const nextSaved: Partial<Record<AiProvider, AiConnection>> = {
    ...ai.saved,
    [ai.provider]: { baseUrl: ai.baseUrl, apiKey: ai.apiKey, orgId: ai.orgId, model: ai.model },
  };

  /* What `next` had saved, or — the first time it is ever selected — the
     catalogue's defaults for it: its own endpoint and default model, with no
     key or org id, never another provider's. */
  const restored = nextSaved[next];
  const definition = findProvider(next);
  const activated: AiConnection = restored ?? {
    baseUrl: definition.baseUrl,
    apiKey: '',
    orgId: '',
    model: definition.defaultModel,
  };

  /* The active connection lives only in the flat fields below; a copy left
     behind in `saved` could drift from it. */
  delete nextSaved[next];

  return {
    ...ai,
    provider: next,
    baseUrl: activated.baseUrl,
    apiKey: activated.apiKey,
    orgId: activated.orgId,
    model: activated.model,
    saved: nextSaved,
  };
}
