import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  getAdminEngagementReport,
  getAdminUnderratedReport,
  type AdminEngagementUser,
} from '@/lib/api.js';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function UserRow({
  user,
  extra,
}: {
  user: AdminEngagementUser;
  extra?: ReactNode;
}) {
  return (
    <tr className="border-t border-rizzotto-iron-800">
      <td className="px-3 py-2">
        <Link
          to="/users/$id"
          params={{ id: user.id }}
          className="text-rizzotto-gold-400 hover:text-rizzotto-gold-300"
        >
          {user.username}
        </Link>
      </td>
      <td className="px-3 py-2 text-stone-400">{user.email ?? '—'}</td>
      {extra}
      <td className="px-3 py-2 text-stone-500">{formatDate(user.createdAt)}</td>
      <td className="px-3 py-2 text-stone-500">{formatDate(user.lastLogin)}</td>
    </tr>
  );
}

// #19 / N9 — data rating vs self-claim. Backend lists only genuine upward band jumps
// (dataBand > questionnaireBand), sorted by the gap descending.
function UnderratedSection() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-underrated-report'],
    queryFn: () => getAdminUnderratedReport(),
  });

  return (
    <section className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
      <h3 className="font-display text-lg font-semibold text-rizzotto-gold-500">
        Underrated players
      </h3>
      <p className="mb-3 text-xs text-stone-500">
        Players whose results place them a full band above their questionnaire self-rating —
        potentially stronger than they claimed. Sorted by the gap. Only players with both a
        questionnaire and enough game data appear.
      </p>

      {isLoading && <p className="py-4 text-center text-sm text-stone-400">Loading…</p>}
      {error && (
        <div className="rounded border border-red-900 bg-red-950/40 p-3 text-red-300 text-xs">
          Failed to load underrated report.
        </div>
      )}
      {data && data.players.length === 0 && (
        <p className="py-4 text-center text-sm text-stone-500">
          No players are currently rated a full band above their self-rating.
        </p>
      )}
      {data && data.players.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Player</th>
                <th className="px-3 py-2">Claimed</th>
                <th className="px-3 py-2">From data</th>
                <th className="px-3 py-2">Win vs avg</th>
                <th className="px-3 py-2">Gap</th>
              </tr>
            </thead>
            <tbody>
              {data.players.map((p) => {
                const bandGap = p.dataBand - p.questionnaireBand;
                return (
                  <tr key={p.id} className="border-t border-rizzotto-iron-800">
                    <td className="px-3 py-2">
                      <Link
                        to="/users/$id"
                        params={{ id: p.id }}
                        className="text-rizzotto-gold-400 hover:text-rizzotto-gold-300"
                      >
                        {p.username}
                      </Link>
                      {p.smurfSuspected && (
                        <span className="ml-2 rounded bg-red-900/50 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
                          smurf?
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-stone-400">
                      {p.questionnaireBand} {p.questionnaireBandName}
                    </td>
                    <td className="px-3 py-2 text-stone-300">
                      {p.dataBand} {p.dataBandName}
                    </td>
                    <td className="px-3 py-2 text-stone-400">{Math.round(p.dataWinChance * 100)}%</td>
                    <td className="px-3 py-2">
                      <span className="font-semibold text-rizzotto-gold-400">
                        +{bandGap} band{bandGap === 1 ? '' : 's'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EngagementError() {
  return (
    <div className="rounded border border-red-900 bg-red-950/40 p-3 text-red-300 text-xs">
      Failed to load engagement report.
    </div>
  );
}

// Registered users who have not linked + verified Steam yet.
function NotSteamVerifiedSection() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-engagement-report'],
    queryFn: getAdminEngagementReport,
  });

  if (isLoading) return <div className="py-8 text-center text-stone-400 text-sm">Loading…</div>;
  if (error) return <EngagementError />;
  if (!data) return null;

  return (
    <section className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
      <h3 className="font-display text-lg font-semibold text-rizzotto-gold-500">Not Steam-verified</h3>
      <p className="mb-3 text-xs text-stone-500">
        Registered users who have not linked and verified their Steam account yet — they can&rsquo;t be
        matched into Steam-gated play. {data.notSteamVerified.length} total.
      </p>
      {data.notSteamVerified.length === 0 ? (
        <p className="py-4 text-center text-sm text-stone-500">Everyone is verified. 🎉</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Player</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Registered</th>
                <th className="px-3 py-2">Last login</th>
              </tr>
            </thead>
            <tbody>
              {data.notSteamVerified.map((u) => (
                <UserRow key={u.id} user={u} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// Verified users who have never completed a game — dormant accounts worth a nudge.
function VerifiedNeverPlayedSection() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-engagement-report'],
    queryFn: getAdminEngagementReport,
  });

  if (isLoading) return <div className="py-8 text-center text-stone-400 text-sm">Loading…</div>;
  if (error) return <EngagementError />;
  if (!data) return null;

  return (
    <section className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
      <h3 className="font-display text-lg font-semibold text-rizzotto-gold-500">Verified, never played</h3>
      <p className="mb-3 text-xs text-stone-500">
        Fully registered and Steam-verified users who have never completed a game — dormant accounts
        worth a nudge. {data.verifiedNeverPlayed.length} total.
      </p>
      {data.verifiedNeverPlayed.length === 0 ? (
        <p className="py-4 text-center text-sm text-stone-500">
          Every verified player has played at least once.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Player</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Steam</th>
                <th className="px-3 py-2">Registered</th>
                <th className="px-3 py-2">Last login</th>
              </tr>
            </thead>
            <tbody>
              {data.verifiedNeverPlayed.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  extra={
                    <td className="px-3 py-2 text-stone-400">
                      {u.steamProfileUrl ? (
                        <a
                          href={u.steamProfileUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-rizzotto-gold-400 hover:text-rizzotto-gold-300"
                        >
                          {u.steamPersona ?? 'Steam'}
                        </a>
                      ) : (
                        (u.steamPersona ?? '—')
                      )}
                    </td>
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// N10 — split the previously-stacked reports into sub-tabs to cut down on scrolling.
const SUB_TABS = [
  { key: 'underrated', label: 'Underrated' },
  { key: 'notVerified', label: 'Not verified' },
  { key: 'neverPlayed', label: 'Never played' },
] as const;
type SubTab = (typeof SUB_TABS)[number]['key'];

export function AdminReportsTab() {
  const [sub, setSub] = useState<SubTab>('underrated');
  return (
    <div className="space-y-6">
      <div className="inline-flex gap-1 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-1">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSub(t.key)}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              sub === t.key
                ? 'bg-rizzotto-gold-600/20 text-rizzotto-gold-300'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {sub === 'underrated' && <UnderratedSection />}
      {sub === 'notVerified' && <NotSteamVerifiedSection />}
      {sub === 'neverPlayed' && <VerifiedNeverPlayedSection />}
    </div>
  );
}
