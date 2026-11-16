import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_AI_SETTINGS, defaultAiConnection } from '@core/constants/settings';
import type { StreamOptions } from '@core/ai/stream';
import type { AiProvider, AiSettings } from '@core/types/settings';

import type { Capability } from '@core/agent/agent';
import type * as Digest from './digest';
import { buildBaseSystem, type PromptContext } from './prompt';
import type { ToolContext } from './toolkit';
import { SITE_TOOLKIT, SITE_WIDGET_HINTS } from './siteToolkit';
import { OPEN_TOOLKIT_SCHEMA } from '@core/tools/contract';
import { buildWidgetGuide } from '@core/agent/widgets';

const { streamComplete } = vi.hoisted(() => ({ streamComplete: vi.fn() }));
vi.mock('@core/ai/stream', () => ({ streamComplete }));

const { freshnessNote } = vi.hoisted(() => ({ freshnessNote: vi.fn() }));
vi.mock('./digest', async (importOriginal) => ({
  ...(await importOriginal<typeof Digest>()),
  freshnessNote,
}));

const { createSession, runAgent } = await import('@core/agent/agent');

/**
 * What the site's model reads, byte for byte.
 *
 * Provider prompt caches key on the prefix, and the wording below was tuned
 * against real answers — so a refactor of how the prompt is *assembled* must not
 * change a character of what is *sent*. The snapshots beside this file were
 * recorded before the engine was made host-agnostic and are the reference:
 * never update them with `-u` to make a refactor pass. Update them only for a
 * wording change that is meant, and say so in the change.
 *
 * One deliberate change (2026-11-13): the zod-to-JSON-Schema converter now
 * honours exclusive bounds, so every `.positive()` integer parameter is declared
 * `"minimum": 1` instead of the misleading `"minimum": 0` — 17 lines, nothing
 * else moved. Validation always refused 0; the declaration now says so up front.
 */

const NOW = Date.UTC(2026, 10, 12, 9, 30);
const SCOPE = {
  storeKey: 'all',
  shopIds: [11, 12],
  rangeKey: 'r30',
  fromMs: Date.UTC(2026, 9, 14),
  toMs: Date.UTC(2026, 10, 12, 23, 59, 59, 999),
} as const;

const prompt = (native: boolean, shopNames: readonly string[] = ['Abaya Shop', 'Kids']): PromptContext => ({
  language: 'uz',
  scope: SCOPE,
  shopNames,
  now: NOW,
  native,
});

const CONTEXT: ToolContext = {
  scope: SCOPE,
  products: [],
  shops: [
    { id: 11, name: 'Abaya Shop' },
    { id: 12, name: 'Kids' },
  ],
  language: 'uz',
  now: NOW,
  signal: undefined,
};

const NOTE = '[freshness] now 09:30 UTC · stored here, auto-refreshes past 60min\nsales 09:12 · returns never';

const settingsFor = (provider: AiProvider): AiSettings => ({
  ...DEFAULT_AI_SETTINGS,
  ...defaultAiConnection(provider),
  provider,
  baseUrl: 'https://example.invalid',
  apiKey: 'k',
  model: 'm',
});

/** One question through the loop; returns what the first request carried. */
async function firstRequest(
  provider: AiProvider,
  carried: ReadonlySet<Capability>,
): Promise<StreamOptions['request']> {
  streamComplete.mockImplementation(async (options: StreamOptions) => {
    const text = '{"kind":"text","text":"Tayyor."}';
    options.onDelta(text);
    return { text, calls: [], inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  });

  const native = provider !== 'ollama';
  await runAgent({
    settings: settingsFor(provider),
    system: buildBaseSystem(prompt(native)),
    session: createSession({ question: 'sotuv qanday?', history: [], carried }),
    toolkit: SITE_TOOLKIT,
    context: CONTEXT,
    language: 'uz',
    granted: new Set(carried),
    signal: new AbortController().signal,
    onBlocks: () => {},
    onRun: () => {},
    budget: { rounds: 1, calls: 1 },
  });

  const request = (streamComplete.mock.calls[0]?.[0] as StreamOptions).request;
  return request;
}

beforeEach(() => {
  streamComplete.mockReset();
  freshnessNote.mockReset();
  freshnessNote.mockResolvedValue(NOTE);
});

describe('the base system prompt', () => {
  it('is unchanged for a provider that carries tool calls', () => {
    expect(buildBaseSystem(prompt(true))).toMatchSnapshot();
  });

  it('is unchanged for the text protocol', () => {
    expect(buildBaseSystem(prompt(false))).toMatchSnapshot();
  });

  it('is unchanged when no shop name is known', () => {
    expect(buildBaseSystem(prompt(true, []))).toMatchSnapshot();
  });
});

describe('the widget guide', () => {
  it('is unchanged', () => {
    expect(buildWidgetGuide(SITE_WIDGET_HINTS)).toMatchSnapshot();
  });
});

describe('what the loop sends on the site', () => {
  it('carries both documents and the freshness note, natively', async () => {
    const request = await firstRequest('gemini', new Set(['tools', 'widgets']));
    expect(request.system).toMatchSnapshot();
    expect(request.tools).toMatchSnapshot();
  });

  it('carries both documents and the freshness note, over text', async () => {
    const request = await firstRequest('ollama', new Set(['tools', 'widgets']));
    expect(request.system).toMatchSnapshot();
    expect(request.tools).toBeUndefined();
  });

  it('declares only open_toolkit before anything is granted', async () => {
    const request = await firstRequest('claude', new Set());
    expect(request.system).toMatchSnapshot();
    expect(request.tools).toMatchSnapshot();
  });
});

describe('the seams the site is assembled from', () => {
  it('declares open_toolkit exactly as the shared contract does', () => {
    /* createToolkit returns OPEN_TOOLKIT_SCHEMA itself, so this compares a value with
       itself; the real protection is the "declares only open_toolkit" snapshot. */
    expect(SITE_TOOLKIT.schemas(new Set())).toEqual([OPEN_TOOLKIT_SCHEMA]);
  });

  it('gives a host without hints a guide that names no site lookup', () => {
    const generic = buildWidgetGuide();

    expect(generic).not.toContain('window.totals');
    expect(generic).not.toContain('sales.timeline');
    expect(generic).toContain('closing total before you send it.');
    expect(generic).toContain('             or per product.\n');
  });
});
