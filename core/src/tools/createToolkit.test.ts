import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ASK_ACTION,
  ASK_ACTION_ID,
  createActionRegistry,
  type ActionDefinition,
} from '@core/agent/actionRegistry';

import { OPEN_TOOLKIT_SCHEMA, type BaseToolContext, type ToolSpec } from './contract';
import { createToolkit, runLookup } from './createToolkit';

/**
 * The mechanism both hosts build their toolkit with, tested on invented tables.
 * The site's byte-for-byte output is pinned in `sitePrompt.test.ts`; this file
 * holds what is true of any host.
 */

const CONTEXT: BaseToolContext = { language: 'en', now: 0, signal: undefined };

const echo: ToolSpec = {
  route: 'invented route',
  args: '{n?:number}',
  summary: ['Echoes a number.', 'Second line.'],
  schema: z.object({ n: z.number().int().optional() }),
  run: async (args) => ({ text: `[echo] n=${String(args['n'])}`, routes: ['invented route'] }),
};

const boom: ToolSpec = {
  ...echo,
  args: '{}',
  summary: ['Always fails.'],
  schema: z.object({}),
  run: async () => {
    throw new Error('the source said no');
  },
};

const TOOLS = { 'demo.echo': echo, 'demo.boom': boom };

const WRITE: ActionDefinition = {
  ...ASK_ACTION,
  endpoint: 'POST /invented',
  risk: 'mid',
  argsDoc: '{x:number}',
  summary: 'Invented write.',
  params: z.object({ x: z.number() }),
};

const ACTIONS = createActionRegistry({ [ASK_ACTION_ID]: ASK_ACTION, 'demo.write': WRITE });

const toolkit = createToolkit({
  tools: TOOLS,
  actions: ACTIONS,
  sections: () => [{ title: 'HOST SECTION', lines: ['  host prose'] }],
  closing: () => [{ title: 'NOT AVAILABLE', lines: ['  nothing else'] }],
});

describe('running a lookup', () => {
  it('runs a valid call', async () => {
    const result = await toolkit.run('demo.echo', { n: 3 }, CONTEXT);
    expect(result.text).toBe('[echo] n=3');
  });

  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__'])(
    'treats "%s" as no such lookup rather than finding it on the prototype',
    async (name) => {
      const result = await runLookup(TOOLS, name, {}, CONTEXT);
      expect(result.text).toBe(`[${name}] no such lookup. Available: demo.echo, demo.boom`);
    },
  );

  it('rejects arguments with the reason and the expected shape', async () => {
    const result = await toolkit.run('demo.echo', { n: 'x' }, CONTEXT);
    expect(result.text).toContain('arguments rejected');
    expect(result.text).toContain('n:');
    expect(result.text).toContain('Expected {n?:number}');
  });

  it('hands a failure to the model as text', async () => {
    const result = await toolkit.run('demo.boom', {}, CONTEXT);
    expect(result.text).toBe(
      '[demo.boom] failed — the source said no. Say what you could not read rather than estimating it.',
    );
  });

  it('rethrows when the question was cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      toolkit.run('demo.boom', {}, { ...CONTEXT, signal: controller.signal }),
    ).rejects.toThrow('the source said no');
  });
});

describe('the native declarations', () => {
  it('declare only open_toolkit until "tools" is granted', () => {
    expect(toolkit.schemas(new Set())).toEqual([OPEN_TOOLKIT_SCHEMA]);
    expect(toolkit.schemas(new Set(['widgets']))).toEqual([OPEN_TOOLKIT_SCHEMA]);
  });

  it('declare every lookup and action under provider-safe names afterwards', () => {
    const declared = toolkit.schemas(new Set(['tools']));
    expect(declared.map((entry) => entry.name)).toEqual([
      'open_toolkit',
      'demo_echo',
      'demo_boom',
      'copilot_ask',
      'demo_write',
    ]);
    expect(declared[1]?.description).toBe('Echoes a number. Second line.');
    expect(declared[4]?.description).toContain('NOT performed by you');
    expect(declared[4]?.description).toContain('POST /invented (risk mid)');
  });

  it('map a safe name back to its id, and leave an unknown name alone', () => {
    expect(toolkit.idOfName('demo_echo')).toBe('demo.echo');
    expect(toolkit.idOfName('copilot_ask')).toBe('copilot.ask');
    expect(toolkit.idOfName('open_toolkit')).toBe('open_toolkit');
    expect(toolkit.idOfName('constructor')).toBe('constructor');
  });
});

describe('the toolkit document', () => {
  const document = toolkit.describe(CONTEXT);

  it('lists the host sections between the result paragraph and the lookups', () => {
    const order = ['CALLING', 'WHAT A RESULT IS', 'HOST SECTION', 'LOOKUPS', 'ACTIONS', 'NOT AVAILABLE'].map(
      (title) => document.indexOf(`\n${title}\n`),
    );
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('is generated from the registries', () => {
    expect(document).toContain('  demo.echo {n?:number}\n      Echoes a number.\n      Second line.');
    expect(document).toContain('  copilot.ask {question:"…"}');
    expect(document).toContain('Places a follow-up question chip under your answer.');
    expect(document).toContain('POST /invented · risk mid · Places a button');
  });

  it('uses the first lookup in its calling example unless told otherwise', () => {
    expect(document).toContain('{"call":"demo.echo","args":{}}');
    const named = createToolkit({ tools: TOOLS, actions: ACTIONS, sections: () => [], exampleCall: 'demo.boom' });
    expect(named.describe(CONTEXT)).toContain('{"call":"demo.boom","args":{}}');
  });
});

describe('optional members', () => {
  it('are absent when the host supplies none', () => {
    expect('freshness' in toolkit).toBe(false);
    expect('widgetHints' in toolkit).toBe(false);
  });

  it('are carried when it does', async () => {
    const hinted = createToolkit({
      tools: TOOLS,
      actions: ACTIONS,
      sections: () => [],
      freshness: async () => 'fresh',
      widgetHints: { charts: { line: 'x' } },
    });
    expect(await hinted.freshness?.(CONTEXT)).toBe('fresh');
    expect(hinted.widgetHints).toEqual({ charts: { line: 'x' } });
  });
});
