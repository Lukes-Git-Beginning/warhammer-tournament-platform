import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAdminCalibrationQuestions,
  putAdminCalibrationQuestions,
  searchUsers,
  type CalibrationQuestionDto,
  type CalibrationOption,
} from '@/lib/api.js';
import { CalibrationAuditPanel } from './CalibrationAuditPanel.js';

// ---------------------------------------------------------------------------
// Floor helpers
// ---------------------------------------------------------------------------

const FLOOR_OPTIONS: { label: string; value: number | null }[] = [
  { label: '— none', value: null },
  { label: '1 New', value: 1 },
  { label: '2 Beginner', value: 2 },
  { label: '3 Intermediate', value: 3 },
  { label: '4 Advanced', value: 4 },
  { label: '5 Top', value: 5 },
];

// ---------------------------------------------------------------------------
// Unique-ID helper (no crypto dependency)
// ---------------------------------------------------------------------------

function uid(): string {
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function OptionRow({
  opt,
  onChange,
  onRemove,
}: {
  opt: CalibrationOption;
  onChange: (updated: CalibrationOption) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
      <input
        type="text"
        value={opt.label}
        onChange={(e) => onChange({ ...opt, label: e.target.value })}
        placeholder="Label"
        className="rounded border border-rizzotto-iron-600 bg-rizzotto-iron-950 px-2 py-1 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-1 focus:ring-rizzotto-gold-500"
      />
      <input
        type="text"
        value={opt.value}
        onChange={(e) => onChange({ ...opt, value: e.target.value })}
        placeholder="Value (key)"
        className="rounded border border-rizzotto-iron-600 bg-rizzotto-iron-950 px-2 py-1 text-sm text-stone-200 placeholder:text-stone-600 font-mono focus:outline-none focus:ring-1 focus:ring-rizzotto-gold-500"
      />
      <select
        value={opt.floor ?? ''}
        onChange={(e) => {
          const raw = e.target.value;
          onChange({ ...opt, floor: raw === '' ? null : Number(raw) });
        }}
        className="rounded border border-rizzotto-iron-600 bg-rizzotto-iron-950 px-2 py-1 text-sm text-stone-200 focus:outline-none focus:ring-1 focus:ring-rizzotto-gold-500"
      >
        {FLOOR_OPTIONS.map((fo) => (
          <option key={String(fo.value)} value={fo.value ?? ''}>
            {fo.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onRemove}
        title="Remove option"
        className="text-stone-500 hover:text-red-400 transition-colors text-xs px-1"
      >
        ✕
      </button>
    </div>
  );
}

function QuestionCard({
  question,
  index,
  onChange,
  onRemove,
}: {
  question: CalibrationQuestionDto;
  index: number;
  onChange: (updated: CalibrationQuestionDto) => void;
  onRemove: () => void;
}) {
  function updateOption(i: number, updated: CalibrationOption) {
    const options = question.options.map((o, idx) => (idx === i ? updated : o));
    onChange({ ...question, options });
  }

  function removeOption(i: number) {
    const options = question.options.filter((_, idx) => idx !== i);
    onChange({ ...question, options });
  }

  function addOption() {
    const options: CalibrationOption[] = [
      ...question.options,
      { value: '', label: '', floor: null },
    ];
    onChange({ ...question, options });
  }

  return (
    <div className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-1">
          <label className="block text-[10px] font-mono text-stone-500 uppercase tracking-wider">
            Question {index + 1} — ID: <span className="text-rizzotto-gold-600">{question.id}</span>
          </label>
          <input
            type="text"
            value={question.prompt}
            onChange={(e) => onChange({ ...question, prompt: e.target.value })}
            placeholder="Question prompt"
            className="w-full rounded border border-rizzotto-iron-600 bg-rizzotto-iron-950 px-3 py-1.5 text-sm text-stone-100 placeholder:text-stone-600 focus:outline-none focus:ring-1 focus:ring-rizzotto-gold-500"
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          title="Remove question"
          className="mt-5 text-stone-500 hover:text-red-400 transition-colors text-xs px-1"
        >
          Remove question
        </button>
      </div>

      {question.options.length > 0 && (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 text-[10px] text-stone-600 uppercase tracking-wider px-0.5">
            <span>Label</span>
            <span>Value</span>
            <span>Floor</span>
            <span />
          </div>
          {question.options.map((opt, i) => (
            <OptionRow
              key={i}
              opt={opt}
              onChange={(updated) => updateOption(i, updated)}
              onRemove={() => removeOption(i)}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={addOption}
        className="text-xs text-rizzotto-gold-500 hover:text-rizzotto-gold-300 transition-colors"
      >
        + Add option
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Player audit — search a player and inspect their answers + classification.
// ---------------------------------------------------------------------------

function CalibrationAuditSection() {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<{ id: string; username: string } | null>(null);

  const canSearch = search.trim().length >= 2;
  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', search, 'username', 'asc'],
    queryFn: () => searchUsers(search, 'username', 'asc'),
    enabled: canSearch,
  });
  const users = data?.users ?? [];

  return (
    <section className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4 space-y-4">
      <div className="space-y-0.5">
        <p className="text-sm font-semibold text-stone-300">Player calibration audit</p>
        <p className="text-xs text-stone-500">
          Search a player to see their questionnaire answers and full skill classification.
        </p>
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setSelected(null);
        }}
        placeholder="Search by username or Discord ID…"
        className="w-full max-w-sm rounded border border-rizzotto-iron-600 bg-rizzotto-iron-950 px-3 py-1.5 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-1 focus:ring-rizzotto-gold-500"
      />

      {canSearch && !selected && (
        <div className="max-h-60 max-w-sm overflow-y-auto rounded border border-rizzotto-iron-700 divide-y divide-rizzotto-iron-800/60">
          {isLoading && <div className="px-3 py-2 text-xs text-stone-500">Searching…</div>}
          {!isLoading && users.length === 0 && (
            <div className="px-3 py-2 text-xs text-stone-500">No players found.</div>
          )}
          {users.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => setSelected({ id: u.id, username: u.username })}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-stone-200 hover:bg-rizzotto-iron-800/50 transition-colors"
            >
              {u.avatar_url ? (
                <img
                  src={u.avatar_url}
                  alt={u.username}
                  className="h-6 w-6 rounded-full border border-stone-700 object-cover shrink-0"
                />
              ) : (
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-700 text-[10px] font-medium text-stone-200">
                  {u.username[0]?.toUpperCase() ?? '?'}
                </span>
              )}
              {u.username}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="text-xs text-rizzotto-gold-500 hover:text-rizzotto-gold-300 transition-colors"
          >
            ← Back to search
          </button>
          <CalibrationAuditPanel userId={selected.id} username={selected.username} />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

export function SkillCalibrationTab() {
  const queryClient = useQueryClient();

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['admin-calibration-questions'],
    queryFn: getAdminCalibrationQuestions,
    retry: false,
  });

  const [questions, setQuestions] = useState<CalibrationQuestionDto[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Initialise local state from server data (once)
  useEffect(() => {
    if (data?.questions) {
      setQuestions(data.questions);
    }
  }, [data]);

  const { mutate, isPending } = useMutation({
    mutationFn: (qs: CalibrationQuestionDto[]) => putAdminCalibrationQuestions(qs),
    onSuccess: (result) => {
      setQuestions(result.questions);
      setSaveStatus('saved');
      setSaveMessage('Saved successfully.');
      void queryClient.invalidateQueries({ queryKey: ['admin-calibration-questions'] });
      setTimeout(() => setSaveStatus('idle'), 3000);
    },
    onError: (err: Error) => {
      setSaveStatus('error');
      setSaveMessage(err.message ?? 'Save failed.');
    },
  });

  function addQuestion() {
    setQuestions((prev) => [
      ...prev,
      { id: uid(), prompt: '', options: [] },
    ]);
  }

  function updateQuestion(i: number, updated: CalibrationQuestionDto) {
    setQuestions((prev) => prev.map((q, idx) => (idx === i ? updated : q)));
  }

  function removeQuestion(i: number) {
    setQuestions((prev) => prev.filter((_, idx) => idx !== i));
  }

  function handleReset() {
    if (data?.defaults) {
      setQuestions(data.defaults);
      setSaveStatus('idle');
      setSaveMessage(null);
    }
  }

  function handleSave() {
    setSaveStatus('idle');
    setSaveMessage(null);
    mutate(questions);
  }

  return (
    <div className="space-y-6">
      {/* Intro / legend */}
      <div className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4 text-sm text-stone-400 space-y-1">
        <p className="font-semibold text-stone-300">Skill Calibration — Questionnaire Editor</p>
        <p>
          Each question has one or more options. The <strong className="text-stone-200">Floor</strong> field
          sets the minimum skill band that answer implies:
        </p>
        <ul className="mt-1 ml-4 list-disc space-y-0.5 text-xs">
          <li><span className="text-stone-200">None (—)</span> — no signal; answer is not used for gating.</li>
          <li><span className="text-stone-200">1 New</span> — band 1 (under 20% CtW).</li>
          <li><span className="text-stone-200">2 Beginner</span> — band 2+ (20-35%).</li>
          <li><span className="text-stone-200">3 Intermediate</span> — band 3+ (35-75%).</li>
          <li><span className="text-stone-200">4 Advanced</span> — band 4+ (75-90%).</li>
          <li><span className="text-stone-200">5 Top</span> — band 5, highest (90%+).</li>
        </ul>
        <p className="text-xs mt-1">
          The effective floor for a player is the <em>maximum</em> floor across all their answers. CtW =
          win chance vs the average active player, and each percentage is the win-chance range for that band.
        </p>
      </div>

      {/* Loading / error states */}
      {isLoading && (
        <div className="py-6 text-center text-stone-400 text-sm">Loading…</div>
      )}

      {loadError && (
        <div className="rounded border border-red-900 bg-red-950/40 p-3 text-red-300 text-xs">
          Failed to load calibration questions:{' '}
          {loadError instanceof Error ? loadError.message : 'Unknown error'}
        </div>
      )}

      {/* Question list */}
      {!isLoading && (
        <>
          <div className="space-y-4">
            {questions.map((q, i) => (
              <QuestionCard
                key={q.id}
                question={q}
                index={i}
                onChange={(updated) => updateQuestion(i, updated)}
                onRemove={() => removeQuestion(i)}
              />
            ))}

            {questions.length === 0 && (
              <div className="py-6 text-center text-stone-500 text-sm border border-dashed border-rizzotto-iron-700 rounded-md">
                No questions yet. Add one below.
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={addQuestion}
            className="text-sm text-rizzotto-gold-500 hover:text-rizzotto-gold-300 transition-colors"
          >
            + Add question
          </button>

          {/* Action bar */}
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-rizzotto-iron-700">
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending}
              className="rounded bg-rizzotto-gold-600 px-4 py-1.5 text-sm font-semibold text-rizzotto-iron-950 hover:bg-rizzotto-gold-500 transition-colors disabled:opacity-50"
            >
              {isPending ? 'Saving…' : 'Save'}
            </button>

            <button
              type="button"
              onClick={handleReset}
              disabled={!data?.defaults || isPending}
              className="rounded border border-rizzotto-iron-600 px-4 py-1.5 text-sm text-stone-300 hover:bg-rizzotto-iron-800 transition-colors disabled:opacity-40"
            >
              Reset to defaults
            </button>

            {saveStatus === 'saved' && saveMessage && (
              <span className="text-xs text-emerald-400">{saveMessage}</span>
            )}
            {saveStatus === 'error' && saveMessage && (
              <span className="text-xs text-red-400">{saveMessage}</span>
            )}
          </div>
        </>
      )}

      {/* Player calibration audit (#27) */}
      <CalibrationAuditSection />
    </div>
  );
}
