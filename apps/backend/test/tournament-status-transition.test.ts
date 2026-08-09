/**
 * Tournament status transitions: forward flow plus the one permitted backwards step —
 * REGISTRATION_CLOSED → OPEN_REGISTRATION ("reopen registration", to undo an accidental close).
 */
import { describe, it, expect } from 'vitest';
import { TournamentStatus } from '@rizzotto/db';
import { validateStatusTransition } from '../src/lib/tournament-utils.js';

describe('validateStatusTransition', () => {
  it('allows the normal forward flow', () => {
    expect(validateStatusTransition(TournamentStatus.DRAFT, TournamentStatus.OPEN_REGISTRATION)).toBe(true);
    expect(validateStatusTransition(TournamentStatus.OPEN_REGISTRATION, TournamentStatus.REGISTRATION_CLOSED)).toBe(true);
    expect(validateStatusTransition(TournamentStatus.REGISTRATION_CLOSED, TournamentStatus.ONGOING)).toBe(true);
    expect(validateStatusTransition(TournamentStatus.ONGOING, TournamentStatus.COMPLETED)).toBe(true);
  });

  it('allows reopening registration (the only permitted backwards step)', () => {
    expect(validateStatusTransition(TournamentStatus.REGISTRATION_CLOSED, TournamentStatus.OPEN_REGISTRATION)).toBe(true);
  });

  it('still blocks every other backwards / illegal transition', () => {
    expect(validateStatusTransition(TournamentStatus.ONGOING, TournamentStatus.REGISTRATION_CLOSED)).toBe(false);
    expect(validateStatusTransition(TournamentStatus.OPEN_REGISTRATION, TournamentStatus.DRAFT)).toBe(false);
    expect(validateStatusTransition(TournamentStatus.COMPLETED, TournamentStatus.ONGOING)).toBe(false);
    expect(validateStatusTransition(TournamentStatus.REGISTRATION_CLOSED, TournamentStatus.COMPLETED)).toBe(false);
  });
});
