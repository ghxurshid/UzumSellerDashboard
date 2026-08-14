import { GitCompareArrows } from 'lucide-react';
import type { ReactNode } from 'react';

import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { RANGE_KEYS, describeWindow, resolveWindow } from '@/lib/dateRange';
import { useFiltersStore } from '@/store/filters.store';
import { useUiStore } from '@/store/ui.store';

import { MENU_ITEM, MenuSurface } from './MenuSurface';

interface RangeMenuProps {
  readonly open: boolean;
  readonly onOpenChange: () => void;
  readonly trigger: ReactNode;
}

export function RangeMenu({ open, onOpenChange, trigger }: RangeMenuProps): ReactNode {
  const { t } = useTranslation();
  const rangeKey = useFiltersStore((state) => state.rangeKey);
  const setRange = useFiltersStore((state) => state.setRange);
  const closeMenu = useUiStore((state) => state.closeMenu);

  return (
    <MenuSurface open={open} onOpenChange={onOpenChange} trigger={trigger} width="w-242">
      <div role="menu" aria-label={t('compareTo')}>
        {RANGE_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            role="menuitemradio"
            aria-checked={rangeKey === key}
            onClick={() => {
              setRange(key);
              closeMenu();
            }}
            className={cn(MENU_ITEM, rangeKey === key && 'bg-acc-soft')}
          >
            {t(key)}
            <div className="flex-1" />
            <span data-numeric className="text-mini text-faint">
              {describeWindow(resolveWindow(key))}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-7 border-t border-line px-9 py-8 text-xs text-dim">
        <GitCompareArrows aria-hidden className="size-12 text-acc-dim" />
        {t('compareTo')}
        <div className="flex-1" />
        <span className="text-faint">{t('prevPeriod')}</span>
      </div>
    </MenuSurface>
  );
}
