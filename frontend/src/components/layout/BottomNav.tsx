import { MoreHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

import { NAV_ITEMS } from '@/constants/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';

/**
 * How many sections get a tab of their own.
 *
 * Four plus the overflow button is what fits across a 320px screen at a
 * legible label size — five 64px targets. The sections that do not fit are not
 * hidden: they are the first thing in the drawer the fifth button opens.
 */
const PRIMARY_COUNT = 4;

const TAB = cn(
  'flex min-h-52 flex-1 cursor-pointer flex-col items-center justify-center gap-2',
  'border-0 bg-transparent px-2 py-6 text-meta text-faint transition-colors',
  'hover:text-acc-dim active:bg-acc-soft',
);

/**
 * The phone tab bar.
 *
 * It replaces the 52px icon rail below the tablet breakpoint, and it replaces
 * it rather than shrinking it: a rail of unlabelled 34px glyphs is a desktop
 * affordance that survives neither the loss of hover titles nor the size of a
 * thumb. Each tab here is at least 52px tall and carries its label.
 *
 * It sits in the shell's flex column rather than being `fixed`, so the scroll
 * area above it ends where the bar begins — content can never be stranded
 * underneath it, and no page needs a bottom padding that compensates for it.
 */
export function BottomNav({ onOpenMenu }: { readonly onOpenMenu: () => void }): ReactNode {
  const { t } = useTranslation();

  return (
    <nav
      aria-label={t('navSection')}
      className="flex shrink-0 items-stretch border-t border-line bg-chrome pb-safe"
    >
      {NAV_ITEMS.slice(0, PRIMARY_COUNT).map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.screen}
            to={item.path}
            className={cn(
              TAB,
              'aria-[current=page]:text-acc-dim aria-[current=page]:bg-acc-soft',
            )}
          >
            <Icon aria-hidden className="size-18" />
            <span className="max-w-full truncate px-2">{t(item.labelKey)}</span>
          </NavLink>
        );
      })}

      <button type="button" onClick={onOpenMenu} aria-haspopup="dialog" className={TAB}>
        <MoreHorizontal aria-hidden className="size-18" />
        <span className="max-w-full truncate px-2">{t('moreL')}</span>
      </button>
    </nav>
  );
}
