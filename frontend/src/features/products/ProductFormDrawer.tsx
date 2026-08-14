import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { SelectField, TextField } from '@/components/ui/Field';
import { useActionGuard } from '@/hooks/useActionGuard';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { queryKeys } from '@/services/api/queryKeys';
import { useUzumActions } from '@/services/queries/useUzumActions';
import { fetchBarcodeTypes } from '@/services/uzum/endpoints';
import type { Product, Sku } from '@/types/domain';

import {
  labelsFormSchema,
  priceFormSchema,
  stockFormSchema,
  toNumber,
  type LabelsFormValues,
  type PriceFormValues,
  type StockFormValues,
} from './productForms';

export type ProductFormKind = 'price' | 'stock' | 'labels' | null;

interface ProductFormDrawerProps {
  readonly kind: ProductFormKind;
  readonly product: Product;
  readonly sku: Sku;
  readonly onClose: () => void;
}

/**
 * The write forms behind the product detail actions.
 *
 * Each one posts to the endpoint named in its subtitle and closes only after
 * the API has answered. Validation runs on blur and again on change once a
 * field has errored, so the first keystroke of a correction clears the message
 * instead of leaving it standing until the next submit.
 */
export function ProductFormDrawer({
  kind,
  product,
  sku,
  onClose,
}: ProductFormDrawerProps): ReactNode {
  const { t } = useTranslation();

  return (
    <Drawer
      open={kind !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={
        kind === 'price' ? t('aPrice') : kind === 'stock' ? t('updStock') : t('printLabels')
      }
      subtitle={
        kind === 'price'
          ? `POST /v1/product/${product.shopId}/sendPriceData`
          : kind === 'stock'
            ? 'POST /v2/fbs/sku/stocks'
            : `POST /v1/product/shop/${product.shopId}/barcodes/print`
      }
    >
      {kind === 'price' && <PriceForm product={product} sku={sku} onDone={onClose} />}
      {kind === 'stock' && <StockForm sku={sku} onDone={onClose} />}
      {kind === 'labels' && <LabelsForm product={product} sku={sku} onDone={onClose} />}
    </Drawer>
  );
}

function FormError({ count }: { readonly count: number }): ReactNode {
  const { t } = useTranslation();
  if (count === 0) return null;

  return (
    <p
      role="alert"
      className="m-0 flex items-center gap-6 rounded-8 border border-neg-line bg-neg-soft px-10 py-8 text-xs text-neg"
    >
      <AlertCircle aria-hidden className="size-12 shrink-0" />
      {t('fErrs', { n: count })}
    </p>
  );
}

function PriceForm({
  product,
  sku,
  onDone,
}: {
  readonly product: Product;
  readonly sku: Sku;
  readonly onDone: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const { allow } = useActionGuard();
  const actions = useUzumActions();

  const form = useForm<PriceFormValues>({
    resolver: zodResolver(priceFormSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      productId: String(product.productId),
      skuId: String(sku.skuId),
      fullPrice: String(sku.price),
      sellPrice: String(sku.price),
    },
  });

  useEffect(() => {
    form.reset({
      productId: String(product.productId),
      skuId: String(sku.skuId),
      fullPrice: String(sku.price),
      sellPrice: String(sku.price),
    });
  }, [form, product.productId, sku.price, sku.skuId]);

  const submit = form.handleSubmit((values) => {
    if (!allow()) return;
    void actions
      .updatePrice(product.shopId, [
        {
          skuId: toNumber(values.skuId),
          fullPrice: toNumber(values.fullPrice),
          sellPrice: toNumber(values.sellPrice),
        },
      ])
      .then(onDone);
  });

  return (
    <form onSubmit={submit} className="flex flex-col gap-12">
      <FormError count={Object.keys(form.formState.errors).length} />

      <TextField label="productId" readOnly disabled {...form.register('productId')} />
      <TextField label="skuId" readOnly disabled {...form.register('skuId')} />
      <TextField
        label={t('fFullPriceF')}
        inputMode="numeric"
        hint="NewPriceSku.fullPrice — integer, so'm"
        error={form.formState.errors.fullPrice?.message}
        {...form.register('fullPrice')}
      />
      <TextField
        label={t('fSellPrice')}
        inputMode="numeric"
        hint="NewPriceSku.sellPrice — must not exceed fullPrice"
        error={form.formState.errors.sellPrice?.message}
        {...form.register('sellPrice')}
      />

      <p className="m-0 text-xs leading-[1.55] text-dim">{t('nfPrice')}</p>

      <div className="flex justify-end gap-8 border-t border-line pt-12">
        <Button type="button" size="lg" onClick={onDone}>
          {t('cancel')}
        </Button>
        <Button type="submit" variant="primary" size="lg">
          {t('mConfirm')}
        </Button>
      </div>
    </form>
  );
}

function StockForm({ sku, onDone }: { readonly sku: Sku; readonly onDone: () => void }): ReactNode {
  const { t } = useTranslation();
  const { allow } = useActionGuard();
  const actions = useUzumActions();

  const form = useForm<StockFormValues>({
    resolver: zodResolver(stockFormSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      skuId: String(sku.skuId),
      barcode: sku.barcode,
      amount: String(sku.quantityFbs),
    },
  });

  const submit = form.handleSubmit((values) => {
    if (!allow()) return;
    void actions
      .updateStock([
        { skuId: toNumber(values.skuId), barcode: values.barcode, amount: toNumber(values.amount) },
      ])
      .then(onDone);
  });

  return (
    <form onSubmit={submit} className="flex flex-col gap-12">
      <FormError count={Object.keys(form.formState.errors).length} />

      <TextField label="skuId" readOnly disabled {...form.register('skuId')} />
      <TextField
        label={t('fBarcode')}
        hint="RestSellerSkuFbsAmountDto.barcode — required, unique on the market side"
        error={form.formState.errors.barcode?.message}
        {...form.register('barcode')}
      />
      <TextField
        label={t('fAmountF')}
        inputMode="numeric"
        placeholder="0"
        error={form.formState.errors.amount?.message}
        {...form.register('amount')}
      />

      <p className="m-0 text-xs leading-[1.55] text-dim">{t('nfStock')}</p>

      <div className="flex justify-end gap-8 border-t border-line pt-12">
        <Button type="button" size="lg" onClick={onDone}>
          {t('cancel')}
        </Button>
        <Button type="submit" variant="primary" size="lg">
          {t('saveShort')}
        </Button>
      </div>
    </form>
  );
}

function LabelsForm({
  product,
  sku,
  onDone,
}: {
  readonly product: Product;
  readonly sku: Sku;
  readonly onDone: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const { allow } = useActionGuard();
  const actions = useUzumActions();

  /* Label sizes are a reference list the API owns; offering anything else
     would mean printing against an id it does not recognise. */
  const types = useQuery({
    queryKey: queryKeys.reference.barcodeTypes,
    queryFn: ({ signal }) => fetchBarcodeTypes({ signal }),
    staleTime: 24 * 60 * 60 * 1_000,
  });

  const form = useForm<LabelsFormValues>({
    resolver: zodResolver(labelsFormSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { skuId: String(sku.skuId), labelCount: '1', barcodeTypeId: '' },
  });

  const submit = form.handleSubmit((values) => {
    if (!allow()) return;
    void actions
      .printSkuLabels(product.shopId, values.barcodeTypeId, [
        { skuId: toNumber(values.skuId), labelCount: toNumber(values.labelCount) },
      ])
      .then(onDone);
  });

  return (
    <form onSubmit={submit} className="flex flex-col gap-12">
      <FormError count={Object.keys(form.formState.errors).length} />

      <TextField label="skuId" readOnly disabled {...form.register('skuId')} />
      <TextField
        label={t('fCount')}
        inputMode="numeric"
        error={form.formState.errors.labelCount?.message}
        {...form.register('labelCount')}
      />
      <SelectField
        label={t('fBarcodeType')}
        options={[
          { value: '', label: '—' },
          ...(types.data ?? []).map((type) => ({
            value: String(type.id),
            label: type.title ?? type.name ?? String(type.id),
          })),
        ]}
        error={form.formState.errors.barcodeTypeId?.message}
        {...form.register('barcodeTypeId')}
      />

      <p className="m-0 text-xs leading-[1.55] text-dim">{t('nfLabels')}</p>

      <div className="flex justify-end gap-8 border-t border-line pt-12">
        <Button type="button" size="lg" onClick={onDone}>
          {t('cancel')}
        </Button>
        <Button type="submit" variant="primary" size="lg">
          {t('printLabels')}
        </Button>
      </div>
    </form>
  );
}
