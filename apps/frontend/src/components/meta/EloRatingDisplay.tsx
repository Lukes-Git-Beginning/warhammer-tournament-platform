interface EloRatingDisplayProps {
  rating: number;
  delta?: number;
  size?: 'sm' | 'md';
}

export function EloRatingDisplay({ rating, delta, size = 'md' }: EloRatingDisplayProps) {
  const ratingClass = size === 'sm' ? 'text-sm font-semibold' : 'text-base font-bold';
  const deltaClass = size === 'sm' ? 'text-xs' : 'text-sm';

  let deltaEl: React.ReactNode = null;
  if (delta !== undefined) {
    if (delta > 0) {
      deltaEl = (
        <span className={`${deltaClass} text-emerald-400 ml-1`}>
          ▲ +{delta}
        </span>
      );
    } else if (delta < 0) {
      deltaEl = (
        <span className={`${deltaClass} text-red-400 ml-1`}>
          ▼ {delta}
        </span>
      );
    } else {
      deltaEl = (
        <span className={`${deltaClass} text-stone-500 ml-1`}>
          — 0
        </span>
      );
    }
  }

  return (
    <span className="inline-flex items-baseline gap-0.5">
      <span className={`${ratingClass} text-stone-100`}>{rating}</span>
      {deltaEl}
    </span>
  );
}
