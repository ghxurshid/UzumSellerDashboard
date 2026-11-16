import { describe, expect, it } from 'vitest';

import { buildSystemPrompt, type PromptHost } from './systemPrompt';

/**
 * The two protocol sentences with a host-supplied half.
 *
 * The site's full text is pinned byte for byte in `sitePrompt.test.ts` and the
 * extension's in `extension/src/host/prompt.test.ts`; this holds the switch
 * itself — what a host gets when it says nothing, and that what it supplies
 * replaces the protocol's line rather than adding to it.
 */

const HOST: PromptHost = {
  identity: ['You are a test host.'],
  topics: ['Tests.'],
  provenance: ['Invented.'],
  context: ['Today: 2026-11-12'],
};

const build = (host: PromptHost): string => buildSystemPrompt(host, { language: 'en', native: true });

describe('the language rule', () => {
  it('quotes no field name a host did not supply', () => {
    const prompt = build(HOST);

    expect(prompt).toContain(
      '  Field names stay exactly as a result spells them, and so do product names. Everything\n' +
        '  else is in their language.',
    );
    expect(prompt).not.toContain('sellPrice');
  });

  it('quotes the names a host vouches for', () => {
    const prompt = build({ ...HOST, fieldNames: ['priceA', 'stockB'] });

    expect(prompt).toContain('  Field names from the API stay as they are — priceA, stockB — and\n');
    expect(prompt).not.toContain('Field names stay exactly');
  });

  it('treats an empty list as no list', () => {
    expect(build({ ...HOST, fieldNames: [] })).toBe(build(HOST));
  });
});

describe('how a write happens', () => {
  it('is a button the seller presses unless the host says otherwise', () => {
    expect(build(HOST)).toContain(
      '  You never write anything to Uzum yourself. A write is a button you place and the seller\n  presses.',
    );
  });

  it('is replaced, indented, by what the host supplies', () => {
    const prompt = build({ ...HOST, writes: ['You never write anything. Nothing here writes.'] });

    expect(prompt).toContain('\n  You never write anything. Nothing here writes.\n');
    expect(prompt).not.toContain('A write is a button you place');
  });
});
