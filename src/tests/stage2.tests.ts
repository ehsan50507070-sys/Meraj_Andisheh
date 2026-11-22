import {
  evaluateThemeContrast,
  getThemeDefinition,
  isValidThemeKey,
  resolveThemeKey,
  THEME_KEYS,
} from '../core/services/themeService';
import { faResources } from '../web/resources/fa';
import { toPersianDigits } from '../web/resources/formatters';
import { t } from '../web/resources/i18n';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

export const stage2Tests: UnitTestCase[] = [
  {
    id: 'stage2-wcag-contrast-all-themes',
    nameKey: 'health.card.tests.stage2Case1Name',
    descriptionKey: 'health.card.tests.stage2Case1Desc',
    run: () => {
      for (const themeKey of THEME_KEYS) {
        const report = evaluateThemeContrast(themeKey);
        assert(
          report.allPassed,
          `Theme "${themeKey}" failed WCAG AA (>= 4.5:1): ${report.checks
            .filter((c) => !c.passesAA)
            .map((c) => `${c.id}=${c.ratio}`)
            .join(', ')}`,
        );
      }
    },
  },
  {
    id: 'stage2-theme-service-validation',
    nameKey: 'health.card.tests.stage2Case2Name',
    descriptionKey: 'health.card.tests.stage2Case2Desc',
    run: () => {
      assertEqual(isValidThemeKey('playful'), true, 'playful must be valid');
      assertEqual(isValidThemeKey('modern'), true, 'modern must be valid');
      assertEqual(isValidThemeKey('editorial'), true, 'editorial must be valid');
      assertEqual(isValidThemeKey('unknown-theme'), false, 'unknown-theme must be invalid');

      assertEqual(resolveThemeKey('MODERN'), 'modern', 'resolveThemeKey must normalize case');
      assertEqual(
        resolveThemeKey('invalid', 'playful'),
        'playful',
        'resolveThemeKey must fall back safely',
      );

      const playfulDef = getThemeDefinition('playful');
      assertEqual(playfulDef.radiusCardPx, 24, 'playful card radius must be 24px');
      assertEqual(playfulDef.fontScale, 1.125, 'playful font scale must be 1.125');

      const modernDef = getThemeDefinition('modern');
      assertEqual(modernDef.isDark, true, 'modern theme must be marked dark');
    },
  },
  {
    id: 'stage2-persian-digits-formatter',
    nameKey: 'health.card.tests.stage2Case3Name',
    descriptionKey: 'health.card.tests.stage2Case3Desc',
    run: () => {
      assertEqual(toPersianDigits(12345), '۱۲۳۴۵', '12345 must format to ۱۲۳۴۵');
      assertEqual(toPersianDigits('09876'), '۰۹۸۷۶', '09876 must format to ۰۹۸۷۶');
      assertEqual(
        toPersianDigits('صفحه 3 از 10'),
        'صفحه ۳ از ۱۰',
        'Mixed text numerals must convert to Persian digits',
      );
    },
  },
  {
    id: 'stage2-i18n-stage2-keys',
    nameKey: 'health.card.tests.stage2Case4Name',
    descriptionKey: 'health.card.tests.stage2Case4Desc',
    run: () => {
      const stage2SampleKeys = [
        'theme.playful.name',
        'theme.modern.name',
        'theme.editorial.name',
        'layout.header.accountAction',
        'layout.nav.categoriesButton',
        'layout.footer.studioTitle',
        'dev.pageTitle',
        'dev.section.buttons.primary',
        'dev.section.cards.title',
        'dev.section.forms.title',
        'dev.section.tags.title',
        'dev.section.alerts.title',
        'dev.section.modal.openButton',
        'dev.section.pagination.title',
        'dev.section.table.title',
        'dev.contrast.title',
      ] as const;

      for (const key of stage2SampleKeys) {
        const value = t(key);
        assert(
          typeof value === 'string' && value.trim().length > 0 && value !== key,
          `Stage 2 resource key "${key}" must exist and be non-empty`,
        );
      }

      for (const [key, value] of Object.entries(faResources)) {
        assert(value.trim().length > 0, `Resource key "${key}" in fa.ts must not be empty`);
      }
    },
  },
];
