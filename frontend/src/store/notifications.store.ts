import { create } from 'zustand';

import { raiseCriticalAlert } from '@/lib/alerts';
import { readKv, writeKv } from '@/services/storage/idb/kv.repo';
import { KV_KEYS } from '@/services/storage/idb/schema';
import type { Notification, Tone } from '@/types/domain';

/**
 * The notification log.
 *
 * Entries are appended when something happens — a sync lands or fails, a write
 * is rejected, the token stops being accepted. Nothing is seeded: a new install
 * has an empty bell, and that is the correct thing for it to show.
 *
 * The log is capped and persisted, so a user who closes the panel mid-sync
 * still finds out how it ended.
 *
 * Persistence is asynchronous now, and deliberately unawaited. A notification
 * has already been raised by the time the write goes out — the bell shows it,
 * the toast fires — so blocking on the disk would delay the visible half of the
 * feature for the sake of the invisible half.
 */

const MAX_ENTRIES = 50;

export interface NotifyOptions {
  readonly icon?: string;
  readonly tone?: Tone;
  /** Replaces an existing entry with the same key instead of stacking. */
  readonly dedupeKey?: string;
}

interface NotificationsState {
  readonly items: readonly Notification[];
  notify: (text: string, options?: NotifyOptions) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
}

/** Load the stored log into the store. Called once, from `bootstrap()`. */
export async function restoreNotifications(): Promise<void> {
  try {
    const stored = await readKv<unknown>(KV_KEYS.notifications);
    if (!Array.isArray(stored)) return;

    useNotificationsStore.setState({
      items: (stored as Notification[]).slice(0, MAX_ENTRIES),
    });
  } catch {
    /* A log that cannot be read is an empty bell, which is what a new install
       shows anyway. Nothing to recover and nothing to report. */
  }
}

function persist(items: readonly Notification[]): void {
  void writeKv(KV_KEYS.notifications, items).catch(() => {
    /* Losing the log costs history, not correctness. */
  });
}

export const useNotificationsStore = create<NotificationsState>()((set, get) => ({
  items: [],

  notify: (text, options = {}) => {
    const entry: Notification = {
      id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      at: Date.now(),
      icon: options.icon ?? 'info',
      tone: options.tone ?? 'accent',
      read: false,
    };

    set((state) => {
      /* A repeating condition — the same source failing on every retry —
         should update its entry, not fill the panel with copies of itself. */
      const withoutDuplicate =
        options.dedupeKey === undefined
          ? state.items
          : state.items.filter((item) => !item.id.startsWith(`n-${options.dedupeKey}`));

      const id =
        options.dedupeKey === undefined ? entry.id : `n-${options.dedupeKey}-${entry.at}`;

      return { items: [{ ...entry, id }, ...withoutDuplicate].slice(0, MAX_ENTRIES) };
    });

    persist(get().items);

    /* A negative event is the only kind worth interrupting the user for, and
       only if they turned that on in Settings. */
    if (entry.tone === 'negative') raiseCriticalAlert(text);
  },

  markRead: (id) => {
    set((state) => ({
      items: state.items.map((item) => (item.id === id ? { ...item, read: true } : item)),
    }));
    persist(get().items);
  },

  markAllRead: () => {
    set((state) => ({ items: state.items.map((item) => ({ ...item, read: true })) }));
    persist(get().items);
  },

  clear: () => {
    set({ items: [] });
    persist([]);
  },
}));

/** Imperative entry point for non-React callers. */
export const notify = (text: string, options?: NotifyOptions): void =>
  useNotificationsStore.getState().notify(text, options);

export const selectUnreadCount = (state: NotificationsState): number =>
  state.items.filter((item) => !item.read).length;
