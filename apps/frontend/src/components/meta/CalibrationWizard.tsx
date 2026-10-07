import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getCalibrationQuestions, getMyCalibrationAnswers, saveCalibrationAnswers } from '@/lib/api.js';
import { nextCalibrationQuestion, questionTypeLabel } from '@/lib/calibrationFlow.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog.js';
import { Button } from '@/components/ui/button.js';

/** Stored for a battle-type question the player skipped, so the "answer the new questions"
 *  banner doesn't keep coming back. Not an option value → it never sets a floor. */
const SKIPPED = 'skipped';

/**
 * Calibration questionnaire dialog. Questions are grouped per battle type, strongest-first
 * AND adaptive: only questions that could still raise some battle type's floor are asked
 * (see `calibrationFlow.ts`). The wizard starts from the player's stored answers, so a
 * returning player is only asked what's still open (e.g. the Conquest/Siege questions added
 * after they calibrated). Answers merge into their stored profile on save.
 */
export function CalibrationWizard({
  userId,
  open,
  onOpenChange,
}: {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['calibration-questions'],
    queryFn: getCalibrationQuestions,
    staleTime: Infinity,
    enabled: open,
  });
  const { data: stored } = useQuery({
    queryKey: ['my-calibration-answers'],
    queryFn: getMyCalibrationAnswers,
    enabled: open,
  });

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});

  const questions = data?.questions ?? [];

  const save = useMutation({
    mutationFn: () => {
      // Mark skipped battle-type questions so the pending-types banner clears.
      const skipped: Record<string, string> = {};
      for (const q of questions) {
        if (dismissed[q.id] && q.battleTypes?.length && answers[q.id] == null) skipped[q.id] = SKIPPED;
      }
      return saveCalibrationAnswers({ ...skipped, ...answers });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['player-classification', userId] });
      void queryClient.invalidateQueries({ queryKey: ['my-calibration-answers'] });
      onOpenChange(false);
    },
  });

  // Next question worth asking, given what's been answered (stored + this session) or
  // dismissed. Undefined once no remaining question could raise any type's floor.
  const known = { ...(stored?.answers ?? {}), ...answers };
  const ready = data != null && stored != null;
  const question = ready ? nextCalibrationQuestion(questions, known, dismissed) : undefined;
  const answeredCount = Object.keys(answers).length;
  // Saving only skips is allowed for a returning player (clears the banner) — never for a new
  // one, whose skip markers would otherwise count as "calibrated" with no real answer.
  const canSaveSkipsOnly = Object.keys(dismissed).length > 0 && Object.keys(stored?.answers ?? {}).length > 0;
  const done = ready && questions.length > 0 && !question;
  const typeLabel = question ? questionTypeLabel(question) : null;

  function choose(value: string) {
    if (question) setAnswers((a) => ({ ...a, [question.id]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Where do you stand?</DialogTitle>
          <DialogDescription>
            A few quick questions per battle type help us place your level. Answer what you can — skip the rest.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <p className="py-2 text-sm text-stone-300">
            {answeredCount > 0
              ? "That's everything we need — save to set your level."
              : 'No answers yet. You can save and come back anytime.'}
          </p>
        ) : question ? (
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              {typeLabel && (
                <span className="inline-block rounded border border-stone-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-stone-400">
                  {typeLabel}
                </span>
              )}
              <p className="text-sm font-medium text-rizzotto-stone-200">{question.prompt}</p>
            </div>
            <div className="space-y-2">
              {question.options.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => choose(opt.value)}
                  className="w-full rounded-md border border-stone-800 bg-stone-900/60 px-3 py-2 text-left text-sm text-stone-300 transition-colors hover:border-stone-700"
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setDismissed((d) => ({ ...d, [question.id]: true }))}
              className="text-xs text-stone-500 transition-colors hover:text-stone-400"
            >
              Skip this question →
            </button>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-stone-500">Loading…</p>
        )}

        <div className="flex items-center justify-between gap-2 pt-2">
          <span className="text-xs text-stone-600">
            {answeredCount > 0 ? `${answeredCount} answered` : ''}
          </span>
          <Button
            variant="etched"
            size="sm"
            disabled={save.isPending || (answeredCount === 0 && !canSaveSkipsOnly)}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save my level'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
