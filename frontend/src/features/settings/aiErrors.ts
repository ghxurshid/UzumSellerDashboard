import type { Translator } from '@/lib/i18n/useTranslation';
import type { ApiError } from '@/services/api/client';
import type { AiProvider } from '@/types/settings';

/**
 * One failure, in a sentence the seller reads, not the provider's own error
 * envelope.
 *
 * `testConnection` and `listModels` both throw the same `ApiError` vocabulary
 * (see `services/ai/connection.ts`), and both surfaces in this pane — the
 * "Test connection" panel and the model field's "Load models" button — hit the
 * same providers through it. Describing a `kind` two different ways here would
 * make the same failure read as two different problems depending on which
 * button the seller pressed.
 *
 * `null` means say nothing: a cancelled request is the seller's own doing —
 * they switched providers or left the pane — not a failure to report.
 */
export function describeAiError(error: ApiError, provider: AiProvider, t: Translator): string | null {
  switch (error.kind) {
    case 'cancelled':
      return null;
    case 'unconfigured':
      return t('aiFinishSetup');
    case 'unauthorized':
      return t('aiErrUnauthorized');
    case 'forbidden':
      return t('aiErrForbidden');
    case 'rateLimited':
      return t('aiErrRateLimited');
    case 'network':
      /* Ollama's failure mode is almost always the one fix below, not a
         genuinely unreachable host — worth naming instead of leaving the
         seller to guess why a local server "cannot be reached". */
      return provider === 'ollama'
        ? `${t('aiErrNetwork')} ${t('ollamaHint', { origin: window.location.origin })}`
        : t('aiErrNetwork');
    case 'timeout':
      return t('aiErrTimeout');
    case 'server':
      return t('aiErrServer');
    case 'client':
    case 'notFound':
      /* Two OpenAI failures get their own sentence rather than the generic
         one below: both are `kind: 'client'` (a retry cannot fix either) but
         "the provider refused the request: response.incomplete" tells the
         seller nothing they can act on, while naming the actual fix — raise
         Max tokens, or ease off reasoning effort — does. */
      if (error.code === 'incomplete') return t('aiErrIncomplete');
      if (error.code === 'insufficient_quota') return t('aiErrInsufficientQuota');
      /* Otherwise `error.message` already carries the provider's own short
         explanation — an unknown model id, a malformed body — which is more
         useful here than a generic sentence would be. */
      return t('aiErrRequest', { detail: error.message });
    default:
      // Safety net for a kind this switch has not been taught about yet.
      return error.message;
  }
}
