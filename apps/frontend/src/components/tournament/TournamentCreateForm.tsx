import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { createTournament, listDraftPresets, getMaps } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Label, FieldError, FieldHint } from '@/components/ui/label';

const TournamentCreateSchema = z.object({
  name: z.string().min(3).max(128),
  description: z.string().max(5000).optional(),
  format: z.enum(['SINGLE_ELIMINATION', 'SWISS', 'ROUND_ROBIN']),
  mode: z.enum(['OPEN', 'BPT', 'SFT', 'SLT']).default('OPEN'),
  start_date: z.string().min(1),
  timezone: z.string().min(1),
  max_participants: z.coerce.number().int().positive().optional().or(z.literal('')),
  registration_deadline: z.string().optional(),
  rules: z.string().max(10000).optional(),
  discord_link: z.string().url().optional().or(z.literal('')),
  draft_enabled: z.boolean().default(false),
  draft_preset_id: z.string().uuid().nullable().optional(),
  // Welle 2 fields
  rounds_count: z.coerce.number().int().min(3).max(6).default(5),
  playoff_format: z.enum(['NONE', 'TOP4', 'TOP8']).default('NONE'),
  swiss_match_format: z.enum(['BO1', 'BO3']).default('BO1'),
  playoff_match_format: z.enum(['BO3', 'BO5']).default('BO3'),
  finale_match_format: z.enum(['BO3', 'BO5']).default('BO3'),
  map_decision_mode: z.enum(['RANDOM', 'PICK_BAN']).default('PICK_BAN'),
  map_pool: z.array(z.string()).min(3).max(36).default([]),
});

type FormData = z.infer<typeof TournamentCreateSchema>;

export function TournamentCreateForm() {
  const { t } = useTranslation();
  const router = useRouter();
  const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [form, setForm] = useState<Partial<FormData>>({
    format: 'SINGLE_ELIMINATION',
    mode: 'OPEN',
    timezone: defaultTimezone,
    draft_enabled: false,
    rounds_count: 5,
    playoff_format: 'NONE',
    swiss_match_format: 'BO1',
    playoff_match_format: 'BO3',
    finale_match_format: 'BO3',
    map_decision_mode: 'PICK_BAN',
    map_pool: [],
  });
  const [mapSearch, setMapSearch] = useState('');
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});

  const { data: draftPresets } = useQuery({
    queryKey: ['draft-presets'],
    queryFn: listDraftPresets,
  });

  const { data: mapsData } = useQuery({
    queryKey: ['maps'],
    queryFn: getMaps,
  });
  const allMaps = mapsData?.data ?? [];

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
      map_pool,
      start_date,
      ...rest
    } = result.data;

    // <input type="datetime-local"> emits "YYYY-MM-DDTHH:mm" without timezone.
    // Backend Zod schema requires a full ISO-8601 string — interpret the local
    // value in the browser's timezone and convert to UTC ISO.
    const toIsoOrInvalid = (local: string) => {
      const d = new Date(local);
      return Number.isNaN(d.getTime()) ? local : d.toISOString();
    };

    mutation.mutate({
      ...rest,
      start_date: toIsoOrInvalid(start_date),
      ...(max_participants ? { max_participants: Number(max_participants) } : {}),
      ...(discord_link ? { discord_link } : {}),
      ...(registration_deadline
        ? { registration_deadline: toIsoOrInvalid(registration_deadline) }
        : {}),
      ...(description ? { description } : {}),
      ...(rules ? { rules } : {}),
      draft_enabled: draft_enabled ?? false,
      ...(draft_preset_id ? { draft_preset_id } : {}),
      map_pool: map_pool ?? [],
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
            value={form.mode ?? 'OPEN'}
            onChange={handleChange}
          >
            <option value="OPEN">Open (Casual)</option>
            <option value="BPT">BPT — Blind Pick Tournament</option>
            <option value="SFT">SFT — Single Faction Tournament</option>
            <option value="SLT">SLT — Single List Tournament</option>
          </Select>
          <FieldHint>
            {form.mode === 'BPT' && 'Every match includes a blind faction pick phase.'}
            {form.mode === 'SFT' && 'Players pre-select a faction at registration; revealed at tournament start.'}
            {form.mode === 'SLT' && 'Players upload their army list at registration. Reveal after each completed match.'}
          </FieldHint>
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

      {/* ─── Match Mechanics ───────────────────────────────────────────── */}
      <fieldset className="space-y-4 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
        <legend className="px-1 text-sm font-semibold text-rizzotto-stone-200">
          Match Mechanics
        </legend>

        {/* Rounds count */}
        <div>
          <Label htmlFor="tcf-rounds">Swiss Rounds</Label>
          <div className="flex items-center gap-3 mt-1">
            <input
              id="tcf-rounds"
              type="range"
              name="rounds_count"
              min={3}
              max={6}
              step={1}
              value={form.rounds_count ?? 5}
              onChange={handleChange}
              className="w-full accent-rizzotto-gold-400"
            />
            <span className="w-6 text-center font-semibold text-rizzotto-stone-200 tabular-nums">
              {form.rounds_count ?? 5}
            </span>
          </div>
          <FieldHint>Number of Swiss rounds (3–6). Default: 5.</FieldHint>
        </div>

        {/* Playoff format */}
        <div>
          <Label htmlFor="tcf-playoff">Playoff Format</Label>
          <div className="flex gap-3 mt-1 flex-wrap">
            {(['NONE', 'TOP4', 'TOP8'] as const).map((opt) => (
              <label key={opt} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="playoff_format"
                  value={opt}
                  checked={(form.playoff_format ?? 'NONE') === opt}
                  onChange={handleChange}
                  className="accent-rizzotto-gold-400"
                />
                <span className="text-sm text-rizzotto-stone-300">{opt}</span>
              </label>
            ))}
          </div>
          {form.playoff_format === 'TOP8' && (
            <FieldHint>TOP8 requires ≥16 participants at playoff start. Auto-falls back to TOP4 if below threshold.</FieldHint>
          )}
        </div>

        {/* Match formats */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="tcf-swiss-fmt">Swiss Format</Label>
            <Select
              id="tcf-swiss-fmt"
              name="swiss_match_format"
              value={form.swiss_match_format ?? 'BO1'}
              onChange={handleChange}
            >
              <option value="BO1">Best of 1</option>
              <option value="BO3">Best of 3</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="tcf-playoff-fmt">Playoffs Format</Label>
            <Select
              id="tcf-playoff-fmt"
              name="playoff_match_format"
              value={form.playoff_match_format ?? 'BO3'}
              onChange={handleChange}
            >
              <option value="BO3">Best of 3</option>
              <option value="BO5">Best of 5</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="tcf-finale-fmt">Finale Format</Label>
            <Select
              id="tcf-finale-fmt"
              name="finale_match_format"
              value={form.finale_match_format ?? 'BO3'}
              onChange={handleChange}
            >
              <option value="BO3">Best of 3</option>
              <option value="BO5">Best of 5</option>
            </Select>
          </div>
        </div>
      </fieldset>

      {/* ─── Map Pool ──────────────────────────────────────────────────── */}
      <fieldset className="space-y-4 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
        <legend className="px-1 text-sm font-semibold text-rizzotto-stone-200">
          Map Pool
        </legend>

        {/* Map decision mode */}
        <div>
          <Label>Map Decision Mode</Label>
          <div className="flex gap-4 mt-1">
            {(['PICK_BAN', 'RANDOM'] as const).map((opt) => (
              <label key={opt} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="map_decision_mode"
                  value={opt}
                  checked={(form.map_decision_mode ?? 'PICK_BAN') === opt}
                  onChange={handleChange}
                  className="accent-rizzotto-gold-400"
                />
                <span className="text-sm text-rizzotto-stone-300">
                  {opt === 'PICK_BAN' ? 'Pick & Ban' : 'Random Draw'}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Map search */}
        <div>
          <Label>
            Map Selection{' '}
            <span className="text-rizzotto-stone-500 font-normal text-xs">
              ({(form.map_pool ?? []).length}/36 selected, min 3)
            </span>
          </Label>
          <input
            type="text"
            placeholder="Search maps…"
            value={mapSearch}
            onChange={(e) => setMapSearch(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-rizzotto-iron-600 bg-rizzotto-iron-800 px-3 py-1.5 text-sm text-rizzotto-stone-200 placeholder-rizzotto-stone-500 focus:outline-none focus:ring-1 focus:ring-rizzotto-gold-400"
          />
        </div>

        {/* Map grid */}
        <div className="max-h-52 overflow-y-auto rounded-md border border-rizzotto-iron-700 p-2">
          {allMaps.length === 0 ? (
            <p className="text-xs text-rizzotto-stone-500 text-center py-4">Loading maps…</p>
          ) : (
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {allMaps
                .filter((m) =>
                  m.name.toLowerCase().includes(mapSearch.toLowerCase()),
                )
                .map((map) => {
                  const isSelected = (form.map_pool ?? []).includes(map.id);
                  return (
                    <label
                      key={map.id}
                      className={[
                        'flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer transition-colors text-sm',
                        isSelected
                          ? 'bg-rizzotto-gold-500/15 text-rizzotto-gold-400'
                          : 'hover:bg-rizzotto-iron-800 text-rizzotto-stone-300',
                      ].join(' ')}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {
                          const pool = form.map_pool ?? [];
                          const updated = isSelected
                            ? pool.filter((id) => id !== map.id)
                            : [...pool, map.id];
                          setForm((prev) => ({ ...prev, map_pool: updated }));
                        }}
                        className="accent-rizzotto-gold-400 shrink-0"
                      />
                      <span className="truncate">{map.name}</span>
                    </label>
                  );
                })}
            </div>
          )}
        </div>
        {(form.map_pool ?? []).length < 3 && (form.map_pool ?? []).length > 0 && (
          <FieldError message={`Select at least 3 maps (${(form.map_pool ?? []).length} selected)`} />
        )}
      </fieldset>

      {/* ─── Draft ─────────────────────────────────────────────────────── */}
      <fieldset className="space-y-4 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
        <legend className="px-1 text-sm font-semibold text-rizzotto-stone-200">
          {t('tournament.form.draft_section')}
        </legend>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            name="draft_enabled"
            checked={form.draft_enabled ?? false}
            onChange={handleChange}
            className="h-4 w-4 rounded border-rizzotto-iron-600 bg-rizzotto-iron-800 text-rizzotto-gold-500 focus:ring-rizzotto-gold-500"
          />
          <span className="text-sm text-rizzotto-stone-300">
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
        disabled={
          mutation.isPending ||
          !!(form.draft_enabled && !form.draft_preset_id) ||
          ((form.map_pool?.length ?? 0) > 0 && (form.map_pool?.length ?? 0) < 3)
        }
      >
        {mutation.isPending ? t('tournament.form.submitting') : t('tournament.form.submit')}
      </Button>
    </form>
  );
}
