import { Copy, Eye, EyeOff } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';

/**
 * The design's credential control: a masked, read-only display with reveal,
 * copy and Replace, which flips to an edit row with Save and Cancel.
 *
 * A secret is never sitting in an editable input by accident — changing one is
 * a deliberate two-step act, and the value on screen is dots until asked for.
 */

const CONTROL = 'h-32 rounded-7 border border-line-2 bg-ground text-xs-plus';
const ICON_BUTTON = cn(
  CONTROL,
  'flex w-32 shrink-0 cursor-pointer items-center justify-center bg-transparent text-dim',
  'transition-colors hover:border-acc-line hover:text-acc-dim',
);
const TEXT_BUTTON = cn(
  CONTROL,
  'shrink-0 cursor-pointer bg-transparent px-10 text-dim',
  'transition-colors hover:border-acc-line hover:text-acc-dim',
);

/** Dots plus the last four characters — enough to tell two keys apart. */
function maskSecret(value: string): string {
  if (value === '') return '';
  return '•'.repeat(20) + value.slice(-4);
}

interface CredentialFieldProps {
  readonly label: string;
  readonly value: string;
  readonly placeholder: string;
  /** Empty-state text for the masked display when nothing is stored yet. */
  readonly emptyLabel: string;
  readonly hint?: string;
  readonly masked: boolean;
  readonly copyable?: boolean;
  readonly onCommit: (value: string) => void;
  readonly onCopy?: () => void;
}

export function CredentialField({
  label,
  value,
  placeholder,
  emptyLabel,
  hint,
  masked,
  copyable = false,
  onCommit,
  onCopy,
}: CredentialFieldProps): ReactNode {
  const { t } = useTranslation();

  const [editing, setEditing] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [draft, setDraft] = useState(value);

  /* Never leave a secret revealed once the flag says mask, and never keep a
     stale draft after the stored value changes underneath (reset, migration). */
  useEffect(() => {
    if (masked) setRevealed(false);
  }, [masked]);

  useEffect(() => {
    setDraft(value);
    setEditing(false);
  }, [value]);

  const shown = revealed || !masked;
  const display = value === '' ? emptyLabel : shown ? value : maskSecret(value);

  return (
    <div className="flex flex-col gap-4">
      <span className="text-xs text-dim">{label}</span>

      {editing ? (
        <div className="flex gap-6">
          <input
            autoFocus
            value={draft}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onCommit(draft);
              if (event.key === 'Escape') {
                setDraft(value);
                setEditing(false);
              }
            }}
            className={cn(
              CONTROL,
              'min-w-0 flex-1 border-acc-line px-10 font-mono text-text outline-none',
            )}
          />
          <button
            type="button"
            onClick={() => onCommit(draft)}
            className={cn(
              CONTROL,
              'shrink-0 cursor-pointer border-acc bg-acc-soft px-12 font-medium text-acc-dim',
              'transition-colors hover:bg-acc-strong',
            )}
          >
            {t('saveShort')}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(value);
              setEditing(false);
            }}
            className={TEXT_BUTTON}
          >
            {t('cancel')}
          </button>
        </div>
      ) : (
        <div className="flex gap-6">
          <div
            className={cn(
              CONTROL,
              'flex min-w-0 flex-1 items-center overflow-hidden whitespace-nowrap px-10',
              'font-mono tracking-[0.04em]',
              value === '' ? 'text-faint' : 'text-dim',
            )}
          >
            {display}
          </div>

          <button
            type="button"
            title={t('showHide')}
            aria-label={t('showHide')}
            disabled={value === ''}
            onClick={() => setRevealed((current) => !current)}
            className={cn(ICON_BUTTON, value === '' && 'cursor-not-allowed opacity-45')}
          >
            {shown ? (
              <EyeOff aria-hidden className="size-13" />
            ) : (
              <Eye aria-hidden className="size-13" />
            )}
          </button>

          {copyable && (
            <button
              type="button"
              title={t('copy')}
              aria-label={t('copy')}
              disabled={value === ''}
              onClick={() => {
                void navigator.clipboard?.writeText(value);
                onCopy?.();
              }}
              className={cn(ICON_BUTTON, value === '' && 'cursor-not-allowed opacity-45')}
            >
              <Copy aria-hidden className="size-13" />
            </button>
          )}

          <button type="button" onClick={() => setEditing(true)} className={TEXT_BUTTON}>
            {t('replace')}
          </button>
        </div>
      )}

      {hint !== undefined && <span className="text-mini text-faint">{hint}</span>}
    </div>
  );
}
