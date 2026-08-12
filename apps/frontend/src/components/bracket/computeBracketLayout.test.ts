import { describe, it, expect } from 'vitest';
import type { BracketNode, ProjectedDivision } from '@rizzotto/types';
import {
  computeBracketLayout,
  computePlaceholderLayout,
  computeBracketRender,
  realDivisionBands,
  MATCH_HEIGHT,
  MATCH_WIDTH,
  ROW_GAP,
  ROUND_GAP,
} from './computeBracketLayout';

function makeMatch(
  matchId: string,
  round: number,
  matchNumber: number,
  nextMatchId: string | null = null,
  bracketSide: BracketNode['bracketSide'] = null,
  loserNextMatchId: string | null = null,
  phase: BracketNode['phase'] = null,
): BracketNode {
  return {
    matchId,
    round,
    matchNumber,
    player1Id: null,
    player2Id: null,
    winnerId: null,
    score: null,
    result: null,
    player1Points: null,
    player2Points: null,
    status: 'PENDING',
    nextMatchId,
    loserNextMatchId,
    bracketSide,
    phase,
    player1FactionId: null,
    player2FactionId: null,
    player1GameWins: 0,
    player2GameWins: 0,
  };
}

describe('computeBracketLayout', () => {
  it('4-player bracket: R2.y == midpoint of R1 y-values', () => {
    const matches: BracketNode[] = [
      makeMatch('r1m1', 1, 1, 'r2m1'),
      makeMatch('r1m2', 1, 2, 'r2m1'),
      makeMatch('r2m1', 2, 1, null),
    ];

    const layout = computeBracketLayout(matches);

    const r1m1 = layout.positions.get('r1m1')!;
    const r1m2 = layout.positions.get('r1m2')!;
    const r2m1 = layout.positions.get('r2m1')!;

    expect(r1m1.y).toBe(0);
    expect(r1m2.y).toBe(MATCH_HEIGHT + ROW_GAP);

    const expectedY = (r1m1.y + r1m2.y) / 2;
    expect(r2m1.y).toBe(expectedY);
  });

  it('bye-vs-bye round match (no feeder) does not overlap a later feeder-positioned match', () => {
    // 11-player 16-bracket: 3 R1 matches + 4 R2 (r2m2 is bye-vs-bye, no R1 feeder).
    // Regression: r2m2 used to take the running fallbackY (104) and r2m3, positioned by
    // its feeder r1m2 (also at 104), landed on the exact same row → overlapping nodes.
    const matches: BracketNode[] = [
      makeMatch('r1m1', 1, 1, 'r2m1'),
      makeMatch('r1m2', 1, 2, 'r2m3'),
      makeMatch('r1m3', 1, 3, 'r2m4'),
      makeMatch('r2m1', 2, 1, 'r3m1'),
      makeMatch('r2m2', 2, 2, 'r3m1'), // no feeder
      makeMatch('r2m3', 2, 3, 'r3m2'),
      makeMatch('r2m4', 2, 4, 'r3m2'),
      makeMatch('r3m1', 3, 1, 'r4m1'),
      makeMatch('r3m2', 3, 2, 'r4m1'),
      makeMatch('r4m1', 4, 1, null),
    ];

    const layout = computeBracketLayout(matches);
    const r2ys = ['r2m1', 'r2m2', 'r2m3', 'r2m4']
      .map((id) => layout.positions.get(id)!.y)
      .sort((a, b) => a - b);
    for (let i = 1; i < r2ys.length; i++) {
      expect(r2ys[i]! - r2ys[i - 1]!).toBeGreaterThanOrEqual(MATCH_HEIGHT + ROW_GAP);
    }
  });

  it('8-player bracket: 7 matches, R3.y == midpoint of R2 feeders', () => {
    // R1: m1..m4, R2: m5(feeds m7), m6(feeds m7), R3: m7
    const matches: BracketNode[] = [
      makeMatch('r1m1', 1, 1, 'r2m1'),
      makeMatch('r1m2', 1, 2, 'r2m1'),
      makeMatch('r1m3', 1, 3, 'r2m2'),
      makeMatch('r1m4', 1, 4, 'r2m2'),
      makeMatch('r2m1', 2, 1, 'r3m1'),
      makeMatch('r2m2', 2, 2, 'r3m1'),
      makeMatch('r3m1', 3, 1, null),
    ];

    const layout = computeBracketLayout(matches);
    expect(layout.positions.size).toBe(7);

    const r2m1 = layout.positions.get('r2m1')!;
    const r2m2 = layout.positions.get('r2m2')!;
    const r3m1 = layout.positions.get('r3m1')!;

    expect(r3m1.y).toBe((r2m1.y + r2m2.y) / 2);
  });

  it('16-player bracket: 15 matches', () => {
    // R1: m1-m8, R2: m9-m12, R3: m13-m14, R4: m15
    const r1 = Array.from({ length: 8 }, (_, i) =>
      makeMatch(`r1m${i + 1}`, 1, i + 1, `r2m${Math.floor(i / 2) + 1}`),
    );
    const r2 = Array.from({ length: 4 }, (_, i) =>
      makeMatch(`r2m${i + 1}`, 2, i + 1, `r3m${Math.floor(i / 2) + 1}`),
    );
    const r3 = Array.from({ length: 2 }, (_, i) =>
      makeMatch(`r3m${i + 1}`, 3, i + 1, 'r4m1'),
    );
    const r4 = [makeMatch('r4m1', 4, 1, null)];

    const matches = [...r1, ...r2, ...r3, ...r4];
    expect(matches.length).toBe(15);

    const layout = computeBracketLayout(matches);
    expect(layout.positions.size).toBe(15);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  describe('Double-Elimination layout', () => {
    // Minimal DE fixture:
    //   WB: wb1 (round 1), wb2 (round 2) — wb1 → wb2 winner, wb1 loser → lb1
    //   LB: lb1 (round 3)
    //   GF: gf1 (round 4)
    const deMatches: BracketNode[] = [
      makeMatch('wb1', 1, 1, 'wb2', 'WINNERS', 'lb1'),
      makeMatch('wb2', 2, 1, 'gf1', 'WINNERS'),
      makeMatch('lb1', 3, 1, 'gf1', 'LOSERS'),
      makeMatch('gf1', 4, 1, null, 'GRAND_FINAL'),
    ];

    it('all match IDs are present in positions', () => {
      const layout = computeBracketLayout(deMatches);
      expect(layout.positions.size).toBe(4);
      expect(layout.positions.has('wb1')).toBe(true);
      expect(layout.positions.has('wb2')).toBe(true);
      expect(layout.positions.has('lb1')).toBe(true);
      expect(layout.positions.has('gf1')).toBe(true);
    });

    it('WB matches start at y=0 (top section)', () => {
      const layout = computeBracketLayout(deMatches);
      const wb1 = layout.positions.get('wb1')!;
      const wb2 = layout.positions.get('wb2')!;
      expect(wb1.y).toBe(0);
      expect(wb2.y).toBe(0); // single feeder → same y
    });

    it('LB matches are below WB matches (y > WB bottom)', () => {
      const layout = computeBracketLayout(deMatches);
      const wb2 = layout.positions.get('wb2')!;
      const lb1 = layout.positions.get('lb1')!;
      // LB y-base should be at least WB bottom + SECTION_GAP
      expect(lb1.y).toBeGreaterThan(wb2.y + MATCH_HEIGHT);
    });

    it('WB and LB start at x=0 (column normalisation)', () => {
      const layout = computeBracketLayout(deMatches);
      const wb1 = layout.positions.get('wb1')!;
      const lb1 = layout.positions.get('lb1')!;
      expect(wb1.x).toBe(0);
      expect(lb1.x).toBe(0);
    });

    it('GF is to the right of WB/LB sections', () => {
      const layout = computeBracketLayout(deMatches);
      const wb2 = layout.positions.get('wb2')!;
      const gf1 = layout.positions.get('gf1')!;
      // GF x >= WB second-column x + MATCH_WIDTH + ROUND_GAP
      expect(gf1.x).toBeGreaterThanOrEqual(wb2.x + MATCH_WIDTH + ROUND_GAP);
    });

    it('single PLAYOFF_FINAL (one division / normal format) uses the linear path, no groups', () => {
      const matches: BracketNode[] = [
        makeMatch('sf1', 1, 1, 'gf', null, null, 'PLAYOFF_SF'),
        makeMatch('sf2', 1, 2, 'gf', null, null, 'PLAYOFF_SF'),
        makeMatch('gf', 2, 1, null, null, null, 'PLAYOFF_FINAL'),
      ];
      const layout = computeBracketLayout(matches);
      expect(layout.groups).toBeUndefined();
    });

    it('bracketSide=null matches are unaffected (SE path)', () => {
      // Existing SE test should still pass — no bracketSide set
      const seMatches: BracketNode[] = [
        makeMatch('r1m1', 1, 1, 'r2m1'),
        makeMatch('r1m2', 1, 2, 'r2m1'),
        makeMatch('r2m1', 2, 1, null),
      ];
      const layout = computeBracketLayout(seMatches);
      const r1m1 = layout.positions.get('r1m1')!;
      const r1m2 = layout.positions.get('r1m2')!;
      const r2m1 = layout.positions.get('r2m1')!;
      expect(r1m1.y).toBe(0);
      expect(r1m2.y).toBe(MATCH_HEIGHT + ROW_GAP);
      expect(r2m1.y).toBe((r1m1.y + r1m2.y) / 2);
      // SE x-positions: col = round - 1, col 0 → x=0, col 1 → x=MATCH_WIDTH+ROUND_GAP
      expect(r1m1.x).toBe(0);
      expect(r2m1.x).toBe(MATCH_WIDTH + ROUND_GAP);
    });
  });

  describe('Balanced Liechtenstein division layout', () => {
    it('stacks two division finals into separate, vertically-offset labelled groups', () => {
      const matches: BracketNode[] = [
        makeMatch('finA', 3, 1, null, null, null, 'PLAYOFF_FINAL'),
        makeMatch('finB', 3, 2, null, null, null, 'PLAYOFF_FINAL'),
      ];
      const layout = computeBracketLayout(matches);
      expect(layout.groups).toHaveLength(2);
      const a = layout.positions.get('finA')!;
      const b = layout.positions.get('finB')!;
      // Same column, but stacked vertically (separate divisions).
      expect(a.x).toBe(b.x);
      expect(a.y).not.toBe(b.y);
    });

    it('keeps a TOP4 division and a TOP2 division as separate connected groups', () => {
      const matches: BracketNode[] = [
        // Division A — TOP4: two SFs feed a final; SF losers feed the third place.
        makeMatch('sf1', 3, 1, 'gfA', null, 'thirdA', 'PLAYOFF_SF'),
        makeMatch('sf2', 3, 2, 'gfA', null, 'thirdA', 'PLAYOFF_SF'),
        makeMatch('gfA', 4, 1, null, null, null, 'PLAYOFF_FINAL'),
        makeMatch('thirdA', 4, 2, null, null, null, 'PLAYOFF_THIRD_PLACE'),
        // Division B — TOP2: a lone final.
        makeMatch('gfB', 3, 3, null, null, null, 'PLAYOFF_FINAL'),
      ];
      const layout = computeBracketLayout(matches);
      expect(layout.groups).toHaveLength(2);
      const sizes = layout.groups!.map((g) => g.matchIds.length).sort((x, y) => x - y);
      expect(sizes).toEqual([1, 4]);
    });

    it('keeps a TOP2 division (final + orphan third place) as ONE group', () => {
      // TOP2: the final and the third-place are not linked by next_match_id, but
      // belong to the same division. Emitted consecutively (final #1, third #2).
      const matches: BracketNode[] = [
        makeMatch('finA', 3, 1, null, null, null, 'PLAYOFF_FINAL'),
        makeMatch('thirdA', 3, 2, null, null, null, 'PLAYOFF_THIRD_PLACE'),
        makeMatch('finB', 3, 3, null, null, null, 'PLAYOFF_FINAL'),
        makeMatch('thirdB', 3, 4, null, null, null, 'PLAYOFF_THIRD_PLACE'),
      ];
      const layout = computeBracketLayout(matches);
      // Two divisions, each = {final, third place} — not four singletons.
      expect(layout.groups).toHaveLength(2);
      expect(layout.groups!.every((g) => g.matchIds.length === 2)).toBe(true);
    });

    it('places division brackets to the right of the Swiss columns', () => {
      const matches: BracketNode[] = [
        makeMatch('s1', 1, 1, null, null, null, 'SWISS'),
        makeMatch('s2', 1, 2, null, null, null, 'SWISS'),
        makeMatch('finA', 2, 3, null, null, null, 'PLAYOFF_FINAL'),
        makeMatch('finB', 2, 4, null, null, null, 'PLAYOFF_FINAL'),
      ];
      const layout = computeBracketLayout(matches);
      const swissX = layout.positions.get('s1')!.x;
      const finX = layout.positions.get('finA')!.x;
      expect(finX).toBeGreaterThan(swissX);
    });
  });
});

describe('computePlaceholderLayout (projected playoffs)', () => {
  const div = (size: number, format: ProjectedDivision['format']): ProjectedDivision => ({
    size,
    format,
  });

  it('TOP8: builds QF→SF→Final and reports width from the placeholder extent', () => {
    const l = computePlaceholderLayout([div(8, 'TOP8')], false, 0);
    // 4 QF + 2 SF + 1 Final = 7 nodes
    expect(l.nodes).toHaveLength(7);
    const xs = [...l.positions.values()].map((p) => p.x);
    const cols = [...new Set(xs)].sort((a, b) => a - b);
    expect(cols).toHaveLength(3); // QF, SF, Final columns
    // width spans from xBase (0) to the right edge of the Final column
    expect(l.width).toBe(Math.max(...xs) + MATCH_WIDTH);
  });

  it('offsets every node to the right of xBase (the group-phase width)', () => {
    const xBase = 640;
    const l = computePlaceholderLayout([div(8, 'TOP8')], false, xBase);
    for (const p of l.positions.values()) expect(p.x).toBeGreaterThanOrEqual(xBase);
    // The full right edge the fit calc relies on = xBase + width
    const rightEdge = xBase + l.width;
    expect(rightEdge).toBe(Math.max(...[...l.positions.values()].map((p) => p.x)) + MATCH_WIDTH);
  });

  it('hasThirdPlace adds a 3rd-place node in the Final column, below the final', () => {
    const l = computePlaceholderLayout([div(8, 'TOP8')], true, 0);
    expect(l.nodes).toHaveLength(8);
    const final = l.nodes.find((n) => n.phase === 'Final')!;
    const third = l.nodes.find((n) => n.phase === '3rd Place')!;
    const fp = l.positions.get(final.id)!;
    const tp = l.positions.get(third.id)!;
    expect(tp.x).toBe(fp.x); // same column
    expect(tp.y).toBeGreaterThan(fp.y); // below
  });

  it('BaLi: multiple divisions stack vertically with per-division labels', () => {
    const l = computePlaceholderLayout([div(4, 'TOP4'), div(4, 'TOP4')], false, 0);
    expect(l.groups).toHaveLength(2);
    expect(l.groups[0]!.label).toBe('Division 1');
    expect(l.groups[1]!.label).toBe('Division 2');
    // Division 2 sits entirely below Division 1.
    expect(l.groups[1]!.y).toBeGreaterThan(l.groups[0]!.y);
    const d1Bottom = Math.max(
      ...l.groups[0]!.nodeIds.map((id) => l.positions.get(id)!.y),
    );
    const d2Top = Math.min(...l.groups[1]!.nodeIds.map((id) => l.positions.get(id)!.y));
    expect(d2Top).toBeGreaterThan(d1Bottom);
  });

  it('a single division has no label (null)', () => {
    const l = computePlaceholderLayout([div(2, 'TOP2')], false, 0);
    expect(l.groups).toHaveLength(1);
    expect(l.groups[0]!.label).toBeNull();
  });
});

describe('computeBracketRender — BaLi mixed real + projected divisions', () => {
  const finalNode = (id: string, p1: string, p2: string): BracketNode => ({
    ...makeMatch(id, 3, 1, null, null, null, 'PLAYOFF_FINAL'),
    player1Id: p1,
    player2Id: p2,
  });
  const swiss: BracketNode[] = [makeMatch('s1', 1, 1), makeMatch('s2', 1, 2)];
  const bandByUser = new Map<string, number>([['a', 5], ['b', 5]]);
  const plan = (): ProjectedDivision[] => [
    { size: 2, format: 'TOP2', band: 5 },
    { size: 4, format: 'TOP4', band: 3 },
  ];

  it('realDivisionBands returns the bands of generated divisions', () => {
    expect([...realDivisionBands([finalNode('f5', 'a', 'b')], bandByUser)]).toEqual([5]);
  });

  it('interleaves: generated band-5 bracket sits ABOVE the pending band-3 placeholder', () => {
    const r = computeBracketRender([...swiss, finalNode('f5', 'a', 'b')], {
      projectedDivisions: plan(),
      bandByUser,
      format: 'BALANCED_LIECHTENSTEIN',
    });
    expect(r.layout.positions.has('f5')).toBe(true);
    expect(r.placeholderLayout).not.toBeNull();
    const realY = r.layout.positions.get('f5')!.y;
    const phYs = [...r.placeholderLayout!.positions.values()].map((p) => p.y);
    expect(Math.min(...phYs)).toBeGreaterThan(realY); // band 5 above band 3
    expect(r.placeholderLayout!.nodes).toHaveLength(3); // TOP4: 2 SF + 1 final
    expect(r.placeholderLayout!.groups[0]!.band).toBe(3); // band-styled label
  });

  it('no pending division → no placeholders (all generated)', () => {
    const r = computeBracketRender([...swiss, finalNode('f5', 'a', 'b')], {
      projectedDivisions: [{ size: 2, format: 'TOP2', band: 5 }],
      bandByUser,
      format: 'BALANCED_LIECHTENSTEIN',
    });
    expect(r.placeholderLayout).toBeNull();
    expect(r.layout.positions.has('f5')).toBe(true);
  });

  it('COMPLETED tournament shows no placeholders', () => {
    const r = computeBracketRender(swiss, {
      projectedDivisions: plan(),
      bandByUser,
      format: 'BALANCED_LIECHTENSTEIN',
      isCompleted: true,
    });
    expect(r.placeholderLayout).toBeNull();
  });
});

describe('computeBracketRender — non-BaLi single bracket', () => {
  const swiss: BracketNode[] = [makeMatch('s1', 1, 1), makeMatch('s2', 1, 2)];

  it('shows the projected placeholder to the right until the real playoff exists', () => {
    const before = computeBracketRender(swiss, {
      projectedDivisions: [{ size: 8, format: 'TOP8' }],
      format: 'SWISS',
    });
    expect(before.placeholderLayout).not.toBeNull();
    const swissRight = Math.max(
      ...[...before.layout.positions.values()].map((p) => p.x + MATCH_WIDTH),
    );
    const phLeft = Math.min(...[...before.placeholderLayout!.positions.values()].map((p) => p.x));
    expect(phLeft).toBeGreaterThanOrEqual(swissRight);
  });

  it('hides the placeholder once a real playoff match exists', () => {
    const withPlayoff: BracketNode[] = [
      ...swiss,
      { ...makeMatch('pf', 2, 1, null, null, null, 'PLAYOFF_FINAL'), player1Id: 'a', player2Id: 'b' },
    ];
    const r = computeBracketRender(withPlayoff, {
      projectedDivisions: [{ size: 8, format: 'TOP8' }],
      format: 'SWISS',
    });
    expect(r.placeholderLayout).toBeNull();
  });
});
