import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPlayerClassification } from '@/lib/api.js';
import { Button } from '@/components/ui/button.js';

// Five skill bands, low → high, as distinct metals: white → dark rust → bronze
// → silver → gold. Kept in sync with SKILL_BAND_META (bracket/standings).
const BANDS = [
  { name: 'New', color: 'bg-stone-100', text: 'text-stone-100' },
  { name: 'Beginner', color: 'bg-orange-800', text: 'text-orange-600' },
  { name: 'Intermediate', color: 'bg-[#c17f38]', text: 'text-[#cd9557]' },
  { name: 'Advanced', color: 'bg-slate-400', text: 'text-slate-300' },
  { name: 'Top', color: 'bg-rizzotto-gold-400', text: 'text-rizzotto-gold-400' },
] as const;

// Must match the backend SKILL_BAND_THRESHOLDS (rating-model.ts): the log-odds
// cut-points for 20 / 35 / 75 / 90 % win-chance vs the average player.
const THRESHOLDS = [-1.3863, -0.619, 1.0986, 2.1972];
const SCALE_LOW = -3.5;
const SCALE_HIGH = 3.5;
// Below this SE the data alone is confident enough to place a player without a questionnaire.
const CONFIDENT_SE = 1.0;

function bandIndex(skill: number): number {
  let b = 0;
  for (const t of THRESHOLDS) if (skill >= t) b++;
  return b; // 0..4
}

/** Position (0..100) of a skill value across five equal-width band segments. */
function scalePercent(skill: number): number {
  const bounds = [SCALE_LOW, ...THRESHOLDS, SCALE_HIGH];
  for (let b = 0; b < 5; b++) {
    if (skill < bounds[b + 1]! || b === 4) {
      const inner = (skill - bounds[b]!) / (bounds[b + 1]! - bounds[b]!);
      return ((b + Math.min(1, Math.max(0, inner))) / 5) * 100;
    }
  }
  return 0;
}

function ScaleTrack({ markerPercent, dataPercent, activeBand }: { markerPercent: number | null; dataPercent?: number | null; activeBand: number | null }) {
  return (
    <div className="relative">
      <div className="flex h-2 overflow-hidden rounded-full">
        {BANDS.map((band, i) => (
          <div
            key={band.name}
            className={`h-full flex-1 ${markerPercent === null ? 'bg-stone-800' : band.color} ${
              activeBand !== null && i !== activeBand ? 'opacity-40' : ''
            }`}
          />
        ))}
      </div>
      {/* #17: data-only marker — where the player's games alone place them. */}
      {dataPercent != null && (
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-stone-400 bg-stone-900"
          style={{ left: `${dataPercent}%` }}
          title="Where your games alone place you"
        />
      )}
      {markerPercent !== null && (
        <div
          className="absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-rizzotto-stone-100 shadow-rizzotto-gold-glow"
          style={{ left: `${markerPercent}%` }}
        />
      )}
      <div className="mt-1.5 flex text-[10px] uppercase tracking-wider text-stone-600">
        {BANDS.map((band) => (
          <span key={band.name} className="flex-1 text-center">
            {band.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-stone-800 bg-stone-900/60 p-5">
      <p className="mb-4 text-xs uppercase tracking-wider text-stone-500">Your Standing</p>
      {children}
    </div>
  );
}

export function PlayerLevelScale({
  userId,
  isOwnProfile,
  onCalibrate,
}: {
  userId: string;
  isOwnProfile: boolean;
  onCalibrate: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['player-classification', userId],
    queryFn: () => getPlayerClassification(userId),
    retry: false,
  });

  if (isLoading) {
    return (
      <Frame>
        <div className="h-8 animate-pulse rounded bg-stone-800" />
      </Frame>
    );
  }
  if (!data) return null;

  // With a questionnaire, show the blended estimate; otherwise the raw data
  // estimate (the default band-1 prior is not real signal to display).
  const displaySkill = data.hasQuestionnaire ? data.matchmakingSkill : data.generalSkill;
  const enoughSignal =
    data.hasQuestionnaire ||
    (data.generalSkill != null && data.generalSkillSe != null && data.generalSkillSe < CONFIDENT_SE);

  if (!enoughSignal || displaySkill == null) {
    return (
      <Frame>
        <ScaleTrack markerPercent={null} activeBand={null} />
        {isOwnProfile ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-stone-400">
              Hi! We don&apos;t have enough match data yet to gauge your level. Want to answer a
              few quick questions so we can give you the best experience in RizzOtto&apos;s Arena?
            </p>
            <Button variant="etched" size="sm" onClick={onCalibrate}>
              Answer a few questions →
            </Button>
          </div>
        ) : (
          <p className="mt-4 text-sm text-stone-500">Not enough data to place this player yet.</p>
        )}
      </Frame>
    );
  }

  const bi = bandIndex(displaySkill);
  const pct = scalePercent(displaySkill);
  const winPct = Math.round((1 / (1 + Math.exp(-displaySkill))) * 100);
  // #17: when a questionnaire is blended in, also surface where the games alone place
  // the player — showing which way real results are correcting the rating.
  const dataPct = data.hasQuestionnaire && data.generalSkill != null ? scalePercent(data.generalSkill) : null;
  const dataBandName =
    data.hasQuestionnaire && data.generalSkill != null ? BANDS[bandIndex(data.generalSkill)]!.name : null;

  return (
    <Frame>
      <div className="mb-3 flex items-baseline justify-between">
        <span className={`font-display text-lg font-semibold ${BANDS[bi]!.text}`}>
          {BANDS[bi]!.name}
        </span>
        <span className="text-xs text-stone-500">{winPct}% vs. average player</span>
      </div>
      <ScaleTrack markerPercent={pct} dataPercent={dataPct} activeBand={bi} />
      {dataPct != null && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-stone-500">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-stone-400 bg-stone-900" />
          From your games only: <span className="text-stone-400">{dataBandName}</span>
        </p>
      )}
      {isOwnProfile && !data.hasQuestionnaire && (
        <button
          onClick={onCalibrate}
          className="mt-3 text-xs text-rizzotto-gold-400 transition-colors hover:text-rizzotto-gold-300"
        >
          Refine your level with a few questions →
        </button>
      )}
    </Frame>
  );
}
