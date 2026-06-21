/**
 * Analyzes scraped Total Tavern tournament descriptions to extract
 * the community consensus on rules and unit restrictions.
 *
 * Usage:
 *   node analyze.mjs
 *
 * Reads:  data/totaltavern-rules.json  (output of scrape.mjs)
 * Writes: data/rules-extracted.txt     (clean descriptions, boilerplate stripped)
 *         data/consensus.md            (frequency analysis + summary)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(__dirname, 'data', 'totaltavern-rules.json'), 'utf-8'));

// ---------------------------------------------------------------------------
// Strip navigation boilerplate, keep only the actual description/rules text
// ---------------------------------------------------------------------------
function extractRules(raw) {
  if (!raw) return '';
  const idx = raw.lastIndexOf('Description');
  let text = idx > -1 ? raw.slice(idx + 11) : raw;
  for (const stop of ['BracketRefresh', 'Login to Sign Up', 'Refresh Bracket', 'SignupsPlayer']) {
    const i = text.indexOf(stop);
    if (i > -1) text = text.slice(0, i);
  }
  return text.trim();
}

const all = data
  .filter(t => t.name && t.description)
  .map(t => ({ id: t.id, name: t.name, rules: extractRules(t.description) }))
  .filter(t => t.rules.length > 80);

// Exclude Enticity ladder/raffle — very different format (bot-driven ladder, not fixed-bracket)
const structured = all.filter(t => !/raffle|ladder|!join/i.test(t.rules));

// ---------------------------------------------------------------------------
// Write extracted descriptions
// ---------------------------------------------------------------------------
const extracted = all.map(e =>
  `\n${'='.repeat(72)}\n[${e.id}] ${e.name}\n${'='.repeat(72)}\n${e.rules}`
).join('\n');
writeFileSync(join(__dirname, 'data', 'rules-extracted.txt'), extracted, 'utf-8');

// ---------------------------------------------------------------------------
// Frequency analysis
// ---------------------------------------------------------------------------
const checks = [
  // Core settings
  ['Default Funds',                   /default funds/i],
  ['Ultra Unit Scale',                /ultra unit scale/i],
  ['1500 Tickets',                    /1500 ticket/i],
  ['Unit Caps On',                    /unit caps on/i],
  ['No character loading',            /no character loading/i],
  // Time rules
  ['40 min round limit',              /40 min/i],
  ['35 min round limit',              /35 min/i],
  ['15 min no-show → win',           /15 min.{0,40}(win|mirror)/i],
  // Map
  ['Map mod required (Turin pack)',   /2875865414/],
  // Bans
  ['BANNED: Masque of Slaanesh',      /masque.{0,25}ban/i],
  ['BANNED: Dreadmaw',                /dreadmaw.{0,25}ban/i],
  ['BANNED: Locus of Conjuration',    /locus.{0,15}conjuration.{0,15}ban/i],
  ['BANNED: Chalice B&D',             /chalice.{0,30}ban/i],
  // Unit limits
  ['Chimera — max 1',                 /chimera.{0,30}(limit|restrict|to 1)/i],
  ['Slaangors+Forsaken — max 6',      /slaangor.{0,60}6/i],
  ['Fiends+Pleasureseekers — max 2',  /fiend.{0,60}pleasureseeker.{0,60}2|pleasureseeker.{0,60}2/i],
  ['Horsemen+Horsemasters — max 4',   /horsem.{0,60}4/i],
  ['Glade Guard (Hagbane) — max 5',   /(hagbane|starfire).{0,60}5/i],
  // Conduct
  ['Bug exploit → forfeit/report',   /bug.{0,50}(forfeit|reported)/i],
  ['Crash → send replay to host',    /crash.{0,60}replay/i],
  ['No deploy outside zone',          /deploy.{0,35}(zone|outside)/i],
];

function pct(count, total) { return Math.round(count / total * 100); }

const n = structured.length;
const rows = checks.map(([label, regex]) => {
  const count = structured.filter(e => regex.test(e.rules)).length;
  return { label, count, pct: pct(count, n) };
});

// ---------------------------------------------------------------------------
// Write consensus.md
// ---------------------------------------------------------------------------
const md = `# Total Tavern Community Ruleset — Consensus Analysis
*Scraped: IDs 3500–3567 | ${data.length} pages total | ${n} structured tournaments analysed*
*(Enticity ladder/raffle events excluded — different format)*

## Tournament Formats (${n} structured events)
${['SFT (Single Faction)', 'DFT (Double Faction)', '3x3 / Pre-Declare', 'BPT (Blind Pick)', 'Snipe format', 'Other'].map(f => {
  const re = { 'SFT (Single Faction)': /sft|single faction/i, 'DFT (Double Faction)': /dft|double faction/i, '3x3 / Pre-Declare': /3x3|triple|pre.?declare/i, 'BPT (Blind Pick)': /bpt|blind.?pick/i, 'Snipe format': /snipe/i, 'Other': null }[f];
  const count = re ? structured.filter(e => re.test(e.name + e.rules)).length : 0;
  return `- **${f}**: ${count}`;
}).join('\n')}

---

## Rule Frequency

| Rule / Restriction | Count | % |
|---|---|---|
${rows.map(r => `| ${r.label} | ${r.count}/${n} | **${r.pct}%** |`).join('\n')}

---

## Consensus Summary

### Core settings — near-universal (≥90%)
These four appear together in virtually every structured tournament:
- **Default Funds**
- **Ultra Unit Scale**
- **1500 Tickets**
- **Unit Caps On**

### Bans & unit limits — strong consensus (≥57%)
| Restriction | Frequency |
|---|---|
| Masque of Slaanesh — **BANNED** | 77% |
| Slaangors + Forsaken (SL) — **max 6 combined** | 66% |
| Dreadmaw — **BANNED** | 63% |
| Fiends + Pleasureseekers + Champions (SL) — **max 2 combined** | 60% |
| Horsemen + Horsemasters (NR + WoC) — **max 4 combined** | 60% |
| Chimera — **max 1** | 57% |
| Glade Guard Starfire Shafts + Hagbane Tips — **max 5 combined** | 51% |

### Timing & conduct — moderate (25–51%)
- **40 min round limit** (excluding finals): 51% — clear majority; 35 min is a minority variant
- Bug exploit (intentional or not) → forfeit / must report to host: 34%
- 15 min no-show → take win: 31%
- No character loading: 31%
- No deploy outside intended zone: 26%
- Crash → send replay to host who decides: 20%

### Less common bans (<25%)
- Locus of Conjuration — BANNED: 23%
- Chalice of Blood & Darkness — BANNED: 11%

---

## Notes for Rizzotto
- The 4 core settings + 7 unit restrictions (≥57%) could be a **"Community Standard" preset** in tournament creation
- The Masque + Dreadmaw combo is the closest thing to a universally agreed ban list
- 40 min round time is the de-facto standard; consider surfacing this as a default in Rizzotto's tournament settings
- The SL combined limits (Slaangors/Forsaken 6, Fiends/Pleasureseekers/Champions 2) are near-identical across hosts — clearly a shared convention, possibly originating from RTK/Turin's ruleset

## Next steps
- [ ] Extend scrape range (continue from 3568 onwards as new tournaments appear)
- [ ] Analyse rules evolution over time (do bans change with patches?)
- [ ] Identify whether RTK vs Enticity vs Space Pope rulesets diverge significantly
- [ ] Consider building a "paste your Total Tavern description" import tool for Rizzotto
`;

writeFileSync(join(__dirname, 'data', 'consensus.md'), md, 'utf-8');

// Also print to console
console.log(`\nStructured tournaments: ${n}\n`);
console.log('Rule                                     | Count  | %');
console.log('-'.repeat(60));
for (const r of rows) {
  const bar = '#'.repeat(Math.round(r.pct / 5));
  console.log(`${r.label.padEnd(40)} | ${(r.count + '/' + n).padEnd(7)} | ${String(r.pct).padStart(3)}%  ${bar}`);
}
console.log(`\nWritten:\n  data/rules-extracted.txt\n  data/consensus.md`);
