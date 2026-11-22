const PERSIAN_DIGIT_MAP: Record<string, string> = {
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

export function normalizeDigits(input: string): string {
  return (input ?? '').replace(/[۰-۹٠-٩]/g, (ch) => PERSIAN_DIGIT_MAP[ch] ?? ch);
}

export function normalizeEmailIdentifier(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmailIdentifier(email: string): boolean {
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 254) {
    return false;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/**
 * Normalizes Iranian mobile numbers from formats such as:
 * 09123456789, 9123456789, +989123456789, 00989123456789, 989123456789
 * (including Persian/Arabic digits, spaces, and dashes) to `09XXXXXXXXX`.
 * Returns null if the input is not a valid Iranian mobile number.
 */
export function normalizeIranMobile(input: string): string | null {
  const asciiDigitsInput = normalizeDigits(input ?? '');
  // Strip spaces, dashes, parentheses, underscores, and directional marks
  const compact = asciiDigitsInput.replace(/[\s\-–—()_.\u200c\u200e\u200f]/g, '');
  if (!compact) {
    return null;
  }

  let candidate = compact;

  if (candidate.startsWith('+98')) {
    candidate = `0${candidate.slice(3)}`;
  } else if (candidate.startsWith('0098')) {
    candidate = `0${candidate.slice(4)}`;
  } else if (candidate.startsWith('98') && candidate.length === 12) {
    candidate = `0${candidate.slice(2)}`;
  } else if (candidate.startsWith('9') && candidate.length === 10) {
    candidate = `0${candidate}`;
  }

  if (!/^09\d{9}$/.test(candidate)) {
    return null;
  }

  return candidate;
}

export type DetectedLoginIdentifier =
  | { type: 'phone'; normalized: string }
  | { type: 'email'; normalized: string }
  | { type: 'invalid' };

export function detectLoginIdentifier(input: string): DetectedLoginIdentifier {
  const trimmed = normalizeDigits(input ?? '').trim();
  if (!trimmed) {
    return { type: 'invalid' };
  }

  const normalizedPhone = normalizeIranMobile(trimmed);
  if (normalizedPhone !== null) {
    return { type: 'phone', normalized: normalizedPhone };
  }

  if (isValidEmailIdentifier(trimmed)) {
    return { type: 'email', normalized: normalizeEmailIdentifier(trimmed) };
  }

  return { type: 'invalid' };
}
