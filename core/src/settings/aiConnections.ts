import type { AiConnection, AiProvider, AiSection, AiSettings } from '@core/types/settings';

/**
 * Pure helpers over `AiSection` — the shape that keeps every provider's whole
 * configuration side by side, next to a pointer naming the one in use.
 *
 * The seller's reported bug was one card and one set of fields shared by
 * every provider: entering a Gemini key, switching to OpenAI, entering its
 * key, and switching back showed OpenAI's key under Gemini's card. The fix is
 * structural, not a card that tries harder to remember — `providers` already
 * holds every provider's connection, complete, independent of which one is
 * active, so there is nothing left to move, save or restore when the active
 * pointer changes. These three functions are the only place `AiSection` is
 * built or read from; nothing above should reach into `.providers` directly.
 */

/**
 * One provider's configuration, flattened with its id the way a request is
 * built from. `provider` defaults to the section's own active provider, but a
 * caller may resolve any provider's settings without switching to it first —
 * a connection test run from a card that is not yet active, say.
 */
export function resolveAiSettings(section: AiSection, provider?: AiProvider): AiSettings {
  const id = provider ?? section.provider;
  return { provider: id, ...section.providers[id] };
}

/**
 * Merge `patch` over `provider`'s current connection and nothing else.
 *
 * Every other entry in `providers` — including the active one, when a
 * different provider is being edited — is carried over by reference. That is
 * what makes the independence real rather than asserted: a card bound to
 * `providers.openai` can edit its own key field a hundred times and the
 * object at `providers.gemini` never changes identity, let alone value.
 */
export function withAiConnection(
  section: AiSection,
  provider: AiProvider,
  patch: Partial<AiConnection>,
): AiSection {
  const current = section.providers[provider];
  const next: AiConnection = { ...current, ...patch };

  return {
    ...section,
    providers: { ...section.providers, [provider]: next },
  };
}

/**
 * Move the active pointer, and nothing else.
 *
 * Earlier designs filed the outgoing provider's connection into a side table
 * and restored the incoming one from it or from catalogue defaults — the
 * "switch" this module used to perform. There is no such step now: every
 * provider's configuration already lives in `providers`, complete, whether or
 * not it is the one in use, so making one active is exactly as small as
 * naming it. No connection is copied, moved or cleared.
 */
export function withActiveProvider(section: AiSection, provider: AiProvider): AiSection {
  if (provider === section.provider) return section;
  return { ...section, provider };
}
