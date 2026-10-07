import type { CalibrationQuestionDto } from './api.js';

/**
 * Adaptive calibration flow (Alex-spec, 2026-07-03; per battle type since 2026-10-08).
 *
 * The questionnaire's only skill output is the FLOOR — the highest band any answer
 * implies (a MAX) — and since 2026-10-08 there is one floor PER BATTLE TYPE: a type's
 * floor counts only that type's questions + the general ones (backend `questionnaireFloor`
 * with a scope). Once the answered questions already pin a type's floor at N, any question
 * of that type whose best option is <= N cannot change a single outcome. These helpers
 * drive the wizard to ask only questions that could still raise SOME type's floor — the
 * result is provably identical to answering everything, just with fewer clicks (e.g. "TT
 * Top 16" ends the Domination block at once; the Conquest and Siege blocks are still asked,
 * since a Domination answer never sets their floor).
 */

const BATTLE_TYPES = ['DOMINATION', 'CONQUEST', 'SIEGE'] as const;
type BattleType = (typeof BATTLE_TYPES)[number];

/** The battle types a question feeds (no scope = general = every type). */
function typesOf(question: CalibrationQuestionDto): readonly BattleType[] {
  return question.battleTypes && question.battleTypes.length > 0 ? question.battleTypes : BATTLE_TYPES;
}

/** Floor implied by the answers so far — mirrors backend `questionnaireFloor`: the MAX
 *  band any answered option implies, default 1. Only ever rises. With `battleType`, only
 *  that type's questions + the general ones count. */
export function calibrationFloor(
  questions: CalibrationQuestionDto[],
  answers: Record<string, string>,
  battleType?: BattleType,
): number {
  let floor = 1;
  for (const q of questions) {
    if (battleType && !typesOf(q).includes(battleType)) continue;
    const opt = q.options.find((o) => o.value === answers[q.id]);
    if (opt?.floor != null && opt.floor > floor) floor = opt.floor;
  }
  return floor;
}

/** True when a question still has an option that could push the floor higher. */
export function canRaiseFloor(question: CalibrationQuestionDto, floor: number): boolean {
  return question.options.some((o) => o.floor != null && o.floor > floor);
}

/** The next question worth asking: the first unanswered, non-dismissed question that
 *  could still raise the floor of at least one battle type it feeds. Undefined when every
 *  type's outcome is already fixed. */
export function nextCalibrationQuestion(
  questions: CalibrationQuestionDto[],
  answers: Record<string, string>,
  dismissed: Record<string, boolean>,
): CalibrationQuestionDto | undefined {
  const floors = new Map(BATTLE_TYPES.map((t) => [t, calibrationFloor(questions, answers, t)]));
  return questions.find(
    (q) =>
      answers[q.id] == null &&
      !dismissed[q.id] &&
      typesOf(q).some((t) => canRaiseFloor(q, floors.get(t)!)),
  );
}

/** Display label for a question's battle type ("Conquest"), or null for a general question. */
export function questionTypeLabel(question: CalibrationQuestionDto): string | null {
  if (!question.battleTypes || question.battleTypes.length !== 1) return null;
  const t = question.battleTypes[0]!;
  return t.charAt(0) + t.slice(1).toLowerCase();
}
