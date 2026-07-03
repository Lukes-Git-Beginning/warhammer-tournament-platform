import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getCalibrationQuestions, saveCalibrationAnswers } from '@/lib/api.js';
import { nextCalibrationQuestion } from '@/lib/calibrationFlow.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog.js';
import { Button } from '@/components/ui/button.js';

/**
 * Calibration questionnaire dialog. Questions are strongest-first AND adaptive: only
 * questions that could still raise the player's floor are asked, so a strong player
 * finishes in one or two clicks (see `calibrationFlow.ts`). Answers merge into their
 * stored profile on save.
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

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});

  const save = useMutation({
    mutationFn: () => saveCalibrationAnswers(answers),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['player-classification', userId] });
      onOpenChange(false);
    },
  });

  const questions = data?.questions ?? [];
  // Next question worth asking, given what's been answered/dismissed. Undefined once
  // no remaining question could raise the floor → the level is already decided.
  const question = nextCalibrationQuestion(questions, answers, dismissed);
  const answeredCount = Object.keys(answers).length;
  const done = questions.length > 0 && !question;

  function choose(value: string) {
    if (question) setAnswers((a) => ({ ...a, [question.id]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Where do you stand?</DialogTitle>
          <DialogDescription>
            A few quick questions help us place your level. Answer what you can — skip the rest.
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
            <p className="text-sm font-medium text-rizzotto-stone-200">{question.prompt}</p>
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
            disabled={save.isPending || answeredCount === 0}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save my level'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
