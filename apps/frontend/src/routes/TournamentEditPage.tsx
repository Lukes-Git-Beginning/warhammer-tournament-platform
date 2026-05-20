import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  getTournament,
  patchTournament,
  type Tournament,
  type TournamentPatchInput,
} from '@/lib/api';
import { useAuthQuery } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label, FieldError, FieldHint } from '@/components/ui/label';
import { PageShell } from '@/components/layout/PageShell';

const TournamentEditSchema = z.object({
  name: z.string().min(3).max(120),
  description: z.string().max(2000).optional(),
  start_date: z.string().min(1),
  timezone: z.string().min(1),
  max_participants: z.coerce.number().int().min(2).max(512).optional().or(z.literal('')),
  registration_deadline: z.string().optional(),
  rules: z.string().max(20000).optional(),
  discord_link: z.string().url().optional().or(z.literal('')),
});

type FormData = z.infer<typeof TournamentEditSchema>;

// Convert an ISO timestamp to the "YYYY-MM-DDTHH:mm" shape <input type="datetime-local"> expects.
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(local: string): string {
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? local : d.toISOString();
}

function buildInitialForm(t: Tournament): FormData {
  return {
    name: t.name,
    description: t.description ?? '',
    start_date: isoToLocalInput(t.start_date),
    timezone: t.timezone,
    max_participants: t.max_participants ?? '',
    registration_deadline: isoToLocalInput(t.registration_deadline),
    rules: t.rules ?? '',
    discord_link: t.discord_link ?? '',
  };
}

// Build PATCH body containing only fields whose normalized value diverges from
// the loaded tournament. Empty optional strings are sent as `null` to clear.
function buildPatchBody(
  current: Tournament,
  form: FormData,
): TournamentPatchInput {
  const body: TournamentPatchInput = {};
  if (form.name !== current.name) body.name = form.name;
  if (form.timezone !== current.timezone) body.timezone = form.timezone;

  const startIso = localInputToIso(form.start_date);
  if (startIso !== current.start_date) body.start_date = startIso;

  const deadlineNormalized = form.registration_deadline
    ? localInputToIso(form.registration_deadline)
    : null;
  if (deadlineNormalized !== (current.registration_deadline ?? null)) {
    body.registration_deadline = deadlineNormalized;
  }

  const maxParticipantsNormalized =
    form.max_participants === '' || form.max_participants == null
      ? null
      : Number(form.max_participants);
  if (maxParticipantsNormalized !== (current.max_participants ?? null)) {
    body.max_participants = maxParticipantsNormalized;
  }

  const descNormalized = form.description?.trim() ? form.description : null;
  if (descNormalized !== (current.description ?? null)) {
    body.description = descNormalized;
  }

  const rulesNormalized = form.rules?.trim() ? form.rules : null;
  if (rulesNormalized !== (current.rules ?? null)) {
    body.rules = rulesNormalized;
  }

  const discordNormalized = form.discord_link?.trim() ? form.discord_link : null;
  if (discordNormalized !== (current.discord_link ?? null)) {
    body.discord_link = discordNormalized;
  }

  return body;
}

export function TournamentEditPage() {
  const { t } = useTranslation();
  const { slug } = useParams({ from: '/tournaments/$slug/edit' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: user } = useAuthQuery();

  const { data: tournament, isLoading, error } = useQuery({
    queryKey: ['tournament', slug],
    queryFn: () => getTournament(slug),
    retry: false,
  });

  const [form, setForm] = useState<FormData | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});

  useEffect(() => {
    if (tournament && form === null) {
      setForm(buildInitialForm(tournament));
    }
  }, [tournament, form]);

  const canManage =
    !!user &&
    !!tournament &&
    (user.role === 'MODERATOR' ||
      user.role === 'ADMIN' ||
      (user.role === 'ORGANIZER' && tournament.organizer?.id === user.id));

  useEffect(() => {
    if (!isLoading && tournament && user && !canManage) {
      void navigate({ to: '/tournaments/$slug', params: { slug } });
    }
  }, [isLoading, tournament, user, canManage, navigate, slug]);

  const mutation = useMutation({
    mutationFn: (body: TournamentPatchInput) => patchTournament(slug, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tournament', slug] });
      await queryClient.invalidateQueries({ queryKey: ['tournaments'] });
      await navigate({ to: '/tournaments/$slug', params: { slug } });
    },
  });

  if (isLoading || !tournament || !form) {
    return (
      <PageShell variant="narrow" className="text-rizzotto-stone-400">
        {t('tournament.edit.loading')}
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell variant="narrow">
        <div className="rounded-md border border-red-900 bg-red-950/40 p-6 text-red-300 text-sm">
          {t('tournament.edit.not_found')}
        </div>
      </PageShell>
    );
  }

  if (!canManage) {
    // Redirect is in-flight via the effect above; render a placeholder.
    return (
      <PageShell variant="narrow">
        <div className="rounded-md border border-red-900 bg-red-950/40 p-6 text-red-300 text-sm">
          {t('tournament.edit.forbidden')}
        </div>
      </PageShell>
    );
  }

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) {
    const { name, value } = e.target;
    setForm((prev) => (prev ? { ...prev, [name]: value } : prev));
    setErrors((prev) => ({ ...prev, [name]: undefined }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form || !tournament) return;

    const result = TournamentEditSchema.safeParse(form);
    if (!result.success) {
      const fieldErrors: Partial<Record<keyof FormData, string>> = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof FormData;
        if (!fieldErrors[key]) {
          if (key === 'name') fieldErrors[key] = t('tournament.form.errors.name_min');
          else if (key === 'start_date') fieldErrors[key] = t('tournament.form.errors.start_required');
          else if (key === 'discord_link') fieldErrors[key] = t('tournament.form.errors.discord_invalid');
          else fieldErrors[key] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    const body = buildPatchBody(tournament, result.data);
    if (Object.keys(body).length === 0) {
      // No-op edit — just navigate back.
      void navigate({ to: '/tournaments/$slug', params: { slug } });
      return;
    }
    mutation.mutate(body);
  }

  return (
    <PageShell variant="narrow">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500">
          {t('tournament.edit.title')}
        </h1>
        <p className="mt-2 text-sm text-rizzotto-stone-400">
          {t('tournament.edit.subtitle')}
        </p>
      </header>

      <form onSubmit={handleSubmit} className="w-full space-y-6">
        {mutation.error && (
          <div className="rounded-md border border-red-800 bg-red-950/50 p-4 text-sm text-red-300">
            {(mutation.error as Error).message}
          </div>
        )}

        {/* Read-only: format + mode */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <Label>{t('tournament.form.format')}</Label>
            <div className="mt-1 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/40 px-3 py-2 text-sm text-rizzotto-stone-300">
              {tournament.format}
            </div>
          </div>
          <div className="min-w-0">
            <Label>{t('tournament.form.mode')}</Label>
            <div className="mt-1 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/40 px-3 py-2 text-sm text-rizzotto-stone-300">
              {tournament.mode}
            </div>
          </div>
        </div>
        <FieldHint>{t('tournament.edit.format_locked')}</FieldHint>

        <div>
          <Label htmlFor="tef-name" required>
            {t('tournament.form.name')}
          </Label>
          <Input
            id="tef-name"
            name="name"
            value={form.name}
            onChange={handleChange}
            placeholder={t('tournament.form.name_placeholder')}
          />
          <FieldError message={errors.name} />
        </div>

        <div>
          <Label htmlFor="tef-description">{t('tournament.form.description')}</Label>
          <Textarea
            id="tef-description"
            name="description"
            value={form.description ?? ''}
            onChange={handleChange}
            rows={4}
            placeholder={t('tournament.form.description_placeholder')}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <Label htmlFor="tef-start" required>
              {t('tournament.form.start_date')}
            </Label>
            <Input
              id="tef-start"
              type="datetime-local"
              name="start_date"
              value={form.start_date}
              onChange={handleChange}
            />
            <FieldError message={errors.start_date} />
          </div>

          <div className="min-w-0">
            <Label htmlFor="tef-tz">{t('tournament.form.timezone')}</Label>
            <Input
              id="tef-tz"
              name="timezone"
              value={form.timezone}
              onChange={handleChange}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <Label htmlFor="tef-max">{t('tournament.form.max_participants')}</Label>
            <Input
              id="tef-max"
              type="number"
              name="max_participants"
              value={form.max_participants ?? ''}
              onChange={handleChange}
              min={2}
              placeholder={t('tournament.form.max_participants_placeholder')}
            />
          </div>

          <div className="min-w-0">
            <Label htmlFor="tef-deadline">{t('tournament.form.registration_deadline')}</Label>
            <Input
              id="tef-deadline"
              type="datetime-local"
              name="registration_deadline"
              value={form.registration_deadline ?? ''}
              onChange={handleChange}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="tef-rules">{t('tournament.form.rules')}</Label>
          <Textarea
            id="tef-rules"
            name="rules"
            value={form.rules ?? ''}
            onChange={handleChange}
            rows={6}
            placeholder={t('tournament.form.rules_placeholder')}
            className="font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="tef-discord">{t('tournament.form.discord_link')}</Label>
          <Input
            id="tef-discord"
            name="discord_link"
            value={form.discord_link ?? ''}
            onChange={handleChange}
            placeholder="https://discord.gg/…"
          />
          <FieldError message={errors.discord_link} />
        </div>

        <div className="flex gap-3">
          <Button type="submit" variant="forge" size="md" disabled={mutation.isPending}>
            {mutation.isPending
              ? t('tournament.form.submitting_edit')
              : t('tournament.form.submit_edit')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="md"
            disabled={mutation.isPending}
            onClick={() => navigate({ to: '/tournaments/$slug', params: { slug } })}
          >
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </PageShell>
  );
}
