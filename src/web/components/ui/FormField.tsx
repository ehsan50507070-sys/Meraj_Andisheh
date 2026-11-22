import type { ChangeEvent } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

export interface FormFieldProps {
  id: string;
  label: string;
  kind?: 'input' | 'textarea' | 'select';
  type?: 'text' | 'email' | 'search' | 'password';
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  rows?: number;
  options?: readonly SelectOption[];
}

export function FormField({
  id,
  label,
  kind = 'input',
  type = 'text',
  value,
  onChange,
  placeholder,
  hint,
  error,
  required = false,
  disabled = false,
  rows = 3,
  options = [],
}: FormFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  const baseControlClasses = `w-full rounded-[var(--radius-control)] bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-muted)] border transition-colors duration-150 px-3.5 py-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)] disabled:opacity-55 disabled:cursor-not-allowed ${
    error
      ? 'border-[var(--color-error-text)]'
      : 'border-[var(--color-border-strong)] hover:border-[var(--color-muted)]'
  }`;

  const handleChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    onChange(event.target.value);
  };

  return (
    <div className="space-y-1.5 w-full">
      <label
        htmlFor={id}
        className="block text-sm font-medium text-[var(--color-text)]"
      >
        <span>{label}</span>
        {required && (
          <span className="text-[var(--color-error-text)] mr-1" aria-hidden="true">
            *
          </span>
        )}
      </label>

      {kind === 'textarea' ? (
        <textarea
          id={id}
          rows={rows}
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={`${baseControlClasses} resize-y min-h-[88px]`}
        />
      ) : kind === 'select' ? (
        <select
          id={id}
          value={value}
          onChange={handleChange}
          required={required}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={`${baseControlClasses} min-h-[42px]`}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={`${baseControlClasses} min-h-[42px]`}
        />
      )}

      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-[var(--color-error-text)]">
          {error}
        </p>
      )}

      {hint && !error && (
        <p id={hintId} className="text-xs text-[var(--color-muted)]">
          {hint}
        </p>
      )}
    </div>
  );
}
