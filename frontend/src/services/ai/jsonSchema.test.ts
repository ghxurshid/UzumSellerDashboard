import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { toJsonSchema } from './jsonSchema';

/**
 * The converter that keeps one source of truth for arguments.
 *
 * The Zod schemas validate; the JSON Schemas describe. If the two drift, a
 * model is told about a parameter that will be rejected — or not told about one
 * it needs — and neither failure is visible until a call comes back refused. So
 * the description is derived, and these tests pin the derivation.
 */

describe('toJsonSchema', () => {
  it('describes an object with its required fields', () => {
    const schema = z.object({
      query: z.string(),
      limit: z.number().int().min(1).max(30).optional(),
    });

    expect(toJsonSchema(schema)).toEqual({
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 30 },
      },
      required: ['query'],
      additionalProperties: false,
    });
  });

  it('omits `required` when every field is optional', () => {
    const schema = toJsonSchema(z.object({ from: z.string().optional() }));
    expect(schema).not.toHaveProperty('required');
  });

  it('carries an enum through as a string with choices', () => {
    expect(toJsonSchema(z.enum(['hour', 'day']))).toEqual({
      type: 'string',
      enum: ['hour', 'day'],
    });
  });

  it('describes an array with its bounds', () => {
    const schema = z.array(z.object({ skuId: z.number().int() })).min(1).max(50);

    expect(toJsonSchema(schema)).toEqual({
      type: 'array',
      minItems: 1,
      maxItems: 50,
      items: {
        type: 'object',
        properties: { skuId: { type: 'integer' } },
        required: ['skuId'],
        additionalProperties: false,
      },
    });
  });

  it('unwraps optional and default rather than describing the wrapper', () => {
    expect(toJsonSchema(z.string().optional())).toEqual({ type: 'string' });
    expect(toJsonSchema(z.number().default(3))).toEqual({ type: 'number' });
  });

  it('keeps a regex as a pattern', () => {
    const schema = toJsonSchema(z.string().regex(/^[a-z]+$/));
    expect(schema.pattern).toBe('^[a-z]+$');
  });

  it('passes a description through', () => {
    expect(toJsonSchema(z.string().describe('a name fragment')).description).toBe(
      'a name fragment',
    );
  });

  it('degrades to "any JSON" rather than throwing on a shape it does not model', () => {
    /* The Zod schema is still the gate, so an under-described parameter costs a
       rejected call and a correction — not a crash while building a request. */
    expect(toJsonSchema(z.union([z.string(), z.number()]))).toEqual({});
    expect(toJsonSchema(z.unknown())).toEqual({});
  });
});
