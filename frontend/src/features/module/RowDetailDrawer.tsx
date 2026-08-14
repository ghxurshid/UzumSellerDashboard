import type { ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Icon } from '@/components/ui/Icon';
import type { TranslationKey } from '@/lib/i18n/dictionary';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import type { ModuleRow, ModuleRowAction, Tone } from '@/types/domain';

const TONE_TEXT: Record<Tone, string> = {
  positive: 'text-pos',
  negative: 'text-neg',
  warning: 'text-warn',
  accent: 'text-acc-dim',
  neutral: 'text-dim',
};

interface RowDetailDrawerProps {
  readonly row: ModuleRow | null;
  readonly onClose: () => void;
  readonly onRunAction: (row: ModuleRow, action: ModuleRowAction) => void;
}

/** The same detail the inline expander shows, in a focus-trapped side panel. */
export function RowDetailDrawer({ row, onClose, onRunAction }: RowDetailDrawerProps): ReactNode {
  const { t } = useTranslation();

  return (
    <Drawer
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={row?.id ?? ''}
      subtitle={row?.detail.actions[0]?.endpoint ?? t('openRow')}
      footer={
        row === null ? undefined : (
          <>
            <Button size="lg" onClick={onClose}>
              {t('mClose')}
            </Button>
            {row.detail.actions
              .filter((action) => action.primary === true)
              .map((action) => (
                <Button
                  key={action.act}
                  variant="primary"
                  size="lg"
                  disabled={action.disabled === true}
                  icon={<Icon name={action.icon} className="size-12" />}
                  onClick={() => onRunAction(row, action)}
                >
                  {t(action.labelKey as TranslationKey)}
                </Button>
              ))}
          </>
        )
      }
    >
      {row !== null && (
        <div className="flex flex-col gap-14">
          <p className="m-0 text-xs-plus leading-[1.6] text-dim">{row.detail.note}</p>

          <dl className="grid grid-cols-2 gap-12">
            {row.detail.facts.map((fact) => (
              <div key={fact.label} className="flex flex-col gap-2">
                <dt className="font-mono text-meta uppercase tracking-[0.09em] text-faint">
                  {fact.label}
                </dt>
                <dd data-numeric className="m-0 text-lg">
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-col gap-5">
            {row.detail.list.map((item, index) => (
              <span
                key={`${row.id}-drawer-${index}`}
                className="flex items-center gap-9 rounded-8 border border-line px-9 py-7 text-xs-plus"
              >
                <Icon name={item.icon} className={cn('size-12 shrink-0', TONE_TEXT[item.tone])} />
                <span className="font-mono text-dim">{item.text}</span>
                <span className="flex-1" />
                <span data-numeric>{item.value}</span>
                <span className="min-w-52 text-right text-tiny text-faint">{item.time}</span>
              </span>
            ))}
          </div>

          <div className="flex flex-wrap gap-6 border-t border-line pt-12">
            {row.detail.actions
              .filter((action) => action.primary !== true)
              .map((action) => (
                <Button
                  key={action.act}
                  size="md"
                  disabled={action.disabled === true}
                  icon={<Icon name={action.icon} className="size-12" />}
                  onClick={() => onRunAction(row, action)}
                >
                  {t(action.labelKey as TranslationKey)}
                </Button>
              ))}
          </div>
        </div>
      )}
    </Drawer>
  );
}
