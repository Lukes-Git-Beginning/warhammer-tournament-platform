import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { createTournament, listDraftPresets } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Label, FieldError, FieldHint } from '@/components/ui/label';

const TournamentCreateSchema = z.object({
  name: z.string().min(3).max(128),
  description: z.string().max(5000).optional(),
  format: z.enum(['SINGLE_ELIMINATION', 'SWISS', 'ROUND_ROBIN']),
  mode: z.enum(['ONE_V_ONE', 'TWO_V_TWO']).default('ONE_V_ONE'),
  start_date: z.string().min(1),
  timezone: z.string().min(1),
  max_participants: z.coerce.number().int().positive().optional().or(z.literal('')),
  registration_deadline: z.string().optional(),
  rules: z.string().max(10000).optional(),
  discord_link: z.string().url().optional().or(z.literal('')),
  draft_enabled: z.boolean().default(false),
  draft_preset_id: z.string().uuid().nullable().optional(),
});

type FormData = z.infer<typeof TournamentCreateSchema>;

export function TournamentCreateForm() {
  const { t } = useTranslation();
  const router = useRouter();
  const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [form, setForm] = useState<Partial<FormData>>({
    format: 'SINGLE_ELIMINATION',
    mode: 'ONE_V_ONE',
    timezone: defaultTimezone,
    draft_enabled: false,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});

  const { data: draftPresets } = useQuery({
    queryKey: ['draft-presets'],
    queryFn: listDraftPresets,
  });

  const mutation = useMutation({
    mutationFn: createTournament,
    onSuccess: async (tournament) => {
      await router.navigate({ to: '/tournaments/$slug', params: { slug: tournament.slug } });
    },
  });

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;
    const newValue = type === 'checkbox' ? checked : value;
    setForm((prev) => ({
      ...prev,
      [name]: newValue,
      ...(name === 'draft_enabled' && !checked ? { draft_preset_id: null } : {}),
    }));
    setErrors((prev) => ({ ...prev, [name]: undefined }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = TournamentCreateSchema.safeParse(form);
    if (!result.success) {
      const fieldErrors: Partial<Record<keyof FormData, string>> = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof FormData;
        if (!fieldErrors[key]) {
          // Map Zod-Codes auf i18n-Keys
          if (key === 'name') fieldErrors[key] = t('tournament.form.errors.name_min');
          else if (key === 'start_date') fieldErrors[key] = t('tournament.form.errors.start_required');
          else if (key === 'discord_link') fieldErrors[key] = t('tournament.form.errors.discord_invalid');
          else fieldErrors[key] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    const {
      max_participants,
      discord_link,
      registration_deadline,
      description,
      rules,
      draft_enabled,
      draft_preset_id,
      ...rest
    } = result.data;

    mutation.mutate({
      ...rest,
      ...(max_participants ? { max_participants: Number(max_participants) } : {}),
      ...(discord_link ? { discord_link } : {}),
      ...(registration_deadline ? { registration_deadline } : {}),
      ...(description ? { description } : {}),
      ...(rules ? { rules } : {}),
      draft_enabled: draft_enabled ?? false,
      ...(draft_preset_id ? { draft_preset_id } : {}),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-6">
      {mutation.error && (
        <div className="rounded-md border border-red-800 bg-red-950/50 p-4 text-sm text-red-300">
          {(mutation.error as Error).message}
        </div>
      )}

      <div>
        <Label htmlFor="tcf-name" required>
          {t('tournament.form.name')}
        </Label>
        <Input
          id="tcf-name"
          name="name"
          value={form.name ?? ''}
          onChange={handleChange}
          placeholder={t('tournament.form.name_placeholder')}
        />
        <FieldError message={errors.name} />
      </div>

      <div>
        <Label htmlFor="tcf-description">{t('tournament.form.description')}</Label>
        <Textarea
          id="tcf-description"
          name="description"
          value={form.description ?? ''}
          onChange={handleChange}
          rows={4}
          placeholder={t('tournament.form.description_placeholder')}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <Label htmlFor="tcf-format" required>
            {t('tournament.form.format')}
          </Label>
          <Select
            id="tcf-format"
            name="format"
            value={form.format ?? 'SINGLE_ELIMINATION'}
            onChange={handleChange}
          >
            <option value="SINGLE_ELIMINATION">{t('tournament.format.single_elim')}</option>
            <option value="SWISS">{t('tournament.format.swiss')}</option>
            <option value="ROUND_ROBIN">{t('tournament.format.round_robin')}</option>
          </Select>
        </div>

        <div className="min-w-0">
          <Label htmlFor="tcf-mode">{t('tournament.form.mode')}</Label>
          <Select
            id="tcf-mode"
            name="mode"
            value="ONE_V_ONE"
            disabled
            className="cursor-not-allowed text-karaz-stone-500"
          >
            <option value="ONE_V_ONE">{t('tournament.form.mode_1v1')}</option>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <Label htmlFor="tcf-start" required>
            {t('tournament.form.start_date')}
          </Label>
          <Input
            id="tcf-start"
            type="datetime-local"
            name="start_date"
            value={form.start_date ?? ''}
            onChange={handleChange}
          />
          <FieldError message={errors.start_date} />
        </div>

        <div className="min-w-0">
          <Label htmlFor="tcf-tz">{t('tournament.form.timezone')}</Label>
          <Input
            id="tcf-tz"
            name="timezone"
            value={form.timezone ?? defaultTimezone}
            onChange={handleChange}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <Label htmlFor="tcf-max">{t('tournament.form.max_participants')}</Label>
          <Input
            id="tcf-max"
            type="number"
            name="max_participants"
            value={form.max_participants ?? ''}
            onChange={handleChange}
            min={2}
            placeholder={t('tournament.form.max_participants_placeholder')}
          />
        </div>

        <div className="min-w-0">
          <Label htmlFor="tcf-deadline">{t('tournament.form.registration_deadline')}</Label>
          <Input
            id="tcf-deadline"
            type="datetime-local"
            name="registration_deadline"
            value={form.registration_deadline ?? ''}
            onChange={handleChange}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="tcf-rules">{t('tournament.form.rules')}</Label>
        <Textarea
          id="tcf-rules"
          name="rules"
          value={form.rules ?? ''}
          onChange={handleChange}
          rows={6}
          placeholder={t('tournament.form.rules_placeholder')}
          className="font-mono text-sm"
        />
      </div>

      <div>
        <Label htmlFor="tcf-discord">{t('tournament.form.discord_link')}</Label>
        <Input
          id="tcf-discord"
          name="discord_link"
          value={form.discord_link ?? ''}
          onChange={handleChange}
          placeholder="https://discord.gg/…"
        />
        <FieldError message={errors.discord_link} />
      </div>

      <fieldset className="space-y-4 rounded-md border border-karaz-iron-700 bg-karaz-iron-900/60 p-4">
        <legend className="px-1 text-sm font-semibold text-karaz-stone-200">
          {t('tournament.form.draft_section')}
        </legend>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            name="draft_enabled"
            checked={form.draft_enabled ?? false}
            onChange={handleChange}
            className="h-4 w-4 rounded border-karaz-iron-600 bg-karaz-iron-800 text-karaz-gold-500 focus:ring-karaz-gold-500"
          />
          <span className="text-sm text-karaz-stone-300">
            {t('tournament.form.draft_enable')}
          </span>
        </label>

        {form.draft_enabled && (
          <div>
            <Label htmlFor="tcf-preset" required>
              {t('tournament.form.draft_preset')}
            </Label>
            <Select
              id="tcf-preset"
              name="draft_preset_id"
              value={form.draft_preset_id ?? ''}
              onChange={handleChange}
            >
              <option value="">— {t('tournament.form.draft_preset_placeholder')} —</option>
              {draftPresets?.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name} ({preset.turns.length} {t('tournament.form.turns')},{' '}
                  {preset.turn_seconds}s {t('tournament.form.per_turn')})
                </option>
              ))}
            </Select>
            {form.draft_enabled && !form.draft_preset_id && (
              <FieldHint>{t('tournament.form.draft_preset_required')}</FieldHint>
            )}
          </div>
        )}
      </fieldset>

      <Button
        type="submit"
        variant="forge"
        size="md"
        disabled={mutation.isPending || !!(form.draft_enabled && !form.draft_preset_id)}
      >
        {mutation.isPending ? t('tournament.form.submitting') : t('tournament.form.submit')}
      </Button>
    </form>
  );
}
