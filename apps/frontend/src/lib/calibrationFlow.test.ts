import { describe, it, expect } from 'vitest';
import type { CalibrationQuestionDto } from './api.js';
import { calibrationFloor, nextCalibrationQuestion } from './calibrationFlow.js';

// A trimmed catalog mirroring the real floor structure: a strong lead question that
// can reach Top, a run of proxy questions that cap at Intermediate, the self-rating
// (the only other route to Top), and a floor-less UX question.
const QUESTIONS: CalibrationQuestionDto[] = [
  {
    id: 'best_result',
    prompt: 'Your best competitive tournament result?',
    options: [
      { value: 'none', label: 'Never made semifinals', floor: null },
      { value: 'semis', label: 'Semis/win at NPT/IPT', floor: 3 },
      { value: 'won_open', label: 'Won an open tournament', floor: 4 },
      { value: 'tt_top16', label: 'TT season Top 16', floor: 5 },
    ],
  },
  {
    id: 'total_battles',
    prompt: 'Total multiplayer battles?',
    options: [
      { value: 'lt50', label: 'Fewer than 50', floor: null },
      { value: '200_1000', label: '200-1000', floor: 3 },
    ],
  },
  {
    id: 'steam_hours',
    prompt: 'Total Steam hours?',
    options: [
      { value: 'lt500', label: 'Under 500', floor: null },
      { value: 'gt1500', label: '1500+', floor: 2 },
    ],
  },
  {
    id: 'self_rating',
    prompt: 'Where would you place yourself?',
    options: [
      { value: '1', label: 'New', floor: 1 },
      { value: '5', label: 'Top', floor: 5 },
    ],
  },
  {
    id: 'intent',
    prompt: 'What are you here for?',
    options: [{ value: 'learn', label: 'Learn', floor: null }],
  },
];

const NONE: Record<string, boolean> = {};

describe('calibrationFloor', () => {
  it('defaults to 1 with no answers', () => {
    expect(calibrationFloor(QUESTIONS, {})).toBe(1);
  });
  it('takes the MAX floor across answers, ignoring floor-less options', () => {
    expect(calibrationFloor(QUESTIONS, { best_result: 'won_open', steam_hours: 'gt1500' })).toBe(4);
    expect(calibrationFloor(QUESTIONS, { best_result: 'none', intent: 'learn' })).toBe(1);
  });
});

describe('nextCalibrationQuestion — adaptive skip', () => {
  it('starts with the first floor-raising question', () => {
    expect(nextCalibrationQuestion(QUESTIONS, {}, NONE)?.id).toBe('best_result');
  });

  it('ends immediately once the floor hits the maximum (Top)', () => {
    expect(nextCalibrationQuestion(QUESTIONS, { best_result: 'tt_top16' }, NONE)).toBeUndefined();
  });

  it('after floor 4, jumps straight to self-rating (the only route left to Top)', () => {
    expect(nextCalibrationQuestion(QUESTIONS, { best_result: 'won_open' }, NONE)?.id).toBe(
      'self_rating',
    );
  });

  it('after floor 3, still only the self-rating can raise it', () => {
    expect(nextCalibrationQuestion(QUESTIONS, { best_result: 'semis' }, NONE)?.id).toBe(
      'self_rating',
    );
  });

  it('keeps probing a low answer through the remaining questions', () => {
    // "none" leaves the floor at 1, so the next floor-raising question is asked.
    expect(nextCalibrationQuestion(QUESTIONS, { best_result: 'none' }, NONE)?.id).toBe(
      'total_battles',
    );
  });

  it('never returns the floor-less UX question, and finishes when nothing can raise the floor', () => {
    // Everything answered at its best still leaves only `intent` (no floor) → done.
    const answers = { best_result: 'won_open', self_rating: '5' };
    expect(nextCalibrationQuestion(QUESTIONS, answers, NONE)).toBeUndefined();
  });

  it('skips a dismissed question', () => {
    expect(
      nextCalibrationQuestion(QUESTIONS, { best_result: 'none' }, { total_battles: true })?.id,
    ).toBe('steam_hours');
  });
});
