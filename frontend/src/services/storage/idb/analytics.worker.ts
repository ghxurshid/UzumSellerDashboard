/// <reference lib="webworker" />

import type { WorkerRequest, WorkerResponse } from './aggregation';
import { runAnalytics } from './analytics.runner';

/**
 * The analytics worker.
 *
 * Its entire job is to keep the reading and folding of the archive off the
 * thread that draws. A year of a busy shop's order items is a six-figure row
 * count, and summing it on the main thread is tens to hundreds of milliseconds
 * of frozen interface — dropped frames on the very interaction (changing the
 * range, opening a chart) that asked for the work.
 *
 * The worker opens **its own IndexedDB connection**. That is not a workaround
 * for a limitation; it is the reason this arrangement works at all. IndexedDB
 * is available in workers and its transactions are per-connection, so the
 * reading here runs genuinely in parallel with whatever the main thread is
 * doing, rather than being serialised behind it. Nothing is shipped across the
 * boundary except the finished summary.
 *
 * It is deliberately stateless: no caching, no accumulated connections beyond
 * the one, and every message answered independently. The main thread owns
 * request identity and cancellation — see `analytics.client.ts`.
 */

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, job } = event.data;

  void runAnalytics(job)
    .then((result) => {
      const response: WorkerResponse = { id, ok: true, result };
      scope.postMessage(response);
    })
    .catch((error: unknown) => {
      /* Errors do not structured-clone usefully — an `Error` crosses as a bare
         object with no stack — so the message is extracted here and the client
         rebuilds an `Error` on the far side. */
      const response: WorkerResponse = {
        id,
        ok: false,
        error: error instanceof Error ? error.message : 'Analytics job failed',
      };
      scope.postMessage(response);
    });
};
