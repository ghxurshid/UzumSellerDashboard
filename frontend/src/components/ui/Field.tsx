import { AlertCircle } from 'lucide-react';
import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

import { cn } from '@/lib/utils';

const CONTROL = cn(
  'w-full rounded-7 border bg-panel px-10 text-sm text-text outline-none',
  'transition-colors placeholder:text-faint',
  'hover:border-line-2 focus-visible:border-acc',
  'disabled:cursor-not-allowed disabled:bg-grid disabled:text-dim',
);

interface FieldShellProps {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly controlId: string;
  readonly children: ReactNode;
}

/**
 * Label + control + message, wired together.
 *
 * The error message owns `role="alert"` and is referenced by `aria-describedby`
 * on the control, so a validation failure is announced once — at the field
 * the user is standing in, not as a page-level summary they have to hunt
 * through.
 */
function FieldShell({ label, hint, error, controlId, children }: FieldShellProps): ReactNode {
  return (
    <div className="flex flex-col gap-5">
      <label htmlFor={controlId} className="text-sm text-dim">
        {label}
      </label>

      {children}

      {error !== undefined ? (
        <p
          id={`${controlId}-error`}
          role="alert"
          className="m-0 flex items-center gap-5 text-xs text-neg"
        >
          <AlertCircle aria-hidden className="size-11 shrink-0" />
          {error}
        </p>
      ) : (
        hint !== undefined && (
          <p id={`${controlId}-hint`} className="m-0 font-mono text-tiny leading-[1.45] text-faint">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

function describedBy(controlId: string, error?: string, hint?: string): string | undefined {
  if (error !== undefined) return `${controlId}-error`;
  if (hint !== undefined) return `${controlId}-hint`;
  return undefined;
}

/* ── text input ─────────────────────────────────────────────────────────── */

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, className, ...props },
  ref,
) {
  const id = useId();

  return (
    <FieldShell label={label} hint={hint} error={error} controlId={id}>
      <input
        ref={ref}
        id={id}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(CONTROL, 'h-32', error !== undefined ? 'border-neg' : 'border-line-2', className)}
        {...props}
      />
    </FieldShell>
  );
});

/* ── select ─────────────────────────────────────────────────────────────── */

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly options: readonly SelectOption[];
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, error, options, className, ...props },
  ref,
) {
  const id = useId();

  return (
    <FieldShell label={label} hint={hint} error={error} controlId={id}>
      <select
        ref={ref}
        id={id}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(
          CONTROL,
          'h-32 cursor-pointer pr-26',
          error !== undefined ? 'border-neg' : 'border-line-2',
          className,
        )}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
});

/* ── textarea ───────────────────────────────────────────────────────────── */

export interface TextAreaFieldProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
}

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  function TextAreaField({ label, hint, error, className, ...props }, ref) {
    const id = useId();

    return (
      <FieldShell label={label} hint={hint} error={error} controlId={id}>
        <textarea
          ref={ref}
          id={id}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy(id, error, hint)}
          className={cn(
            CONTROL,
            'min-h-80 resize-y py-8',
            error !== undefined ? 'border-neg' : 'border-line-2',
            className,
          )}
          {...props}
        />
      </FieldShell>
    );
  },
);
