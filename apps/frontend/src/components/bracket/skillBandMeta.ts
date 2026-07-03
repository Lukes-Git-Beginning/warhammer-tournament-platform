/**
 * Skill band 1..5 display metadata for BALANCED_LIECHTENSTEIN.
 * Colour progression: iron (1) → bronze (2) → muted gold (3) → bright gold (4) → forge glow (5).
 * Consistent with PlayerLevelScale.tsx BANDS array.
 *
 * Exported from a shared module so SwissStandings and SVGBracket/MatchNode
 * use identical colours without duplicating the definition.
 */
export const SKILL_BAND_META: Record<number, { name: string; textCls: string; borderCls: string; bgCls: string; dotCls: string }> = {
  1: { name: 'New',          textCls: 'text-stone-400',           borderCls: 'border-stone-600/60',          bgCls: 'bg-stone-700/20',          dotCls: 'bg-stone-400' },
  2: { name: 'Beginner',     textCls: 'text-amber-700',           borderCls: 'border-amber-800/60',          bgCls: 'bg-amber-950/30',          dotCls: 'bg-amber-700' },
  3: { name: 'Intermediate', textCls: 'text-rizzotto-gold-600',   borderCls: 'border-rizzotto-gold-600/50',  bgCls: 'bg-rizzotto-gold-600/10',  dotCls: 'bg-rizzotto-gold-600' },
  4: { name: 'Advanced',     textCls: 'text-rizzotto-gold-400',   borderCls: 'border-rizzotto-gold-400/60',  bgCls: 'bg-rizzotto-gold-500/10',  dotCls: 'bg-rizzotto-gold-400' },
  5: { name: 'Top',          textCls: 'text-orange-300',          borderCls: 'border-orange-400/60',         bgCls: 'bg-orange-500/10',         dotCls: 'bg-orange-300' },
};
