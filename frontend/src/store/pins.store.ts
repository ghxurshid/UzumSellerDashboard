import { create } from 'zustand';

import { MAX_PINS, type PinnedAnswer } from '@/services/insights/pins';
import { readKv, writeKv } from '@/services/storage/idb/kv.repo';
import { KV_KEYS } from '@/services/storage/idb/schema';

/**
 * Answers kept on the dashboard.
 *
 * Stored in the same `kv` slot the notification log uses, for the same reason:
 * this is one document, rewritten whole, with no timestamp worth indexing. It
 * survives a reload because a card the seller pinned in the morning should
 * still be there after lunch.
 *
 * Persistence is unawaited. The card is on screen the moment the store updates;
 * blocking that on a disk write would delay the visible half of the feature for
 * the sake of the invisible half, and a pin lost to a failed write costs one
 * click to make again.
 */

interface PinsState {
  readonly pins: readonly PinnedAnswer[];
  /** True once the stored list has been read, so an empty rail is honest. */
  readonly loaded: boolean;
  add: (pin: PinnedAnswer) => void;
  remove: (id: string) => void;
  clear: () => void;
}

function persist(pins: readonly PinnedAnswer[]): void {
  void writeKv(KV_KEYS.pins, pins).catch(() => {
    /* Losing a pin costs a click, not correctness. */
  });
}

export const usePinsStore = create<PinsState>()((set, get) => ({
  pins: [],
  loaded: false,

  add: (pin) => {
    /* Newest first, and the oldest falls off the end: a dashboard that grows
       without limit stops being a dashboard. */
    const pins = [pin, ...get().pins.filter((entry) => entry.id !== pin.id)].slice(0, MAX_PINS);
    set({ pins });
    persist(pins);
  },

  remove: (id) => {
    const pins = get().pins.filter((entry) => entry.id !== id);
    set({ pins });
    persist(pins);
  },

  clear: () => {
    set({ pins: [] });
    persist([]);
  },
}));

/** Load the stored pins. Called once, from `bootstrap()`. */
export async function restorePins(): Promise<void> {
  try {
    const stored = await readKv<unknown>(KV_KEYS.pins);
    const pins = Array.isArray(stored) ? (stored as PinnedAnswer[]) : [];

    /* Written by an older build, or by a build that stored a shape this one no
       longer understands: keep only entries that still have the two things a
       card cannot be drawn without. */
    const usable = pins.filter(
      (pin) =>
        pin !== null &&
        typeof pin === 'object' &&
        typeof pin.id === 'string' &&
        Array.isArray(pin.blocks),
    );

    applyPins(usable.slice(0, MAX_PINS));
  } catch {
    applyPins([]);
  }
}

function applyPins(pins: readonly PinnedAnswer[]): void {
  usePinsStore.setState({ pins, loaded: true });
}
