import type { AgeGroup } from '../../core/domain/taxonomy';
import { toPersianDigits } from './formatters';
import { t } from './i18n';

export function formatAgeGroupRange(group: Pick<AgeGroup, 'minAge' | 'maxAge'>): string {
  if (group.maxAge === null) {
    return t('ageGroup.rangeOpenEnded', {
      min: toPersianDigits(group.minAge),
    });
  }
  return t('ageGroup.rangeBounded', {
    min: toPersianDigits(group.minAge),
    max: toPersianDigits(group.maxAge),
  });
}

export function formatAgeGroupWithRange(
  group: Pick<AgeGroup, 'name' | 'minAge' | 'maxAge'>,
): string {
  return t('ageGroup.withRange', {
    name: group.name,
    range: formatAgeGroupRange(group),
  });
}
