import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '@core/constants/settings';
import type { AiSection } from '@core/types/settings';

import { resolveAiSettings, withActiveProvider, withAiConnection } from './aiConnections';

/**
 * The three pure helpers `AiSection` is built and read through.
 *
 * The seller's reported bug — a provider switch overwriting another vendor's
 * key — was a consequence of a shared set of fields and a "move the
 * connection over" step. These helpers replace that step entirely: pinning
 * them means pinning that neither `withAiConnection` nor `withActiveProvider`
 * can ever touch a provider they were not asked about.
 */

const SECTION: AiSection = DEFAULT_SETTINGS.ai;

describe('resolveAiSettings', () => {
  it('flattens the active provider\'s connection with its id when no provider is named', () => {
    const settings = resolveAiSettings(SECTION);
    expect(settings).toEqual({ provider: SECTION.provider, ...SECTION.providers[SECTION.provider] });
  });

  it('resolves any named provider without switching to it', () => {
    const settings = resolveAiSettings(SECTION, 'openai');
    expect(settings).toEqual({ provider: 'openai', ...SECTION.providers.openai });
    // The active pointer is untouched by a read.
    expect(SECTION.provider).not.toBe('openai');
  });
});

describe('withAiConnection', () => {
  it('merges the patch over the named provider\'s current connection', () => {
    const next = withAiConnection(SECTION, 'gemini', { apiKey: 'gemini-key' });
    expect(next.providers.gemini).toEqual({ ...SECTION.providers.gemini, apiKey: 'gemini-key' });
  });

  it('leaves every other provider\'s connection at the exact same reference', () => {
    const next = withAiConnection(SECTION, 'gemini', { apiKey: 'gemini-key' });
    for (const id of Object.keys(SECTION.providers) as (keyof typeof SECTION.providers)[]) {
      if (id === 'gemini') continue;
      expect(next.providers[id]).toBe(SECTION.providers[id]);
    }
  });

  it('does not move the active pointer', () => {
    const next = withAiConnection(SECTION, 'openai', { apiKey: 'openai-key' });
    expect(next.provider).toBe(SECTION.provider);
  });

  it('can edit the active provider\'s own connection without disturbing anyone else', () => {
    const next = withAiConnection(SECTION, SECTION.provider, { temperature: 0.9 });
    expect(next.providers[SECTION.provider].temperature).toBe(0.9);
    expect(next.provider).toBe(SECTION.provider);
  });

  it('chains: editing two different providers keeps both edits, independently', () => {
    const afterGemini = withAiConnection(SECTION, 'gemini', { apiKey: 'gemini-key' });
    const afterOpenai = withAiConnection(afterGemini, 'openai', { apiKey: 'openai-key' });

    expect(afterOpenai.providers.gemini.apiKey).toBe('gemini-key');
    expect(afterOpenai.providers.openai.apiKey).toBe('openai-key');
  });
});

describe('withActiveProvider', () => {
  it('moves only the pointer', () => {
    const next = withActiveProvider(SECTION, 'claude');
    expect(next.provider).toBe('claude');
    expect(next.providers).toBe(SECTION.providers);
  });

  it('copies, moves or clears no connection — every provider reads back exactly as it was', () => {
    const edited = withAiConnection(SECTION, 'openai', { apiKey: 'openai-key' });
    const switched = withActiveProvider(edited, 'openai');

    expect(switched.providers).toBe(edited.providers);
    expect(switched.providers.openai.apiKey).toBe('openai-key');
    expect(switched.providers.gemini).toEqual(edited.providers.gemini);
  });

  it('returns the same section by reference when the provider is already active', () => {
    expect(withActiveProvider(SECTION, SECTION.provider)).toBe(SECTION);
  });
});
