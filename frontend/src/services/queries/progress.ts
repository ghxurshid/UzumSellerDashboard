import type { ProgressReporter } from '@/services/uzum/http';

/**
 * Turning several sequential reads into one source's progress.
 *
 * Most of the six sources are not a single paginated call. `products` walks
 * every shop, `orders` walks eight statuses, `invoices` reads three separate
 * collections — and each of those parts only learns its own row total when its
 * first page comes back. Summing raw totals as they are discovered would make
 * the percentage *fall*: a bar at 90% of the first shop drops to 45% the moment
 * the second shop reports how big it is.
 *
 * So two figures are tracked, and they answer different questions:
 *
 *   • `loaded` / `total` are real rows, for the caption. They grow as parts
 *     report, and `total` of 0 honestly means "this route publishes no total".
 *
 *   • `fraction` is the bar, and it is measured in *parts*, which are known up
 *     front. Finishing three of six shops is half way, whatever the row counts
 *     turn out to be, so the bar only ever moves forwards.
 *
 * `fraction` is `null` when nothing can be claimed — a bare-array collection
 * mid-read, where neither rows nor parts have anything to say yet. The UI draws
 * that as an indeterminate bar rather than as zero.
 */

export interface SourceProgress {
  /** Rows read so far across every part. */
  readonly loaded: number;
  /** Rows expected across the parts that have reported one. 0 when unknown. */
  readonly total: number;
  /** How far through the source's parts, 0–1, or null when unknowable. */
  readonly fraction: number | null;
}

export type SourceProgressReporter = (progress: SourceProgress) => void;

export class SourceProgressTracker {
  private bankedRows = 0;
  private bankedTotal = 0;
  private finished = 0;

  /**
   * @param parts How many sequential reads this source makes. Zero is allowed
   *   and means "unknown shape", which reports an indeterminate fraction.
   */
  constructor(
    private readonly parts: number,
    private readonly emit: SourceProgressReporter | undefined,
  ) {}

  /**
   * The page reporter to hand to the read currently in flight.
   *
   * Bound rather than a method so it can be passed directly as a callback
   * without the call site having to preserve `this`.
   */
  readonly page: ProgressReporter = ({ loaded, total }) => {
    if (this.emit === undefined) return;

    const within = total > 0 ? Math.min(1, loaded / total) : 0;
    const known = total > 0 || this.finished > 0;

    this.emit({
      loaded: this.bankedRows + loaded,
      total: this.bankedTotal + total,
      fraction:
        this.parts <= 0 || !known ? null : Math.min(1, (this.finished + within) / this.parts),
    });
  };

  /**
   * Bank a finished part.
   *
   * `total` is floored at the rows actually read: a route that reported no
   * total still contributed rows, and claiming a total below what was read
   * would put the caption above 100%.
   */
  finishPart(rows: number, total = 0): void {
    this.bankedRows += rows;
    this.bankedTotal += Math.max(total, rows);
    this.finished += 1;

    this.emit?.({
      loaded: this.bankedRows,
      total: this.bankedTotal,
      fraction: this.parts <= 0 ? null : Math.min(1, this.finished / this.parts),
    });
  }
}
