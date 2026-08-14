/**
 * File output.
 *
 * Two things leave the application as files: a CSV the browser builds from the
 * rows already on screen, and a PDF the seller API returns Base64-encoded.
 * Both end in a real Blob and a real download — there is no export service to
 * call, and no step here is simulated.
 */

/** Rows are serialised in chunks so a large export can report real progress. */
const CHUNK_ROWS = 200;

export interface CsvColumn<T> {
  readonly header: string;
  readonly value: (row: T) => string | number;
}

export interface CsvOptions<T> {
  readonly rows: readonly T[];
  readonly columns: readonly CsvColumn<T>[];
  readonly report?: (done: number, total: number) => void;
  readonly signal?: AbortSignal;
}

/** Escapes a field for RFC 4180 — quotes doubled, the whole field quoted. */
function escape(value: string | number): string {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

/**
 * Serialise rows to CSV, yielding to the event loop between chunks so the
 * window keeps responding and the progress bar can actually repaint.
 */
export async function buildCsv<T>(options: CsvOptions<T>): Promise<Blob> {
  const { rows, columns, report, signal } = options;
  const lines: string[] = [columns.map((column) => escape(column.header)).join(',')];

  for (let index = 0; index < rows.length; index += CHUNK_ROWS) {
    if (signal?.aborted === true) throw new CancelledError();

    const chunk = rows.slice(index, index + CHUNK_ROWS);
    for (const row of chunk) {
      lines.push(columns.map((column) => escape(column.value(row))).join(','));
    }

    report?.(Math.min(index + CHUNK_ROWS, rows.length), rows.length);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  report?.(rows.length, rows.length);

  /* Excel reads a UTF-8 CSV as the system codepage unless it finds a BOM, and
     every SKU title in this catalogue is non-ASCII. */
  return new Blob(['﻿', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
}

/** Decode the Base64 payload the print endpoints return into a PDF blob. */
export function base64ToPdf(base64: string): Blob {
  /* The API sometimes returns a data: URI and sometimes the bare payload. */
  const payload = base64.includes(',') ? (base64.split(',')[1] ?? '') : base64;
  const binary = atob(payload.trim());

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: 'application/pdf' });
}

/** Hand a blob to the browser as a download and release the object URL. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  /* Revoking immediately can cancel the download in some browsers; one turn of
     the event loop is enough for the navigation to have started. */
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** `savdo-finance-2026-08-11.csv` — sortable, and says what it holds. */
export function timestampedName(prefix: string, extension: string): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  return `savdo-${prefix}-${date}-${time}.${extension}`;
}
