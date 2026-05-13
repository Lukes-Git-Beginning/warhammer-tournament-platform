import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import type { UserMe } from '@tww3/types';
import { Button } from '@/components/ui/button';
import { patchMePreferences } from '@/lib/onboarding';
import { FactionPickerGrid } from './FactionPickerGrid';

interface OnboardingStage2PrefsProps {
  user: UserMe;
  onAdvance: () => void;
}

const COMMON_TIMEZONES = [
  'Europe/Berlin',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Warsaw',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
];

function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin';
  } catch {
    return 'Europe/Berlin';
  }
}

export function OnboardingStage2Prefs({ user, onAdvance }: OnboardingStage2PrefsProps) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const queryClient = useQueryClient();

  const defaultTz = user.timezone ?? getBrowserTimezone();
  const [timezone, setTimezone] = useState(defaultTz);
  const [factions, setFactions] = useState<string[]>(user.preferred_factions ?? []);

  const timezoneOptions = useMemo(() => {
    const set = new Set<string>([defaultTz, ...COMMON_TIMEZONES]);
    return Array.from(set);
  }, [defaultTz]);

  const save = useMutation({
    mutationFn: () =>
      patchMePreferences({ timezone, preferred_factions: factions }),
    onSuccess: (next) => {
      queryClient.setQueryData<UserMe>(['me'], next);
      onAdvance();
    },
  });

  return (
    <div data-testid="onboarding-stage-1" className="w-full max-w-2xl">
      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={
          reduced
            ? { duration: 0.24 }
            : { duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }
        }
        className="w-full rounded-md border border-karaz-iron-700 bg-karaz-iron-900 p-8 shadow-karaz-banner"
      >
        <h2 className="font-headline text-karaz-stone-100" style={{ fontSize: 'clamp(1.5rem, 3vw, 2rem)' }}>
          {t('onboarding.stage2.title')}
        </h2>
        <p className="mt-2 font-sans text-sm leading-relaxed text-karaz-stone-300">
          {t('onboarding.stage2.body')}
        </p>

        <div className="mt-8 space-y-7">
          <div>
            <label
              htmlFor="onboarding-timezone"
              className="block font-display text-[11px] uppercase tracking-[0.18em] text-karaz-gold-500"
            >
              {t('tournament.form.timezone')}
            </label>
            <select
              id="onboarding-timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="mt-2 w-full rounded-sm border border-karaz-iron-600 bg-karaz-iron-800 px-3 py-2 font-sans text-sm text-karaz-stone-200 focus:border-karaz-gold-500 focus:outline-none focus:ring-2 focus:ring-karaz-gold-500/40"
            >
              {timezoneOptions.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-karaz-stone-400">
              Auto-detected: {defaultTz}
            </p>
          </div>

          <div>
            <span className="block font-display text-[11px] uppercase tracking-[0.18em] text-karaz-gold-500">
              {t('onboarding.stage2.factions_label')}
            </span>
            <p className="mt-1 mb-3 text-[11px] text-karaz-stone-400">
              Up to five banners — purely cosmetic, signals your preferred play.
            </p>
            <FactionPickerGrid selected={factions} onChange={setFactions} maxSelections={5} />
          </div>
        </div>

        <div className="mt-8 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:justify-between">
          <Button variant="etched" size="md" onClick={onAdvance} disabled={save.isPending}>
            {t('onboarding.stage2.skip')}
          </Button>
          <Button
            variant="forge"
            size="md"
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            {save.isPending ? t('onboarding.stage2.saving') : t('onboarding.stage2.save')}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
