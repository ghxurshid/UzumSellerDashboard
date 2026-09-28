import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '@/constants/settings';
import type { AiSettings } from '@/types/settings';

const { complete } = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock('@/services/ai/client', () => ({ complete }));

const { generateInsightCards } = await import('./ai');

/**
 * Whether the rail asks the model at all.
 *
 * It used to ask only when a key was stored, which read a working local Ollama
 * — or a keyless custom gateway — as "not configured": the chat answered, the
 * rail stayed silent. The gate is now the transport's own `isAiConfigured`, so
 * the two can no longer disagree about the same connection.
 */

const ask = (ai: Partial<AiSettings>) =>
  generateInsightCards({
    ai: { ...DEFAULT_SETTINGS.ai, ...ai },
    digest: 'DATA',
    language: 'uz',
    covered: [],
  });

beforeEach(() => {
  complete.mockReset();
  complete.mockResolvedValue('{"cards":[]}');
});

describe('the rail author', () => {
  it('asks a keyless local runtime', async () => {
    await ask({ provider: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'qwen3' });

    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('asks a keyless custom gateway', async () => {
    await ask({ provider: 'custom', baseUrl: 'https://llm.example.invalid/v1', apiKey: '', model: 'm' });

    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('stays quiet for a vendor that needs a key and has none', async () => {
    const cards = await ask({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-6-astra' });

    expect(cards).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
  });

  it('stays quiet for a keyless runtime with no model to name', async () => {
    const cards = await ask({ provider: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: '', model: '' });

    expect(cards).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
  });
});
