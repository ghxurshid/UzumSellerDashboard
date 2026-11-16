import type { ReactNode } from 'react';

import { Panel } from '@core/ui/kit/Panel';
import type { TranslationKey } from '@core/i18n/dictionary';
import { useTranslation } from '@core/i18n/useTranslation';

export interface Shortcut {
  readonly keys: readonly string[];
  readonly labelKey: TranslationKey;
}

interface KeyboardSettingsProps {
  /**
   * The shortcuts this host binds, in the order a new user meets them.
   *
   * A list a host did not bind would be a promise the keyboard does not keep, so
   * the pane draws what it is given rather than a fixed table.
   */
  readonly shortcuts: readonly Shortcut[];
}

export function KeyboardSettings({ shortcuts }: KeyboardSettingsProps): ReactNode {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-3">
        <h1 className="m-0 text-xl font-medium tracking-[-0.02em]">{t('sKeys')}</h1>
        <p className="m-0 text-xs-plus text-dim">{t('keysSub')}</p>
      </header>

      <Panel className="overflow-hidden">
        <dl className="m-0">
          {shortcuts.map((shortcut) => (
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
