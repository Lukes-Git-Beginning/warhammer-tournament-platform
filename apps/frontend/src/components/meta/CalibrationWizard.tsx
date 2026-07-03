import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getCalibrationQuestions, saveCalibrationAnswers } from '@/lib/api.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog.js';
import { Button } from '@/components/ui/button.js';

/**
 * Calibration questionnaire dialog. Questions are strongest-first, so experienced
 * players can save after a click or two; the player answers what they can and
 * skips the rest. Answers merge into their stored profile on save.
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

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () => saveCalibrationAnswers(answers),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['player-classification', userId] });
      onOpenChange(false);
    },
  });

  const questions = data?.questions ?? [];
  const question = questions[step];
  const answeredCount = Object.keys(answers).length;
  const done = questions.length > 0 && !question;

  function choose(value: string) {
    if (!question) return;
    setAnswers((a) => ({ ...a, [question.id]: value }));
    setStep((s) => s + 1);
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
              ? "That's everything — save to set your level."
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
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    answers[question.id] === opt.value
                      ? 'border-rizzotto-gold-500 bg-rizzotto-gold-500/10 text-rizzotto-gold-300'
                      : 'border-stone-800 bg-stone-900/60 text-stone-300 hover:border-stone-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setStep((s) => s + 1)}
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
