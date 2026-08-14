import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Last-resort fallback.
 *
 * Rendered outside every provider, so it cannot use `useTranslation` — the
 * copy is inlined in the three interface languages rather than risking a
 * second throw while reporting the first.
 */
export function RootErrorFallback({
  error,
  onReset,
}: {
  readonly error: Error;
  readonly onReset: () => void;
}): ReactNode {
  return (
    <div className="flex h-full items-center justify-center bg-backdrop p-40 text-text">
      <div className="flex max-w-430 flex-col items-start gap-12">
        <span className="flex size-44 items-center justify-center rounded-11 border border-neg-line bg-neg-soft text-neg">
          <TriangleAlert aria-hidden className="size-20" />
        </span>
        <h1 className="text-xl font-medium tracking-[-0.02em]">Savdo — kutilmagan xato</h1>
        <p className="text-sm-plus leading-[1.6] text-dim">
          Interfeys yuklanmadi. Qayta urinib ko‘ring — ma’lumotlaringizga hech nima bo‘lmadi.
          <br />
          Интерфейс не загрузился. Попробуйте снова — данные не затронуты.
          <br />
          The interface failed to load. Retrying is safe — nothing was written.
        </p>
        <button
          type="button"
          onClick={onReset}
          className="h-30 cursor-pointer rounded-7 border border-acc bg-acc-soft px-14 text-sm font-medium text-acc-dim hover:bg-acc-strong"
        >
          Qayta urinish · Повторить · Retry
        </button>
        <p className="w-full border-t border-line pt-10 font-mono text-mini text-faint">
          {error.message}
        </p>
      </div>
    </div>
  );
}
