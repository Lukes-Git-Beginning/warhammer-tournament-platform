import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { createTournament, listDraftPresets, getMaps, getFactions, getAvailabilityHeatmap, uploadTournamentPoster } from '@/lib/api';
import { useAuthQuery } from '@/lib/auth';
import { AvailabilityHeatmap } from '@/components/open-play/AvailabilityHeatmap';
import { StandardRulesetCard } from '@/components/tournament/StandardRulesetCard';
import { PosterPickField } from '@/components/tournament/PosterPickField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MarkdownEditor } from '@/components/ui/markdown-editor';
import { Select } from '@/components/ui/select';
import { Label, FieldError, FieldHint } from '@/components/ui/label';

const TournamentCreateSchema = z.object({
  name: z.string().min(3).max(128),
  description: z.string().max(5000).optional(),
  format: z.enum(['SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'SWISS', 'AUTO_SWISS', 'ROUND_ROBIN', 'LIECHTENSTEIN', 'BALANCED_LIECHTENSTEIN']),
  mode: z.enum(['BPT', 'SFT', 'SLT', 'MATRIX', 'TWO_D_THREE', 'FREE_PICK', 'ONE_V_THREE']).default('BPT'),
  set_faction_id: z.string().min(1).optional(),
  start_date: z.string().min(1),
  timezone: z.string().min(1),
  max_participants: z.coerce.number().int().positive().optional().or(z.literal('')),
  registration_deadline: z.string().optional(),
  rules: z.string().max(10000).optional(),
  standard_rules_enabled: z.boolean().default(true),
  restrictions: z.string().max(10000).optional(),
  discord_link: z.string().url().optional().or(z.literal('')),
  stream_url: z.string().url().optional().or(z.literal('')),
  draft_enabled: z.boolean().default(false),
  draft_preset_id: z.string().uuid().nullable().optional(),
  // Welle 2 fields
  rounds_count: z.coerce.number().int().min(3).max(8).default(5),
  has_third_place_match: z.boolean().default(false),
  playoff_format: z.enum(['NONE', 'TOP2', 'TOP4', 'TOP8']).default('NONE'),
  auto_sizing: z.boolean().default(false),
  auto_advance: z.boolean().default(false),
  allow_late_join_requests: z.boolean().default(false),
  swiss_match_format: z.enum(['BO1', 'BO2', 'BO3', 'BO5']).default('BO1'),
  playoff_match_format: z.enum(['BO1', 'BO2', 'BO3', 'BO5']).default('BO1'),
  finale_match_format: z.enum(['BO1', 'BO2', 'BO3', 'BO5']).default('BO1'),
  map_decision_mode: z.enum(['RANDOM', 'PICK_BAN', 'RANDOM_NO_REPEAT', 'HOST_PRESET', 'HOST_PRESET_PICK_BAN', 'RANDOM_PICK_BAN']).default('RANDOM_PICK_BAN'),
  map_pool: z.array(z.string()).max(36).default([]),
  map_preset_config: z.record(z.string(), z.unknown()).nullable().optional(),
  faction_pool: z.array(z.string()).optional(),
  restricted_factions: z.array(z.string()).optional(),
});

type FormData = z.infer<typeof TournamentCreateSchema>;

type MapDecisionModeOption = {
  value: FormData['map_decision_mode'];
  label: string;
  description: string;
};

const MAP_DECISION_MODES: MapDecisionModeOption[] = [
  { value: 'RANDOM_NO_REPEAT', label: 'Random (No Repeat)', description: 'Server picks one random map. Already-played maps are excluded.' },
  { value: 'HOST_PRESET', label: 'Host Preset (1 Map)', description: 'Host sets one map per round in order. No player interaction needed.' },
  { value: 'HOST_PRESET_PICK_BAN', label: 'Host Preset Ban&Pick', description: 'Host defines 3 maps per round & game. Each player bans one.' },
  { value: 'RANDOM_PICK_BAN', label: 'Random Ban&Pick', description: 'Server draws 3 random maps per game. Each player bans one.' },
];

function formatToMaxGames(fmt?: string): number {
  if (fmt === 'BO2') return 2;
  if (fmt === 'BO3') return 3;
  if (fmt === 'BO5') return 5;
  return 1;
}

/**
 * Worst-case number of games a single player can play — the map-pool size needed
 * so that player never repeats a map (RANDOM_NO_REPEAT). Exact for Swiss/
 * Liechtenstein; estimated for elimination / round-robin from max_participants.
 */
function maxPlayerGames(form: Partial<FormData>): number {
  const swissGames = formatToMaxGames(form.swiss_match_format);
  const playoffGames = formatToMaxGames(form.playoff_match_format);
  const finaleGames = formatToMaxGames(form.finale_match_format);
  const participants = form.max_participants ? Number(form.max_participants) : 0;
  const playoffExtra =
    form.playoff_format === 'TOP4'
      ? playoffGames + finaleGames
      : form.playoff_format === 'TOP8'
        ? 2 * playoffGames + finaleGames
        : 0;
  switch (form.format) {
    case 'SWISS':
    case 'LIECHTENSTEIN':
    case 'BALANCED_LIECHTENSTEIN':
      return (form.rounds_count ?? 5) * swissGames + playoffExtra;
    case 'ROUND_ROBIN':
      return (participants > 1 ? participants - 1 : 7) * swissGames + playoffExtra;
    case 'SINGLE_ELIMINATION':
      return (participants > 1 ? Math.ceil(Math.log2(participants)) : 4) * swissGames;
    case 'DOUBLE_ELIMINATION':
      return 2 * (participants > 1 ? Math.ceil(Math.log2(participants)) : 4) * swissGames;
    default:
      return (form.rounds_count ?? 5) * swissGames;
  }
}

function buildRoundKeys(form: Partial<FormData>): { key: string; label: string; maxGames: number }[] {
  const keys: { key: string; label: string; maxGames: number }[] = [];
  const swissGames = formatToMaxGames(form.swiss_match_format);
  const playoffGames = formatToMaxGames(form.playoff_match_format);
  const finaleGames = formatToMaxGames(form.finale_match_format);

  if (form.format === 'SWISS' || form.format === 'LIECHTENSTEIN' || form.format === 'BALANCED_LIECHTENSTEIN') {
    const rounds = form.rounds_count ?? 5;
    const roundLabel = form.format === 'LIECHTENSTEIN' ? 'Liechtenstein Round' : form.format === 'BALANCED_LIECHTENSTEIN' ? 'Balanced Liechtenstein Round' : 'Swiss Round';
    for (let i = 1; i <= rounds; i++) {
      keys.push({ key: `swiss_${i}`, label: `${roundLabel} ${i}`, maxGames: swissGames });
    }
  }

  const isSE = form.format === 'SINGLE_ELIMINATION';
  const isDE = form.format === 'DOUBLE_ELIMINATION';

  if (isSE) {
    // 4 numbered elim rounds covers up to 64 players (SF + GF are named stages).
    for (let i = 1; i <= 4; i++) {
      keys.push({ key: `swiss_${i}`, label: `Elim Round ${i}`, maxGames: swissGames });
    }
  } else if (isDE) {
    // WB rounds 1–4 (covers up to 64 players). LB rounds 1–6 (normalized from R_W+1).
    for (let i = 1; i <= 4; i++) {
      keys.push({ key: `wb_round_${i}`, label: `WB Round ${i}`, maxGames: swissGames });
    }
    for (let i = 1; i <= 6; i++) {
      keys.push({ key: `lb_round_${i}`, label: `LB Round ${i}`, maxGames: swissGames });
    }
  }

  const hasPlayoffs = isSE || isDE || form.playoff_format === 'TOP4' || form.playoff_format === 'TOP8';

  if (hasPlayoffs) {
    if (form.playoff_format === 'TOP8') {
      keys.push({ key: 'playoff_qf', label: 'Quarterfinals', maxGames: playoffGames });
    }
    keys.push({ key: 'playoff_sf', label: 'Semifinals', maxGames: playoffGames });
    keys.push({ key: 'playoff_final', label: 'Grand Final', maxGames: finaleGames });
    if (form.has_third_place_match && !isDE) {
      keys.push({ key: 'playoff_third', label: 'Small Final (3rd Place)', maxGames: playoffGames });
    }
  }

  return keys;
}

function nextRoundHour(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(20, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

export function TournamentCreateForm() {
  const { t } = useTranslation();
  const router = useRouter();
  const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [form, setForm] = useState<Partial<FormData>>({
    format: 'SINGLE_ELIMINATION',
    mode: 'BPT',
    timezone: defaultTimezone,
    start_date: nextRoundHour(),
    registration_deadline: nextRoundHour(),
    draft_enabled: false,
    standard_rules_enabled: true,
    rounds_count: 5,
    has_third_place_match: false,
    playoff_format: 'NONE',
    auto_sizing: false,
    auto_advance: false,
    allow_late_join_requests: false,
    swiss_match_format: 'BO1',
    playoff_match_format: 'BO1',
    finale_match_format: 'BO1',
    map_decision_mode: 'RANDOM_PICK_BAN',
    map_pool: [],
    map_preset_config: null,
  });
  const [mapSearch, setMapSearch] = useState('');
  const [factionPoolEnabled, setFactionPoolEnabled] = useState(false);
  const [restrictedFactionsEnabled, setRestrictedFactionsEnabled] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});

  const { data: _draftPresets } = useQuery({
    queryKey: ['draft-presets'],
    queryFn: listDraftPresets,
  });

  const { data: mapsData } = useQuery({
    queryKey: ['maps'],
    queryFn: getMaps,
  });
  const allMaps = mapsData?.data ?? [];

  // Default the map pool to ALL maps once they load (only if untouched).
  const mapPoolInitialized = useRef(false);
  useEffect(() => {
    if (mapPoolInitialized.current || allMaps.length === 0) return;
    mapPoolInitialized.current = true;
    setForm((prev) =>
      (prev.map_pool ?? []).length === 0
        ? { ...prev, map_pool: allMaps.map((m) => m.id) }
        : prev,
    );
  }, [allMaps]);

  const { data: factionsData } = useQuery({
    queryKey: ['factions'],
    queryFn: () => getFactions(),
  });
  const allFactions = (factionsData?.data ?? []).map((f) => f.faction).sort((a, b) => a.name.localeCompare(b.name));

  // N8: general community availability, shown next to the start-time picker so
  // the host can choose a slot when most players are around.
  const { data: me } = useAuthQuery();
  const { data: heatmapData } = useQuery({
    queryKey: ['availability-heatmap', 'TOURNAMENT'],
    queryFn: () => getAvailabilityHeatmap('TOURNAMENT'),
    staleTime: 5 * 60 * 1000,
  });

  // Default the faction pool to ALL factions once they load (only if the pool
  // toggle is on and no factions have been manually selected yet).
  const factionPoolInitialized = useRef(false);
  useEffect(() => {
    if (factionPoolInitialized.current || allFactions.length === 0) return;
    factionPoolInitialized.current = true;
    if (factionPoolEnabled && (form.faction_pool ?? []).length === 0) {
      setForm((prev) => ({ ...prev, faction_pool: allFactions.map((f) => f.id) }));
    }
  }, [allFactions, factionPoolEnabled, form.faction_pool]);

  // Modes that draw from the shared map pool. Host-preset modes define maps
  // per round instead, so the shared-pool minimum does not apply to them.
  const usesMapPool = !(
    form.map_decision_mode === 'HOST_PRESET' || form.map_decision_mode === 'HOST_PRESET_PICK_BAN'
  );
  const maxFormatGames = Math.max(
    formatToMaxGames(form.swiss_match_format),
    formatToMaxGames(form.playoff_match_format),
    formatToMaxGames(form.finale_match_format),
  );
  // RANDOM_NO_REPEAT needs enough maps so no player repeats a map across all
  // their games; other pool modes only need to cover the longest single match.
  // Floor of 3. Only enforced when usesMapPool.
  const minPool =
    form.map_decision_mode === 'RANDOM_NO_REPEAT'
      ? Math.max(3, maxPlayerGames(form))
      : Math.max(3, maxFormatGames);

  const [posterFile, setPosterFile] = useState<File | null>(null);

  const mutation = useMutation({
    mutationFn: createTournament,
    onSuccess: async (tournament) => {
      // The poster upload needs an existing tournament (its slug), so it runs
      // here after creation. A failed upload is non-fatal — the tournament
      // exists and the host can add the poster later on the edit page.
      if (posterFile) {
        try {
          await uploadTournamentPoster(tournament.slug, posterFile);
        } catch {
          // swallow — tournament is created, poster is optional
        }
      }
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
      ...(name === 'format'
        ? prev.mode === 'ONE_V_THREE'
          ? {
              // 1v3: 2-leg home/away (BO2) for Swiss rounds, BO3 for brackets.
              swiss_match_format: value === 'SINGLE_ELIMINATION' || value === 'DOUBLE_ELIMINATION' ? 'BO3' : 'BO2',
              playoff_match_format: 'BO3',
              finale_match_format: 'BO3',
              auto_sizing: value === 'BALANCED_LIECHTENSTEIN',
            }
          : {
              finale_match_format: value === 'DOUBLE_ELIMINATION' ? 'BO3' : 'BO1',
              // Balanced Liechtenstein auto-sizes by default; every other format
              // starts with auto-sizing off (the host opts in via the checkbox).
              auto_sizing: value === 'BALANCED_LIECHTENSTEIN',
            }
        : {}),
      ...(name === 'mode' && value === 'ONE_V_THREE'
        ? {
            // 1v3 defaults: BO2 two-leg home/away for Swiss rounds (1–1 = Draw),
            // BO3 for elimination brackets (need a decisive winner). Host can override.
            swiss_match_format: prev.format === 'SINGLE_ELIMINATION' || prev.format === 'DOUBLE_ELIMINATION' ? 'BO3' : 'BO2',
            playoff_match_format: 'BO3',
            finale_match_format: 'BO3',
          }
        : {}),
      ...(name === 'start_date' ? { registration_deadline: value } : {}),
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

    // Map pool minimum only applies to modes that use the shared pool.
    // Host-preset modes define their maps per round, so the pool may be empty.
    if (usesMapPool && (result.data.map_pool ?? []).length < minPool) {
      setErrors((prev) => ({
        ...prev,
        map_pool: `Select at least ${minPool} maps for this map decision mode.`,
      }));
      return;
    }

    const {
      max_participants,
      discord_link,
      stream_url,
      registration_deadline,
      description,
      rules,
      draft_enabled,
      draft_preset_id,
      map_pool,
      map_preset_config,
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
      ...(stream_url ? { stream_url } : {}),
      ...(registration_deadline
        ? { registration_deadline: toIsoOrInvalid(registration_deadline) }
        : {}),
      ...(description ? { description } : {}),
      ...(rules ? { rules } : {}),
      draft_enabled: draft_enabled ?? false,
      ...(draft_preset_id ? { draft_preset_id } : {}),
      map_pool: map_pool ?? [],
      ...(map_preset_config ? { map_preset_config: map_preset_config as Record<string, string[] | string[][]> } : {}),
      ...(factionPoolEnabled && (form.faction_pool ?? []).length > 0 && (form.faction_pool ?? []).length < allFactions.length
        ? { faction_pool: form.faction_pool }
        : {}),
      ...(restrictedFactionsEnabled && (form.restricted_factions ?? []).length > 0
        ? { restricted_factions: form.restricted_factions }
        : {}),
      ...(rest.mode === 'ONE_V_THREE' && rest.set_faction_id
        ? { set_faction_id: rest.set_faction_id }
        : {}),
    });
  }

  const isBalanced = form.format === 'BALANCED_LIECHTENSTEIN';
  // Balanced defaults to auto-sizing; the host can turn it off for fixed rounds.
  const balancedAutoSized = isBalanced && (form.auto_sizing ?? true);

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
        <MarkdownEditor
          id="tcf-description"
          name="description"
          value={form.description ?? ''}
          onChange={handleChange}
          rows={4}
          maxLength={5000}
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
            <optgroup label="── Standard ──">
              <option value="SINGLE_ELIMINATION">{t('tournament.format.single_elim')}</option>
              <option value="DOUBLE_ELIMINATION">{t('tournament.format.double_elim')}</option>
              <option value="SWISS">{t('tournament.format.swiss')}</option>
              <option value="ROUND_ROBIN">{t('tournament.format.round_robin')}</option>
              <option value="LIECHTENSTEIN">{t('tournament.format.liechtenstein')}</option>
              <option value="BALANCED_LIECHTENSTEIN">{t('tournament.format.balanced_liechtenstein')}</option>
            </optgroup>
          </Select>
        </div>

        <div className="min-w-0">
          <Label htmlFor="tcf-mode">{t('tournament.form.mode')}</Label>
          <Select
            id="tcf-mode"
            name="mode"
            value={form.mode ?? 'BPT'}
            onChange={handleChange}
          >
            <option value="BPT">BPT — Blind Pick Tournament</option>
            <option value="SFT">SFT — Single Faction Tournament</option>
            <option value="SLT">SLT — Single List Tournament</option>
            <option value="MATRIX">3×3 Matrix — Faction Matrix Pick/Ban</option>
            <option value="TWO_D_THREE">2D3 — Draw 3 Factions per Player</option>
            <option value="FREE_PICK">Enticity&apos;s Free Pick — SFT/Matrix Hybrid</option>
            <option value="ONE_V_THREE">1v3 — Set Faction vs. One of Three Counterpicks</option>
          </Select>
          <FieldHint>
            {(form.mode === 'BPT' || !form.mode) && 'Every match includes a blind faction pick phase.'}
            {form.mode === 'SFT' && 'Players pre-select a faction at registration; revealed at tournament start.'}
            {form.mode === 'SLT' && 'Players upload their army list at registration. Reveal after each completed match.'}
            {form.mode === 'MATRIX' && 'Each match: both players pick 3 factions blindly, then ban from the 3×3 matchup grid.'}
            {form.mode === 'TWO_D_THREE' && 'Players pick 3 factions at registration; one is drawn at random for each player before every game.'}
            {form.mode === 'FREE_PICK' && 'Each player chooses at registration: a fixed faction (like SFT) or to pick match-by-match. Two fixed players just play their factions; two pick-later players do a 3×3 matrix; a fixed vs pick-later match has the pick-later player offer 3 factions for the fixed player to choose from.'}
            {form.mode === 'ONE_V_THREE' && 'A coin flip sets roles each match: one player runs the host\'s set faction, the other brings three, and the set-faction player picks which of the three their opponent plays.'}
          </FieldHint>
        </div>

        {/* ─── ONE_V_THREE: Set Faction ──────────────────────────────────── */}
        {form.mode === 'ONE_V_THREE' && (
          <div>
            <Label htmlFor="tcf-set-faction" required>
              Set faction (the Runner plays this)
            </Label>
            <div className="max-h-52 overflow-y-auto rounded-md border border-rizzotto-iron-700 p-2">
              {allFactions.length === 0 ? (
                <p className="text-xs text-rizzotto-stone-500 text-center py-4">Loading factions…</p>
              ) : (
                <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                  {allFactions.map((faction) => {
                    const isSelected = form.set_faction_id === faction.id;
                    return (
                      <label
                        key={faction.id}
                        className={[
                          'flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer transition-colors text-sm',
                          isSelected
                            ? 'bg-rizzotto-gold-500/15 text-rizzotto-gold-400'
                            : 'text-rizzotto-stone-300 hover:bg-rizzotto-iron-700/50',
                        ].join(' ')}
                      >
                        <input
                          type="radio"
                          name="set_faction_id"
                          value={faction.id}
                          checked={isSelected}
                          onChange={() => setForm((prev) => ({ ...prev, set_faction_id: faction.id }))}
                          className="accent-rizzotto-gold-400 shrink-0"
                        />
                        <span className="truncate">{faction.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            {errors.set_faction_id && <FieldError message={errors.set_faction_id} />}
          </div>
        )}
      </div>

      {(form.format === 'SWISS' || form.format === 'BALANCED_LIECHTENSTEIN') && (
        <fieldset className="space-y-2 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
          <legend className="px-1 text-sm font-semibold text-rizzotto-stone-200">Automation</legend>
          <p className="text-xs text-rizzotto-stone-500">
            {form.format === 'SWISS'
              ? 'Turn both on for a fully self-running tournament (what “Auto Swiss” used to be).'
              : 'Balanced Liechtenstein advances itself — you only choose whether the round count is auto-sized from the check-in count.'}
          </p>
          <label className="flex items-start gap-2 text-sm text-rizzotto-stone-300">
            <input type="checkbox" name="auto_sizing" checked={form.auto_sizing ?? false} onChange={handleChange} className="mt-0.5" />
            <span>
              <span className="font-medium text-rizzotto-stone-200">Auto-size from check-in</span>
              <span className="block text-xs text-rizzotto-stone-500">
                {form.format === 'SWISS'
                  ? 'Set the round count and playoff size automatically from how many players check in (4–7: 3R + Final · 8–15: 5R + Top 4 · 16+: 4R + Top 8), instead of the fixed values above.'
                  : 'Set the round count automatically from how many players check in (4–7: 3R · 8–15: 5R · 16+: 4R). Turn off to fix the round count yourself.'}
              </span>
            </span>
          </label>
          {form.format === 'SWISS' && (
            <label className="flex items-start gap-2 text-sm text-rizzotto-stone-300">
              <input type="checkbox" name="auto_advance" checked={form.auto_advance ?? false} onChange={handleChange} className="mt-0.5" />
              <span>
                <span className="font-medium text-rizzotto-stone-200">Auto-advance rounds &amp; playoffs</span>
                <span className="block text-xs text-rizzotto-stone-500">Advance to the next round and generate the playoffs automatically once every match in a round is complete, instead of the host doing it by hand.</span>
              </span>
            </label>
          )}
        </fieldset>
      )}

      <label className="flex items-start gap-2 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4 text-sm text-rizzotto-stone-300">
        <input type="checkbox" name="allow_late_join_requests" checked={form.allow_late_join_requests ?? false} onChange={handleChange} className="mt-0.5" />
        <span>
          <span className="font-medium text-rizzotto-stone-200">Allow late-join requests</span>
          <span className="block text-xs text-rizzotto-stone-500">
            Players can request to join after the tournament has started; you approve or decline each request
            (a Discord DM plus a panel on the tournament page). They fill in everything a normal sign-up needs first.
          </span>
        </span>
      </label>

      {form.format === 'AUTO_SWISS' && (
        <div className="rounded-lg border border-rizzotto-gold-500/30 bg-rizzotto-gold-500/5 p-4 text-sm text-rizzotto-stone-300 space-y-1">
          <p className="font-semibold text-rizzotto-gold-400">Auto Swiss — self-running tournament</p>
          <p>Check-in opens automatically 1 hour before start. Rounds and playoff size are determined by how many players check in (4–7: 3R + Final, 8–15: 5R + Top 4, 16+: 4R + Top 8). Rounds advance automatically when all matches are complete. All matches: BO1 · Map: Random Ban&amp;Pick.</p>
        </div>
      )}

      {form.format === 'BALANCED_LIECHTENSTEIN' && (
        <div className="rounded-lg border border-rizzotto-gold-500/30 bg-rizzotto-gold-500/5 p-4 text-sm text-rizzotto-stone-300 space-y-1">
          <p className="font-semibold text-rizzotto-gold-400">Balanced Liechtenstein — skill-matched, self-running</p>
          <p>
            Each round, players are paired against others in their own skill division.{' '}
            {(form.auto_sizing ?? true)
              ? 'The round count is set automatically from how many players check in (4–7: 3R, 8–15: 5R, 16+: 4R).'
              : 'You set a fixed round count below.'}{' '}
            When the group stage ends, every division runs its own playoff bracket sized to that division (TOP 2 / 4 / 8, each with a third-place match).
          </p>
        </div>
      )}

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

      </div>

      {/* N8: general availability heatmap to help the host pick a start time */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-stone-300">When are players usually around?</p>
        <p className="text-xs text-stone-500">
          Community availability — brighter means more players have marked this time as free. Pick a start time when most can attend.
        </p>
        <AvailabilityHeatmap slots={heatmapData?.slots ?? []} userTimezone={me?.timezone ?? undefined} hue={199} />
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

      {/* ─── Rules (N17) ───────────────────────────────────────────────── */}
      <fieldset className="space-y-4 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
        <legend className="px-1 text-sm font-semibold text-rizzotto-stone-200">Rules</legend>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            name="standard_rules_enabled"
            checked={form.standard_rules_enabled ?? false}
            onChange={handleChange}
            className="accent-rizzotto-gold-400 h-4 w-4"
          />
          <span className="text-sm text-rizzotto-stone-300">Enable standard rules</span>
        </label>
        {form.standard_rules_enabled && <StandardRulesetCard compact />}

        <div>
          <Label htmlFor="tcf-rules">Custom Rules</Label>
          <MarkdownEditor
            id="tcf-rules"
            name="rules"
            value={form.rules ?? ''}
            onChange={handleChange}
            rows={6}
            maxLength={10000}
            placeholder={t('tournament.form.rules_placeholder')}
          />
        </div>

        <div>
          <Label htmlFor="tcf-restrictions">Custom Restrictions</Label>
          <MarkdownEditor
            id="tcf-restrictions"
            name="restrictions"
            value={form.restrictions ?? ''}
            onChange={handleChange}
            rows={4}
            maxLength={10000}
            placeholder="Faction-specific house rules, list-submission notes, …"
          />
        </div>
      </fieldset>

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

      <div>
        <Label htmlFor="tcf-stream">Stream link (optional)</Label>
        <Input
          id="tcf-stream"
          name="stream_url"
          value={form.stream_url ?? ''}
          onChange={handleChange}
          placeholder="https://twitch.tv/…"
        />
      </div>

      <PosterPickField file={posterFile} onPick={setPosterFile} />

      {/* ─── Match Mechanics ───────────────────────────────────────────── */}
      <fieldset className="space-y-4 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
        <legend className="px-1 text-sm font-semibold text-rizzotto-stone-200">
          Match Mechanics
        </legend>

        {(form.format === 'SWISS' || form.format === 'ROUND_ROBIN' || form.format === 'LIECHTENSTEIN' || isBalanced) ? (
          <>
            {/* Rounds count — Swiss/Liechtenstein always; Balanced only when the
                host turned auto-sizing off (fixed rounds). Round Robin rounds are
                determined by participant count. */}
            {(form.format === 'SWISS' || form.format === 'LIECHTENSTEIN' || (isBalanced && !balancedAutoSized)) && <div>
              <Label htmlFor="tcf-rounds">{form.format === 'LIECHTENSTEIN' ? 'Liechtenstein Rounds' : isBalanced ? 'Balanced Liechtenstein Rounds' : 'Swiss Rounds'}</Label>
              <div className="flex items-center gap-3 mt-1">
                <input
                  id="tcf-rounds"
                  type="range"
                  name="rounds_count"
                  min={3}
                  max={8}
                  step={1}
                  value={form.rounds_count ?? 5}
                  onChange={handleChange}
                  className="w-full accent-rizzotto-gold-400"
                />
                <span className="w-6 text-center font-semibold text-rizzotto-stone-200 tabular-nums">
                  {form.rounds_count ?? 5}
                </span>
              </div>
              <FieldHint>Number of rounds (3–8). All rounds pre-generated randomly at start. Default: 5.</FieldHint>
            </div>}

            {/* Playoff format + third-place — hidden for Balanced Liechtenstein,
                whose playoff bracket is sized per skill division automatically. */}
            {!isBalanced && (
              <>
            {/* Playoff format */}
            <div>
              <Label htmlFor="tcf-playoff">Playoff Format</Label>
              <div className="flex gap-3 mt-1 flex-wrap">
                {(['NONE', 'TOP2', 'TOP4', 'TOP8'] as const).map((opt) => (
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
              {form.playoff_format === 'TOP4' && (
                <FieldHint>TOP4 requires ≥8 participants at playoff start. Auto-falls back to TOP2 if below threshold.</FieldHint>
              )}
            </div>

            {/* Third-place match — only when playoffs are enabled (SE uses its own below) */}
            {form.playoff_format && form.playoff_format !== 'NONE' && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  name="has_third_place_match"
                  checked={form.has_third_place_match ?? false}
                  onChange={handleChange}
                  className="accent-rizzotto-gold-400 h-4 w-4"
                />
                <span className="text-sm text-rizzotto-stone-300">Third-place match (Small Final)</span>
              </label>
            )}
              </>
            )}

            {/* Match formats */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="tcf-swiss-fmt">{form.format === 'ROUND_ROBIN' ? 'Round Robin Format' : form.format === 'LIECHTENSTEIN' ? 'Liechtenstein Format' : isBalanced ? 'Group Format' : 'Swiss Format'}</Label>
                <Select
                  id="tcf-swiss-fmt"
                  name="swiss_match_format"
                  value={form.swiss_match_format ?? 'BO1'}
                  onChange={handleChange}
                >
                  <option value="BO1">Best of 1</option>
                  <option value="BO2">Best of 2 — home &amp; away (1–1 = draw)</option>
                  <option value="BO3">Best of 3</option>
                  <option value="BO5">Best of 5</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="tcf-playoff-fmt">Playoffs Format</Label>
                <Select
                  id="tcf-playoff-fmt"
                  name="playoff_match_format"
                  value={form.playoff_match_format ?? 'BO1'}
                  onChange={handleChange}
                >
                  <option value="BO1">Best of 1</option>
                  <option value="BO3">Best of 3</option>
                  <option value="BO5">Best of 5</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="tcf-finale-fmt">Finale Format</Label>
                <Select
                  id="tcf-finale-fmt"
                  name="finale_match_format"
                  value={form.finale_match_format ?? 'BO1'}
                  onChange={handleChange}
                >
                  <option value="BO1">Best of 1</option>
                  <option value="BO3">Best of 3</option>
                  <option value="BO5">Best of 5</option>
                </Select>
              </div>
            </div>
          </>
        ) : form.format !== 'AUTO_SWISS' && form.format !== 'BALANCED_LIECHTENSTEIN' ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="tcf-elim-fmt">Match Format</Label>
                <Select
                  id="tcf-elim-fmt"
                  name="swiss_match_format"
                  value={form.swiss_match_format ?? 'BO1'}
                  onChange={handleChange}
                >
                  <option value="BO1">Best of 1</option>
                  <option value="BO3">Best of 3</option>
                  <option value="BO5">Best of 5</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="tcf-elim-sf-fmt">Semis Format</Label>
                <Select
                  id="tcf-elim-sf-fmt"
                  name="playoff_match_format"
                  value={form.playoff_match_format ?? 'BO1'}
                  onChange={handleChange}
                >
                  <option value="BO1">Best of 1</option>
                  <option value="BO3">Best of 3</option>
                  <option value="BO5">Best of 5</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="tcf-elim-gf-fmt">Grand Final Format</Label>
                <Select
                  id="tcf-elim-gf-fmt"
                  name="finale_match_format"
                  value={form.finale_match_format ?? 'BO1'}
                  onChange={handleChange}
                >
                  <option value="BO1">Best of 1</option>
                  <option value="BO3">Best of 3</option>
                  <option value="BO5">Best of 5</option>
                </Select>
              </div>
            </div>
            {form.format === 'SINGLE_ELIMINATION' && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  name="has_third_place_match"
                  checked={form.has_third_place_match ?? false}
                  onChange={handleChange}
                  className="accent-rizzotto-gold-400 h-4 w-4"
                />
                <span className="text-sm text-rizzotto-stone-300">Third-place match (Small Final)</span>
              </label>
            )}
          </>
        ) : null}
      </fieldset>

      {/* ─── Map Pool ──────────────────────────────────────────────────── */}
      <fieldset className="space-y-4 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
        <legend className="px-1 text-sm font-semibold text-rizzotto-stone-200">
          Map Pool
        </legend>

        {/* Map decision mode — hidden for AUTO_SWISS (always Random Ban&Pick) */}
        {form.format !== 'AUTO_SWISS' && <div>
          <Label>Map Decision Mode</Label>
          <div className="grid grid-cols-1 gap-2 mt-2 sm:grid-cols-2">
            {MAP_DECISION_MODES.map((opt) => {
              const isSelected = (form.map_decision_mode ?? 'RANDOM_PICK_BAN') === opt.value;
              return (
                <label
                  key={opt.value}
                  className={[
                    'flex flex-col gap-0.5 rounded-md border px-3 py-2 cursor-pointer transition-colors',
                    isSelected
                      ? 'border-rizzotto-gold-500 bg-rizzotto-gold-500/10'
                      : 'border-rizzotto-iron-600 hover:border-rizzotto-iron-500',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="map_decision_mode"
                      value={opt.value}
                      checked={isSelected}
                      onChange={handleChange}
                      className="accent-rizzotto-gold-400 shrink-0"
                    />
                    <span className={['text-sm font-medium', isSelected ? 'text-rizzotto-gold-300' : 'text-rizzotto-stone-200'].join(' ')}>
                      {opt.label}
                    </span>
                  </div>
                  <p className="text-xs text-rizzotto-stone-500 pl-5">{opt.description}</p>
                </label>
              );
            })}
          </div>
        </div>}

        {/* Preset configuration for HOST_PRESET and HOST_PRESET_PICK_BAN */}
        {(form.map_decision_mode === 'HOST_PRESET' || form.map_decision_mode === 'HOST_PRESET_PICK_BAN') && (() => {
          const roundKeys = buildRoundKeys(form);
          const isPickBan = form.map_decision_mode === 'HOST_PRESET_PICK_BAN';
          const config = (form.map_preset_config ?? {}) as Record<string, string[] | string[][]>;

          return (
            <div className="space-y-3 rounded-md border border-rizzotto-iron-600 bg-rizzotto-iron-900/40 p-3">
              <p className="text-xs font-semibold text-rizzotto-stone-300 uppercase tracking-wide">
                {isPickBan ? 'Map preset per round & game (3 maps per game)' : 'Map preset per round (1 map per game)'}
              </p>
              {roundKeys.length === 0 && (
                <p className="text-xs text-rizzotto-stone-500">No configurable rounds for this format. Enable playoffs to configure map presets for bracket stages.</p>
              )}
              {roundKeys.map(({ key, label, maxGames }) => {
                const entry = config[key];

                if (!isPickBan) {
                  // HOST_PRESET: Pro Runde 1 Map-Select pro Game-Slot
                  const mapsForRound = (Array.isArray(entry) ? entry : []) as string[];
                  return (
                    <div key={key} className="space-y-1">
                      <p className="text-xs font-medium text-rizzotto-stone-400">{label}</p>
                      {Array.from({ length: maxGames }).map((_, gi) => (
                        <div key={gi} className="flex items-center gap-2">
                          {maxGames > 1 && <span className="text-xs text-rizzotto-stone-600 w-12 shrink-0">Game {gi + 1}</span>}
                          <select
                            value={mapsForRound[gi] ?? ''}
                            onChange={(e) => {
                              const updated = [...mapsForRound];
                              updated[gi] = e.target.value;
                              setForm((prev) => ({
                                ...prev,
                                map_preset_config: { ...config, [key]: updated },
                              }));
                            }}
                            className="flex-1 rounded border border-rizzotto-iron-600 bg-rizzotto-iron-800 px-2 py-1 text-xs text-rizzotto-stone-200"
                          >
                            <option value="">— Select map —</option>
                            {allMaps.map((m) => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  );
                }

                // HOST_PRESET_PICK_BAN: Pro Runde, pro Game-Slot 3 Checkboxen
                const setsForRound = (Array.isArray(entry) ? entry : []) as string[][];
                return (
                  <div key={key} className="space-y-2">
                    <p className="text-xs font-medium text-rizzotto-stone-400">{label}</p>
                    {Array.from({ length: maxGames }).map((_, gi) => {
                      const selectedForGame = (Array.isArray(setsForRound[gi]) ? setsForRound[gi] : []) as string[];
                      return (
                        <div key={gi} className="space-y-1">
                          {maxGames > 1 && <p className="text-xs text-rizzotto-stone-600 pl-1">Game {gi + 1}</p>}
                          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 max-h-32 overflow-y-auto rounded border border-rizzotto-iron-700 p-1.5">
                            {allMaps.map((m) => {
                              const isSel = selectedForGame.includes(m.id);
                              const atMax = !isSel && selectedForGame.length >= 3;
                              return (
                                <label
                                  key={m.id}
                                  className={['flex items-center gap-1.5 rounded px-1.5 py-1 text-xs cursor-pointer', isSel ? 'bg-rizzotto-gold-500/15 text-rizzotto-gold-400' : atMax ? 'opacity-40 cursor-not-allowed text-rizzotto-stone-500' : 'hover:bg-rizzotto-iron-800 text-rizzotto-stone-300'].join(' ')}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSel}
                                    disabled={atMax}
                                    onChange={() => {
                                      const updated = isSel ? selectedForGame.filter((id) => id !== m.id) : [...selectedForGame, m.id];
                                      const newSets = [...setsForRound];
                                      newSets[gi] = updated;
                                      setForm((prev) => ({
                                        ...prev,
                                        map_preset_config: { ...config, [key]: newSets },
                                      }));
                                    }}
                                    className="accent-rizzotto-gold-400 shrink-0"
                                  />
                                  <span className="truncate">{m.name}</span>
                                </label>
                              );
                            })}
                          </div>
                          {selectedForGame.length > 0 && selectedForGame.length < 3 && (
                            <p className="text-xs text-amber-500 pl-1">{3 - selectedForGame.length} more map(s) needed</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* Map pool — hidden for preset modes (maps are configured per round above) */}
        {form.map_decision_mode !== 'HOST_PRESET' && form.map_decision_mode !== 'HOST_PRESET_PICK_BAN' && (<><div>
          <div className="flex items-center justify-between">
            <Label>
              Map Selection{' '}
              <span className="text-rizzotto-stone-500 font-normal text-xs">
                ({(form.map_pool ?? []).length}/{allMaps.length} selected, min {minPool})
              </span>
            </Label>
            <button
              type="button"
              onClick={() => {
                const allSelected = allMaps.every((m) => (form.map_pool ?? []).includes(m.id));
                setForm((prev) => ({ ...prev, map_pool: allSelected ? [] : allMaps.map((m) => m.id) }));
              }}
              className="text-xs text-rizzotto-gold-400 hover:text-rizzotto-gold-300 transition-colors"
            >
              {allMaps.every((m) => (form.map_pool ?? []).includes(m.id)) ? 'Deselect all' : 'Select all'}
            </button>
          </div>
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
        </div></>)}
        {usesMapPool && (
          <FieldHint>
            {form.map_decision_mode === 'RANDOM_NO_REPEAT'
              ? `Minimum ${minPool} maps — enough that no player gets the same map twice across their games. Selecting all maps is recommended.`
              : `Minimum ${minPool} maps — a floor of 3 plus your longest match (best-of-${maxFormatGames}), so maps don't repeat within a match.`}
          </FieldHint>
        )}
        {usesMapPool && (form.map_pool ?? []).length < minPool && (
          <FieldError message={`Select at least ${minPool} maps (${(form.map_pool ?? []).length} selected).`} />
        )}
      </fieldset>

      {/* ─── Faction Pool ──────────────────────────────────────────────── */}
      <fieldset className="space-y-4 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
        <legend className="px-1 text-sm font-semibold text-rizzotto-stone-200">
          Faction Pool
        </legend>

        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={factionPoolEnabled}
            onChange={(e) => {
              setFactionPoolEnabled(e.target.checked);
              if (e.target.checked) {
                // Default to all factions selected — host deselects the ones to ban.
                setForm((prev) => ({ ...prev, faction_pool: allFactions.map((f) => f.id) }));
              } else {
                setForm((prev) => ({ ...prev, faction_pool: [] }));
              }
            }}
            className="h-4 w-4 rounded border-rizzotto-iron-600 bg-rizzotto-iron-800 text-rizzotto-gold-500 focus:ring-rizzotto-gold-500"
          />
          <span className="text-sm text-rizzotto-stone-300">
            Restrict to a faction subset
          </span>
        </label>
        <FieldHint>Default: all factions allowed. Enable to limit which factions players may register with.</FieldHint>

        {factionPoolEnabled && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>
                Allowed Factions{' '}
                <span className="text-rizzotto-stone-500 font-normal text-xs">
                  ({(form.faction_pool ?? []).length}/{allFactions.length} selected)
                </span>
              </Label>
              <button
                type="button"
                onClick={() => {
                  const allSelected = allFactions.every((f) => (form.faction_pool ?? []).includes(f.id));
                  setForm((prev) => ({ ...prev, faction_pool: allSelected ? [] : allFactions.map((f) => f.id) }));
                }}
                className="text-xs text-rizzotto-gold-400 hover:text-rizzotto-gold-300 transition-colors"
              >
                {allFactions.every((f) => (form.faction_pool ?? []).includes(f.id)) ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="max-h-52 overflow-y-auto rounded-md border border-rizzotto-iron-700 p-2">
              {allFactions.length === 0 ? (
                <p className="text-xs text-rizzotto-stone-500 text-center py-4">Loading factions…</p>
              ) : (
                <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                  {allFactions.map((faction) => {
                    const isSelected = (form.faction_pool ?? []).includes(faction.id);
                    return (
                      <label
                        key={faction.id}
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
                            const pool = form.faction_pool ?? [];
                            const updated = isSelected
                              ? pool.filter((id) => id !== faction.id)
                              : [...pool, faction.id];
                            setForm((prev) => ({ ...prev, faction_pool: updated }));
                          }}
                          className="accent-rizzotto-gold-400 shrink-0"
                        />
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: `#${faction.color_hex}` }}
                        />
                        <span className="truncate">{faction.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </fieldset>

      {/* ─── Restricted Factions ───────────────────────────────────────── */}
      <fieldset className="space-y-4 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
        <legend className="px-1 text-sm font-semibold text-rizzotto-stone-200">
          Restricted Factions
        </legend>

        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={restrictedFactionsEnabled}
            onChange={(e) => {
              setRestrictedFactionsEnabled(e.target.checked);
              if (!e.target.checked) setForm((prev) => ({ ...prev, restricted_factions: [] }));
            }}
            className="h-4 w-4 rounded border-rizzotto-iron-600 bg-rizzotto-iron-800 text-rizzotto-gold-500 focus:ring-rizzotto-gold-500"
          />
          <span className="text-sm text-rizzotto-stone-300">
            Mark factions as restricted (nerfed)
          </span>
        </label>
        <FieldHint>
          Games where either player used a restricted faction will not count toward the leaderboard. Use this for factions affected by unit bans or caps.
        </FieldHint>

        {restrictedFactionsEnabled && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>
                Restricted Factions{' '}
                <span className="text-rizzotto-stone-500 font-normal text-xs">
                  ({(form.restricted_factions ?? []).length} selected)
                </span>
              </Label>
              {(form.restricted_factions ?? []).length > 0 && (
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, restricted_factions: [] }))}
                  className="text-xs text-rizzotto-gold-400 hover:text-rizzotto-gold-300 transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>
            <div className="max-h-52 overflow-y-auto rounded-md border border-rizzotto-iron-700 p-2">
              {allFactions.length === 0 ? (
                <p className="text-xs text-rizzotto-stone-500 text-center py-4">Loading factions…</p>
              ) : (
                <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                  {allFactions.map((faction) => {
                    const isSelected = (form.restricted_factions ?? []).includes(faction.id);
                    return (
                      <label
                        key={faction.id}
                        className={[
                          'flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer transition-colors text-sm',
                          isSelected
                            ? 'bg-red-900/30 text-red-300'
                            : 'hover:bg-rizzotto-iron-800 text-rizzotto-stone-300',
                        ].join(' ')}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            const current = form.restricted_factions ?? [];
                            const updated = isSelected
                              ? current.filter((id) => id !== faction.id)
                              : [...current, faction.id];
                            setForm((prev) => ({ ...prev, restricted_factions: updated }));
                          }}
                          className="accent-red-400 shrink-0"
                        />
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: `#${faction.color_hex}` }}
                        />
                        <span className="truncate">{faction.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
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
          (usesMapPool && (form.map_pool?.length ?? 0) < minPool)
        }
      >
        {mutation.isPending ? t('tournament.form.submitting') : t('tournament.form.submit')}
      </Button>
    </form>
  );
}
