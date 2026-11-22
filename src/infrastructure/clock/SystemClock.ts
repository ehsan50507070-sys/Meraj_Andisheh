import type { IClock } from '../../core/abstractions/IClock';

function padTwo(value: number): string {
  return String(value).padStart(2, '0');
}

function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
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

function normalizePersianDigitsToLatin(input: string): string {
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  return input
    .replace(/[۰-۹]/g, (char) => String(persianDigits.indexOf(char)))
    .replace(/[٠-٩]/g, (char) => String(arabicDigits.indexOf(char)));
}

export class SystemClock implements IClock {
  public now(): Date {
    return new Date();
  }

  public nowUtcIso(): string {
    return this.now().toISOString();
  }

  public nowJalali(): string {
    return this.toJalali(this.now());
  }

  public toJalali(date: Date): string {
    try {
      const formatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });

      const parts = formatter.formatToParts(date);
      const yearPart = parts.find((p) => p.type === 'year')?.value;
      const monthPart = parts.find((p) => p.type === 'month')?.value;
      const dayPart = parts.find((p) => p.type === 'day')?.value;
      const hourPart = parts.find((p) => p.type === 'hour')?.value;
      const minutePart = parts.find((p) => p.type === 'minute')?.value;
      const secondPart = parts.find((p) => p.type === 'second')?.value;

      if (yearPart && monthPart && dayPart && hourPart && minutePart && secondPart) {
        const numericYear = Number(normalizePersianDigitsToLatin(yearPart));
        // Validate Intl actually used the Persian calendar (years ~1300-1500) rather than Gregorian fallback
        if (numericYear >= 1300 && numericYear <= 1600) {
          const normalizedHour = hourPart === '۲۴' || hourPart === '24' ? '00' : normalizePersianDigitsToLatin(hourPart);
          return `${normalizePersianDigitsToLatin(yearPart)}/${normalizePersianDigitsToLatin(monthPart)}/${normalizePersianDigitsToLatin(dayPart)} ${normalizedHour}:${normalizePersianDigitsToLatin(minutePart)}:${normalizePersianDigitsToLatin(secondPart)}`;
        }
      }
    } catch {
      // Fall through to deterministic algorithmic conversion
    }

    const [jy, jm, jd] = gregorianToJalali(
      date.getFullYear(),
      date.getMonth() + 1,
      date.getDate(),
    );

    return `${jy}/${padTwo(jm)}/${padTwo(jd)} ${padTwo(date.getHours())}:${padTwo(date.getMinutes())}:${padTwo(date.getSeconds())}`;
  }
}
