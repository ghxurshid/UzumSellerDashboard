import { z } from 'zod';

/**
 * Zod schemas, as the shape a provider's tool API wants.
 *
 * Native tool calling needs every argument list expressed as JSON Schema. The
 * argument lists already exist — they are the Zod schemas in the toolkit and
 * the action registry, and those are what actually validate a call before it
 * runs. Writing a second copy by hand would put the two on separate clocks: the
 * day someone adds a field to a Zod schema and forgets the JSON one, the model
 * is told about a parameter that will be rejected, or not told about one it
 * needs.
 *
 * So the JSON Schema is derived. One direction, one source of truth, and a tool
 * whose arguments change is described correctly by construction.
 *
 * ## Why a converter rather than a dependency
 *
 * `zod-to-json-schema` handles the whole of Zod, including the parts this
 * application does not use — effects, intersections, discriminated unions,
 * recursive references, branded types. What is actually needed here is objects
 * of strings, numbers, booleans, enums and arrays, all one or two levels deep.
 * That is the eighty lines below, against a dependency and its transitive
 * weight in a bundle that ships to a phone.
 *
 * Anything outside the subset degrades to `{}` — "any JSON" — rather than
 * throwing. The Zod schema still rejects a bad call, so the failure mode is a
 * model that guessed and got told why, not a crash at request-build time.
 */

export interface JsonSchema {
  readonly type?: string;
  readonly description?: string;
  readonly enum?: readonly string[];
  readonly items?: JsonSchema;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly pattern?: string;
}

/** Zod keeps its checks on `_def`; this is the only place that reads them. */
interface Check {
  readonly kind: string;
  readonly value?: number;
  readonly inclusive?: boolean;
  readonly regex?: RegExp;
}

function checksOf(schema: z.ZodTypeAny): readonly Check[] {
  const def = (schema as { _def?: { checks?: readonly Check[] } })._def;
  return def?.checks ?? [];
}

/**
 * One numeric bound, with zod's `inclusive` flag honoured.
 *
 * `.positive()` is `{ kind: 'min', value: 0, inclusive: false }`; reading only
 * `value` announced "minimum 0" for every id parameter, telling the model that 0
 * is acceptable when validation refuses it.
 *
 * - Integer: an exclusive bound is exactly the adjacent integer (`> 0` is
 *   `minimum: 1`), using keywords every adapter already tolerates.
 * - Non-integer: no adjacent value exists, and the only exact keyword is
 *   `exclusiveMinimum`/`exclusiveMaximum`, whose form differs between drafts
 *   (boolean in draft 4, number since 6). Gemini's schema subset drops numeric
 *   bounds entirely (`geminiSchema`), and OpenAI-compatible gateways and local
 *   runtimes that turn schemas into grammars are not shown to accept it, where a
 *   rejected schema fails the whole request. So the inclusive keyword is kept,
 *   the closest declaration every adapter takes; the Zod check still refuses the
 *   boundary value itself.
 */
function bound(checks: readonly Check[], kind: 'min' | 'max', integer: boolean): number | undefined {
  /* Every check of the kind applies at once, so the declaration takes the
     strictest one — never looser than what validation enforces. For integers
     each bound is first rounded inwards to the nearest allowed integer, which
     also covers a fractional bound such as `gt(0.5)`. */
  const values: number[] = [];
  for (const check of checks) {
    if (check.kind !== kind || check.value === undefined) continue;
    if (!integer) {
      values.push(check.value);
    } else if (kind === 'min') {
      values.push(check.inclusive === false ? Math.floor(check.value) + 1 : Math.ceil(check.value));
    } else {
      values.push(check.inclusive === false ? Math.ceil(check.value) - 1 : Math.floor(check.value));
    }
  }
  if (values.length === 0) return undefined;
  return kind === 'min' ? Math.max(...values) : Math.min(...values);
}

function numeric(schema: z.ZodNumber): JsonSchema {
  const checks = checksOf(schema);
  const integer = checks.some((check) => check.kind === 'int');
  const min = bound(checks, 'min', integer);
  const max = bound(checks, 'max', integer);

  return {
    type: integer ? 'integer' : 'number',
    ...(min === undefined ? {} : { minimum: min }),
    ...(max === undefined ? {} : { maximum: max }),
  };
}

function textual(schema: z.ZodString): JsonSchema {
  const checks = checksOf(schema);
  const pattern = checks.find((check) => check.kind === 'regex')?.regex;

  return {
    type: 'string',
    ...(pattern === undefined ? {} : { pattern: pattern.source }),
  };
}

/**
 * One schema, converted.
 *
 * `description` is threaded through because it is the only prose a provider's
 * tool API carries per field, and a model reading `{"limit": {"type":"integer"}}`
 * has less to go on than one reading what the limit means.
 */
export function toJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const described = (result: JsonSchema): JsonSchema => {
    const description = schema.description;
    return description === undefined ? result : { ...result, description };
  };

  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return toJsonSchema(schema.unwrap() as z.ZodTypeAny);
  }

  if (schema instanceof z.ZodDefault) {
    return toJsonSchema(schema._def.innerType as z.ZodTypeAny);
  }

  if (schema instanceof z.ZodString) return described(textual(schema));
  if (schema instanceof z.ZodNumber) return described(numeric(schema));
  if (schema instanceof z.ZodBoolean) return described({ type: 'boolean' });

  if (schema instanceof z.ZodEnum) {
    return described({ type: 'string', enum: schema.options as readonly string[] });
  }

  if (schema instanceof z.ZodLiteral) {
    const value = schema.value as unknown;
    return described(
      typeof value === 'string'
        ? { type: 'string', enum: [value] }
        : { type: typeof value === 'number' ? 'number' : 'string' },
    );
  }

  if (schema instanceof z.ZodArray) {
    const checks = schema._def as {
      minLength?: { value: number } | null;
      maxLength?: { value: number } | null;
    };

    return described({
      type: 'array',
      items: toJsonSchema(schema.element as z.ZodTypeAny),
      ...(checks.minLength == null ? {} : { minItems: checks.minLength.value }),
      ...(checks.maxLength == null ? {} : { maxItems: checks.maxLength.value }),
    });
  }

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = toJsonSchema(value);
      if (!value.isOptional()) required.push(key);
    }

    return described({
      type: 'object',
      properties,
      ...(required.length === 0 ? {} : { required }),
      /* Providers vary on whether they honour this, and the Zod schema is the
         real gate anyway — but stating it stops a model from inventing a field
         and being surprised when the call is rejected. */
      additionalProperties: false,
    });
  }

  /* Unknown, union, record, anything else: describe nothing and let Zod judge. */
  return described({});
}
