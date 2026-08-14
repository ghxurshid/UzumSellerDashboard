import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { useProgressTask, type ProgressHandle } from '@/hooks/useProgressTask';
import { base64ToPdf, downloadBlob, timestampedName } from '@/lib/download';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { ApiError } from '@/services/api/client';
import * as uzum from '@/services/uzum/endpoints';
import type { PriceUpdateEntry, StockUpdateEntry } from '@/services/uzum/types';
import { useNotificationsStore } from '@/store/notifications.store';
import { useToastStore } from '@/store/toast.store';

/**
 * Every write the application can perform, wired to the endpoint that performs
 * it.
 *
 * Each action does four real things: run the request behind the progress
 * overlay, report the API's own answer, log an event to the notification panel,
 * and invalidate exactly the queries whose data the write just changed. A write
 * that is rejected leaves the cache alone and says why.
 *
 * Bulk actions loop rather than batch, because the seller API has no batch
 * endpoint for orders — so the progress bar counts real completed requests.
 */

export interface UzumActions {
  readonly updateStock: (entries: readonly StockUpdateEntry[]) => Promise<void>;
  readonly updatePrice: (shopId: number, entries: readonly PriceUpdateEntry[]) => Promise<void>;
  readonly confirmOrders: (orderIds: readonly number[]) => Promise<void>;
  readonly cancelOrder: (orderId: number, reason: string, comment: string) => Promise<void>;
  readonly bindIdentifiers: (
    orderId: number,
    body: { orderItemId: number; type: string; values: readonly string[] },
  ) => Promise<void>;
  readonly deliverOrder: (orderId: number) => Promise<void>;
  readonly completeOrder: (orderId: number, issueCode: string) => Promise<void>;
  readonly refundOrder: (orderId: number) => Promise<void>;
  readonly createInvoice: (body: {
    orderIds: readonly number[];
    dropOffPointUuid: string;
    timeSlotUuid: string;
    idempotencyKey: string;
  }) => Promise<void>;
  readonly cancelInvoice: (invoiceId: number) => Promise<void>;
  readonly updateInvoiceContent: (
    invoiceId: number,
    body: { customerOrderId: number; idempotencyKey: string },
  ) => Promise<void>;
  readonly updateTimeSlot: (body: {
    invoiceId: number;
    dropOffPointUuid: string;
    timeSlotUuid: string;
    idempotencyKey: string;
  }) => Promise<void>;
  readonly printOrderLabel: (orderId: number, size: string) => Promise<void>;
  readonly printSkuLabels: (
    shopId: number,
    barcodeTypeId: string,
    skus: ReadonlyArray<{ skuId: number; labelCount: number }>,
  ) => Promise<void>;
  readonly printSupplyAct: (invoiceId: number) => Promise<void>;
  readonly printAcceptanceAct: (invoiceId: number) => Promise<void>;
}

export function useUzumActions(): UzumActions {
  const client = useQueryClient();
  const { t } = useTranslation();
  const push = useToastStore((state) => state.push);
  const notify = useNotificationsStore((state) => state.notify);
  const progress = useProgressTask();

  const invalidate = useCallback(
    (...segments: readonly string[]) => {
      for (const segment of segments) {
        void client.invalidateQueries({ queryKey: ['uzum', 'source', segment] });
      }
    },
    [client],
  );

  const fail = useCallback(
    (error: unknown) => {
      const message = error instanceof ApiError ? error.message : t('tFail');
      push(message, { kind: 'err', sticky: true });
      notify(message, { icon: 'alert-triangle', tone: 'negative' });
    },
    [notify, push, t],
  );

  const succeed = useCallback(
    (message: string) => {
      push(message, { kind: 'ok' });
      notify(message, { icon: 'circle-check', tone: 'positive' });
    },
    [notify, push],
  );

  /** One request, indeterminate bar, uniform success/failure reporting. */
  const single = useCallback(
    async (
      descriptor: { label: string; sub: string; kind: 'proc' | 'down' },
      call: (handle: ProgressHandle) => Promise<unknown>,
      done: { message: string; invalidates?: readonly string[] },
    ): Promise<void> => {
      await progress.run({
        ...descriptor,
        task: call,
        onDone: () => {
          succeed(done.message);
          if (done.invalidates !== undefined) invalidate(...done.invalidates);
        },
        onError: fail,
        onCancelled: () => push(t('tCancelled'), { kind: 'info' }),
      });
    },
    [fail, invalidate, progress, push, succeed, t],
  );

  const openPdf = useCallback(
    (base64: string, name: string) => {
      downloadBlob(base64ToPdf(base64), timestampedName(name, 'pdf'));
      succeed(t('tPdfReady'));
    },
    [succeed, t],
  );

  return useMemo<UzumActions>(
    () => ({
      updateStock: (entries) =>
        single(
          { label: t('prSend'), sub: 'POST /v2/fbs/sku/stocks', kind: 'proc' },
          ({ signal }) => uzum.updateSkuStocks(entries, { signal }),
          { message: t('tStockSent'), invalidates: ['stocks', 'products'] },
        ),

      updatePrice: (shopId, entries) =>
        single(
          { label: t('prSend'), sub: `POST /v1/product/${shopId}/sendPriceData`, kind: 'proc' },
          ({ signal }) => uzum.sendPriceData(shopId, entries, { signal }),
          { message: t('tPriceSent'), invalidates: ['products'] },
        ),

      /* No batch confirm endpoint exists, so this is genuinely N requests and
         the bar counts them as they land. A failure part-way through stops the
         loop and reports how many did go through. */
      confirmOrders: async (orderIds) => {
        let confirmed = 0;
        await progress.run({
          label: t('prSend'),
          sub: `${orderIds.length} × POST /v1/fbs/order/{orderId}/confirm`,
          kind: 'proc',
          task: async ({ report, signal }) => {
            for (const orderId of orderIds) {
              if (signal.aborted) break;
              await uzum.confirmFbsOrder(orderId, { signal });
              confirmed += 1;
              report(confirmed, orderIds.length);
            }
            return confirmed;
          },
          onDone: () => {
            succeed(t('tConfd', { n: confirmed }));
            invalidate('orders');
          },
          onError: (error) => {
            fail(error);
            if (confirmed > 0) {
              push(t('tConfd', { n: confirmed }), { kind: 'warn' });
              invalidate('orders');
            }
          },
          onCancelled: () => {
            push(t('tCancelled'), { kind: 'info' });
            if (confirmed > 0) invalidate('orders');
          },
        });
      },

      cancelOrder: (orderId, reason, comment) =>
        single(
          { label: t('prSend'), sub: `POST /v1/fbs/order/${orderId}/cancel`, kind: 'proc' },
          ({ signal }) =>
            uzum.cancelFbsOrder(
              orderId,
              comment === '' ? { reason } : { reason, comment },
              { signal },
            ),
          { message: t('tOrdCancelled'), invalidates: ['orders', 'finance'] },
        ),

      bindIdentifiers: (orderId, body) =>
        single(
          { label: t('prSend'), sub: `POST /v1/fbs/order/${orderId}/identifier`, kind: 'proc' },
          ({ signal }) => uzum.bindOrderIdentifiers(orderId, body, { signal }),
          { message: t('tIdentSaved'), invalidates: ['orders'] },
        ),

      deliverOrder: (orderId) =>
        single(
          { label: t('prSend'), sub: `POST /v1/dbs/order/${orderId}/delivering`, kind: 'proc' },
          ({ signal }) => uzum.deliverDbsOrder(orderId, { signal }),
          { message: t('tDelivering'), invalidates: ['orders'] },
        ),

      completeOrder: (orderId, issueCode) =>
        single(
          { label: t('prSend'), sub: `POST /v1/dbs/order/${orderId}/completed`, kind: 'proc' },
          ({ signal }) => uzum.completeDbsOrder(orderId, { issueCode }, { signal }),
          { message: t('tCompleted'), invalidates: ['orders'] },
        ),

      refundOrder: (orderId) =>
        single(
          { label: t('prSend'), sub: `POST /v1/dbs/order/${orderId}/refund`, kind: 'proc' },
          ({ signal }) => uzum.refundDbsOrder(orderId, { signal }),
          { message: t('tRefundCreated'), invalidates: ['orders', 'invoices'] },
        ),

      createInvoice: (body) =>
        single(
          { label: t('prSend'), sub: 'POST /v1/fbs/invoice', kind: 'proc' },
          ({ signal }) => uzum.createFbsInvoice(body, { signal }),
          { message: t('tInvCreated'), invalidates: ['invoices', 'orders'] },
        ),

      cancelInvoice: (invoiceId) =>
        single(
          { label: t('prSend'), sub: `POST /v1/fbs/invoice/${invoiceId}/cancel`, kind: 'proc' },
          ({ signal }) => uzum.cancelFbsInvoice(invoiceId, { signal }),
          { message: t('tInvCancelled'), invalidates: ['invoices', 'orders'] },
        ),

      updateInvoiceContent: (invoiceId, body) =>
        single(
          {
            label: t('prSend'),
            sub: `POST /v1/fbs/invoice/${invoiceId}/update-content`,
            kind: 'proc',
          },
          ({ signal }) => uzum.updateFbsInvoiceContent(invoiceId, body, { signal }),
          { message: t('tContentUpd'), invalidates: ['invoices'] },
        ),

      updateTimeSlot: (body) =>
        single(
          { label: t('prSend'), sub: 'POST /v1/fbs/invoice/dop/time-slot', kind: 'proc' },
          ({ signal }) => uzum.updateFbsInvoiceTimeSlot(body, { signal }),
          { message: t('tSlotUpd'), invalidates: ['invoices'] },
        ),

      printOrderLabel: async (orderId, size) => {
        await progress.run({
          label: t('prLabels'),
          sub: `GET /v1/fbs/order/${orderId}/labels/print`,
          kind: 'down',
          task: ({ signal }) => uzum.fetchOrderLabel(orderId, size, { signal }),
          onDone: (base64) => openPdf(base64, `label-${orderId}`),
          onError: fail,
        });
      },

      printSkuLabels: async (shopId, barcodeTypeId, skus) => {
        await progress.run({
          label: t('prLabels'),
          sub: `POST /v1/product/shop/${shopId}/barcodes/print`,
          kind: 'down',
          task: ({ signal }) =>
            uzum.printSkuBarcodes(shopId, { barcodeTypeId, skus }, { signal }),
          onDone: (base64) => openPdf(base64, 'barcodes'),
          onError: fail,
        });
      },

      printSupplyAct: async (invoiceId) => {
        await progress.run({
          label: t('prLabels'),
          sub: `GET /v1/fbs/invoice/${invoiceId}/print`,
          kind: 'down',
          task: ({ signal }) => uzum.fetchSupplyAct(invoiceId, { signal }),
          onDone: (base64) => openPdf(base64, `supply-act-${invoiceId}`),
          onError: fail,
        });
      },

      printAcceptanceAct: async (invoiceId) => {
        await progress.run({
          label: t('prLabels'),
          sub: `GET /v1/fbs/invoice/${invoiceId}/closing-documents`,
          kind: 'down',
          task: ({ signal }) => uzum.fetchAcceptanceAct(invoiceId, { signal }),
          onDone: (base64) => openPdf(base64, `acceptance-act-${invoiceId}`),
          onError: fail,
        });
      },
    }),
    [fail, invalidate, openPdf, progress, push, single, succeed, t],
  );
}
