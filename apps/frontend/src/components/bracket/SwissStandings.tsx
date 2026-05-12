import { Link } from '@tanstack/react-router';
import type { SwissMeta } from '@tww3/types';

interface SwissStandingsProps {
  standings: SwissMeta['standings'];
  currentRound: number;
  recommendedRounds: number;
}

function Avatar({ url, username }: { url: string | null; username: string }) {
  if (!url) {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-stone-700 text-xs font-medium text-stone-200">
        {username[0]?.toUpperCase() ?? '?'}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt={username}
      className="h-6 w-6 rounded-full border border-stone-700 object-cover"
    />
  );
}

export function SwissStandings({ standings, currentRound, recommendedRounds }: SwissStandingsProps) {
  return (
    <div className="mb-6 rounded-md border border-stone-800 bg-stone-900/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-stone-800 bg-stone-900/60">
        <h3 className="font-display text-base font-semibold text-warhammer-gold">
          Standings (Runde {currentRound}/{recommendedRounds})
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-stone-800">
              <th className="px-4 py-2 text-left font-medium text-stone-400">#</th>
              <th className="px-4 py-2 text-left font-medium text-stone-400">Spieler</th>
              <th className="px-4 py-2 text-right font-medium text-stone-400">Punkte</th>
              <th className="px-4 py-2 text-center font-medium text-stone-400">W / L / B</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-800/60">
            {standings.map((entry, idx) => {
              const displayName = entry.username ?? entry.userId;
              return (
                <tr key={entry.userId} className="hover:bg-stone-800/30 transition-colors">
                  <td className="px-4 py-2 text-stone-500">{idx + 1}</td>
                  <td className="px-4 py-2">
                    <Link
                      to="/users/$id"
                      params={{ id: entry.userId }}
                      className="flex items-center gap-2 hover:text-warhammer-gold transition-colors"
                    >
                      <Avatar url={entry.avatarUrl} username={displayName} />
                      <span className="text-stone-200">{displayName}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right font-semibold text-stone-100">{entry.score}</td>
                  <td className="px-4 py-2 text-center text-stone-300">
                    <span className="text-emerald-400">{entry.wins}</span>
                    <span className="text-stone-600"> / </span>
                    <span className="text-red-400">{entry.losses}</span>
                    <span className="text-stone-600"> / </span>
                    <span className="text-stone-400">{entry.byes}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
