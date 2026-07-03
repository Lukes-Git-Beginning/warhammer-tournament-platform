/**
 * Skill band 1..5 display metadata for BALANCED_LIECHTENSTEIN.
 * Colour progression (distinct metals, easy to tell apart):
 *   1 New → white · 2 Beginner → dark rust · 3 Intermediate → bronze ·
 *   4 Advanced → silver · 5 Top → gold.
 *
 * Exported from a shared module so SwissStandings and SVGBracket/MatchNode
 * use identical colours without duplicating the definition.
 */
export const SKILL_BAND_META: Record<number, { name: string; textCls: string; borderCls: string; bgCls: string; dotCls: string }> = {
  1: { name: 'New',          textCls: 'text-stone-100',         borderCls: 'border-stone-300/40',   bgCls: 'bg-stone-200/10',    dotCls: 'bg-stone-100' },
  2: { name: 'Beginner',     textCls: 'text-orange-600',        borderCls: 'border-orange-800/60',  bgCls: 'bg-orange-950/30',   dotCls: 'bg-orange-800' },
  3: { name: 'Intermediate', textCls: 'text-[#cd9557]',         borderCls: 'border-[#a06a30]/60',   bgCls: 'bg-[#3a2914]/40',    dotCls: 'bg-[#c17f38]' },
  4: { name: 'Advanced',     textCls: 'text-slate-300',         borderCls: 'border-slate-400/50',   bgCls: 'bg-slate-400/10',    dotCls: 'bg-slate-400' },
  5: { name: 'Top',          textCls: 'text-rizzotto-gold-400', borderCls: 'border-rizzotto-gold-400/60', bgCls: 'bg-rizzotto-gold-500/10', dotCls: 'bg-rizzotto-gold-400' },
};
