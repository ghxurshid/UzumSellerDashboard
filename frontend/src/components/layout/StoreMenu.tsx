import { Building2, CheckCircle2, Store as StoreIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { useConnection } from '@/services/queries/useConnection';
import { ALL_STORES, useFiltersStore } from '@/store/filters.store';
import { useUiStore } from '@/store/ui.store';

import { MENU_ITEM, MenuSurface } from './MenuSurface';

interface StoreMenuProps {
  readonly open: boolean;
  readonly onOpenChange: () => void;
  readonly trigger: ReactNode;
}

export function StoreMenu({ open, onOpenChange, trigger }: StoreMenuProps): ReactNode {
  const { t } = useTranslation();
  const storeKey = useFiltersStore((state) => state.storeKey);
  const setStore = useFiltersStore((state) => state.setStore);
  const closeMenu = useUiStore((state) => state.closeMenu);
  const { shops } = useConnection();

  const select = (key: string): void => {
    setStore(key);
    closeMenu();
  };

  return (
    <MenuSurface open={open} onOpenChange={onOpenChange} trigger={trigger} width="w-262">
      <div role="menu" aria-label={t('allShort')}>
        {shops.map((shop) => {
          const key = String(shop.id);
          return (
            <button
              key={key}
              type="button"
              role="menuitemradio"
              aria-checked={storeKey === key}
              onClick={() => select(key)}
              className={cn(MENU_ITEM, storeKey === key && 'bg-acc-soft')}
            >
              <span className="flex size-22 shrink-0 items-center justify-center rounded-6 bg-grid text-xs text-faint">
                <StoreIcon aria-hidden className="size-11" />
              </span>
              <span className="flex min-w-0 flex-col leading-[1.3]">
                <span className="truncate">{shop.name}</span>
                <span className="truncate font-mono text-tiny text-faint">shopId {shop.id}</span>
              </span>
              <div className="flex-1" />
              {storeKey === key && (
                <CheckCircle2 aria-hidden className="size-13 shrink-0 text-acc-dim" />
              )}
            </button>
          );
        })}

        {shops.length === 0 && (
          <p className="m-0 px-11 py-10 text-center text-xs text-faint">{t('connNone')}</p>
        )}

        <button
          type="button"
          role="menuitemradio"
          aria-checked={storeKey === ALL_STORES}
          onClick={() => select(ALL_STORES)}
          className={cn(
            MENU_ITEM,
            'mt-4 rounded-none rounded-b-8 border-t border-line',
            storeKey === ALL_STORES && 'bg-acc-soft',
          )}
        >
          <Building2 aria-hidden className="size-14 text-acc-dim" />
          {t('allStores')}
        </button>
      </div>
    </MenuSurface>
  );
}
