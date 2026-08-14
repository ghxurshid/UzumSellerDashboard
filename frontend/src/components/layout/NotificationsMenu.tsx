import type { ReactNode } from 'react';

import { Icon } from '@/components/ui/Icon';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { useNotificationsStore } from '@/store/notifications.store';
import type { Tone } from '@/types/domain';

import { MenuSurface } from './MenuSurface';

const TONE_TEXT: Record<Tone, string> = {
  positive: 'text-pos',
  negative: 'text-neg',
  warning: 'text-warn',
  accent: 'text-acc-dim',
  neutral: 'text-dim',
};

/** Relative age, recomputed on render — the log stores an instant, not a label. */
function ageOf(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

interface NotificationsMenuProps {
  readonly open: boolean;
  readonly onOpenChange: () => void;
  readonly trigger: ReactNode;
}

/**
 * The event log.
 *
 * Entries appear when something happens — a sync landing or failing, a write
 * being rejected. An empty panel is the correct state for a quiet account, so
 * it says so rather than filling itself with examples.
 */
export function NotificationsMenu({
  open,
  onOpenChange,
  trigger,
}: NotificationsMenuProps): ReactNode {
  const { t } = useTranslation();

  const items = useNotificationsStore((state) => state.items);
  const markRead = useNotificationsStore((state) => state.markRead);
  const markAllRead = useNotificationsStore((state) => state.markAllRead);

  const allRead = items.every((item) => item.read);

  return (
    <MenuSurface
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
      width="w-314"
      align="end"
    >
      <div className="flex items-center gap-8 border-b border-line px-11 py-9 text-xs-plus">
        <span className="font-medium">{t('notifs')}</span>
        <div className="flex-1" />
        {items.length > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            className="cursor-pointer border-0 bg-transparent p-0 text-xs text-acc-dim"
          >
            {t('markRead')}
          </button>
        )}
      </div>

      {items.length === 0 && (
        <p className="m-0 px-11 py-14 text-center text-xs text-faint">{t('emptyNotifs')}</p>
      )}

      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => markRead(item.id)}
          className={cn(
            'flex w-full cursor-pointer gap-9 border-0 border-b border-line px-11 py-9 text-left transition-colors hover:bg-acc-soft',
            item.read ? 'bg-transparent' : 'bg-acc-soft/40',
          )}
        >
          <Icon name={item.icon} className={cn('mt-px size-14 shrink-0', TONE_TEXT[item.tone])} />
          <span className="flex min-w-0 flex-col gap-2">
            <span className="text-xs-plus leading-[1.4]">{item.text}</span>
            <span data-numeric className="text-tiny text-faint">
              {ageOf(item.at)}
            </span>
          </span>
        </button>
      ))}

      {allRead && items.length > 0 && (
        <p className="m-0 px-11 py-10 text-center text-xs text-faint">{t('allRead')}</p>
      )}
    </MenuSurface>
  );
}
