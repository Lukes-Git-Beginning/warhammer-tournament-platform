import type { ProjectedDivision } from '@rizzotto/types';

/**
 * A placeholder playoff bracket rendered from the projected plan (TBD slots), shown BEFORE the
 * real playoffs are generated. It reshapes live as the field changes (the plan is recomputed on
 * every fetch) and is replaced by the real bracket once the group phase ends. Purely presentational
 * — a left-to-right column of round boxes per projected division.
 */
export function PlayoffPlanPreview({ divisions }: { divisions: ProjectedDivision[] }) {
  const real = divisions.filter((d) => d.format !== 'NONE' && d.size >= 2);
  if (real.length === 0) return null;

  return (
    <div className="mb-4 rounded-md border border-dashed border-stone-700 bg-stone-950/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-stone-500">Playoff plan</span>
        <span className="text-[10px] italic text-stone-600">provisional — fills in when the group phase ends</span>
      </div>
      <div className="flex flex-col gap-5">
        {real.map((d, i) => (
          <DivisionPreview key={i} division={d} label={real.length > 1 ? `Division ${i + 1}` : null} />
        ))}
      </div>
    </div>
  );
}

function DivisionPreview({ division, label }: { division: ProjectedDivision; label: string | null }) {
  const rounds = divisionRounds(division.format);
  return (
    <div>
      {label && (
        <div className="mb-2 text-xs font-medium text-stone-400">
          {label} <span className="text-stone-600">· {division.format.replace('TOP', 'Top ')} · {division.size} seeds</span>
        </div>
      )}
      <div className="flex items-stretch gap-4 overflow-x-auto pb-1">
        {rounds.map((round, r) => (
          <div key={r} className="flex min-w-[130px] flex-col justify-center gap-3">
            <div className="text-[10px] uppercase tracking-wider text-stone-600">{round.label}</div>
            {round.boxes.map((box, b) => (
              <div key={b} className="rounded border border-stone-700/70 bg-stone-900/60 px-2 py-1">
                {box.tag && <div className="mb-0.5 text-[9px] uppercase tracking-wider text-stone-600">{box.tag}</div>}
                <div className="text-xs text-stone-500">TBD</div>
                <div className="my-0.5 h-px bg-stone-800" />
                <div className="text-xs text-stone-500">TBD</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

interface Round { label: string; boxes: { tag?: string }[] }

/** The bracket rounds for a division's playoff format (matches buildDivisionBracket's shape). */
function divisionRounds(format: ProjectedDivision['format']): Round[] {
  if (format === 'TOP8') {
    return [
      { label: 'Quarterfinals', boxes: [{}, {}, {}, {}] },
      { label: 'Semifinals', boxes: [{}, {}] },
      { label: 'Final', boxes: [{ tag: 'Final' }, { tag: '3rd place' }] },
    ];
  }
  if (format === 'TOP4') {
    return [
      { label: 'Semifinals', boxes: [{}, {}] },
      { label: 'Final', boxes: [{ tag: 'Final' }, { tag: '3rd place' }] },
    ];
  }
  // TOP2 — direct final + third place.
  return [{ label: 'Final', boxes: [{ tag: 'Final' }, { tag: '3rd place' }] }];
}
