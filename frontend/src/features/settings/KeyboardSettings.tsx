import type { ReactNode } from 'react';

import { Panel } from '@/components/ui/Panel';
import type { TranslationKey } from '@/lib/i18n/dictionary';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface Shortcut {
  readonly keys: readonly string[];
  readonly labelKey: TranslationKey;
}

/** Every shortcut the app binds, in the order a new user meets them. */
const SHORTCUTS: readonly Shortcut[] = [
  { keys: ['⌘', 'K'], labelKey: 'palPh' },
  { keys: ['⌘', 'J'], labelKey: 'askCopilot' },
  { keys: ['↑', '↓'], labelKey: 'palNav' },
  { keys: ['↵'], labelKey: 'palOpen' },
  { keys: ['Esc'], labelKey: 'mClose' },
  { keys: ['Tab'], labelKey: 'gGo' },
  { keys: ['Space'], labelKey: 'selectedL' },
  { keys: ['⇧', 'F10'], labelKey: 'gAct' },
];

export function KeyboardSettings(): ReactNode {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-3">
        <h1 className="m-0 text-xl font-medium tracking-[-0.02em]">{t('sKeys')}</h1>
        <p className="m-0 text-xs-plus text-dim">{t('keysSub')}</p>
      </header>

      <Panel className="overflow-hidden">
        <dl className="m-0">
          {SHORTCUTS.map((shortcut) => (
            <div
              key={shortcut.keys.join('+')}
              className="grid grid-cols-1 items-center gap-8 border-b border-line px-11 py-11 last:border-b-0 sm:px-14 min-[720px]:grid-cols-[220px_minmax(0,1fr)] min-[720px]:gap-14"
            >
              <dt className="flex gap-4">
                {shortcut.keys.map((key) => (
                  <kbd
                    key={key}
                    className="rounded-5 border border-line-2 bg-ground px-7 py-2 font-sans text-xs text-dim"
                  >
                    {key}
                  </kbd>
                ))}
              </dt>
              <dd className="m-0 text-sm-plus text-dim">{t(shortcut.labelKey)}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  );
}
