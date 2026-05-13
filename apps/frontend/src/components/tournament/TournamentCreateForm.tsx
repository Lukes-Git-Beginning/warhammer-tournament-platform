import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import { createTournament, listDraftPresets } from '@/lib/api';

const TournamentCreateSchema = z.object({
  name: z.string().min(3, 'Name muss mindestens 3 Zeichen haben').max(128),
  description: z.string().max(5000).optional(),
  format: z.enum(['SINGLE_ELIMINATION', 'SWISS', 'ROUND_ROBIN']),
  mode: z.enum(['ONE_V_ONE', 'TWO_V_TWO']).default('ONE_V_ONE'),
  start_date: z.string().min(1, 'Startdatum erforderlich'),
  timezone: z.string().min(1),
  max_participants: z.coerce.number().int().positive().optional().or(z.literal('')),
  registration_deadline: z.string().optional(),
  rules: z.string().max(10000).optional(),
  discord_link: z.string().url('Ungültige URL').optional().or(z.literal('')),
  draft_enabled: z.boolean().default(false),
  draft_preset_id: z.string().uuid().nullable().optional(),
});

type FormData = z.infer<typeof TournamentCreateSchema>;

export function TournamentCreateForm() {
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
      // Reset preset when draft_enabled is unchecked
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
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    const { max_participants, discord_link, registration_deadline, description, rules, draft_enabled, draft_preset_id, ...rest } =
      result.data;

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
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      {mutation.error && (
        <div className="rounded-md border border-red-800 bg-red-950/50 p-4 text-red-300 text-sm">
          {(mutation.error as Error).message}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1">
          Name <span className="text-red-400">*</span>
        </label>
        <input
          name="name"
          value={form.name ?? ''}
          onChange={handleChange}
          placeholder="Turniername"
          className="w-full rounded-md border border-stone-700 bg-stone-800 px-3 py-2 text-stone-100 placeholder:text-stone-500 focus:border-warhammer-gold focus:outline-none"
        />
        {errors.name && <p className="mt-1 text-xs text-red-400">{errors.name}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1">Beschreibung</label>
        <textarea
          name="description"
          value={form.description ?? ''}
          onChange={handleChange}
          rows={4}
          placeholder="Optionale Beschreibung…"
          className="w-full rounded-md border border-stone-700 bg-stone-800 px-3 py-2 text-stone-100 placeholder:text-stone-500 focus:border-warhammer-gold focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1">
            Format <span className="text-red-400">*</span>
          </label>
          <select
            name="format"
            value={form.format ?? 'SINGLE_ELIMINATION'}
            onChange={handleChange}
            className="w-full rounded-md border border-stone-700 bg-stone-800 px-3 py-2 text-stone-100 focus:border-warhammer-gold focus:outline-none"
          >
            <option value="SINGLE_ELIMINATION">Single Elimination</option>
            <option value="SWISS">Swiss</option>
            <option value="ROUND_ROBIN">Round Robin</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1">Modus</label>
          <select
            name="mode"
            value="ONE_V_ONE"
            disabled
            className="w-full rounded-md border border-stone-700 bg-stone-800 px-3 py-2 text-stone-500 cursor-not-allowed"
          >
            <option value="ONE_V_ONE">1v1 (M1)</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1">
            Startdatum <span className="text-red-400">*</span>
          </label>
          <input
            type="datetime-local"
            name="start_date"
            value={form.start_date ?? ''}
            onChange={handleChange}
            className="w-full rounded-md border border-stone-700 bg-stone-800 px-3 py-2 text-stone-100 focus:border-warhammer-gold focus:outline-none"
          />
          {errors.start_date && <p className="mt-1 text-xs text-red-400">{errors.start_date}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1">Zeitzone</label>
          <input
            name="timezone"
            value={form.timezone ?? defaultTimezone}
            onChange={handleChange}
            className="w-full rounded-md border border-stone-700 bg-stone-800 px-3 py-2 text-stone-100 focus:border-warhammer-gold focus:outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1">Max. Teilnehmer</label>
          <input
            type="number"
            name="max_participants"
            value={form.max_participants ?? ''}
            onChange={handleChange}
            min={2}
            placeholder="Unbegrenzt"
            className="w-full rounded-md border border-stone-700 bg-stone-800 px-3 py-2 text-stone-100 placeholder:text-stone-500 focus:border-warhammer-gold focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1">
            Anmeldeschluss
          </label>
          <input
            type="datetime-local"
            name="registration_deadline"
            value={form.registration_deadline ?? ''}
            onChange={handleChange}
            className="w-full rounded-md border border-stone-700 bg-stone-800 px-3 py-2 text-stone-100 focus:border-warhammer-gold focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1">Regeln (Markdown)</label>
        <textarea
          name="rules"
          value={form.rules ?? ''}
          onChange={handleChange}
          rows={6}
          placeholder="Turnier-Regeln im Markdown-Format…"
          className="w-full rounded-md border border-stone-700 bg-stone-800 px-3 py-2 text-stone-100 placeholder:text-stone-500 font-mono text-sm focus:border-warhammer-gold focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1">Discord-Link</label>
        <input
          name="discord_link"
          value={form.discord_link ?? ''}
          onChange={handleChange}
          placeholder="https://discord.gg/…"
          className="w-full rounded-md border border-stone-700 bg-stone-800 px-3 py-2 text-stone-100 placeholder:text-stone-500 focus:border-warhammer-gold focus:outline-none"
        />
        {errors.discord_link && (
          <p className="mt-1 text-xs text-red-400">{errors.discord_link}</p>
        )}
      </div>

      <div className="space-y-4 rounded-md border border-stone-700 bg-stone-900/50 p-4">
        <h3 className="text-sm font-semibold text-stone-300">Draft-System</h3>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            name="draft_enabled"
            checked={form.draft_enabled ?? false}
            onChange={handleChange}
            className="h-4 w-4 rounded border-stone-600 bg-stone-800 text-warhammer-gold focus:ring-warhammer-gold"
          />
          <span className="text-sm text-stone-300">Draft-System aktivieren</span>
        </label>

        {form.draft_enabled && (
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1">
              Draft-Preset <span className="text-red-400">*</span>
            </label>
            <select
              name="draft_preset_id"
              value={form.draft_preset_id ?? ''}
              onChange={handleChange}
              className="w-full rounded-md border border-stone-700 bg-stone-800 px-3 py-2 text-stone-100 focus:border-warhammer-gold focus:outline-none"
            >
              <option value="">— Preset wählen —</option>
              {draftPresets?.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name} ({preset.turns.length} Züge, {preset.turn_seconds}s pro Zug)
                </option>
              ))}
            </select>
            {form.draft_enabled && !form.draft_preset_id && (
              <p className="mt-1 text-xs text-amber-400">
                Bitte ein Preset wählen, um das Draft-System zu aktivieren.
              </p>
            )}
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={mutation.isPending || !!(form.draft_enabled && !form.draft_preset_id)}
        className="rounded-md bg-warhammer-gold px-6 py-2.5 font-semibold text-stone-950 transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {mutation.isPending ? 'Wird erstellt…' : 'Turnier erstellen'}
      </button>
    </form>
  );
}
