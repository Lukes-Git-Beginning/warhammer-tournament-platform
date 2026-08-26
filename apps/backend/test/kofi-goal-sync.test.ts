import { describe, it, expect } from 'vitest';
import { parseKofiGoal } from '../src/lib/kofi-goal-sync.js';

// Mirrors the real Ko-Fi markup: a "27% " span immediately followed by the
// goal-total span with the stable id, "of €500 goal".
function page(pct: string, target: string): string {
  return (
    `<div id="profileGoalTitle" class="kfds-font-bold">Build 2v2, Conquest & Siege + run the Arena</div>` +
    `<div class="progress"><div class="progress-bar" role="progressbar" aria-valuenow="0"></div></div>` +
    `<div class="text-left"><span class="kfds-font-bold">${pct}% </span>` +
    `<span class="goal-label" id="profileGoalTotal">of €${target} goal</span></div>`
  );
}

describe('parseKofiGoal', () => {
  it('parses the target and derives raised from the percentage', () => {
    expect(parseKofiGoal(page('27', '500'))).toEqual({ goal: 500, raised: 135 });
  });

  it('handles a thousands separator in the target', () => {
    expect(parseKofiGoal(page('50', '1,000'))).toEqual({ goal: 1000, raised: 500 });
  });

  it('handles a €-entity instead of the literal symbol', () => {
    const html = page('40', '500').replace('of €500', 'of &#x20AC;500');
    expect(parseKofiGoal(html)).toEqual({ goal: 500, raised: 200 });
  });

  it('returns null when there is no goal block', () => {
    expect(parseKofiGoal('<div>no goal here</div>')).toBeNull();
  });
});
