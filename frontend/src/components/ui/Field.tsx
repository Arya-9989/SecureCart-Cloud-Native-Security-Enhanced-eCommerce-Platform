import { clsx } from "clsx";
import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

interface FieldShellProps {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
}

function FieldShell({ id, label, error, hint, children, className }: FieldShellProps) {
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, error?: string, hint?: string): string | undefined {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  wrapperClassName?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, id, className, wrapperClassName, ...props },
  ref,
) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldShell id={fieldId} label={label} error={error} hint={hint} className={wrapperClassName}>
      <input
        ref={ref}
        id={fieldId}
        className={clsx("field", className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, error, hint)}
        {...props}
      />
    </FieldShell>
  );
});

export interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string | undefined;
  wrapperClassName?: string;
}

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  function TextAreaField({ label, error, id, className, wrapperClassName, ...props }, ref) {
    const generated = useId();
    const fieldId = id ?? generated;
    return (
      <FieldShell id={fieldId} label={label} error={error} className={wrapperClassName}>
        <textarea
          ref={ref}
          id={fieldId}
          className={clsx("field min-h-24 resize-y", className)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(fieldId, error)}
          {...props}
        />
      </FieldShell>
    );
  },
);

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string | undefined;
  wrapperClassName?: string;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, error, id, className, wrapperClassName, children, ...props },
  ref,
) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldShell id={fieldId} label={label} error={error} className={wrapperClassName}>
      <select
        ref={ref}
        id={fieldId}
        className={clsx("field", className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, error)}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
});
