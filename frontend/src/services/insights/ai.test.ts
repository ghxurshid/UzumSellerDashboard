import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_AI_SETTINGS, defaultAiConnection } from '@core/constants/settings';
import type { AiSettings } from '@core/types/settings';

const { complete } = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock('@core/ai/client', () => ({ complete }));

const { generateInsightCards } = await import('./ai');

/**
 * Whether the rail asks the model at all.
 *
 * It used to ask only when a key was stored, which read a working local Ollama
 * — or a keyless custom gateway — as "not configured": the chat answered, the
 * rail stayed silent. The gate is now the transport's own `isAiConfigured`, so
 * the two can no longer disagree about the same connection.
 */

/* Every case names its provider, and the rest of its connection is that
   provider's own defaults — not the app's default provider's values under
   another id. */
const ask = (ai: Partial<AiSettings> & Pick<AiSettings, 'provider'>) =>
  generateInsightCards({
    ai: { ...DEFAULT_AI_SETTINGS, ...defaultAiConnection(ai.provider), ...ai },
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

describe('a card naming an action the site does not have', () => {
  it('is refused by the site registry, as the id enum used to refuse it', async () => {
    complete.mockResolvedValue(
      JSON.stringify({
        cards: [
          {
            id: 'rename',
            severity: 'watch',
            group: 'profit',
            source: 'GET /v1/product/shop/{shopId}',
            title: 'Nomini o‘zgartiring',
            blocks: [
              { kind: 'text', text: 'Nom juda uzun.' },
              { kind: 'action', actionId: 'product.rename', params: { name: 'Abaya' } },
            ],
          },
        ],
      }),
    );

    const cards = await ask({ provider: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'qwen3' });

    expect(cards).toEqual([]);
  });

  it('keeps a card whose action the site registry holds', async () => {
    complete.mockResolvedValue(
      JSON.stringify({
        cards: [
          {
            id: 'stock',
            severity: 'high',
            group: 'stockOps',
            source: 'GET /v2/fbs/sku/stocks',
            title: 'Abaya tugayapti',
            blocks: [
              { kind: 'text', text: 'Qoldiq 2 dona.' },
              { kind: 'action', actionId: 'nav.open', params: { screen: 'inventory' } },
            ],
          },
        ],
      }),
    );

    const cards = await ask({ provider: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'qwen3' });

    expect(cards).toHaveLength(1);
    expect(cards[0]?.blocks.map((block) => block.kind)).toEqual(['text', 'action']);
  });
});
