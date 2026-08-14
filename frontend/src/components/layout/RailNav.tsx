import { Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import { NAV_ITEMS, SETTINGS_PATH } from '@/constants/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { useConnection } from '@/services/queries/useConnection';

const RAIL_ITEM = cn(
  'flex size-34 cursor-pointer items-center justify-center rounded-8 border-0',
  'text-dim transition-colors duration-150 hover:bg-acc-soft',
  'aria-[current=page]:bg-acc-soft aria-[current=page]:text-acc-dim',
);

/**
 * The 52px icon rail.
 *
 * `NavLink` supplies `aria-current="page"`, which doubles as the active-state
 * selector — the highlight and the accessible state can never disagree.
 */
export function RailNav(): ReactNode {
  const { t } = useTranslation();
  const { shops, status } = useConnection();
  const location = useLocation();

  /* The account badge is the shop the token belongs to — there is no user
     profile in the seller API, so nothing is invented for it. */
  const account = shops[0]?.name ?? null;
  const initials =
    account === null
      ? '—'
      : account
          .split(/\s+/)
          .slice(0, 2)
          .map((word) => word.charAt(0).toUpperCase())
          .join('');

  return (
    <nav
      aria-label={t('nOverview')}
      className="flex w-52 shrink-0 flex-col items-center gap-3 border-r border-line bg-chrome py-9"
    >
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink key={item.screen} to={item.path} title={t(item.labelKey)} className={RAIL_ITEM}>
            <Icon aria-hidden className="size-17" />
            <span className="sr-only">{t(item.labelKey)}</span>
          </NavLink>
        );
      })}

      <div className="flex-1" />

      <NavLink
        to={SETTINGS_PATH}
        title={t('settings')}
        aria-current={location.pathname.startsWith(SETTINGS_PATH) ? 'page' : undefined}
        className={RAIL_ITEM}
      >
        <Settings aria-hidden className="size-17" />
        <span className="sr-only">{t('settings')}</span>
      </NavLink>

      <span
        title={account ?? t('connNone')}
        className={cn(
          'mt-6 flex size-26 items-center justify-center rounded-full text-tiny font-medium',
          status === 'connected'
            ? 'bg-linear-[145deg,var(--s-acc),var(--s-acc-line)] text-white'
            : 'border border-line-2 text-faint',
        )}
      >
        {initials}
      </span>
    </nav>
  );
}
