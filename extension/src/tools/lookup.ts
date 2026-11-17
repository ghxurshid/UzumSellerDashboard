import { z } from 'zod';

import type { ToolResult } from '@core/tools/contract';
import { compose, header } from '@core/tools/plaintext';
import { uzumRequest, type UzumResponse } from '@ext/uzum/client';
import type { UzumRouteId, UzumRouteParams } from '@ext/uzum/routes';

import { CABINET_DEADLINE_MS, explainFailure, refusalText, withDeadline } from './cabinet';
import { renderPayload, type RenderOptions } from './render';

/**
 * The parts of a cabinet lookup that do not depend on which route it reads.
 *
 * `productsList.ts` wrote these inline when it was the only lookup. With several,
 * the same four things would otherwise be said once per file and drift: the
 * `shopId` argument, the one request with its deadline and its failure text, the
 * refusal of an account lookup in a signed-out tab, and what to print when the
 * response is not the shape the lookup knows. A tool file is left with what is
 * particular to its route: its arguments, its columns and its header.
 */

/** `coerce` because a model sometimes quotes a number; the bounds still decide meaning. */
export const shopIdArg = z.coerce
  .number()
  .int()
  .positive()
  .describe("One of the seller's shop ids. Omit it to use the shop the cabinet page shows.")
  .optional();

export const asNumber = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);

/** A header part: null drops it. */
export type Part = string | null;

export type CabinetRead =
  | { readonly ok: true; readonly response: UzumResponse }
  | { readonly ok: false; readonly result: ToolResult };

/**
 * The one request a lookup makes, raced against the deadline.
 *
 * A failure comes back as the text the model reads — the header with what was
 * asked, `FAILED`, what happened and what to do — so the tool only writes what
 * it does with a response. A question the seller walked away from is rethrown,
 * not reported as a failed lookup.
 */
export async function readCabinet<R extends UzumRouteId>(
  tool: string,
  signal: AbortSignal | undefined,
  asked: readonly Part[],
  route: R,
  params: UzumRouteParams<R>,
): Promise<CabinetRead> {
  try {
    const response = await withDeadline(signal, CABINET_DEADLINE_MS, (inner) => uzumRequest(route, params, inner));
    return { ok: true, response };
  } catch (error) {
    if (signal?.aborted === true) throw error;

    return {
      ok: false,
      result: {
        trace: `${tool} failed`,
        text: compose([
          header(tool, [...asked, 'FAILED']),
          `${explainFailure(error)} Say what you could not read rather than estimating it.`,
        ]),
      },
    };
  }
}

/** What an account lookup answers in a tab that is not signed in: text, and no request. */
export function signedOutResult(tool: string): ToolResult {
  return { trace: `${tool}: no request`, text: refusalText(tool, { kind: 'signedOut' }) ?? '' };
}

/** `HTTP 206` for a success that was not a plain 200; nothing otherwise. */
export const statusPart = (response: UzumResponse): Part => (response.status === 200 ? null : `HTTP ${response.status}`);

/**
 * A response that is not the shape the lookup knows, printed generically.
 *
 * One recorded sample is not a contract, so a body the lookup does not
 * recognise must still be reported truthfully: whatever is there, under the
 * API's own names, with the header saying what was expected instead.
 */
export function unrecognised(
  tool: string,
  asked: readonly Part[],
  response: UzumResponse,
  expected: string,
  options: RenderOptions = {},
): ToolResult {
  const rendered = renderPayload(response.data, options);
  return {
    routes: [response.route],
    trace: `${tool}: shape not recognised`,
    text: compose([
      header(tool, [
        ...asked,
        `shape not recognised (expected ${expected}): printed generically`,
        `live from ${response.route}`,
        statusPart(response),
        rendered.truncated ? `TRUNCATED: ${rendered.cuts.join('; ')}` : null,
      ]),
      "units unknown · columns are the cabinet API's own field names, values exactly as returned",
      rendered.text,
    ]),
  };
}

/**
 * Where a page sits when the response carries no total.
 *
 * The same words `products.list` uses in that case: a full page may be followed
 * by another, a short one may be a cap rather than the end, and no page is ever
 * called the last on the strength of its length.
 */
export function pageWithoutTotal(noun: string, page: number, size: number, count: number): string {
  const next = page + 1;
  if (count === 0) return 'empty page — nothing at this page number; the response carries no total';
  if (count > size) return `more ${noun} than size ${size} asked for — the API may not honour size; the response carries no total`;
  if (count === size) return `as many as asked — there may be more: next page ${next}; the response carries no total`;
  return `fewer than the ${size} asked for — the API may cap a page, so more may exist; ask page ${next} to check; the response carries no total`;
}
