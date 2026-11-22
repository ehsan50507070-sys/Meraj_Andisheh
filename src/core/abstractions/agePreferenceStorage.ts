export interface IAgePreferenceStorage {
  getAgeKey(): string | null;
  setAgeKey(ageKey: string, maxAgeSeconds?: number): void;
  clearAgeKey(): void;
}
