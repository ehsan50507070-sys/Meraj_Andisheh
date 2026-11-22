import { faResources, type ResourceKey } from './fa';

export type TranslationParams = Record<string, string | number>;

const activeDictionary: Record<string, string> = faResources;

/**
 * Translates a resource key using the active Persian dictionary.
 * Falls back safely to the key itself if no translation exists.
 */
export function t(key: ResourceKey | (string & {}), params?: TranslationParams): string {
  if (!key || typeof key !== 'string') {
    return '';
  }

  const rawValue = Object.prototype.hasOwnProperty.call(activeDictionary, key)
    ? activeDictionary[key]
    : key;

  if (!rawValue) {
    return key;
  }

  if (!params) {
    return rawValue;
  }

  return rawValue.replace(/\{(\w+)\}/g, (match, token: string) => {
    if (Object.prototype.hasOwnProperty.call(params, token)) {
      return String(params[token]);
    }
    return match;
  });
}
