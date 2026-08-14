import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { queryKeys } from '@/services/api/queryKeys';
import { useUzumActions } from '@/services/queries/useUzumActions';
import { fetchBarcodeTypes, fetchReturnReasons } from '@/services/uzum/endpoints';
import { useDialogStore } from '@/store/dialog.store';

import type { ActionContext, FormAction } from './actionContext';

/**
 * The form behind a write.
 *
 * Every field maps to a field of the request body, and the validation rules are
 * the API's own — a barcode is required because `POST /v2/fbs/sku/stocks`
 * rejects the row without one, and identifier values must be unique inside an
 * order item because the API returns an error when they repeat. Nothing is
 * validated here that the server does not also validate; nothing is skipped
 * that it does.
 *
 * Reference lists (cancellation reasons, label sizes) are fetched from the API
 * rather than hardcoded, so the options offered are the ones it will accept.
 */

type Values = Record<string, string>;
type Errors = Record<string, string>;

const numberOf = (value: string): number => Number(value.replace(/\s/g, ''));

function initialValues(context: ActionContext): Values {
  const raw = context.raw;
  const text = (key: string): string => {
    const value = raw[key];
    return value === undefined || value === null ? '' : String(value);
  };

  switch (context.action) {
    case 'stock':
      return { skuId: text('skuId'), barcode: text('barcode'), amount: text('amount') };
    case 'price':
      return { productId: text('productId'), skuId: text('skuId'), fullPrice: '', sellPrice: '' };
    case 'cancelOrder':
      return { orderId: text('orderId'), reason: '', comment: '' };
    case 'labels':
      return context.moduleKey === 'ops'
        ? { orderId: text('orderId'), size: 'LARGE' }
        : { skuId: text('skuId'), labelCount: '1', barcodeTypeId: '' };
    case 'identifiers':
      return { orderId: text('orderId'), orderItemId: '', identType: 'IMEI', values: '' };
    case 'complete':
      return { orderId: text('orderId'), issueCode: '' };
    case 'createInvoice':
      return {
        orderIds: context.ids.join(', '),
        dropOffPointUuid: '',
        timeSlotUuid: '',
        idempotencyKey: `inv-${Date.now().toString(36)}`,
      };
    case 'updateContent':
      return {
        invoiceId: text('invoiceId'),
        customerOrderId: '',
        idempotencyKey: `upd-${Date.now().toString(36)}`,
      };
    case 'timeSlot':
      return {
        invoiceId: text('invoiceId'),
        dropOffPointUuid: '',
        timeSlotUuid: '',
        idempotencyKey: `slot-${Date.now().toString(36)}`,
      };
  }
}

function validate(action: FormAction, values: Values, t: (key: never) => string): Errors {
  const errors: Errors = {};
  const required = (key: string): void => {
    if ((values[key] ?? '').trim() === '') errors[key] = 'fReq';
  };
  const wholeNumber = (key: string, min: number): void => {
    const raw = (values[key] ?? '').trim();
    if (raw === '') {
      errors[key] = 'fReq';
      return;
    }
    const parsed = numberOf(raw);
    if (!Number.isInteger(parsed)) errors[key] = 'fInt';
    else if (parsed < min) errors[key] = 'fNeg';
  };

  void t;

  switch (action) {
    case 'stock':
      required('skuId');
      /* The API keys the row on barcode and rejects a blank or duplicate one. */
      required('barcode');
      wholeNumber('amount', 0);
      break;
    case 'price':
      required('productId');
      required('skuId');
      wholeNumber('fullPrice', 1);
      wholeNumber('sellPrice', 1);
      if (
        errors['fullPrice'] === undefined &&
        errors['sellPrice'] === undefined &&
        numberOf(values['sellPrice'] ?? '') > numberOf(values['fullPrice'] ?? '')
      ) {
        errors['sellPrice'] = 'fPriceOrder';
      }
      break;
    case 'cancelOrder':
      required('reason');
      break;
    case 'labels':
      if ('labelCount' in values) {
        required('skuId');
        required('barcodeTypeId');
        wholeNumber('labelCount', 1);
        if (errors['labelCount'] === undefined && numberOf(values['labelCount'] ?? '') > 100) {
          errors['labelCount'] = 'fMaxLabels';
        }
      } else {
        required('orderId');
      }
      break;
    case 'identifiers': {
      required('orderItemId');
      required('values');
      const lines = (values['values'] ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
      if (new Set(lines).size !== lines.length) errors['values'] = 'fUnique';
      break;
    }
    case 'complete':
      required('issueCode');
      break;
    case 'createInvoice':
      required('dropOffPointUuid');
      required('timeSlotUuid');
      break;
    case 'updateContent':
      wholeNumber('customerOrderId', 1);
      break;
    case 'timeSlot':
      required('dropOffPointUuid');
      required('timeSlotUuid');
      break;
  }

  return errors;
}

const TITLE_KEY: Record<FormAction, 'updStock' | 'aPrice' | 'aCancelOrd' | 'printLabels' | 'aIdent' | 'aComplete' | 'aCreateInv' | 'aUpdContent' | 'aSlot'> = {
  stock: 'updStock',
  price: 'aPrice',
  cancelOrder: 'aCancelOrd',
  labels: 'printLabels',
  identifiers: 'aIdent',
  complete: 'aComplete',
  createInvoice: 'aCreateInv',
  updateContent: 'aUpdContent',
  timeSlot: 'aSlot',
};

const NOTE_KEY: Partial<Record<FormAction, 'nfStock' | 'nfPrice' | 'nfCancel' | 'nfLabels' | 'nfIdent' | 'nfComplete' | 'nfInvoice' | 'nfContent'>> = {
  stock: 'nfStock',
  price: 'nfPrice',
  cancelOrder: 'nfCancel',
  labels: 'nfLabels',
  identifiers: 'nfIdent',
  complete: 'nfComplete',
  createInvoice: 'nfInvoice',
  updateContent: 'nfContent',
};

export interface ActionDrawerProps {
  readonly context: ActionContext | null;
  readonly onClose: () => void;
}

export function ActionDrawer({ context, onClose }: ActionDrawerProps): ReactNode {
  const { t } = useTranslation();
  const actions = useUzumActions();
  const requestConfirm = useDialogStore((state) => state.requestConfirm);

  const [values, setValues] = useState<Values>({});
  const [submitted, setSubmitted] = useState(false);
  const [seeded, setSeeded] = useState<string | null>(null);

  /* Reference data the form's options come from, read only while it is open. */
  const reasons = useQuery({
    queryKey: queryKeys.reference.returnReasons,
    queryFn: ({ signal }) => fetchReturnReasons({ signal }),
    enabled: context?.action === 'cancelOrder',
    staleTime: 24 * 60 * 60 * 1_000,
  });

  const barcodeTypes = useQuery({
    queryKey: queryKeys.reference.barcodeTypes,
    queryFn: ({ signal }) => fetchBarcodeTypes({ signal }),
    enabled: context?.action === 'labels' && context.moduleKey !== 'ops',
    staleTime: 24 * 60 * 60 * 1_000,
  });

  const key = context === null ? null : `${context.action}:${context.label}`;
  if (context !== null && seeded !== key) {
    setSeeded(key);
    setValues(initialValues(context));
    setSubmitted(false);
  }

  const errors = useMemo<Errors>(
    () => (context === null ? {} : validate(context.action, values, t as never)),
    [context, t, values],
  );

  if (context === null) return null;

  const set = (field: string) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const errorFor = (field: string): string | undefined => {
    if (!submitted) return undefined;
    const code = errors[field];
    if (code === undefined) return undefined;
    return t(code as never);
  };

  const submit = async (): Promise<void> => {
    setSubmitted(true);
    const count = Object.keys(errors).length;
    if (count > 0) return;

    const raw = context.raw;
    const number = (key_: string): number => numberOf(values[key_] ?? '');

    switch (context.action) {
      case 'stock':
        await actions.updateStock([
          {
            skuId: number('skuId'),
            barcode: (values['barcode'] ?? '').trim(),
            amount: number('amount'),
          },
        ]);
        break;

      case 'price':
        await actions.updatePrice(Number(raw['shopId'] ?? 0), [
          {
            skuId: number('skuId'),
            fullPrice: number('fullPrice'),
            sellPrice: number('sellPrice'),
          },
        ]);
        break;

      case 'cancelOrder': {
        /* A cancellation reaches the buyer and cannot be undone from here, so
           the reason is collected first and confirmed second. */
        const orderId = number('orderId');
        const reason = values['reason'] ?? '';
        const comment = (values['comment'] ?? '').trim();

        requestConfirm(
          {
            title: t('cfCancelOrdT'),
            body: t('cfCancelOrdB'),
            cta: t('aCancelOrd'),
            tone: 'warn',
          },
          () => void actions.cancelOrder(orderId, reason, comment),
        );
        break;
      }

      case 'labels':
        if (context.moduleKey === 'ops') {
          await actions.printOrderLabel(number('orderId'), values['size'] ?? 'LARGE');
        } else {
          await actions.printSkuLabels(Number(raw['shopId'] ?? 0), values['barcodeTypeId'] ?? '', [
            { skuId: number('skuId'), labelCount: number('labelCount') },
          ]);
        }
        break;

      case 'identifiers':
        await actions.bindIdentifiers(number('orderId'), {
          orderItemId: number('orderItemId'),
          type: values['identType'] ?? 'IMEI',
          values: (values['values'] ?? '')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line !== ''),
        });
        break;

      case 'complete':
        await actions.completeOrder(number('orderId'), (values['issueCode'] ?? '').trim());
        break;

      case 'createInvoice':
        await actions.createInvoice({
          orderIds: context.ids.map(Number).filter(Number.isFinite),
          dropOffPointUuid: (values['dropOffPointUuid'] ?? '').trim(),
          timeSlotUuid: (values['timeSlotUuid'] ?? '').trim(),
          idempotencyKey: values['idempotencyKey'] ?? '',
        });
        break;

      case 'updateContent':
        await actions.updateInvoiceContent(number('invoiceId'), {
          customerOrderId: number('customerOrderId'),
          idempotencyKey: values['idempotencyKey'] ?? '',
        });
        break;

      case 'timeSlot':
        await actions.updateTimeSlot({
          invoiceId: number('invoiceId'),
          dropOffPointUuid: (values['dropOffPointUuid'] ?? '').trim(),
          timeSlotUuid: (values['timeSlotUuid'] ?? '').trim(),
          idempotencyKey: values['idempotencyKey'] ?? '',
        });
        break;
    }

    onClose();
  };

  const noteKey = NOTE_KEY[context.action];
  const errorCount = Object.keys(errors).length;

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t(TITLE_KEY[context.action])}
      subtitle={context.endpoint}
      footer={
        <>
          <Button size="lg" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="primary" size="lg" onClick={() => void submit()}>
            {t('fSend')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-11">
        {submitted && errorCount > 0 && (
          <p role="alert" className="m-0 rounded-8 border border-neg-line bg-neg-soft px-10 py-8 text-xs text-neg">
            {t('fErrs', { n: errorCount })}
          </p>
        )}

        <Fields
          context={context}
          values={values}
          set={set}
          errorFor={errorFor}
          reasons={(reasons.data ?? []).map((reason) => ({
            value: reason.reason,
            label: reason.title,
          }))}
          barcodeTypes={(barcodeTypes.data ?? []).map((type) => ({
            value: String(type.id),
            label: type.title ?? type.name ?? String(type.id),
          }))}
        />

        {noteKey !== undefined && (
          <p className="m-0 border-t border-line pt-10 text-xs leading-[1.55] text-dim">
            {t(noteKey)}
          </p>
        )}
      </div>
    </Drawer>
  );
}

interface FieldsProps {
  readonly context: ActionContext;
  readonly values: Values;
  readonly set: (field: string) => (value: string) => void;
  readonly errorFor: (field: string) => string | undefined;
  readonly reasons: ReadonlyArray<{ value: string; label: string }>;
  readonly barcodeTypes: ReadonlyArray<{ value: string; label: string }>;
}

function Fields({ context, values, set, errorFor, reasons, barcodeTypes }: FieldsProps): ReactNode {
  const { t } = useTranslation();

  const text = (field: string, label: string, hint?: string): ReactNode => (
    <TextField
      label={label}
      value={values[field] ?? ''}
      onChange={(event) => set(field)(event.target.value)}
      {...(hint !== undefined ? { hint } : {})}
      {...(errorFor(field) !== undefined ? { error: errorFor(field) } : {})}
    />
  );

  switch (context.action) {
    case 'stock':
      return (
        <>
          {text('skuId', 'skuId')}
          {text('barcode', t('fBarcode'))}
          {text('amount', t('fAmountF'))}
        </>
      );

    case 'price':
      return (
        <>
          {text('productId', 'productId')}
          {text('skuId', 'skuId')}
          {text('fullPrice', t('fFullPriceF'))}
          {text('sellPrice', t('fSellPrice'))}
        </>
      );

    case 'cancelOrder':
      return (
        <>
          {text('orderId', 'orderId')}
          <SelectField
            label={t('fReason')}
            value={values['reason'] ?? ''}
            onChange={(event) => set('reason')(event.target.value)}
            options={[{ value: '', label: '—' }, ...reasons]}
            {...(errorFor('reason') !== undefined ? { error: errorFor('reason') } : {})}
          />
          <TextAreaField
            label={t('fComment')}
            value={values['comment'] ?? ''}
            onChange={(event) => set('comment')(event.target.value)}
          />
        </>
      );

    case 'labels':
      return context.moduleKey === 'ops' ? (
        <>
          {text('orderId', 'orderId')}
          <SelectField
            label={t('fLabelSize')}
            value={values['size'] ?? 'LARGE'}
            onChange={(event) => set('size')(event.target.value)}
            options={[
              { value: 'LARGE', label: 'LARGE' },
              { value: 'SMALL', label: 'SMALL' },
            ]}
          />
        </>
      ) : (
        <>
          {text('skuId', 'skuId')}
          <SelectField
            label={t('fBarcodeType')}
            value={values['barcodeTypeId'] ?? ''}
            onChange={(event) => set('barcodeTypeId')(event.target.value)}
            options={[{ value: '', label: '—' }, ...barcodeTypes]}
            {...(errorFor('barcodeTypeId') !== undefined
              ? { error: errorFor('barcodeTypeId') }
              : {})}
          />
          {text('labelCount', t('fCount'))}
        </>
      );

    case 'identifiers':
      return (
        <>
          {text('orderId', 'orderId')}
          {text('orderItemId', 'orderItemId')}
          <SelectField
            label={t('fIdentType')}
            value={values['identType'] ?? 'IMEI'}
            onChange={(event) => set('identType')(event.target.value)}
            options={[
              { value: 'IMEI', label: 'IMEI' },
              { value: 'ASL_BELGISI', label: 'ASL_BELGISI' },
            ]}
          />
          <TextAreaField
            label={t('fIdentValues')}
            value={values['values'] ?? ''}
            onChange={(event) => set('values')(event.target.value)}
            {...(errorFor('values') !== undefined ? { error: errorFor('values') } : {})}
          />
        </>
      );

    case 'complete':
      return (
        <>
          {text('orderId', 'orderId')}
          {text('issueCode', t('fIssueCode'))}
        </>
      );

    case 'createInvoice':
      return (
        <>
          {text('orderIds', t('fOrdersF'))}
          {text('dropOffPointUuid', t('fDropOff'))}
          {text('timeSlotUuid', t('fTimeSlot'))}
          {text('idempotencyKey', t('fIdemp'))}
        </>
      );

    case 'updateContent':
      return (
        <>
          {text('invoiceId', 'invoiceId')}
          {text('customerOrderId', 'customerOrderId')}
          {text('idempotencyKey', t('fIdemp'))}
        </>
      );

    case 'timeSlot':
      return (
        <>
          {text('invoiceId', 'invoiceId')}
          {text('dropOffPointUuid', t('fDropOff'))}
          {text('timeSlotUuid', t('fTimeSlot'))}
          {text('idempotencyKey', t('fIdemp'))}
        </>
      );
  }
}
