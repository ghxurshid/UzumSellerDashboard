import type { ReactNode } from 'react';
import { useNavigate, useRouteError } from 'react-router-dom';

import { StateBlock } from '@/components/common/StateBlock';
import { useTranslation } from '@/lib/i18n/useTranslation';

/**
 * Route-level fallback — a page chunk that failed to load, or a screen that
 * threw while rendering.
 *
 * It is attached to the *child* routes, not the shell, so it appears inside the
 * content pane: the rail, the topbar and Settings stay reachable. A screen
 * failing is not a reason to take the application away from the user, and the
 * cause is usually something they can fix in Settings.
 */
export function RouteError(): ReactNode {
  const { t } = useTranslation();
  const error = useRouteError();
  const navigate = useNavigate();

  const detail = error instanceof Error ? error.message : String(error);

  return (
    <StateBlock
      state="error"
      meta={detail}
      onPrimaryAction={() => void navigate(0)}
      secondaryLabel={t('blInitC')}
      onSecondaryAction={() => void navigate('/settings')}
    />
  );
}
