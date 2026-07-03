import type { CalibrationQuestionDto } from './api.js';

/**
 * Adaptive calibration flow (Alex-spec, 2026-07-03).
 *
 * The questionnaire's only skill output is the FLOOR — the highest band any answer
 * implies (a MAX). The matchmaking prior and the gating band both derive solely from
 * that floor (see backend `classify()`), so once the answered questions already pin
 * the floor at N, any question whose best option is <= N cannot change a single
 * outcome. Asking it is pure wasted time. These helpers drive the wizard to ask only
 * questions that could still raise the floor — the result is provably identical to
 * answering everything, just with fewer clicks (e.g. "TT Top 16" ends it at once;
 * "Won an open tournament" jumps straight to the self-rating, the only remaining
 * question that could still reach Top).
 */

/** Floor implied by the answers so far — mirrors backend `questionnaireFloor`: the
 *  MAX band any answered option implies, default 1. Only ever rises. */
export function calibrationFloor(
  questions: CalibrationQuestionDto[],
  answers: Record<string, string>,
): number {
  let floor = 1;
  for (const q of questions) {
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
 *  could still raise the floor. Undefined when the outcome is already fixed. */
export function nextCalibrationQuestion(
  questions: CalibrationQuestionDto[],
  answers: Record<string, string>,
  dismissed: Record<string, boolean>,
): CalibrationQuestionDto | undefined {
  const floor = calibrationFloor(questions, answers);
  return questions.find(
    (q) => answers[q.id] == null && !dismissed[q.id] && canRaiseFloor(q, floor),
  );
}
