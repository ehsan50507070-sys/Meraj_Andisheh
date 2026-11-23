/**
 * Pure, dependency-free Persian (Jalali / Solar Hijri) <-> Gregorian calendar service.
 * Implements exact integer arithmetic (Borkowski / Jalaali astronomical break algorithm)
 * with full leap-year support and zero external CDN or library dependencies.
 */

export interface JalaliDate {
  jy: number;
  jm: number;
  jd: number;
}

export interface GregorianDate {
  gy: number;
  gm: number;
  gd: number;
}

export interface UtcRangeBounds {
  fromIso: string;
  toIso: string;
}

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'] as const;

/**
 * Astronomical 33-year break points for the Persian calendar (1178–3178 SH reliable range).
 */
const JALALI_BREAKS: readonly number[] = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394,
  2456, 3178,
];

function intDiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

function intMod(a: number, b: number): number {
  return a - Math.trunc(a / b) * b;
}

function padTwo(value: number): string {
  return String(value).padStart(2, '0');
}

function padFour(value: number): string {
  return String(value).padStart(4, '0');
}

interface JalaliCalInfo {
  leap: number;
  gy: number;
  march: number;
}

function jalaliCal(jy: number): JalaliCalInfo {
  const gy = jy + 621;
  let leapJ = -14;
  let jp = JALALI_BREAKS[0];
  let jump = 0;

  for (let i = 1; i < JALALI_BREAKS.length; i += 1) {
    const jm = JALALI_BREAKS[i];
    jump = jm - jp;
    if (jy < jm) {
      break;
    }
    leapJ += intDiv(jump, 33) * 8 + intDiv(intMod(jump, 33), 4);
    jp = jm;
  }

  let n = jy - jp;
  leapJ += intDiv(n, 33) * 8 + intDiv(intMod(n, 33) + 3, 4);
  if (intMod(jump, 33) === 4 && jump - n === 4) {
    leapJ += 1;
  }

  const leapG = intDiv(gy, 4) - intDiv((intDiv(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;

  if (jump - n < 6) {
    n = n - jump + intDiv(jump + 4, 33) * 33;
  }
  let leap = intMod(intMod(n + 1, 33) - 1, 4);
  if (leap === -1) {
    leap = 4;
  }

  return { leap, gy, march };
}

function gregorianToJdn(gy: number, gm: number, gd: number): number {
  let d =
    intDiv((gy + intDiv(gm - 8, 6) + 100100) * 1461, 4) +
    intDiv(153 * intMod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - intDiv(intDiv(gy + 100100 + intDiv(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function jdnToGregorian(jdn: number): GregorianDate {
  let j = 4 * jdn + 139361631;
  j = j + intDiv(intDiv(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = intDiv(intMod(j, 1461), 4) * 5 + 308;
  const gd = intDiv(intMod(i, 153), 5) + 1;
  const gm = intMod(intDiv(i, 153), 12) + 1;
  const gy = intDiv(j, 1461) - 100100 + intDiv(8 - gm, 6);
  return { gy, gm, gd };
}

function jalaliToJdn(jy: number, jm: number, jd: number): number {
  const r = jalaliCal(jy);
  return gregorianToJdn(r.gy, 3, r.march) + (jm - 1) * 31 - intDiv(jm, 7) * (jm - 7) + jd - 1;
}

function jdnToJalali(jdn: number): JalaliDate {
  const gy = jdnToGregorian(jdn).gy;
  let jy = gy - 621;
  const r = jalaliCal(jy);
  const jdn1f = gregorianToJdn(gy, 3, r.march);
  let k = jdn - jdn1f;

  if (k >= 0) {
    if (k <= 185) {
      const jm = 1 + intDiv(k, 31);
      const jd = intMod(k, 31) + 1;
      return { jy, jm, jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) {
      k += 1;
    }
  }

  const jm = 7 + intDiv(k, 30);
  const jd = intMod(k, 30) + 1;
  return { jy, jm, jd };
}

/**
 * Converts Persian/Arabic digits in a string into Western ASCII digits (0-9).
 */
export function normalizeCalendarDigitsToLatin(input: string): string {
  return input
    .replace(/[۰-۹]/g, (char) => String(char.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (char) => String(char.charCodeAt(0) - 0x0660));
}

/**
 * Converts Western/Arabic digits in a string or number into Persian digits (۰-۹).
 */
export function toPersianCalendarDigits(value: string | number): string {
  return String(value)
    .replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[Number(digit)] ?? digit)
    .replace(/[٠-٩]/g, (digit) => PERSIAN_DIGITS[digit.charCodeAt(0) - 0x0660] ?? digit);
}

/**
 * Returns true if the given Jalali year is a leap year (30 days in Esfand / month 12).
 */
export function isJalaliLeapYear(jy: number): boolean {
  if (!Number.isInteger(jy)) {
    return false;
  }
  return jalaliCal(jy).leap === 0;
}

/**
 * Returns the exact number of days in the specified Jalali month (1..12) of year `jy`.
 */
export function getJalaliMonthLength(jy: number, jm: number): number {
  if (!Number.isInteger(jy) || !Number.isInteger(jm) || jm < 1 || jm > 12) {
    return 0;
  }
  if (jm <= 6) {
    return 31;
  }
  if (jm <= 11) {
    return 30;
  }
  return isJalaliLeapYear(jy) ? 30 : 29;
}

/**
 * Validates whether `(jy, jm, jd)` forms a real Jalali calendar date.
 */
export function isValidJalaliDate(jy: number, jm: number, jd: number): boolean {
  if (!Number.isInteger(jy) || !Number.isInteger(jm) || !Number.isInteger(jd)) {
    return false;
  }
  if (jy < 1 || jy > 3177 || jm < 1 || jm > 12) {
    return false;
  }
  const monthLength = getJalaliMonthLength(jy, jm);
  return jd >= 1 && jd <= monthLength;
}

/**
 * Converts a Gregorian calendar date `(gy, gm, gd)` to Jalali `{ jy, jm, jd }`.
 */
export function gregorianToJalali(gy: number, gm: number, gd: number): JalaliDate {
  return jdnToJalali(gregorianToJdn(gy, gm, gd));
}

/**
 * Converts a Jalali calendar date `(jy, jm, jd)` to Gregorian `{ gy, gm, gd }`.
 */
export function jalaliToGregorian(jy: number, jm: number, jd: number): GregorianDate {
  return jdnToGregorian(jalaliToJdn(jy, jm, jd));
}

/**
 * Compares two Jalali dates (`< 0` if a < b, `0` if equal, `> 0` if a > b).
 */
export function compareJalaliDates(a: JalaliDate, b: JalaliDate): number {
  if (a.jy !== b.jy) {
    return a.jy - b.jy;
  }
  if (a.jm !== b.jm) {
    return a.jm - b.jm;
  }
  return a.jd - b.jd;
}

/**
 * Formats a Jalali date as `YYYY/MM/DD`, defaulting to Persian digits (`۱۴۰۵/۰۹/۰۲`).
 */
export function formatJalaliDate(
  jy: number,
  jm: number,
  jd: number,
  usePersianDigits = true,
): string {
  const base = `${padFour(jy)}/${padTwo(jm)}/${padTwo(jd)}`;
  return usePersianDigits ? toPersianCalendarDigits(base) : base;
}

/**
 * Parses a user-entered Jalali date string accepting Persian (`۰-۹`), Arabic (`٠-٩`),
 * and Latin (`0-9`) digits with `/` or `-` separators, and strictly checks month/day bounds
 * including leap-year Esfand validation. Returns `null` for any invalid input.
 */
export function parseJalaliInput(input: string): JalaliDate | null {
  if (typeof input !== 'string') {
    return null;
  }
  const normalized = normalizeCalendarDigitsToLatin(input).trim();
  if (!normalized) {
    return null;
  }

  const match = /^(\d{4})\s*[/-]\s*(\d{1,2})\s*[/-]\s*(\d{1,2})$/.exec(normalized);
  if (!match) {
    return null;
  }

  const jy = Number.parseInt(match[1], 10);
  const jm = Number.parseInt(match[2], 10);
  const jd = Number.parseInt(match[3], 10);

  if (!isValidJalaliDate(jy, jm, jd)) {
    return null;
  }

  return { jy, jm, jd };
}

/**
 * Converts a JS `Date` instance to a `JalaliDate` (local calendar by default, or UTC if `useUtc=true`).
 */
export function dateToJalali(date: Date = new Date(), useUtc = false): JalaliDate {
  const gy = useUtc ? date.getUTCFullYear() : date.getFullYear();
  const gm = (useUtc ? date.getUTCMonth() : date.getMonth()) + 1;
  const gd = useUtc ? date.getUTCDate() : date.getDate();
  return gregorianToJalali(gy, gm, gd);
}

/**
 * Returns today's Jalali date in local time (or UTC when `useUtc=true`).
 */
export function getTodayJalali(useUtc = false): JalaliDate {
  return dateToJalali(new Date(), useUtc);
}

/**
 * Returns the 0-based Persian weekday index for a Jalali date:
 * 0 = Saturday (شنبه), 1 = Sunday, ..., 6 = Friday (جمعه).
 */
export function getJalaliWeekdayIndex(jy: number, jm: number, jd: number): number {
  const { gy, gm, gd } = jalaliToGregorian(jy, jm, jd);
  const utcDay = new Date(Date.UTC(gy, gm - 1, gd)).getUTCDay(); // 0=Sun..6=Sat
  return (utcDay + 1) % 7;
}

/**
 * Converts a pair of Jalali dates (or parseable Jalali strings) into UTC ISO range boundaries:
 * start of `fromJalali` (`00:00:00.000Z`) and end of `toJalali` (`23:59:59.999Z`).
 * Returns `null` if either date is invalid or cannot be parsed.
 * Note: Ordering (`from > to`) is preserved in the returned ISO strings so downstream services
 * such as `AnalyticsDashboardService` can validate and emit `INVALID_DATE_RANGE`.
 */
export function jalaliToUtcRangeBounds(
  fromJalali: JalaliDate | string,
  toJalali: JalaliDate | string,
): UtcRangeBounds | null {
  const parsedFrom =
    typeof fromJalali === 'string'
      ? parseJalaliInput(fromJalali)
      : isValidJalaliDate(fromJalali.jy, fromJalali.jm, fromJalali.jd)
        ? fromJalali
        : null;
  const parsedTo =
    typeof toJalali === 'string'
      ? parseJalaliInput(toJalali)
      : isValidJalaliDate(toJalali.jy, toJalali.jm, toJalali.jd)
        ? toJalali
        : null;

  if (!parsedFrom || !parsedTo) {
    return null;
  }

  const fromG = jalaliToGregorian(parsedFrom.jy, parsedFrom.jm, parsedFrom.jd);
  const toG = jalaliToGregorian(parsedTo.jy, parsedTo.jm, parsedTo.jd);

  return {
    fromIso: `${padFour(fromG.gy)}-${padTwo(fromG.gm)}-${padTwo(fromG.gd)}T00:00:00.000Z`,
    toIso: `${padFour(toG.gy)}-${padTwo(toG.gm)}-${padTwo(toG.gd)}T23:59:59.999Z`,
  };
}
