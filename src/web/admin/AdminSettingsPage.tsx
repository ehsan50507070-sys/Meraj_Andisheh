import { Save, Settings, ToggleRight } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { FeatureFlag, FeatureFlagKey } from '../../core/domain/settings';
import { KNOWN_SITE_SETTING_KEYS } from '../../core/services/settingsManagementService';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, FormField, Tag } from '../components/ui';
import { toPersianDigits } from '../resources/formatters';
import type { ResourceKey } from '../resources/fa';
import { t } from '../resources/i18n';
import { appContainer } from '../services/appContainer';
import { AdminLayout } from './AdminLayout';

interface AdminSettingsPageProps {
  currentRoute: string;
}

function getFlagNameKey(key: FeatureFlagKey): ResourceKey {
  return `admin.settings.flag.${key}.name` as ResourceKey;
}

function getFlagDescKey(key: FeatureFlagKey): ResourceKey {
  return `admin.settings.flag.${key}.desc` as ResourceKey;
}

export function AdminSettingsPage({ currentRoute }: AdminSettingsPageProps) {
  const { currentUser, refreshSiteTitle, refreshFeatureFlags } = useAuth();
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [settingValues, setSettingValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    variant: 'success' | 'error';
    message: string;
  } | null>(null);

  const loadSettings = useCallback(async () => {
    const [flagsRes, settingsRes] = await Promise.all([
      appContainer.settingsManagementService.getFeatureFlags(currentUser),
      appContainer.settingsManagementService.getSiteSettings(currentUser),
    ]);

    if (flagsRes.ok && flagsRes.items) {
      setFlags(flagsRes.items);
    }
    if (settingsRes.ok && settingsRes.items) {
      const map: Record<string, string> = {};
      for (const item of settingsRes.items) {
        map[item.key] = item.value;
      }
      setSettingValues(map);
    }
  }, [currentUser]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleToggleFlag = async (flag: FeatureFlag) => {
    const res = await appContainer.settingsManagementService.toggleFeatureFlag(
      currentUser,
      flag.key,
      !flag.isEnabled,
    );

    if (!res.ok) {
      setFeedback({
        variant: 'error',
        message: res.messageKey ? t(res.messageKey as ResourceKey) : t('admin.forbidden.title'),
      });
      return;
    }

    setFlags((prev) =>
      prev.map((item) =>
        item.key === flag.key ? { ...item, isEnabled: !flag.isEnabled } : item,
      ),
    );
    await refreshFeatureFlags();
    setFeedback({
      variant: 'success',
      message: t('admin.settings.flagUpdated', {
        name: t(getFlagNameKey(flag.key)),
      }),
    });
  };

  const handleSubmitSettings = async (event: FormEvent) => {
    event.preventDefault();
    setFieldErrors({});
    setFeedback(null);
    setIsSaving(true);

    try {
      const res = await appContainer.settingsManagementService.updateSiteSettings(
        currentUser,
        settingValues,
      );

      if (!res.ok) {
        if (res.fieldErrors) {
          const translated: Record<string, string> = {};
          for (const [k, msgKey] of Object.entries(res.fieldErrors)) {
            translated[k] = t(msgKey as ResourceKey);
          }
          setFieldErrors(translated);
        }
        setFeedback({
          variant: 'error',
          message: res.messageKey
            ? t(res.messageKey as ResourceKey)
            : t('admin.settings.error.validationFailed'),
        });
        return;
      }

      if (res.items) {
        const map: Record<string, string> = {};
        for (const item of res.items) {
          map[item.key] = item.value;
        }
        setSettingValues((prev) => ({ ...prev, ...map }));
      }

      await refreshSiteTitle();
      setFeedback({
        variant: 'success',
        message: t('admin.settings.saveSuccess'),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AdminLayout currentRoute={currentRoute}>
      <div className="space-y-6">
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-1">
          <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
            <Settings className="w-6 h-6 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
            <span>{t('admin.settings.title')}</span>
          </h1>
          <p className="text-xs sm:text-sm text-[var(--color-muted)]">
            {t('admin.settings.subtitle')}
          </p>
        </section>

        {feedback && (
          <Alert
            variant={feedback.variant}
            message={feedback.message}
            onDismiss={() => setFeedback(null)}
          />
        )}

        {/* Section 1: Feature Flags */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-4">
          <div className="space-y-1 pb-4 border-b border-[var(--color-border)]">
            <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)] flex items-center gap-2">
              <ToggleRight className="w-5 h-5 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
              <span>{t('admin.settings.flagsSectionTitle')}</span>
            </h2>
            <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
              {t('admin.settings.flagsSectionDesc')}
            </p>
          </div>

          <ul className="divide-y divide-[var(--color-border)]">
            {flags.map((flag) => (
              <li
                key={flag.key}
                className="py-3.5 flex flex-wrap items-center justify-between gap-4"
              >
                <div className="space-y-0.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--color-text)]">
                      {t(getFlagNameKey(flag.key))}
                    </span>
                    <code
                      dir="ltr"
                      className="text-[11px] font-mono text-[var(--color-muted)] bg-[var(--color-surface-alt)] px-1.5 py-0.5 rounded"
                    >
                      {flag.key}
                    </code>
                  </div>
                  <p className="text-xs text-[var(--color-muted)]">
                    {t(getFlagDescKey(flag.key))}
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <Tag
                    label={
                      flag.isEnabled
                        ? t('admin.settings.flagEnabled')
                        : t('admin.settings.flagDisabled')
                    }
                    variant={flag.isEnabled ? 'success' : 'neutral'}
                  />
                  <button
                    type="button"
                    role="switch"
                    aria-checked={flag.isEnabled}
                    aria-label={t('admin.settings.flagToggleAria', {
                      name: t(getFlagNameKey(flag.key)),
                    })}
                    onClick={() => void handleToggleFlag(flag)}
                    className={`relative inline-flex h-7 w-12 items-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] ${
                      flag.isEnabled
                        ? 'bg-[var(--color-primary-button)] border-transparent'
                        : 'bg-[var(--color-surface-alt)] border-[var(--color-border-strong)]'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                        flag.isEnabled ? '-translate-x-6' : '-translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Section 2: Site Settings */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-5">
          <div className="space-y-1 pb-4 border-b border-[var(--color-border)]">
            <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
              {t('admin.settings.siteSectionTitle')}
            </h2>
            <p className="text-xs sm:text-sm text-[var(--color-muted)]">
              {t('admin.settings.siteSectionDesc')}
            </p>
          </div>

          <form onSubmit={(e) => void handleSubmitSettings(e)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {KNOWN_SITE_SETTING_KEYS.map((key) => {
                const labelKey = `admin.settings.key.${key}.label` as ResourceKey;
                const value = settingValues[key] ?? '';
                const error = fieldErrors[key];

                if (key === 'Personalization.DefaultEnabled') {
                  return (
                    <FormField
                      key={key}
                      id={`setting-${key}`}
                      label={t(labelKey)}
                      kind="select"
                      value={value || '1'}
                      onChange={(nextVal) =>
                        setSettingValues((prev) => ({ ...prev, [key]: nextVal }))
                      }
                      options={[
                        {
                          value: '1',
                          label: t('admin.settings.key.Personalization.DefaultEnabled.optionOn'),
                        },
                        {
                          value: '0',
                          label: t('admin.settings.key.Personalization.DefaultEnabled.optionOff'),
                        },
                      ]}
                      error={error}
                    />
                  );
                }

                const hintKey =
                  key === 'Site.Title' || key === 'Site.Subtitle'
                    ? (`admin.settings.key.${key}.hint` as ResourceKey)
                    : undefined;

                const isNumeric = key !== 'Site.Title' && key !== 'Site.Subtitle';
                return (
                  <FormField
                    key={key}
                    id={`setting-${key}`}
                    label={t(labelKey)}
                    value={value}
                    onChange={(nextVal) =>
                      setSettingValues((prev) => ({ ...prev, [key]: nextVal }))
                    }
                    hint={
                      hintKey
                        ? t(hintKey)
                        : isNumeric && value
                          ? toPersianDigits(value)
                          : undefined
                    }
                    error={error}
                    required
                  />
                );
              })}
            </div>

            <div className="pt-2 flex justify-end">
              <Button
                type="submit"
                variant="primary"
                disabled={isSaving}
                startIcon={<Save className="w-4 h-4" />}
              >
                {isSaving
                  ? t('admin.settings.savingButton')
                  : t('admin.settings.saveButton')}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </AdminLayout>
  );
}
