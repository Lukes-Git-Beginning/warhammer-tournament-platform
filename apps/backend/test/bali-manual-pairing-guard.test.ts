import { describe, it, expect } from 'vitest';
import { blockBalancedManualPairing } from '../src/lib/tournament-utils.js';

describe('blockBalancedManualPairing', () => {
  it('never blocks non-Balanced-Liechtenstein formats', () => {
    for (const fmt of ['SWISS', 'SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'ROUND_ROBIN', 'LIECHTENSTEIN', null, undefined]) {
      expect(blockBalancedManualPairing(fmt, 'HOST', false)).toBeNull();
      expect(blockBalancedManualPairing(fmt, 'ADMIN', false)).toBeNull();
    }
  });

  it('blocks HOST and MODERATOR outright in BaLi (403)', () => {
    for (const role of ['HOST', 'MODERATOR', 'PLAYER', '']) {
      const block = blockBalancedManualPairing('BALANCED_LIECHTENSTEIN', role, true);
      expect(block?.status).toBe(403);
      expect(block?.body.error).toBe('Forbidden');
    }
  });

  it('requires an explicit confirm for ADMIN in BaLi (409 without, allowed with)', () => {
    const noConfirm = blockBalancedManualPairing('BALANCED_LIECHTENSTEIN', 'ADMIN', false);
    expect(noConfirm?.status).toBe(409);
    expect(noConfirm?.body.error).toBe('ConfirmationRequired');

    expect(blockBalancedManualPairing('BALANCED_LIECHTENSTEIN', 'ADMIN', true)).toBeNull();
  });
});
