import { useState, type ReactNode } from 'react';

import { TextField } from '@/components/ui/Field';
import { useTranslation } from '@/lib/i18n/useTranslation';

/**
 * A text field that keeps its edit in local state and commits on blur.
 *
 * Writing through on every keystroke would let a half-typed URL or model id
 * reach the sanitiser, which restores the default the moment the field goes
 * empty — the value would fight the person typing it. Shared by `AiSettings`
 * (base URL, org id) and `AiModelField` (a typed model id), so the two never
 * grow slightly different commit behaviour.
 *
 * `validate` is checked before `onCommit` runs, not after — a value several of
 * this pane's fields (`orgId`, `projectId`, `anthropicVersion`, `appUrl`,
 * `appTitle`) become an HTTP header, and `fetch` throws on anything outside
 * printable ASCII, so a seller who pastes a title with a curly quote or a
 * Cyrillic letter needs to be told *before* it reaches storage and breaks
 * every request the provider gets from then on, not after.
 */
export function CommitField({
  label,
  value,
  placeholder,
  optional = false,
  mono = false,
  validate,
  onCommit,
}: {
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly optional?: boolean;
  readonly mono?: boolean;
  /** Returns an error message to block the commit, or `null` to allow it. */
  readonly validate?: (value: string) => string | null;
  readonly onCommit: (value: string) => void;
}): ReactNode {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* While the field is focused the draft owns the value; otherwise the store
     does, so a reset or an adapter switch is reflected immediately. */
  const shown = focused ? draft : value;

  const commit = (next: string): void => {
    if (next === value) return;
    const problem = validate?.(next) ?? null;
    if (problem !== null) {
      setError(problem);
      return;
    }
    setError(null);
    onCommit(next);
  };

  return (
    <TextField
      label={optional ? `${label} · ${t('optional')}` : label}
      value={shown}
      {...(placeholder !== undefined ? { placeholder } : {})}
      spellCheck={false}
      autoComplete="off"
      className={mono ? 'font-mono' : undefined}
      error={error ?? undefined}
      onFocus={() => {
        setDraft(value);
        setFocused(true);
        setError(null);
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        setFocused(false);
        commit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(value);
          setFocused(false);
          setError(null);
        }
      }}
    />
  );
}
