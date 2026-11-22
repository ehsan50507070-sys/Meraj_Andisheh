export interface IClock {
  now(): Date;
  nowUtcIso(): string;
  nowJalali(): string;
  toJalali(date: Date): string;
}
