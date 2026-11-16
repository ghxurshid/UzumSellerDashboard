import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_AI_SETTINGS, defaultAiConnection } from '@core/constants/settings';
import { safeToolName, type ToolCall } from '@core/ai/messages';
import type { StreamOptions, StreamResult } from '@core/ai/stream';
import type { Block } from '@core/agent/blocks';
import type { AiProvider, AiSettings } from '@core/types/settings';

import type { SellerSession } from '@ext/uzum/session';

import { buildExtensionSystem } from './prompt';
import { EXTENSION_TOOLKIT, createExtToolContext } from './toolkit';

/* The model, and the cabinet behind the bridge — the two things a test cannot
   reach. Everything between them is the real loop, the real toolkit and the
   real renderer. */
const { streamComplete } = vi.hoisted(() => ({ streamComplete: vi.fn() }));
vi.mock('@core/ai/stream', () => ({ streamComplete }));

const { uzumRequest } = vi.hoisted(() => ({ uzumRequest: vi.fn() }));
vi.mock('@ext/uzum/client', () => ({ uzumRequest }));

const { createSession, runAgent } = await import('@core/agent/agent');

/**
 * One question through the shared loop, on the extension's toolkit.
 *
 * What the panel will do per question: build the prompt and the tool context
 * from one session, hand `runAgent` the extension's toolkit, and draw what
 * comes back. These pin that the pieces meet — the model can open the toolkit,
 * call the product list, read what the cabinet sent, and answer in blocks that
 * reach the screen — over both the provider's own tool calls and the text
 * protocol. Every value is invented.
 */

const NOW = Date.UTC(2026, 10, 12, 9, 30);

const SESSION: SellerSession = {
  signedIn: true,
  shopIds: [4101, 4202],
  currentShopId: 4202,
  sellerId: 777_431,
  accountId: 868_529,
  permissions: { 4101: ['PRODUCT_READ'], 4202: ['PRODUCT_READ'] },
};

/** A body in the one recorded shape (`productList`); the read goes through the specialised tables. */
const CABINET_BODY = {
  productList: [
    { productId: 90_017, title: 'Ipak sharf Q7', skuCount: 3 },
    { productId: 90_018, title: 'Paxta ro‘mol Z2', skuCount: 1 },
  ],
};

const settingsFor = (provider: AiProvider): AiSettings => ({
  ...DEFAULT_AI_SETTINGS,
  ...defaultAiConnection(provider),
  provider,
  baseUrl: 'https://example.invalid',
  apiKey: 'k',
  model: 'm',
});

interface Turn {
  readonly text?: string;
  readonly calls?: readonly ToolCall[];
}

function turns(...script: readonly Turn[]): void {
  let index = 0;
  streamComplete.mockImplementation(async (options: StreamOptions): Promise<StreamResult> => {
    const turn = script[index] ?? {};
    index += 1;
    const text = turn.text ?? '';
    if (text !== '') options.onDelta(text);
    return {
      text,
      calls: [...(turn.calls ?? [])],
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
    } as StreamResult;
  });
}

async function ask(provider: AiProvider, session: SellerSession = SESSION) {
  const native = provider !== 'ollama';
  const blocks: Block[] = [];
  const signal = new AbortController().signal;

  const outcome = await runAgent({
    settings: settingsFor(provider),
    system: buildExtensionSystem({ language: 'uz', native, session, now: NOW, timeZone: 'Asia/Tashkent' }),
    session: createSession({ question: 'mahsulotlarim ro‘yxatini ko‘rsat', history: [] }),
    toolkit: EXTENSION_TOOLKIT,
    context: createExtToolContext({ session, language: 'uz', now: NOW, signal }),
    language: 'uz',
    granted: new Set(),
    signal,
    onBlocks: (produced) => blocks.push(...produced),
    onRun: () => {},
  });

  return { blocks, outcome };
}

const request = (call: number): StreamOptions['request'] =>
  (streamComplete.mock.calls[call]?.[0] as StreamOptions).request;

const ANSWER =
  '{"kind":"text","text":"Sahifada **2 ta** mahsulot bor."}\n' +
  '{"kind":"table","columns":["productId","title"],"rows":[[90017,"Ipak sharf Q7"],[90018,"Paxta ro‘mol Z2"]],"formats":["text","text"]}';

beforeEach(() => {
  streamComplete.mockReset();
  uzumRequest.mockReset();
  uzumRequest.mockResolvedValue({
    status: 200,
    data: CABINET_BODY,
    shopId: 4202,
    route: 'GET /api/seller/shop/{shopId}/product/getProducts',
  });
});

describe('a question on the extension toolkit', () => {
  it('opens the toolkit, reads the product list and answers with native tool calls', async () => {
    turns(
      { calls: [{ id: 'c1', name: 'open_toolkit', args: { capability: 'tools' } }] },
      { calls: [{ id: 'c2', name: safeToolName('products.list'), args: { page: 0, size: 10 } }] },
      { text: ANSWER },
    );

    const { blocks, outcome } = await ask('gemini');

    /* First request: only the door is declared. */
    expect(request(0).tools?.map((tool) => tool.name)).toEqual(['open_toolkit']);
    /* After opening: the product list and the follow-up chip, and nothing of the site's. */
    const declared = request(1).tools?.map((tool) => tool.name) ?? [];
    expect(declared).toEqual(['open_toolkit', 'products_list', 'copilot_ask']);

    /* No shopId from the model: the cabinet was asked for the shop on screen. */
    expect(uzumRequest).toHaveBeenCalledTimes(1);
    expect(uzumRequest.mock.calls[0]?.[0]).toBe('products.list');
    expect(uzumRequest.mock.calls[0]?.[1]).toEqual({ shopId: 4202, page: 0, size: 10, filter: 'ALL' });

    /* The model read what the cabinet sent, under the API's own field names. */
    const third = JSON.stringify(request(2).messages);
    expect(third).toContain('productId');
    expect(third).toContain('Ipak sharf Q7');
    expect(third).toContain('askedShopId');

    /* And its answer reached the screen, after the trace of what was read. */
    expect(blocks.map((block) => block.kind)).toEqual(['trace', 'text', 'table']);
    expect(blocks[0]).toMatchObject({ kind: 'trace', tool: 'products.list' });
    expect(blocks[1]).toMatchObject({ kind: 'text', text: 'Sahifada **2 ta** mahsulot bor.' });
    expect(outcome.calls).toBe(1);
    expect(outcome.dropped).toBe(0);
    expect(outcome.routes).toEqual(['GET /api/seller/shop/{shopId}/product/getProducts']);
  });

  it('still reads a body in a shape nobody recorded, through the generic renderer', async () => {
    uzumRequest.mockResolvedValue({
      status: 200,
      data: { items: [{ id: 1, name: 'Ipak sharf Q7' }] },
      shopId: 4202,
      route: 'GET /api/seller/shop/{shopId}/product/getProducts',
    });
    turns(
      { calls: [{ id: 'c1', name: 'open_toolkit', args: { capability: 'tools' } }] },
      { calls: [{ id: 'c2', name: safeToolName('products.list'), args: {} }] },
      { text: ANSWER },
    );

    const { outcome } = await ask('gemini');

    const third = JSON.stringify(request(2).messages);
    expect(third).toContain('shape not recognised: printed generically');
    expect(third).toContain('Ipak sharf Q7');
    expect(third).toContain('askedShopId');
    expect(outcome.calls).toBe(1);
  });

  it('does the same over the text protocol', async () => {
    turns(
      { text: '{"need":"tools"}' },
      { text: '{"call":"products.list","args":{"shopId":4101}}' },
      { text: ANSWER },
    );

    const { blocks, outcome } = await ask('ollama');

    expect(request(0).tools).toBeUndefined();
    /* The toolkit document is the extension's, not the site's. */
    const second = JSON.stringify(request(1).messages);
    expect(second).toContain('products.list');
    expect(second).not.toContain('window.totals');

    expect(uzumRequest.mock.calls[0]?.[1]).toEqual({ shopId: 4101, page: 0, size: 24, filter: 'ALL' });
    expect(JSON.stringify(request(2).messages)).toContain('Paxta ro‘mol Z2');

    expect(blocks.map((block) => block.kind)).toEqual(['trace', 'text', 'table']);
    expect(outcome.dropped).toBe(0);
  });

  it('refuses a site action the model remembered, and asks for the line again', async () => {
    turns(
      { text: '{"kind":"action","actionId":"product.price","params":{"productId":90017,"price":120000}}' },
      { text: '{"kind":"text","text":"Narxni bu yerdan o‘zgartira olmayman."}' },
    );

    const { blocks, outcome } = await ask('ollama');

    /* Nothing drawn for the refused button; the rewrite turn names what exists. */
    expect(blocks).toEqual([{ kind: 'text', text: 'Narxni bu yerdan o‘zgartira olmayman.' }]);
    const rewrite = JSON.stringify(request(1).messages);
    expect(rewrite).toContain('no action named \\"product.price\\"');
    expect(rewrite).toContain('copilot.ask');
    expect(outcome.dropped).toBe(0);
    expect(uzumRequest).not.toHaveBeenCalled();
  });

  it('places a follow-up chip and never runs it', async () => {
    turns({
      text:
        '{"kind":"text","text":"Tayyor."}\n' +
        '{"kind":"action","actionId":"copilot.ask","params":{"question":"Qaysi biri tugayapti?"}}',
    });

    const { blocks } = await ask('ollama');

    expect(blocks).toEqual([
      { kind: 'text', text: 'Tayyor.' },
      { kind: 'action', actionId: 'copilot.ask', params: { question: 'Qaysi biri tugayapti?' } },
    ]);
  });

  it('makes no request for a signed-out tab, and says why to the model', async () => {
    const signedOut: SellerSession = {
      signedIn: false,
      shopIds: [],
      currentShopId: null,
      sellerId: null,
      accountId: null,
      permissions: {},
    };
    turns(
      { text: '{"call":"products.list","args":{}}' },
      { text: '{"kind":"text","text":"Kabinetga kiring."}' },
    );

    const { blocks } = await ask('ollama', signedOut);

    expect(uzumRequest).not.toHaveBeenCalled();
    expect(request(0).system).toContain('NOT signed in');
    expect(JSON.stringify(request(1).messages)).toContain('not signed in');
    expect(blocks.at(-1)).toEqual({ kind: 'text', text: 'Kabinetga kiring.' });
  });
});
