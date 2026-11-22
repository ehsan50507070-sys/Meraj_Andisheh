const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'] as const;

/**
 * Converts Western/Arabic digits in a string or number to Persian digits.
 */
export function toPersianDigits(value: string | number): string {
  const input = String(value);
  return input
    .replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[Number(digit)] ?? digit)
    .replace(/[٠-٩]/g, (digit) => {
      const code = digit.charCodeAt(0) - 0x0660;
      return PERSIAN_DIGITS[code] ?? digit;
    });
}
