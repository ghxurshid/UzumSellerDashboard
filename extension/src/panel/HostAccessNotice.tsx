import { ShieldQuestion } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { useTranslation } from '@core/i18n/useTranslation';
import { useAiSettings } from '@core/state/settings.store';
import { useToastStore } from '@core/state/toast.store';
import { Button } from '@core/ui/kit/Button';

import { hostRequestFor } from './hostAccess';

interface PermissionsLike {
  contains(request: { origins: string[] }): Promise<boolean>;
  request(request: { origins: string[] }): Promise<boolean>;
  onAdded?: EventLike;
  onRemoved?: EventLike;
}
interface EventLike {
  addListener(callback: () => void): void;
  removeListener(callback: () => void): void;
}

/** `browser.permissions` first (Firefox), then `chrome.permissions`, like the storage lookup. */
function permissionsApi(): PermissionsLike | null {
  const g = globalThis as unknown as {
    browser?: { permissions?: PermissionsLike };
    chrome?: { permissions?: PermissionsLike };
  };
  return g.browser?.permissions ?? g.chrome?.permissions ?? null;
}

/**
 * Offers the browser's host permission for an AI endpoint the manifest does not
 * name. Shown in the AI tab only when the active provider's origin is not yet
 * granted; granting is optional and a refusal changes nothing.
 *
 * `permissions.request` needs a user gesture, so it is called straight from the
 * click handler — no `await` before it, or the browser would refuse it.
 */
export function HostAccessNotice(): ReactNode {
  const { t } = useTranslation();
  const { baseUrl } = useAiSettings();
  const push = useToastStore((state) => state.push);

  const target = useMemo(() => hostRequestFor(baseUrl), [baseUrl]);
  const pattern = target?.pattern ?? null;
  /* null: not known (nothing to check, or the API is missing) — drawn as absent. */
  const [granted, setGranted] = useState<boolean | null>(null);

  useEffect(() => {
    const api = permissionsApi();
    if (api === null || pattern === null) {
      setGranted(null);
      return;
    }

    let current = true;
    const check = (): void => {
      api
        .contains({ origins: [pattern] })
        .then((value) => {
          if (current) setGranted(value);
        })
        .catch(() => {
          if (current) setGranted(null);
        });
    };
    check();
    /* A grant or a revoke from the browser's own extension page shows up here too. */
    api.onAdded?.addListener(check);
    api.onRemoved?.addListener(check);
    return () => {
      current = false;
      api.onAdded?.removeListener(check);
      api.onRemoved?.removeListener(check);
    };
  }, [pattern]);

  if (target === null || granted !== false) return null;

  const grant = (): void => {
    const api = permissionsApi();
    if (api === null) return;
    api
      .request({ origins: [target.pattern] })
      .then((ok) => {
        setGranted(ok);
        push(t(ok ? 'extPermGranted' : 'extPermDenied'), { kind: ok ? 'ok' : 'info' });
      })
      .catch(() => push(t('extPermDenied'), { kind: 'info' }));
  };

  return (
    <div
      role="note"
      className="flex flex-col items-start gap-9 rounded-11 border border-line bg-panel px-11 py-11 sm:px-14"
    >
      <span className="flex items-start gap-7 text-xs-plus leading-[1.55] text-dim">
        <ShieldQuestion aria-hidden className="mt-1 size-13 shrink-0 text-acc-dim" />
        {t('extPermText', { host: target.label })}
      </span>
      <Button size="md" variant="primary" onClick={grant}>
        {t('extPermGrant', { host: target.label })}
      </Button>
    </div>
  );
}
