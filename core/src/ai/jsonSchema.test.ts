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

  describe('numeric bounds', () => {
    const int = z.number().int();

    it('declares an exclusive integer bound as the adjacent integer', () => {
      expect(toJsonSchema(int.positive())).toEqual({ type: 'integer', minimum: 1 });
      expect(toJsonSchema(int.gt(0))).toEqual({ type: 'integer', minimum: 1 });
      expect(toJsonSchema(int.negative())).toEqual({ type: 'integer', maximum: -1 });
      expect(toJsonSchema(int.lt(10))).toEqual({ type: 'integer', maximum: 9 });
      expect(toJsonSchema(int.gt(-3))).toEqual({ type: 'integer', minimum: -2 });
    });

    it('keeps inclusive integer bounds as they are', () => {
      expect(toJsonSchema(int.gte(0))).toEqual({ type: 'integer', minimum: 0 });
      expect(toJsonSchema(int.lte(10))).toEqual({ type: 'integer', maximum: 10 });
      expect(toJsonSchema(int.nonnegative())).toEqual({ type: 'integer', minimum: 0 });
      expect(toJsonSchema(int.min(1).max(30))).toEqual({ type: 'integer', minimum: 1, maximum: 30 });
    });

    it('combines an exclusive bound with the other side', () => {
      expect(toJsonSchema(int.positive().max(50))).toEqual({
        type: 'integer',
        minimum: 1,
        maximum: 50,
      });
      expect(toJsonSchema(int.gt(0).lt(10))).toEqual({ type: 'integer', minimum: 1, maximum: 9 });
    });

    it('keeps the inclusive keyword on a non-integer, which has no adjacent value', () => {
      expect(toJsonSchema(z.number().positive())).toEqual({ type: 'number', minimum: 0 });
      expect(toJsonSchema(z.number().gt(0.5))).toEqual({ type: 'number', minimum: 0.5 });
      expect(toJsonSchema(z.number().lt(1))).toEqual({ type: 'number', maximum: 1 });
      expect(toJsonSchema(z.number().negative())).toEqual({ type: 'number', maximum: 0 });
      expect(toJsonSchema(z.number().gte(0).lte(1))).toEqual({
        type: 'number',
        minimum: 0,
        maximum: 1,
      });
    });

    it('takes the strictest of several checks on the same side', () => {
      expect(toJsonSchema(int.positive().min(5))).toEqual({ type: 'integer', minimum: 5 });
      expect(toJsonSchema(int.min(5).positive())).toEqual({ type: 'integer', minimum: 5 });
      expect(toJsonSchema(int.min(0).gt(3))).toEqual({ type: 'integer', minimum: 4 });
      expect(toJsonSchema(int.max(20).lt(10))).toEqual({ type: 'integer', maximum: 9 });
      expect(toJsonSchema(int.lt(10).max(5))).toEqual({ type: 'integer', maximum: 5 });
      expect(toJsonSchema(z.number().min(1).min(3))).toEqual({ type: 'number', minimum: 3 });
      expect(toJsonSchema(z.number().max(9).max(4))).toEqual({ type: 'number', maximum: 4 });
    });

    it('rounds a fractional integer bound inwards', () => {
      expect(toJsonSchema(int.gt(0.5))).toEqual({ type: 'integer', minimum: 1 });
      expect(toJsonSchema(int.gt(1))).toEqual({ type: 'integer', minimum: 2 });
      expect(toJsonSchema(int.lt(9.5))).toEqual({ type: 'integer', maximum: 9 });
      expect(toJsonSchema(int.lt(9))).toEqual({ type: 'integer', maximum: 8 });
      expect(toJsonSchema(int.gte(0.5))).toEqual({ type: 'integer', minimum: 1 });
      expect(toJsonSchema(int.lte(9.5))).toEqual({ type: 'integer', maximum: 9 });
    });

    it('never introduces an exclusive keyword', () => {
      const text = JSON.stringify([
        toJsonSchema(z.number().positive()),
        toJsonSchema(int.positive()),
      ]);
      expect(text).not.toContain('exclusive');
    });

    it('carries the bound through optional and described fields', () => {
      const schema = z.object({
        skuId: int.positive().describe('the SKU'),
        shopId: int.positive().optional(),
      });

      expect(toJsonSchema(schema)).toEqual({
        type: 'object',
        properties: {
          skuId: { type: 'integer', minimum: 1, description: 'the SKU' },
          shopId: { type: 'integer', minimum: 1 },
        },
        required: ['skuId'],
        additionalProperties: false,
      });
    });

    it('carries the bound into array items', () => {
      expect(toJsonSchema(z.array(int.positive()).min(1).max(50))).toEqual({
        type: 'array',
        minItems: 1,
        maxItems: 50,
        items: { type: 'integer', minimum: 1 },
      });
    });
  });

  it('degrades to "any JSON" rather than throwing on a shape it does not model', () => {
    /* The Zod schema is still the gate, so an under-described parameter costs a
       rejected call and a correction — not a crash while building a request. */
    expect(toJsonSchema(z.union([z.string(), z.number()]))).toEqual({});
    expect(toJsonSchema(z.unknown())).toEqual({});
  });
});
