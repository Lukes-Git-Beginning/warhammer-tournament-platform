import type { ReactNode } from 'react';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAdminPlayerCalibrationAnswers,
  getPlayerClassification,
  resetPlayerCalibration,
  type AdminCalibrationAudit,
  type PlayerClassificationDto,
} from '@/lib/api.js';
import { SKILL_BAND_META } from '@/components/bracket/skillBandMeta.js';

// ---------------------------------------------------------------------------
// Band chip — reuses the shared metal palette (New/Beginner/…/Top).
// ---------------------------------------------------------------------------

function BandChip({ band }: { band: number | null }) {
  if (band == null) return <span className="text-stone-600">—</span>;
  const meta = SKILL_BAND_META[band];
  if (!meta) return <span className="text-stone-400">Band {band}</span>;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-semibold ${meta.textCls} ${meta.borderCls} ${meta.bgCls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dotCls}`} />
      {band} {meta.name}
    </span>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] font-mono uppercase tracking-wider text-stone-500">{label}</div>
      <div className="text-sm text-stone-200">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Classification summary
// ---------------------------------------------------------------------------

function ClassificationSummary({ c }: { c: PlayerClassificationDto }) {
  return (
    <div className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-stone-300">Skill classification</p>
        {c.smurfSuspected && (
          <span className="rounded bg-red-900/50 px-2 py-0.5 text-xs font-medium text-red-300">
            Smurf suspected
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Stat label="Effective band">
          {c.rated ? (
            <span className="inline-flex items-center gap-2">
              <BandChip band={c.gatingBand} />
              <span className="text-stone-400">{c.bandName}</span>
            </span>
          ) : (
            <span className="rounded border border-stone-700 px-2 py-0.5 text-xs text-stone-500">
              Unrated
            </span>
          )}
        </Stat>
        <Stat label="Matchmaking band">
          <BandChip band={c.matchmakingBand} />
        </Stat>
        <Stat label="Questionnaire floor">
          {c.questionnaireFloor > 0 ? <BandChip band={c.questionnaireFloor} /> : <span className="text-stone-600">none</span>}
        </Stat>
        <Stat label="Matchmaking skill">
          {Math.round(c.matchmakingSkill)} <span className="text-stone-500">± {Math.round(c.posteriorSe)}</span>
        </Stat>
        <Stat label="General skill">
          {c.generalSkill != null ? (
            <>
              {Math.round(c.generalSkill)}
              {c.generalSkillSe != null && <span className="text-stone-500"> ± {Math.round(c.generalSkillSe)}</span>}
            </>
          ) : (
            <span className="text-stone-600">—</span>
          )}
        </Stat>
        <Stat label="Win chance vs even">
          {Math.round(c.matchmakingWinChance * 100)}%
        </Stat>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Answers table
// ---------------------------------------------------------------------------

function AnswersTable({ audit }: { audit: AdminCalibrationAudit }) {
  if (!audit.hasQuestionnaire) {
    return (
      <div className="rounded-md border border-dashed border-rizzotto-iron-700 py-6 text-center text-sm text-stone-500">
        This player hasn&rsquo;t completed the calibration questionnaire.
      </div>
    );
  }
  // The questionnaire floor is the MAX floor across answers — highlight the
  // answer(s) that set it, since that is what explains a play-up.
  const maxFloor = audit.questionnaireFloor;
  return (
    <div className="overflow-x-auto rounded-md border border-rizzotto-iron-700">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-rizzotto-iron-700 bg-rizzotto-iron-900/60">
            <th className="px-4 py-2.5 text-left font-medium text-stone-400">Question</th>
            <th className="px-4 py-2.5 text-left font-medium text-stone-400">Answer</th>
            <th className="px-4 py-2.5 text-left font-medium text-stone-400">Implied floor</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-rizzotto-iron-800/60">
          {audit.answers.map((a) => {
            const setsFloor = a.floor != null && maxFloor != null && a.floor === maxFloor;
            return (
              <tr
                key={a.questionId}
                className={setsFloor ? 'bg-rizzotto-gold-500/5' : undefined}
              >
                <td className="px-4 py-2.5 text-stone-300">
                  {a.prompt}
                  {setsFloor && (
                    <span className="ml-2 rounded bg-rizzotto-gold-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rizzotto-gold-400">
                      sets floor
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-stone-200">{a.optionLabel}</td>
                <td className="px-4 py-2.5">
                  <BandChip band={a.floor} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel — shared between the Skill Calibration tab (inline) and the Users tab
// (inside a modal). Given a userId, shows the full skill classification plus
// the calibration-questionnaire answer breakdown.
// ---------------------------------------------------------------------------

export function CalibrationAuditPanel({ userId, username }: { userId: string; username?: string }) {
  const auditQuery = useQuery({
    queryKey: ['admin-player-calibration', userId],
    queryFn: () => getAdminPlayerCalibrationAnswers(userId),
    enabled: !!userId,
    retry: false,
  });
  const classificationQuery = useQuery({
    queryKey: ['player-classification', userId],
    queryFn: () => getPlayerClassification(userId),
    enabled: !!userId,
    retry: false,
  });

  const queryClient = useQueryClient();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const resetMutation = useMutation({
    mutationFn: () => resetPlayerCalibration(userId),
    onSuccess: () => {
      setConfirmingReset(false);
      void queryClient.invalidateQueries({ queryKey: ['admin-player-calibration', userId] });
      void queryClient.invalidateQueries({ queryKey: ['player-classification', userId] });
      void queryClient.invalidateQueries({ queryKey: ['admin-skill-distribution'] });
    },
  });

  const isLoading = auditQuery.isLoading || classificationQuery.isLoading;
  const error = auditQuery.error ?? classificationQuery.error;
  const name = auditQuery.data?.username ?? username;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        {name && (
          <p className="text-sm text-stone-400">
            Calibration audit for <span className="font-semibold text-stone-200">{name}</span>
          </p>
        )}
        {auditQuery.data?.hasQuestionnaire &&
          (confirmingReset ? (
            <span className="flex shrink-0 items-center gap-2 text-xs">
              <span className="text-stone-400">Reset questionnaire?</span>
              <button
                type="button"
                disabled={resetMutation.isPending}
                onClick={() => resetMutation.mutate()}
                className="rounded border border-red-700 px-2 py-0.5 font-semibold text-red-300 hover:bg-red-900/30 disabled:opacity-50"
              >
                {resetMutation.isPending ? 'Resetting…' : 'Yes, reset'}
              </button>
              <button type="button" onClick={() => setConfirmingReset(false)} className="text-stone-500 hover:text-stone-300">
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingReset(true)}
              className="shrink-0 rounded border border-stone-700 px-2.5 py-1 text-xs font-semibold text-stone-300 transition-colors hover:border-red-700 hover:text-red-300"
            >
              Reset questionnaire
            </button>
          ))}
      </div>

      {isLoading && <div className="py-6 text-center text-sm text-stone-400">Loading…</div>}

      {error && !isLoading && (
        <div className="rounded border border-red-900 bg-red-950/40 p-3 text-xs text-red-300">
          Failed to load calibration data: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      )}

      {!isLoading && !error && (
        <>
          {classificationQuery.data && <ClassificationSummary c={classificationQuery.data} />}
          {auditQuery.data && <AnswersTable audit={auditQuery.data} />}
        </>
      )}
    </div>
  );
}
