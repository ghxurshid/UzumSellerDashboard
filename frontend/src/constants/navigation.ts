import {
  ChartLine,
  Package,
  Layers,
  ClipboardList,
  FileText,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import type { TranslationKey } from '@/lib/i18n/dictionary';
import type { ScreenKey } from '@/types/domain';

export interface NavItem {
  readonly screen: ScreenKey;
  readonly path: string;
  readonly labelKey: TranslationKey;
  readonly icon: LucideIcon;
}

/**
 * The icon rail.
 *
 * The source design draws Phosphor glyphs; the stack here standardises on
 * Lucide, so each entry maps to the closest Lucide equivalent at the same
 * optical weight (Phosphor `chart-line` → `ChartLine`, `package` → `Package`,
 * `stack` → `Layers`, `clipboard-text` → `ClipboardList`, `receipt` →
 * `FileText`, `wallet` → `Wallet`).
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { screen: 'overview', path: '/overview', labelKey: 'nOverview', icon: ChartLine },
  { screen: 'products', path: '/products', labelKey: 'nProducts', icon: Package },
  { screen: 'inventory', path: '/inventory', labelKey: 'nInventory', icon: Layers },
  { screen: 'ops', path: '/operations', labelKey: 'nOps', icon: ClipboardList },
  { screen: 'invoices', path: '/invoices', labelKey: 'nInvoices', icon: FileText },
  { screen: 'finance', path: '/finance', labelKey: 'nFinance', icon: Wallet },
];

export const SETTINGS_PATH = '/settings';

export const PATH_BY_SCREEN: Readonly<Record<ScreenKey, string>> = {
  overview: '/overview',
  products: '/products',
  inventory: '/inventory',
  ops: '/operations',
  invoices: '/invoices',
  finance: '/finance',
  settings: SETTINGS_PATH,
};
