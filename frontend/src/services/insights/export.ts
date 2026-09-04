import { buildCsv, downloadBlob, timestampedName } from '@/lib/download';
import type { Translator } from '@/lib/i18n/useTranslation';
import type { Language } from '@/types/domain';

import type { Block } from './blocks';
import { formatFact, type FactTable } from './facts';
import { phrase } from './phrase';
import { renderTemplate } from './template';

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
  facts: FactTable,
  t: Translator,
  language: Language,
  section: string,
  rows: SheetRow[],
): void {
  const resolve = (ref: string): string => {
    const fact = facts.get(ref);
    return fact === undefined ? '' : formatFact(fact, language);
  };

  for (const block of blocks) {
    switch (block.kind) {
      case 'metric':
        rows.push({
          section,
          label: block.label === undefined ? block.ref : phrase(t, block.label),
          value: resolve(block.ref),
        });
        break;

      case 'kv':
        for (const row of block.rows) {
          rows.push({ section, label: phrase(t, row.label), value: resolve(row.ref) });
        }
        break;

      case 'steps':
        for (const item of block.items) {
          rows.push({
            section,
            label: renderTemplate(phrase(t, item.text), facts, language),
            value: item.ref === undefined ? '' : resolve(item.ref),
          });
        }
        break;

      case 'chart':
        for (const step of block.steps ?? []) {
          rows.push({ section, label: phrase(t, step.label), value: resolve(step.ref) });
        }
        break;

      /* A table keeps its own shape: the first column is the label and the
         last is the value, which is how every table in this design is built. */
      case 'table':
        for (const row of block.rows) {
          const cells = row.map((cell) => phrase(t, cell));
          rows.push({
            section,
            label: cells[0] ?? '',
            value: cells.slice(1).join(' · '),
          });
        }
        break;

      case 'callout':
        collect(block.blocks, facts, t, language, phrase(t, block.title), rows);
        break;

      /* Prose, pills, buttons and the read trace state nothing a cell can
         hold — and the trace in particular belongs to the conversation rather
         than to the answer being exported. */
      case 'text':
      case 'badges':
      case 'action':
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
  readonly facts: FactTable;
  readonly t: Translator;
  readonly language: Language;
  readonly title: string;
}): Promise<void> {
  const rows: SheetRow[] = [];
  collect(options.blocks, options.facts, options.t, options.language, options.title, rows);

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
