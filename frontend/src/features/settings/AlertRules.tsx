import { BellRing, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { IconButton } from '@/components/ui/IconButton';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { formatStamp } from '@/lib/format';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useAlertsStore } from '@/store/alerts.store';

/**
 * The standing rules, where they can be seen and switched off.
 *
 * The rules are set in the chat, which is the right place to *state* one — a
 * seller says "tell me when a SKU runs out" far more readily than they fill in
 * a form. It is the wrong place to *find* one afterwards: a rule set three
 * weeks ago is buried in a transcript, and a notification whose cause the
 * seller cannot locate is a notification they cannot stop.
 *
 * So this pane is the register. It shows nothing the chat cannot also report —
 * `alerts.list` reads the same rules — but it is where a rule is switched off
 * without having to ask for it in words.
 */
export function AlertRules(): ReactNode {
  const { t } = useTranslation();
  const rules = useAlertsStore((state) => state.rules);
  const remove = useAlertsStore((state) => state.remove);

  return (
    <Panel>
      <PanelHeader
        title={t('alTitle')}
        meta={rules.length === 0 ? undefined : String(rules.length)}
      />

      <div className="flex flex-col gap-9 px-14 py-12">
        {rules.length === 0 ? (
          <p className="m-0 max-w-680 text-xs-plus leading-[1.6] text-dim">{t('alEmpty')}</p>
        ) : (
          rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center gap-9 border-b border-line pb-8 last:border-b-0 last:pb-0"
            >
              <BellRing aria-hidden className="size-13 shrink-0 text-acc-dim" />

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="font-mono text-xs text-text">{rule.kind}</span>
                <span className="text-tiny text-faint">
                  {/* The threshold is stated raw and in the unit the rule uses,
                      because a rule the seller cannot read is one they cannot
                      trust to be watching the right line. */}
                  <span data-numeric>{rule.threshold}</span>
                  {' · '}
                  {rule.lastFiredAt === null
                    ? t('alNeverFired')
                    : t('alLastFired', { when: formatStamp(rule.lastFiredAt) })}
                </span>
              </div>

              <IconButton label={t('iaAlertOff')} size="xs" onClick={() => remove(rule.kind)}>
                <Trash2 aria-hidden className="size-12" />
              </IconButton>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}
