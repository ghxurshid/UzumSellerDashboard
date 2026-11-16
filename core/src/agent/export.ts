import { buildCsv, downloadBlob, timestampedName } from '@core/lib/download';
import type { Translator } from '@core/i18n/useTranslation';
import type { Language } from '@core/types/common';

import type { Block } from './blocks';
import {
  changeFrom,
  compareRow,
  formatChange,
  formatFigure,
  rankOrder,
  shareOf,
} from './figures';
import { phrase } from './phrase';

/**
 * Taking an answer out of the panel.
 *
 * This is the quiet payoff of composing answers as documents. A transcript of
 * strings can be copied; a transcript of blocks can be *re-rendered* — into
 * spreadsheet rows, into a printable page, into whatever the next surface
 * needs — because the numbers are still numbers and the tables are still
 * tables.
 *
 * ## Why there is no PDF library here
 *
 * The PDFs this application already produces come from Uzum's own print
 * endpoints; nothing generates one in the browser. Adding jsPDF to do so would
 * cost about as much as the charting library `RevenueChart` declined, to
 * reproduce a page the browser can already lay out and export. So *PDF* opens
 * the print dialog against a print stylesheet, and the user gets a real PDF via
 * the path their operating system already has.
 */

/** Flattens whatever a block states into label/value rows a sheet can hold. */
interface SheetRow {
  readonly section: string;
  readonly label: string;
  readonly value: string;
}

function collect(
  blocks: readonly Block[],
  t: Translator,
  language: Language,
  section: string,
  rows: SheetRow[],
): void {
  for (const block of blocks) {
    switch (block.kind) {
      case 'metric':
        rows.push({
          section,
          label: block.label === undefined ? '' : phrase(t, block.label),
          value: `${formatFigure(block.value, block.format, language)}${
            block.change === undefined ? '' : ` (${formatChange(block.change)})`
          }`,
        });
        break;

      /* A tile goes out the way a lone metric does, with the change the
         screen derived written beside the figure it belongs to. */
      case 'metrics':
        for (const item of block.items) {
          const change = changeFrom(item.value, item.previous);
          rows.push({
            section,
            label: phrase(t, item.label),
            value: `${formatFigure(item.value, item.format, language)}${
              change === null ? '' : ` (${formatChange(change)})`
            }`,
          });
        }
        break;

      case 'kv':
        for (const row of block.rows) {
          rows.push({
            section,
            label: phrase(t, row.label),
            value: formatFigure(row.value, row.format, language),
          });
        }
        break;

      /* Part, whole and share in one cell — the three the row shows on screen. */
      case 'progress':
        for (const row of block.rows) {
          const share = shareOf(row.value, row.total);
          rows.push({
            section,
            label: phrase(t, row.label),
            value: `${formatFigure(row.value, row.format, language)} / ${formatFigure(row.total, row.format, language)}${
              share === null ? '' : ` (${formatFigure(share, 'percent', language)})`
            }`,
          });
        }
        break;

      /* In ranked order with the place in front, so the sheet reads as the
         ranking the screen drew rather than as the list the author wrote. */
      case 'rank': {
        const title = block.title === undefined ? section : phrase(t, block.title);
        for (const { sourceIndex, place } of rankOrder(
          block.items.map((item) => item.value),
          block.order,
        )) {
          const item = block.items[sourceIndex];
          if (item === undefined) continue;
          rows.push({
            section: title,
            label: `${place}. ${phrase(t, item.label)}`,
            value: formatFigure(item.value, block.format, language),
          });
        }
        break;
      }

      case 'steps':
        for (const item of block.items) {
          rows.push({
            section,
            label: phrase(t, item.text),
            value: item.value === undefined ? '' : formatFigure(item.value, item.format, language),
          });
        }
        break;

      case 'chart': {
        const title = block.title === undefined ? section : phrase(t, block.title);
        for (const item of block.items ?? []) {
          rows.push({
            section: title,
            label: phrase(t, item.label),
            value: formatFigure(item.value, block.format, language),
          });
        }
        /* A line goes out a row per bucket and a column per series would need a
           second sheet shape; one row per bucket and series keeps the three
           columns every other block fills. */
        for (const series of block.series ?? []) {
          block.labels?.forEach((label, index) => {
            const value = series.values[index];
            if (value === undefined) return;
            rows.push({
              section: `${title} · ${phrase(t, series.name)}`,
              label,
              value: formatFigure(value, block.format, language),
            });
          });
        }
        break;
      }

      /* A product is a section of its own, a row per figure, with where it
         stands as the first of them. */
      case 'product': {
        const title = phrase(t, block.title);
        if (block.status !== undefined) {
          rows.push({ section: title, label: '', value: phrase(t, block.status.text) });
        }
        for (const figure of block.figures ?? []) {
          rows.push({
            section: title,
            label: phrase(t, figure.label),
            value: formatFigure(figure.value, figure.format, language),
          });
        }
        break;
      }

      /* Both sides and the gap in one cell, named, so a row lifted out of the
         sheet still says which figure belongs to which side. */
      case 'compare': {
        const nameA = phrase(t, block.a);
        const nameB = phrase(t, block.b);
        const title = block.title === undefined ? `${nameA} / ${nameB}` : phrase(t, block.title);
        for (const row of block.rows) {
          const { change } = compareRow(row.a, row.b, row.better);
          rows.push({
            section: title,
            label: phrase(t, row.label),
            value: `${nameA}: ${formatFigure(row.a, row.format, language)} · ${nameB}: ${formatFigure(row.b, row.format, language)}${
              change === null ? '' : ` (${formatChange(change)})`
            }`,
          });
        }
        break;
      }

      /* A table keeps its own shape: the first column is the label and the
         rest are the value, formatted by the column's own format. */
      case 'table':
        for (const row of block.rows) {
          const cells = row.map((cell, index) =>
            typeof cell === 'number'
              ? formatFigure(cell, block.formats?.[index], language)
              : phrase(t, cell),
          );
          rows.push({ section, label: cells[0] ?? '', value: cells.slice(1).join(' · ') });
        }
        break;

      case 'callout':
        collect(block.blocks, t, language, phrase(t, block.title), rows);
        break;

      /* Prose, pills, buttons, a question asked back and the read trace state
         nothing a cell can hold — and the trace and the question in particular
         belong to the conversation rather than to the answer being exported. */
      case 'text':
      case 'badges':
      case 'action':
      case 'choice':
      case 'trace':
        break;
    }
  }
}

/**
 * The answer as a spreadsheet.
 *
 * Numbers go out formatted rather than raw, because the destination is a person
 * reconciling against the Uzum dashboard, not a pipeline — and the formatted
 * figure is the one they will see on the other screen.
 */
export async function exportAnswerCsv(options: {
  readonly blocks: readonly Block[];
  readonly t: Translator;
  readonly language: Language;
  readonly title: string;
}): Promise<void> {
  const rows: SheetRow[] = [];
  collect(options.blocks, options.t, options.language, options.title, rows);

  if (rows.length === 0) return;

  const blob = await buildCsv<SheetRow>({
    rows,
    columns: [
      { header: 'Section', value: (row) => row.section },
      { header: 'Label', value: (row) => row.label },
      { header: 'Value', value: (row) => row.value },
    ],
  });

  downloadBlob(blob, timestampedName('copilot-answer', 'csv'));
}

/**
 * Hand the answer to the browser's own print pipeline.
 *
 * `print-answer` is set on the element for the duration of the call; the print
 * stylesheet in `globals.css` hides everything else, so what reaches the paper
 * is the one answer rather than the whole application chrome around it.
 */
export function printAnswer(node: HTMLElement | null): void {
  if (node === null) return;

  node.setAttribute('data-print-target', '');
  document.body.setAttribute('data-printing', '');

  const cleanup = (): void => {
    node.removeAttribute('data-print-target');
    document.body.removeAttribute('data-printing');
    window.removeEventListener('afterprint', cleanup);
  };

  window.addEventListener('afterprint', cleanup);
  window.print();
}
