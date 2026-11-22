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

function gregorianToJalaliTuple(gy: number, gm: number, gd: number): [number, number, number] {
  const gDaysInMonth = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 +
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) +
    gd +
    gDaysInMonth[gm - 1];

  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;

  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }

  let jm: number;
  let jd: number;
  if (days < 186) {
    jm = 1 + Math.floor(days / 31);
    jd = 1 + (days % 31);
  } else {
    jm = 7 + Math.floor((days - 186) / 30);
    jd = 1 + ((days - 186) % 30);
  }
  return [jy, jm, jd];
}

export function formatJalaliDatePersian(isoTimestamp: string | null | undefined): string {
  if (!isoTimestamp) {
    return '—';
  }
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  try {
    const formatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const formatted = formatter.format(date);
    if (formatted && formatted.trim().length > 0) {
      return toPersianDigits(formatted);
    }
  } catch {
    // Fallback below
  }

  const [jy, jm, jd] = gregorianToJalaliTuple(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
  );
  const pad = (n: number) => String(n).padStart(2, '0');
  return toPersianDigits(`${jy}/${pad(jm)}/${pad(jd)}`);
}

export function formatMediaSecondsPersian(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hrs > 0) {
    return toPersianDigits(`${hrs}:${pad(mins)}:${pad(secs)}`);
  }
  return toPersianDigits(`${pad(mins)}:${pad(secs)}`);
}

export function formatFileSizeParts(sizeBytes: number | null | undefined): {
  unit: 'bytes' | 'kb' | 'mb';
  value: string;
} | null {
  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return null;
  }
  if (sizeBytes < 1024) {
    return { unit: 'bytes', value: toPersianDigits(Math.round(sizeBytes)) };
  }
  const kb = sizeBytes / 1024;
  if (kb < 1024) {
    return { unit: 'kb', value: toPersianDigits(kb.toFixed(1).replace(/\.0$/, '')) };
  }
  const mb = kb / 1024;
  return { unit: 'mb', value: toPersianDigits(mb.toFixed(1).replace(/\.0$/, '')) };
}
