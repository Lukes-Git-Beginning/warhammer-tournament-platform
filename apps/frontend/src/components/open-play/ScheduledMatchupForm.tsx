import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createScheduledMatchup, getAvailabilityHeatmap, type MatchFormat, type HeatmapSlot } from '../../lib/api';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Select } from '../ui/select';
import { Textarea } from '../ui/textarea';
import { AvailabilityHeatmap } from './AvailabilityHeatmap';
import { ChallengeCalendar } from './ChallengeCalendar';

interface ScheduledMatchupFormProps {
  onSuccess?: () => void;
}

export function ScheduledMatchupForm({ onSuccess }: ScheduledMatchupFormProps) {
  const qc = useQueryClient();
  const [format, setFormat] = useState<MatchFormat>('BO3');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [notes, setNotes] = useState('');
  const [anonymous, setAnonymous] = useState(false);

  const { data: heatmapData } = useQuery({
    queryKey: ['availability-heatmap'],
    queryFn: getAvailabilityHeatmap,
    staleTime: 5 * 60 * 1000,
  });

  const matchmakingSlots: HeatmapSlot[] = (heatmapData?.slots ?? []).filter(
    (s) => s.context === 'MATCHMAKING',
  );

  const create = useMutation({
    mutationFn: () =>
      createScheduledMatchup({
        format,
        proposed_at: selectedDate!.toISOString(),
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
      className="space-y-5"
    >
      <div className="space-y-1.5">
        <Label>Format</Label>
        <Select value={format} onChange={(e) => setFormat(e.target.value as MatchFormat)} className="w-48">
          <option value="BO1">BO1 — Best of 1 (~30 min)</option>
          <option value="BO3">BO3 — Best of 3 (~90 min)</option>
          <option value="BO5">BO5 — Best of 5 (~150 min)</option>
        </Select>
      </div>

      {/* 7-day pick calendar */}
      <div className="space-y-1.5">
        <Label>Pick a start time</Label>
        <ChallengeCalendar format={format} selected={selectedDate} onSelect={setSelectedDate} />
      </div>

      {/* Community heatmap for reference */}
      <div className="space-y-1">
        <p className="text-xs font-medium text-stone-400">When are others usually free?</p>
        <p className="text-xs text-stone-500">Use the heatmap above to pick a time with good overlap.</p>
        <AvailabilityHeatmap slots={matchmakingSlots} />
      </div>

      <div className="space-y-1.5">
        <Label>Notes (optional)</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. any faction welcome, looking for a close game"
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

      <Button type="submit" size="lg" disabled={create.isPending || !selectedDate} className="w-full">
        {create.isPending ? 'Posting...' : 'Post Challenge'}
      </Button>
    </form>
  );
}
