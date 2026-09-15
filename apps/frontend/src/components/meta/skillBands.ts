// Five skill bands, low → high, as distinct metals: white → dark rust → bronze
// → silver → gold. Kept in sync with SKILL_BAND_META (bracket/standings) and the
// backend SKILL_BAND_THRESHOLDS (rating-model.ts). `hex` mirrors the Tailwind
// class so SVG (recharts) can use the same colours as the DOM.
export const BANDS = [
  { name: 'New', color: 'bg-stone-100', text: 'text-stone-100', hex: '#f5f5f4' },
  { name: 'Beginner', color: 'bg-orange-800', text: 'text-orange-600', hex: '#9a3412' },
  { name: 'Intermediate', color: 'bg-[#c17f38]', text: 'text-[#cd9557]', hex: '#c17f38' },
  { name: 'Advanced', color: 'bg-slate-400', text: 'text-slate-300', hex: '#94a3b8' },
  { name: 'Top', color: 'bg-rizzotto-gold-400', text: 'text-rizzotto-gold-400', hex: '#e4b432' },
] as const;

// Log-odds cut-points for 20 / 35 / 75 / 90 % win-chance vs the average player.
export const THRESHOLDS = [-1.3863, -0.619, 1.0986, 2.1972];

/** Band index 0..4 for a log-odds skill value. */
export function bandIndex(skill: number): number {
  let b = 0;
  for (const t of THRESHOLDS) if (skill >= t) b++;
  return b; // 0..4
}

/** Win-% (0..100) vs the average player for a log-odds skill value. */
export function winChance(skill: number): number {
  return (1 / (1 + Math.exp(-skill))) * 100;
}
