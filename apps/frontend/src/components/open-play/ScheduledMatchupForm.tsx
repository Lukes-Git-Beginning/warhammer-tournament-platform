import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createScheduledMatchup, type MatchFormat } from '../../lib/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select } from '../ui/select';
import { Textarea } from '../ui/textarea';

interface ScheduledMatchupFormProps {
  onSuccess?: () => void;
}

export function ScheduledMatchupForm({ onSuccess }: ScheduledMatchupFormProps) {
  const qc = useQueryClient();
  const [format, setFormat] = useState<MatchFormat>('BO3');
  const [proposedAt, setProposedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [anonymous, setAnonymous] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      createScheduledMatchup({
        format,
        proposed_at: new Date(proposedAt).toISOString(),
        notes: notes || undefined,
        anonymous,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scheduled-matchups'] });
      onSuccess?.();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label>Format</Label>
        <Select value={format} onChange={(e) => setFormat(e.target.value as MatchFormat)}>
          <option value="BO1">BO1 — Best of 1</option>
          <option value="BO3">BO3 — Best of 3</option>
          <option value="BO5">BO5 — Best of 5</option>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Proposed time (your local time)</Label>
        <Input
          type="datetime-local"
          value={proposedAt}
          onChange={(e) => setProposedAt(e.target.value)}
          required
          min={new Date().toISOString().slice(0, 16)}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Notes (optional)</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Blind Pick, any faction ok"
          maxLength={500}
          rows={2}
        />
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={anonymous}
          onChange={(e) => setAnonymous(e.target.checked)}
          className="h-4 w-4 rounded border-stone-600 bg-stone-800 text-amber-500"
        />
        <span className="text-sm text-stone-300">Post anonymously</span>
      </label>

      {create.error && (
        <p className="text-xs text-red-400">{String(create.error)}</p>
      )}

      <Button type="submit" disabled={create.isPending || !proposedAt} className="w-full">
        {create.isPending ? 'Posting...' : 'Post Challenge'}
      </Button>
    </form>
  );
}
