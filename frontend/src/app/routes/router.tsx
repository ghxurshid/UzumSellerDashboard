import { lazy } from 'react';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';

import { AppShell } from '@/components/layout/AppShell';
import { RouteError } from '@/app/routes/RouteError';

/**
 * Route table.
 *
 * Every page is a lazy chunk: the shell and the overview are what a cold start
 * must paint, and the remaining five screens should not sit in that bundle.
 *
 * The error element is attached to each *child* route rather than to the shell.
 * A screen that throws then fails inside the content pane, leaving the rail,
 * the topbar and Settings usable — which matters, because the usual cause of a
 * screen failing is a setting the user needs to go and change.
 */
const OverviewPage = lazy(() => import('@/pages/overview/OverviewPage'));
const ProductsPage = lazy(() => import('@/pages/products/ProductsPage'));
const ProductDetailPage = lazy(() => import('@/pages/products/ProductDetailPage'));
const ModulePage = lazy(() => import('@/pages/module/ModulePage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));

/** Each screen carries its own boundary; none of them can take the shell down. */
const screen = (path: string, element: RouteObject['element']): RouteObject => ({
  path,
  element,
  errorElement: <RouteError />,
});

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    /* Last resort: only reached if the shell itself fails to render. */
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to="/overview" replace /> },
      screen('overview', <OverviewPage />),
      screen('products', <ProductsPage />),
      screen('products/:productId', <ProductDetailPage />),
      screen('inventory', <ModulePage moduleKey="inventory" />),
      screen('operations', <ModulePage moduleKey="ops" />),
      screen('invoices', <ModulePage moduleKey="invoices" />),
      screen('finance', <ModulePage moduleKey="finance" />),
      screen('settings', <SettingsPage />),
      { path: '*', element: <Navigate to="/overview" replace /> },
    ],
  },
]);
