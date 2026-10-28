import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BATTLE_TYPES } from '@rizzotto/types';
import { STANDARD_RULESET } from '@/components/tournament/StandardRulesetCard';
import { cooldownLabel, OpenPlayConduct, strikeDecay, strikeLadder, strikeOffences } from './OpenPlayConduct';

describe('Open Play code of conduct — the texts follow OPEN_PLAY_CONDUCT', () => {
  it('lists the strike ladder from a warning to an admin lift', () => {
    expect(strikeLadder()).toEqual([
      '1st strike: a warning by DM.',
      '2nd strike: no queueing for 1 hour.',
      '3rd strike: no queueing for 24 hours.',
      '4th strike: no queueing for 7 days.',
      '5th and every further strike: no queueing until an admin lifts it.',
    ]);
  });

  it('names both offences with their numbers, and the decay', () => {
    const [queue, pick] = strikeOffences();
    expect(queue).toContain('3 times within 24 hours, each within 5 minutes of joining');
    expect(pick).toContain('5 minutes after your opponent picked');
    expect(strikeDecay()).toBe('Every 7 days without a new strike, one strike is taken off.');
  });

  it('writes cooldowns in hours or whole days', () => {
    expect(cooldownLabel(1)).toBe('1 hour');
    expect(cooldownLabel(24)).toBe('24 hours');
    expect(cooldownLabel(168)).toBe('7 days');
  });
});

describe('Open Play code of conduct box', () => {
  const LAND_BATTLE_RULE = 'Both players must attack at all times.';

  function render() {
    const client = new QueryClient();
    for (const bt of BATTLE_TYPES) {
      const conduct = [...STANDARD_RULESET.conduct, ...(bt === 'LAND_BATTLE' ? [LAND_BATTLE_RULE] : [])];
      client.setQueryData(['standard-ruleset', bt, 'ONE_V_ONE'], { ...STANDARD_RULESET, conduct });
    }
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <OpenPlayConduct />
      </QueryClientProvider>,
    );
  }

  it('shows your part and why strikes exist, with the strike details folded in', () => {
    const html = render();
    expect(html).toContain('Your part');
    expect(html).toContain('10 minutes to ready up');
    expect(html).toContain('What not to do');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('How strikes work');
    expect(html).not.toContain('What a strike does');
  });

  it("leaves a battle type's own rules to the rules box", () => {
    expect(render()).not.toContain(LAND_BATTLE_RULE);
  });
});
