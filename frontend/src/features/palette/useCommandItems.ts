import {
  FileSpreadsheet,
  Package,
  RefreshCw,
  Sparkles,
  SunMoon,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { NAV_ITEMS, SETTINGS_PATH } from '@/constants/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useProductsQuery } from '@/services/queries/useProductsQuery';
import { useSync } from '@/services/sync/useSync';
import { usePreferencesStore } from '@/store/preferences.store';
import { useUiStore } from '@/store/ui.store';

export type CommandGroup = 'go' | 'products' | 'actions' | 'ask';

export interface CommandItem {
  readonly id: string;
  readonly group: CommandGroup;
  readonly label: string;
  readonly hint?: string;
  readonly icon: LucideIcon;
  readonly run: () => void;
}

const MAX_PRODUCT_MATCHES = 6;

/**
 * The palette's index.
 *
 * Navigation and actions are always present; product matches are computed from
 * the query the user has typed, capped so a two-character query cannot render
 * 750 rows. The "ask Copilot" entry is always last and always available — it is
 * the fallback when nothing else matched.
 */
export function useCommandItems(query: string): readonly CommandItem[] {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { products } = useProductsQuery();
  const sync = useSync();
  const toggleTheme = usePreferencesStore((state) => state.toggleTheme);
  const setPaletteOpen = useUiStore((state) => state.setPaletteOpen);
  const setChatOpen = useUiStore((state) => state.setChatOpen);

  return useMemo<readonly CommandItem[]>(() => {
    const normalised = query.trim().toLowerCase();
    const close = (): void => setPaletteOpen(false);

    const navigation: CommandItem[] = NAV_ITEMS.map((item) => ({
      id: `go-${item.screen}`,
      group: 'go',
      label: t(item.labelKey),
      hint: item.path,
      icon: item.icon,
      run: () => {
        close();
        void navigate(item.path);
      },
    }));

    navigation.push({
      id: 'go-settings',
      group: 'go',
      label: t('settings'),
      hint: SETTINGS_PATH,
      icon: NAV_ITEMS[0]?.icon ?? Package,
      run: () => {
        close();
        void navigate(SETTINGS_PATH);
      },
    });

    const productMatches: CommandItem[] =
      normalised === ''
        ? []
        : products
            .filter(
              (product) =>
                product.name.toLowerCase().includes(normalised) ||
                product.sku.includes(normalised),
            )
            .slice(0, MAX_PRODUCT_MATCHES)
            .map((product) => ({
              id: `product-${product.productId}`,
              group: 'products',
              label: product.name,
              hint: product.sku,
              icon: Package,
              run: () => {
                close();
                void navigate(`/products/${product.productId}`);
              },
            }));

    const actions: CommandItem[] = [
      {
        id: 'action-sync',
        group: 'actions',
        label: t('aSync'),
        icon: RefreshCw,
        run: () => {
          close();
          void sync.run();
        },
      },
      {
        /* Export belongs to a table, not to the palette — it takes the user to
           the screen whose rows would be exported rather than guessing which. */
        id: 'action-export',
        group: 'actions',
        label: t('aExport'),
        icon: FileSpreadsheet,
        run: () => {
          close();
          void navigate('/products');
        },
      },
      {
        id: 'action-theme',
        group: 'actions',
        label: t('aTheme'),
        icon: SunMoon,
        run: () => {
          close();
          toggleTheme();
        },
      },
    ];

    const ask: CommandItem = {
      id: 'ask-copilot',
      group: 'ask',
      label: normalised === '' ? t('askCopilot') : `${t('palAsk')}: ${query.trim()}`,
      icon: Sparkles,
      run: () => {
        close();
        setChatOpen(true);
      },
    };

    const matches = (item: CommandItem): boolean =>
      normalised === '' ||
      item.label.toLowerCase().includes(normalised) ||
      (item.hint?.toLowerCase().includes(normalised) ?? false);

    return [
      ...navigation.filter(matches),
      ...productMatches,
      ...actions.filter(matches),
      ask,
    ];
  }, [navigate, products, query, setChatOpen, setPaletteOpen, sync, t, toggleTheme]);
}
