import { create } from 'zustand';

import {
  defaultThreshold,
  ALERT_KINDS,
  type AlertKind,
  type AlertRule,
} from '@/services/insights/alerts';
import { readKv, writeKv } from '@/services/storage/idb/kv.repo';
import { KV_KEYS } from '@/services/storage/idb/schema';

/**
 * The standing rules, and what each of them last said.
 *
 * Persisted like the notification log and for the same reason: a rule the
 * seller set on Monday is worthless if it does not survive to Tuesday. The
 * firing state — when it last fired and on what — is stored with the rule
 * rather than beside it, because a rule that forgets what it announced starts
 * announcing it again on the next reload.
 */

/** More than this and the bell is the problem rather than the solution. */
const MAX_RULES = 8;

interface AlertsState {
  readonly rules: readonly AlertRule[];
  /** Add or replace — one rule per kind, since two would fire together. */
  upsert: (kind: AlertKind, threshold?: number) => AlertRule;
  remove: (kind: AlertKind | null) => number;
  /** Record that a rule fired, with what it found. */
  markFired: (id: string, signature: string, at: number) => void;
}

function persist(rules: readonly AlertRule[]): void {
  void writeKv(KV_KEYS.alerts, rules).catch(() => {
    /* A lost rule costs a sentence in the chat to set again. */
  });
}

export const useAlertsStore = create<AlertsState>()((set, get) => ({
  rules: [],

  upsert: (kind, threshold) => {
    const rule: AlertRule = {
      id: `al-${kind}`,
      kind,
      threshold: threshold ?? defaultThreshold(kind),
      createdAt: Date.now(),
      lastFiredAt: null,
      lastSignature: null,
    };

    /* Keyed by kind, so "tell me when stock is below 5" replaces "below 3"
       rather than leaving both to fire at once about the same shelf. */
    const rules = [...get().rules.filter((entry) => entry.kind !== kind), rule].slice(
      0,
      MAX_RULES,
    );

    set({ rules });
    persist(rules);
    return rule;
  },

  remove: (kind) => {
    const before = get().rules.length;
    const rules = kind === null ? [] : get().rules.filter((entry) => entry.kind !== kind);
    set({ rules });
    persist(rules);
    return before - rules.length;
  },

  markFired: (id, signature, at) => {
    const rules = get().rules.map((rule) =>
      rule.id === id ? { ...rule, lastFiredAt: at, lastSignature: signature } : rule,
    );
    set({ rules });
    persist(rules);
  },
}));

/** Load the stored rules. Called once, from `bootstrap()`. */
export async function restoreAlerts(): Promise<void> {
  try {
    const stored = await readKv<unknown>(KV_KEYS.alerts);
    if (!Array.isArray(stored)) return;

    const rules = (stored as AlertRule[]).filter(
      (rule) =>
        rule !== null &&
        typeof rule === 'object' &&
        typeof rule.id === 'string' &&
        (ALERT_KINDS as readonly string[]).includes(rule.kind) &&
        typeof rule.threshold === 'number',
    );

    useAlertsStore.setState({ rules: rules.slice(0, MAX_RULES) });
  } catch {
    /* Rules that cannot be read are no rules, which is what a new install has. */
  }
}
