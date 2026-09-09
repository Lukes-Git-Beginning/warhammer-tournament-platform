import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getReferralsOverview,
  getTournamentReferrals,
  listTournaments,
  type Tournament,
} from '@/lib/api';

/** The tournaments list caps pageSize at 100 — page through to get all of them. */
async function fetchAllTournaments(): Promise<Tournament[]> {
  const pageSize = 100;
  const first = await listTournaments(1, pageSize);
  const all = [...first.data];
  const totalPages = Math.ceil(first.total / pageSize);
  for (let p = 2; p <= totalPages; p++) {
    all.push(...(await listTournaments(p, pageSize)).data);
  }
  return all;
}

const pct = (v: number | null): string => (v == null ? '—' : `${Math.round(v * 100)}%`);

/** Show the destination name with its ref as muted secondary text; ref alone for orphaned sources. */
const sourceLabel = (name: string | null, ref: string) =>
  name ? (
    <>
      {name}
      <span className="ml-2 text-xs text-stone-500">{ref}</span>
    </>
  ) : (
    ref
  );
const th = 'px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-rizzotto-gold-500/80';
const td = 'px-3 py-1.5 text-sm text-stone-200';
const inputClass =
  'rounded border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none';

export function ReferralsTab() {
  const { data: overview } = useQuery({ queryKey: ['referrals-overview'], queryFn: getReferralsOverview });
  const { data: tournaments = [] } = useQuery({
    queryKey: ['referrals-tournaments'],
    queryFn: fetchAllTournaments,
  });
  const [slug, setSlug] = useState('');
  const { data: report } = useQuery({
    queryKey: ['referrals-tournament', slug],
    queryFn: () => getTournamentReferrals(slug),
    enabled: !!slug,
  });

  return (
    <div className="flex flex-col gap-8">
      {/* ---- Overview ---- */}
      <section>
        <h3 className="mb-1 font-display text-base font-semibold text-rizzotto-gold-400">Where people came from</h3>
        <p className="mb-4 text-xs text-stone-500">
          Across all tournaments, per ref-tagged source: link clicks, tournament sign-ups (a player counts once per
          tournament joined), brand-new players by first-touch (once per account), and sign-up conversion.
        </p>
        <table className="w-full max-w-3xl overflow-hidden rounded-md border border-stone-800">
          <thead className="bg-stone-900/60">
            <tr>
              <th className={th}>Source</th>
              <th className={`${th} text-right`}>Clicks</th>
              <th className={`${th} text-right`}>Sign-ups</th>
              <th className={`${th} text-right`}>New players</th>
              <th className={`${th} text-right`}>Conversion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-800/60">
            {(overview?.sources ?? []).map((s) => (
              <tr key={s.ref}>
                <td className={td}>{sourceLabel(s.name, s.ref)}</td>
                <td className={`${td} text-right`}>{s.clicks}</td>
                <td className={`${td} text-right`}>{s.signups}</td>
                <td className={`${td} text-right`}>{s.newPlayers}</td>
                <td className={`${td} text-right`}>{pct(s.conversion)}</td>
              </tr>
            ))}
            {overview && (
              <tr className="bg-stone-900/30">
                <td className={`${td} text-stone-400`}>Direct / untagged</td>
                <td className={`${td} text-right text-stone-500`}>—</td>
                <td className={`${td} text-right`}>{overview.directSignups}</td>
                <td className={`${td} text-right text-stone-500`}>—</td>
                <td className={`${td} text-right text-stone-500`}>—</td>
              </tr>
            )}
            {overview && overview.sources.length === 0 && overview.directSignups === 0 && (
              <tr>
                <td className={`${td} text-stone-500`} colSpan={5}>
                  No destinations or referral activity yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* ---- Per tournament ---- */}
      <section className="border-t border-stone-800 pt-6">
        <h3 className="mb-1 font-display text-base font-semibold text-rizzotto-gold-400">Per tournament</h3>
        <p className="mb-4 text-xs text-stone-500">
          For one tournament: how each source performed — clicks, sign-ups, and conversion.
        </p>
        <select value={slug} onChange={(e) => setSlug(e.target.value)} className={`${inputClass} mb-4 w-full max-w-md`}>
          <option value="">Select a tournament…</option>
          {tournaments.map((t) => (
            <option key={t.id} value={t.slug}>
              {t.name}
            </option>
          ))}
        </select>

        {report && (
          <table className="w-full max-w-2xl overflow-hidden rounded-md border border-stone-800">
            <thead className="bg-stone-900/60">
              <tr>
                <th className={th}>Source</th>
                <th className={`${th} text-right`}>Clicks</th>
                <th className={`${th} text-right`}>Sign-ups</th>
                <th className={`${th} text-right`}>Conversion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/60">
              {report.sources.map((s) => (
                <tr key={s.ref}>
                  <td className={td}>{sourceLabel(s.name, s.ref)}</td>
                  <td className={`${td} text-right`}>{s.clicks}</td>
                  <td className={`${td} text-right`}>{s.signups}</td>
                  <td className={`${td} text-right`}>{pct(s.conversion)}</td>
                </tr>
              ))}
              <tr className="bg-stone-900/30">
                <td className={`${td} text-stone-400`}>Direct / untagged</td>
                <td className={`${td} text-right text-stone-500`}>—</td>
                <td className={`${td} text-right`}>{report.directSignups}</td>
                <td className={`${td} text-right text-stone-500`}>—</td>
              </tr>
              {report.sources.length === 0 && report.directSignups === 0 && (
                <tr>
                  <td className={`${td} text-stone-500`} colSpan={4}>
                    No sign-ups yet for this tournament.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
