import type { ReactNode } from 'react';
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

// #19 — data rating vs self-claim. Sorted by the gap, descending; no threshold.
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
        Players whose results place them above their questionnaire self-rating — potentially stronger
        than they claimed. Sorted by the gap; no cut-off, so use your judgement. Only players with both
        a questionnaire and enough game data appear.
      </p>

      {isLoading && <p className="py-4 text-center text-sm text-stone-400">Loading…</p>}
      {error && (
        <div className="rounded border border-red-900 bg-red-950/40 p-3 text-red-300 text-xs">
          Failed to load underrated report.
        </div>
      )}
      {data && data.players.length === 0 && (
        <p className="py-4 text-center text-sm text-stone-500">
          No comparable players yet (need both a questionnaire and game data).
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
                      <span
                        className={
                          bandGap > 0
                            ? 'font-semibold text-rizzotto-gold-400'
                            : bandGap < 0
                              ? 'text-stone-600'
                              : 'text-stone-500'
                        }
                      >
                        {bandGap > 0 ? `+${bandGap}` : bandGap} band{Math.abs(bandGap) === 1 ? '' : 's'}
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

function EngagementSection() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-engagement-report'],
    queryFn: getAdminEngagementReport,
  });

  if (isLoading) return <div className="py-8 text-center text-stone-400 text-sm">Loading…</div>;
  if (error)
    return (
      <div className="rounded border border-red-900 bg-red-950/40 p-3 text-red-300 text-xs">
        Failed to load engagement report.
      </div>
    );
  if (!data) return null;

  return (
    <div className="space-y-8">
      {/* (1) Not Steam-verified -------------------------------------------------- */}
      <section className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
        <h3 className="font-display text-lg font-semibold text-rizzotto-gold-500">
          Not Steam-verified
        </h3>
        <p className="mb-3 text-xs text-stone-500">
          Registered users who have not linked and verified their Steam account yet — they can&rsquo;t
          be matched into Steam-gated play. {data.notSteamVerified.length} total.
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

      {/* (2) Verified but never played ------------------------------------------ */}
      <section className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
        <h3 className="font-display text-lg font-semibold text-rizzotto-gold-500">
          Verified, never played
        </h3>
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
    </div>
  );
}

export function AdminReportsTab() {
  return (
    <div className="space-y-8">
      <UnderratedSection />
      <EngagementSection />
    </div>
  );
}
