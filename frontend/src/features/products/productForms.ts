import { z } from 'zod';

/**
 * Write-form schemas.
 *
 * Constraints mirror what the seller API enforces, so a rejection surfaces in
 * the field rather than as a 400 after the request goes out: prices are whole
 * so'm, `sellPrice` may not exceed `fullPrice`, and label counts stay inside
 * the print service's range.
 *
 * Fields stay `string` through validation — form controls hold strings, and a
 * schema that transformed them would make the resolver's input and output
 * types diverge, which `@hookform/resolvers` v3 cannot express. Coercion to
 * number happens once, at the submit boundary, via `toNumber`.
 */
const WHOLE_NUMBER = /^\d+$/;

const wholeNumberField = (message: string) =>
  z.string().trim().min(1, message).regex(WHOLE_NUMBER, message);

export const priceFormSchema = z
  .object({
    productId: z.string(),
    skuId: z.string(),
    fullPrice: wholeNumberField('required'),
    sellPrice: wholeNumberField('required'),
  })
  .refine((data) => Number(data.sellPrice) <= Number(data.fullPrice), {
    path: ['sellPrice'],
    message: 'sellPrice ≤ fullPrice',
  });

export type PriceFormValues = z.infer<typeof priceFormSchema>;

export const stockFormSchema = z.object({
  skuId: z.string(),
  barcode: z.string().trim().min(1, 'required'),
  amount: wholeNumberField('required'),
});

export type StockFormValues = z.infer<typeof stockFormSchema>;

/** `POST /v1/product/shop/{shopId}/barcodes/print` caps this at 100 per SKU. */
export const MAX_LABELS_PER_SKU = 100;

export const labelsFormSchema = z.object({
  skuId: z.string(),
  labelCount: wholeNumberField('required').refine(
    (value) => Number(value) >= 1 && Number(value) <= MAX_LABELS_PER_SKU,
    `1–${MAX_LABELS_PER_SKU}`,
  ),
  /* Label types come from GET /v1/product/barcodes/types, so the id is free
     text here and the select is filled from that reference call. */
  barcodeTypeId: z.string().min(1, 'required'),
});

export type LabelsFormValues = z.infer<typeof labelsFormSchema>;

/** The one place a validated form string becomes the number the API wants. */
export function toNumber(value: string): number {
  return Number(value);
}
