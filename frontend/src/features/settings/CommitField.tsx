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
 */
export function CommitField({
  label,
  value,
  placeholder,
  optional = false,
  mono = false,
  onCommit,
}: {
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly optional?: boolean;
  readonly mono?: boolean;
  readonly onCommit: (value: string) => void;
}): ReactNode {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);

  /* While the field is focused the draft owns the value; otherwise the store
     does, so a reset or an adapter switch is reflected immediately. */
  const shown = focused ? draft : value;

  return (
    <TextField
      label={optional ? `${label} · ${t('optional')}` : label}
      value={shown}
      {...(placeholder !== undefined ? { placeholder } : {})}
      spellCheck={false}
      autoComplete="off"
      className={mono ? 'font-mono' : undefined}
      onFocus={() => {
        setDraft(value);
        setFocused(true);
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        setFocused(false);
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(value);
          setFocused(false);
        }
      }}
    />
  );
}
