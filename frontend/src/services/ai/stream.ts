import { ApiError } from '@/services/api/client';
import type { AiSettings } from '@/types/settings';

import type { CompletionRequest } from './client';

/**
 * The same three request shapes as `client.ts`, read as they arrive.
 *
 * `complete()` waits for the whole body, which is right for the insights rail —
 * it runs in the background and nobody is watching. A chat answer is watched.
 * Four seconds of blank panel reads as broken, and the fix is not a faster model
 * but showing the answer as it is written.
 *
 * That cannot go through axios: the browser adapter buffers the response and
 * hands over a finished string. So this uses `fetch` and reads the
 * `ReadableStream` directly, which is also why it does its own error mapping
 * rather than borrowing `toApiError`.
 *
 * ## Server-sent events, three dialects
 *
 * All three providers stream SSE — `data: {json}` lines separated by blank
 * lines — and disagree only about where the text sits inside each event. The
 * frame parsing is therefore shared and the per-provider part is one accessor.
 */

export interface StreamOptions {
  readonly settings: AiSettings;
  readonly request: CompletionRequest;
  /** Called with each text fragment, in order, as it arrives. */
  readonly onDelta: (text: string) => void;
}

/** What the caller needs afterwards: the whole text, and what it cost. */
export interface StreamResult {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

const ANTHROPIC_BROWSER_HEADER = 'anthropic-dangerous-direct-browser-access';
const ANTHROPIC_VERSION = '2023-06-01';

/** Rough enough for a cost read-out, and free. See `pricing.ts`. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}

interface Dialect {
  readonly url: string;
  readonly body: unknown;
  readonly headers: Record<string, string>;
  /** Pulls the text fragment out of one decoded SSE payload, if it has one. */
  readonly deltaOf: (event: unknown) => string | null;
  /** Usage, when the provider reports it — otherwise the estimate stands. */
  readonly usageOf: (event: unknown) => { input?: number; output?: number } | null;
}

function at(value: unknown, path: readonly (string | number)[]): unknown {
  let cursor: unknown = value;
  for (const step of path) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string | number, unknown>)[step];
  }
  return cursor;
}

function textAt(value: unknown, path: readonly (string | number)[]): string | null {
  const found = at(value, path);
  return typeof found === 'string' ? found : null;
}

function numberAt(value: unknown, path: readonly (string | number)[]): number | undefined {
  const found = at(value, path);
  return typeof found === 'number' ? found : undefined;
}

/**
 * The text of one Gemini chunk: every part of it, minus the model's thinking.
 *
 * `parts` is a list, and reading `parts[0]` treats it as though it were always
 * one thing. A chunk that carries two — which is what happens the moment thought
 * summaries are on, and can happen without them — loses everything after the
 * first, silently, as missing words in a sentence that still looks whole. The
 * `thought` flag is what separates reasoning from answer, and reasoning is not
 * something a seller should be reading.
 */
function geminiText(event: unknown): string | null {
  const parts = at(event, ['candidates', 0, 'content', 'parts']);
  if (!Array.isArray(parts)) return null;

  let text = '';
  for (const part of parts) {
    if (part === null || typeof part !== 'object') continue;
    const { thought, text: value } = part as { thought?: unknown; text?: unknown };
    if (thought === true) continue;
    if (typeof value === 'string') text += value;
  }

  return text === '' ? null : text;
}

function dialectFor(settings: AiSettings, request: CompletionRequest): Dialect {
  const base = settings.baseUrl.replace(/\/+$/, '');

  if (settings.provider === 'claude') {
    return {
      url: `${base}/messages`,
      body: {
        model: settings.model,
        max_tokens: settings.maxTokens,
        temperature: settings.temperature,
        system: request.system,
        messages: request.messages,
        stream: true,
      },
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        [ANTHROPIC_BROWSER_HEADER]: 'true',
      },
      deltaOf: (event) => textAt(event, ['delta', 'text']),
      usageOf: (event) => {
        const input = numberAt(event, ['message', 'usage', 'input_tokens']);
        const output = numberAt(event, ['usage', 'output_tokens']);
        return input === undefined && output === undefined ? null : { input, output };
      },
    };
  }

  if (settings.provider === 'gemini') {
    /**
     * Gemini thinks before it writes, and is silent for the whole of it.
     *
     * From Gemini 3 on the models think dynamically by default, deciding their
     * own reasoning depth. Thought summaries are withheld unless `includeThoughts`
     * asks for them, so the connection is open and streaming nothing — and then
     * the answer arrives in a burst. Technically a stream; indistinguishable
     * from a blocking call to the person watching the panel.
     *
     * `thinkingLevel` puts a floor under that. The compose call is not where
     * reasoning earns its keep: the retrieval step already chose the lookups and
     * ran them, so what is left is rendering a settled fact table into blocks.
     * Spending seconds of silent deliberation on formatting buys nothing and
     * costs the thing the streaming was for.
     *
     * `low` rather than `minimal` because only some of the Gemini 3 models
     * accept `minimal`, and this is gated on the family rather than on a list of
     * model ids that would fall out of date. Anything earlier — a 2.x model, or
     * whatever someone types into the custom field — is left alone: the field
     * is rejected outright where it is not understood, which is the same trap
     * `stream_options` sets below.
     */
    const thinks = /^gemini-[3-9]/.test(settings.model.trim());

    return {
      url: `${base}/models/${settings.model}:streamGenerateContent?alt=sse`,
      body: {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: request.messages.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          temperature: settings.temperature,
          maxOutputTokens: settings.maxTokens,
          ...(thinks ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
        },
      },
      headers: { 'content-type': 'application/json', 'x-goog-api-key': settings.apiKey },
      deltaOf: geminiText,
      usageOf: (event) => {
        const input = numberAt(event, ['usageMetadata', 'promptTokenCount']);
        const answer = numberAt(event, ['usageMetadata', 'candidatesTokenCount']);
        /* Thinking is billed as output but counted apart from it, so leaving it
           out under-reports the cost of exactly the slowest answers. */
        const thoughts = numberAt(event, ['usageMetadata', 'thoughtsTokenCount']);
        const output =
          answer === undefined && thoughts === undefined
            ? undefined
            : (answer ?? 0) + (thoughts ?? 0);
        return input === undefined && output === undefined ? null : { input, output };
      },
    };
  }

  /**
   * `stream_options` is asked for only where it is known to exist.
   *
   * OpenAI reports usage during a stream only when this is set, which is worth
   * having. But "OpenAI-compatible" is a claim about the response shape, not a
   * promise to accept every request field — Ollama, LM Studio and several
   * self-hosted gateways reject an unknown key with a 400 rather than ignoring
   * it. Sending it everywhere would break streaming precisely on the setups
   * least able to diagnose why, so the others fall back to the token estimate.
   */
  const wantsUsage = settings.provider === 'openai' || settings.provider === 'openrouter';

  return {
    url: `${base}/chat/completions`,
    body: {
      model: settings.model,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      messages: [{ role: 'system', content: request.system }, ...request.messages],
      stream: true,
      ...(wantsUsage ? { stream_options: { include_usage: true } } : {}),
    },
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.apiKey}`,
      ...(settings.orgId === '' ? {} : { 'openai-organization': settings.orgId }),
    },
    deltaOf: (event) => textAt(event, ['choices', 0, 'delta', 'content']),
    usageOf: (event) => {
      const input = numberAt(event, ['usage', 'prompt_tokens']);
      const output = numberAt(event, ['usage', 'completion_tokens']);
      return input === undefined && output === undefined ? null : { input, output };
    },
  };
}

/**
 * Stream one completion.
 *
 * Throws `ApiError` with the same `kind` vocabulary the rest of the app maps to
 * on-screen states, so a caller does not have to know this went out over
 * `fetch` rather than axios.
 */
export async function streamComplete(options: StreamOptions): Promise<StreamResult> {
  const { settings, request, onDelta } = options;

  if (settings.apiKey.trim() === '' || settings.baseUrl.trim() === '' || settings.model.trim() === '') {
    throw new ApiError('AI provider is not configured', { kind: 'unconfigured' });
  }

  const dialect = dialectFor(settings, request);

  /**
   * An idle timeout, not a total one.
   *
   * `complete()` gets `settings.timeoutMs` for free from axios; `fetch` has no
   * timeout at all, so without this a stalled connection hangs until the user
   * happens to press cancel — and a request that never resolves also never
   * releases the pending turn.
   *
   * The clock measures silence rather than duration. A long answer is supposed
   * to take a long time, and cutting it off at a fixed deadline would punish
   * exactly the thorough replies the deep mode exists to get. What is never
   * normal is a stream that stops arriving mid-sentence, so the timer resets on
   * every chunk and only fires when nothing has come for the whole window.
   */
  const internal = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const resetIdle = (): void => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      internal.abort();
    }, Math.max(5_000, settings.timeoutMs));
  };

  const onCallerAbort = (): void => internal.abort();
  request.signal?.addEventListener('abort', onCallerAbort, { once: true });

  const release = (): void => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    request.signal?.removeEventListener('abort', onCallerAbort);
  };

  /** Cancelled by the user, or given up on — the two need different messages. */
  const abortError = (): ApiError =>
    timedOut
      ? new ApiError('The model stopped responding', { kind: 'timeout' })
      : new ApiError('Cancelled', { kind: 'cancelled' });

  resetIdle();

  let response: Response;
  try {
    response = await fetch(dialect.url, {
      method: 'POST',
      headers: dialect.headers,
      body: JSON.stringify(dialect.body),
      signal: internal.signal,
    });
  } catch (error) {
    release();
    if (error instanceof DOMException && error.name === 'AbortError') throw abortError();
    throw new ApiError('The model could not be reached', { kind: 'network' });
  }

  if (!response.ok || response.body === null) {
    release();
    /* The body is the only place these providers explain themselves, and it is
       short — reading it costs nothing and turns a bare 401 into a sentence. */
    const detail = await response.text().catch(() => '');
    throw new ApiError(detail.slice(0, 300) || `The model returned ${response.status}`, {
      kind:
        response.status === 401
          ? 'unauthorized'
          : response.status === 403
            ? 'forbidden'
            : response.status === 429
              ? 'rateLimited'
              : 'server',
      status: response.status,
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      /* Bytes arrived, so the connection is alive — the silence clock starts
         again from here rather than from when the request went out. */
      resetIdle();
      buffer += decoder.decode(value, { stream: true });

      /**
       * SSE frames end at a blank line — which is `\n\n` or `\r\n\r\n`.
       *
       * Both are legal and both are seen in the wild: Node-based gateways emit
       * the short form, several Python servers and anything behind certain
       * proxies emit the long one. Splitting on only `\n\n` would leave a
       * `\r`-terminated stream with no frame boundary it ever recognises, and
       * the failure is silent — a request that succeeds, streams bytes, and
       * produces an empty answer. Normalising first costs one pass and removes
       * the whole class.
       */
      buffer = buffer.replace(/\r\n/g, '\n');

      let split = buffer.indexOf('\n\n');
      while (split !== -1) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        split = buffer.indexOf('\n\n');

        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '' || payload === '[DONE]') continue;

          let event: unknown;
          try {
            event = JSON.parse(payload);
          } catch {
            continue;
          }

          const usage = dialect.usageOf(event);
          if (usage !== null) {
            if (usage.input !== undefined) inputTokens = usage.input;
            if (usage.output !== undefined) outputTokens = usage.output;
          }

          const delta = dialect.deltaOf(event);
          if (delta !== null && delta !== '') {
            text += delta;
            onDelta(delta);
          }
        }
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw abortError();
    throw new ApiError('The stream ended unexpectedly', { kind: 'network' });
  } finally {
    release();
    reader.releaseLock();
  }

  return {
    text,
    /* Providers that stayed silent about usage get an estimate, so the cost
       read-out is never blank for one adapter and populated for another. */
    inputTokens: inputTokens > 0 ? inputTokens : estimateTokens(request.system),
    outputTokens: outputTokens > 0 ? outputTokens : estimateTokens(text),
  };
}
