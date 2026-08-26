import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Coffee, Crown, Trophy, type LucideIcon } from 'lucide-react';
import {
  searchSupporters,
  updateSupporterFlags,
  getSupporterRoleConfig,
  putSupporterRoleConfig,
  getFundingGoal,
  putFundingGoal,
  type AdminSupporterRow,
  type SupporterRoleConfig,
  type FundingGoal,
} from '@/lib/api';
import type { SupporterTiers } from '@rizzotto/types';

const TIER_KEYS = ['supporter', 'lord', 'champion'] as const;
type TierKey = (typeof TIER_KEYS)[number];

const TIER_ICON: Record<TierKey, LucideIcon> = {
  supporter: Coffee,
  lord: Crown,
  champion: Trophy,
};
const TIER_COLOR: Record<TierKey, string> = {
  supporter: 'text-amber-600',
  lord: 'text-yellow-400',
  champion: 'text-red-500',
};

// -- Discord role-ID mapping ------------------------------------------------

function RoleConfigSection() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['supporter-role-config'], queryFn: getSupporterRoleConfig });
  const [draft, setDraft] = useState<SupporterRoleConfig | null>(null);
  const [saved, setSaved] = useState(false);
  const cfg: SupporterRoleConfig =
    draft ?? data ?? { supporterRoleId: null, lordRoleId: null, championRoleId: null };

  const mutation = useMutation({
    mutationFn: () => putSupporterRoleConfig(cfg),
    onSuccess: (res) => {
      qc.setQueryData(['supporter-role-config'], res);
      setDraft(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  function field(key: keyof SupporterRoleConfig, label: string) {
    return (
      <label className="flex flex-col gap-1 text-xs text-stone-400">
        {label}
        <input
          type="text"
          value={cfg[key] ?? ''}
          onChange={(e) => setDraft({ ...cfg, [key]: e.target.value.trim() || null })}
          placeholder="Discord role ID"
          className="rounded border border-stone-700 bg-stone-900 px-2 py-1 font-mono text-xs text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
        />
      </label>
    );
  }

  return (
    <section className="mb-8 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/40 p-5">
      <h3 className="mb-1 font-display text-base font-semibold text-rizzotto-gold-500">
        Discord role mapping
      </h3>
      <p className="mb-4 text-xs text-stone-500">
        Map the three Ko-Fi Discord roles to supporter tiers. Members holding these roles are synced on
        login and by a daily job. Leave a field blank to disable Discord sync for that tier — the manual
        checkboxes below still apply.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {field('supporterRoleId', 'Supporter role ID')}
        {field('lordRoleId', 'Lord role ID')}
        {field('championRoleId', 'Champion role ID')}
      </div>
      <div className="mt-4">
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={draft === null || mutation.isPending}
          className="rounded border border-rizzotto-gold-600 px-3 py-1.5 text-sm text-rizzotto-gold-400 transition-colors hover:bg-rizzotto-gold-900/20 disabled:opacity-40"
        >
          {mutation.isPending ? 'Saving…' : saved ? 'Saved ✓' : 'Save mapping'}
        </button>
      </div>
    </section>
  );
}

// -- Per-user override rows -------------------------------------------------

function EffectiveBadges({ tiers }: { tiers: SupporterTiers }) {
  const held = TIER_KEYS.filter((k) => tiers[k]);
  if (held.length === 0) return <span className="text-xs text-stone-600">none</span>;
  return (
    <span className="inline-flex items-center gap-1">
      {held.map((k) => {
        const Icon = TIER_ICON[k];
        return <Icon key={k} size={16} strokeWidth={1.75} className={TIER_COLOR[k]} aria-label={k} />;
      })}
    </span>
  );
}

function SupporterRow({ row }: { row: AdminSupporterRow }) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (flags: SupporterTiers) => updateSupporterFlags(row.userId, flags),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-supporters'] }),
  });

  function toggle(key: TierKey) {
    mutation.mutate({ ...row.manual, [key]: !row.manual[key] });
  }

  return (
    <tr className="transition-colors hover:bg-stone-800/30">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {row.avatarUrl ? (
            <img src={row.avatarUrl} alt="" className="h-7 w-7 rounded-full border border-stone-700 object-cover" />
          ) : (
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-stone-700 text-xs text-stone-200">
              {row.username[0]?.toUpperCase() ?? '?'}
            </span>
          )}
          <span className="text-stone-200">{row.username}</span>
        </div>
      </td>
      {TIER_KEYS.map((k) => (
        <td key={k} className="px-4 py-3 text-center">
          <input
            type="checkbox"
            className="accent-amber-500"
            checked={row.manual[k]}
            disabled={mutation.isPending}
            onChange={() => toggle(k)}
            title={`Grant ${k} manually`}
          />
          {row.discord[k] && (
            <span className="ml-1 text-[10px] text-stone-500" title="Also granted by a Discord role">
              D
            </span>
          )}
        </td>
      ))}
      <td className="px-4 py-3">
        <EffectiveBadges tiers={row.effective} />
      </td>
    </tr>
  );
}

// -- Funding goal (progress bar) --------------------------------------------

function FundingGoalSection() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['funding-goal'], queryFn: getFundingGoal });
  const [draft, setDraft] = useState<FundingGoal | null>(null);
  const [saved, setSaved] = useState(false);
  const cfg: FundingGoal = draft ?? data ?? { goal: 500, raised: 135, currency: 'EUR' };
  const pct = cfg.goal > 0 ? Math.round((cfg.raised / cfg.goal) * 100) : 0;

  const mutation = useMutation({
    mutationFn: () => putFundingGoal(cfg),
    onSuccess: (res) => {
      qc.setQueryData(['funding-goal'], res);
      setDraft(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  function numberField(key: 'raised' | 'goal', label: string) {
    return (
      <label className="flex flex-col gap-1 text-xs text-stone-400">
        {label}
        <input
          type="number"
          min={0}
          value={cfg[key]}
          onChange={(e) => setDraft({ ...cfg, [key]: Number(e.target.value) || 0 })}
          className="rounded border border-stone-700 bg-stone-900 px-2 py-1 text-sm text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
        />
      </label>
    );
  }

  return (
    <section className="mb-8 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/40 p-5">
      <h3 className="mb-1 font-display text-base font-semibold text-rizzotto-gold-500">Funding goal</h3>
      <p className="mb-4 text-xs text-stone-500">
        Drives the progress bar on the landing page and the support page. Update &ldquo;raised&rdquo; as
        donations come in — currently {pct}% of goal.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {numberField('raised', 'Raised')}
        {numberField('goal', 'Goal')}
        <label className="flex flex-col gap-1 text-xs text-stone-400">
          Currency
          <input
            type="text"
            value={cfg.currency}
            onChange={(e) => setDraft({ ...cfg, currency: e.target.value.toUpperCase().slice(0, 8) })}
            className="rounded border border-stone-700 bg-stone-900 px-2 py-1 text-sm text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
          />
        </label>
      </div>
      <div className="mt-4">
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={draft === null || mutation.isPending}
          className="rounded border border-rizzotto-gold-600 px-3 py-1.5 text-sm text-rizzotto-gold-400 transition-colors hover:bg-rizzotto-gold-900/20 disabled:opacity-40"
        >
          {mutation.isPending ? 'Saving…' : saved ? 'Saved ✓' : 'Save goal'}
        </button>
      </div>
    </section>
  );
}

export function AdminSupportersTab() {
  const [search, setSearch] = useState('');
  const q = search.trim();
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-supporters', q],
    queryFn: () => searchSupporters(q),
  });
  const rows = data?.users ?? [];

  return (
    <div>
      <FundingGoalSection />
      <RoleConfigSection />

      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search users to add…"
          className="w-full max-w-sm rounded border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 placeholder:text-stone-500 focus:border-rizzotto-gold-500 focus:outline-none"
        />
      </div>

      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-stone-400">
        {q ? 'Search results' : 'Current supporters'}
      </h3>

      {isLoading && <p className="py-6 text-sm text-stone-400">Loading…</p>}
      {error && <p className="py-6 text-sm text-red-400">Failed to load.</p>}

      {!isLoading && !error && (
        <div className="overflow-x-auto rounded-md border border-stone-800">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-stone-800 bg-stone-900/60 text-xs uppercase tracking-wider text-stone-400">
                <th className="px-4 py-3 text-left font-medium">User</th>
                <th className="px-4 py-3 text-center font-medium">Supporter</th>
                <th className="px-4 py-3 text-center font-medium">Lord</th>
                <th className="px-4 py-3 text-center font-medium">Champion</th>
                <th className="px-4 py-3 text-left font-medium">Effective</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/60">
              {rows.map((row) => (
                <SupporterRow key={row.userId} row={row} />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-stone-500">
                    {q ? 'No users found.' : 'No supporters yet — search above to add one.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="px-4 py-2 text-[11px] text-stone-600">
            Checkboxes set the manual override. A small “D” marks a tier already granted by a Discord
            role. Effective = Discord ∪ manual (cumulative — any Lord or Champion is also a Supporter).
          </p>
        </div>
      )}
    </div>
  );
}
