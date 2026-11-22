import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  children: ReactNode;
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'min-h-[36px] px-3 py-1.5 text-xs gap-1.5',
  md: 'min-h-[40px] px-4 py-2 text-sm gap-2',
  lg: 'min-h-[46px] px-6 py-2.5 text-base gap-2.5',
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] border border-transparent hover:bg-[var(--color-primary-hover)]',
  secondary:
    'bg-[var(--color-surface-alt)] text-[var(--color-text)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)]',
  outline:
    'bg-transparent text-[var(--color-text)] border border-[var(--color-border-strong)] hover:bg-[var(--color-surface-alt)]',
  ghost:
    'bg-transparent text-[var(--color-text)] border border-transparent hover:bg-[var(--color-surface-alt)]',
  danger:
    'bg-[var(--color-danger)] text-[var(--color-on-danger)] border border-transparent hover:bg-[var(--color-danger-hover)]',
};

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  startIcon,
  endIcon,
  className = '',
  type = 'button',
  disabled = false,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={`inline-flex items-center justify-center font-medium rounded-[var(--radius-control)] transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] disabled:opacity-50 disabled:cursor-not-allowed ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {startIcon && (
        <span className="inline-flex items-center shrink-0" aria-hidden="true">
          {startIcon}
        </span>
      )}
      <span>{children}</span>
      {endIcon && (
        <span className="inline-flex items-center shrink-0" aria-hidden="true">
          {endIcon}
        </span>
      )}
    </button>
  );
}
