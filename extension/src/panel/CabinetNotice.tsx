import { PlugZap } from 'lucide-react';
import type { ReactNode } from 'react';

import { useTranslation } from '@core/i18n/useTranslation';
import { Button } from '@core/ui/kit/Button';

import { canRecheck, NOTICE_TEXT, type CabinetStatus } from './cabinetStatus';

/**
 * The slim strip above the transcript. Nothing while the cabinet is readable:
 * a notice that is always there stops being read.
 */
export function CabinetNotice({
  status,
  onRecheck,
}: {
  readonly status: CabinetStatus;
  readonly onRecheck: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const key = NOTICE_TEXT[status];
  if (key === null) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-x-9 gap-y-7 border-b border-warn-line bg-warn-soft px-12 py-9"
    >
      <span className="flex min-w-0 flex-1 basis-180 items-start gap-7 text-xs-plus leading-[1.5] text-warn">
        <PlugZap aria-hidden className="mt-1 size-13 shrink-0" />
        {t(key)}
      </span>
      {status === 'closed' && (
        /* The one cure for a closed connection: a fresh document, which the page
           side answers with a fresh handshake. */
        <Button size="sm" onClick={() => window.location.reload()}>
          {t('extReload')}
        </Button>
      )}
      {canRecheck(status) && (
        <Button size="sm" onClick={onRecheck}>
          {t('extRecheck')}
        </Button>
      )}
    </div>
  );
}
