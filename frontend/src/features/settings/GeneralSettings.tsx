import { Monitor, Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { SelectField } from '@/components/ui/Field';
import type { TranslationKey } from '@/lib/i18n/dictionary';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { usePreferencesStore, type GeneralPreferences } from '@/store/preferences.store';
import { useToastStore } from '@/store/toast.store';
import type { Language, ThemeMode } from '@/types/domain';

const THEME_OPTIONS: ReadonlyArray<{
  readonly value: ThemeMode;
  readonly labelKey: TranslationKey;
  readonly icon: typeof Sun;
}> = [
  { value: 'dark', labelKey: 'dark', icon: Moon },
  { value: 'light', labelKey: 'light', icon: Sun },
  { value: 'system', labelKey: 'system', icon: Monitor },
];

const LANGUAGE_OPTIONS: ReadonlyArray<{ readonly value: Language; readonly label: string }> = [
  { value: 'uz', label: "O'zbekcha" },
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
];

type ToggleKey = keyof Pick<GeneralPreferences, 'criticalAlerts' | 'sound'>;

const TOGGLES: ReadonlyArray<{
  readonly key: ToggleKey;
  readonly labelKey: TranslationKey;
  readonly hintKey: TranslationKey;
}> = [
  { key: 'criticalAlerts', labelKey: 'tgCrit', hintKey: 'tgCritH' },
  { key: 'sound', labelKey: 'tgSnd', hintKey: 'tgSndH' },
];

export function GeneralSettings(): ReactNode {
  const { t } = useTranslation();
  const push = useToastStore((state) => state.push);

  const theme = usePreferencesStore((state) => state.theme);
  const setTheme = usePreferencesStore((state) => state.setTheme);
  const language = usePreferencesStore((state) => state.language);
  const setLanguage = usePreferencesStore((state) => state.setLanguage);
  const general = usePreferencesStore((state) => state.general);
  const patchGeneral = usePreferencesStore((state) => state.patchGeneral);
  const resetGeneral = usePreferencesStore((state) => state.resetGeneral);

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-3">
        <h1 className="m-0 text-xl font-medium tracking-[-0.02em]">{t('sGeneral')}</h1>
        <p className="m-0 text-xs-plus text-dim">{t('gSub')}</p>
      </header>

      <Panel className="overflow-hidden">
        <Row label={t('theme')} hint={t('themeHint')}>
          <div role="radiogroup" aria-label={t('theme')} className="flex gap-6">
            {THEME_OPTIONS.map((option) => {
              const Icon = option.icon;
              const active = theme === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTheme(option.value)}
                  className={cn(
                    'flex h-28 cursor-pointer items-center gap-6 rounded-7 border px-11 text-xs-plus transition-colors hover:border-acc-line',
                    active
                      ? 'border-acc bg-acc-soft text-acc-dim'
                      : 'border-line-2 bg-transparent text-dim',
                  )}
                >
                  <Icon aria-hidden className="size-13" />
                  {t(option.labelKey)}
                </button>
              );
            })}
          </div>
        </Row>

        <Row label={t('lang')} hint={t('langHint')}>
          <div className="min-w-206">
            <SelectField
              label=""
              value={language}
              onChange={(event) => setLanguage(event.target.value as Language)}
              options={LANGUAGE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
            />
          </div>
        </Row>

        <Row label={t('curLbl')} hint={t('curHint')}>
          <div className="min-w-206">
            <SelectField
              label=""
              value={general.currency}
              onChange={(event) =>
                patchGeneral({ currency: event.target.value as GeneralPreferences['currency'] })
              }
              options={[
                { value: 'UZS', label: "UZS · so'm" },
                { value: 'USD', label: 'USD · $' },
              ]}
            />
          </div>
        </Row>

        <Row label={t('tzLbl')} hint={t('tzHint')}>
          <div className="min-w-206">
            <SelectField
              label=""
              value={general.timezone}
              onChange={(event) => patchGeneral({ timezone: event.target.value })}
              options={[
                { value: 'Asia/Tashkent', label: 'Asia/Tashkent · UTC+5' },
                { value: 'UTC', label: 'UTC' },
              ]}
            />
          </div>
        </Row>

        <Row label={t('nfLbl')} hint={t('nfHint')}>
          <div className="min-w-206">
            <SelectField
              label=""
              value={general.numberFormat}
              onChange={(event) =>
                patchGeneral({
                  numberFormat: event.target.value as GeneralPreferences['numberFormat'],
                })
              }
              options={[
                { value: 'space-dot', label: '1 234 567.89' },
                { value: 'space-comma', label: '1 234 567,89' },
              ]}
            />
          </div>
        </Row>

        {TOGGLES.map((toggle) => {
          const value = general[toggle.key];
          return (
            <Row key={toggle.key} label={t(toggle.labelKey)} hint={t(toggle.hintKey)}>
              <div className="flex items-center gap-10">
                <button
                  type="button"
                  role="switch"
                  aria-checked={value}
                  aria-label={t(toggle.labelKey)}
                  onClick={() => patchGeneral({ [toggle.key]: !value })}
                  className={cn(
                    'flex h-20 w-36 shrink-0 cursor-pointer items-center rounded-full border p-0 transition-colors',
                    value ? 'justify-end border-acc bg-acc-soft' : 'justify-start border-line-2',
                  )}
                >
                  <span
                    className={cn(
                      'mx-2 size-14 rounded-full transition-colors',
                      value ? 'bg-acc' : 'bg-faint',
                    )}
                  />
                </button>
                <span className={cn('text-xs', value ? 'text-acc-dim' : 'text-faint')}>
                  {value ? t('onL') : t('offL')}
                </span>
              </div>
            </Row>
          );
        })}
      </Panel>

      <div className="flex items-center gap-10">
        <span className="text-xs text-faint">{t('savedLive')}</span>
        <div className="flex-1" />
        <Button
          size="xl"
          onClick={() => {
            resetGeneral();
            push(t('resetT'), { kind: 'info' });
          }}
        >
          {t('reset')}
        </Button>
      </div>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="grid grid-cols-[220px_minmax(0,1fr)] items-center gap-14 border-b border-line px-14 py-11 last:border-b-0 max-[720px]:grid-cols-1">
      <div>
        <div className="text-sm-plus">{label}</div>
        <div className="text-xs text-faint">{hint}</div>
      </div>
      {children}
    </div>
  );
}
