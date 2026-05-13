import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { act } from 'react';
import type { BracketNode } from '@tww3/types';
import { MatchNode, statusColors } from './MatchNode';

function makeMatch(overrides: Partial<BracketNode> = {}): BracketNode {
  return {
    matchId: 'test-match-1',
    round: 1,
    matchNumber: 1,
    player1Id: 'p1',
    player2Id: 'p2',
    winnerId: null,
    score: null,
    status: 'PENDING',
    nextMatchId: null,
    player1FactionId: null,
    player2FactionId: null,
    ...overrides,
  };
}

// --- statusColors unit tests (no DOM needed) ---

describe('statusColors map', () => {
  it('contains correct class string for ONGOING', () => {
    expect(statusColors['ONGOING']).toContain('border-green-600');
    expect(statusColors['ONGOING']).toContain('bg-green-900/40');
  });

  it('contains opacity-60 for BYE', () => {
    expect(statusColors['BYE']).toContain('opacity-60');
  });

  it('contains amber classes for FORFEIT', () => {
    expect(statusColors['FORFEIT']).toContain('border-amber-700');
    expect(statusColors['FORFEIT']).toContain('bg-amber-950/40');
  });

  it('contains stone-600 border for COMPLETED', () => {
    expect(statusColors['COMPLETED']).toContain('border-stone-600');
  });

  it('returns a fallback for unknown status', () => {
    const cls = statusColors['UNKNOWN_STATUS'] ?? 'border-stone-700 bg-stone-900/40';
    expect(cls).toContain('border-stone-700');
  });
});

// --- DOM rendering tests ---

describe('MatchNode DOM rendering', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.width = '200px';
    container.style.height = '80px';
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it('renders with border-green-600 class when status is ONGOING', () => {
    const match = makeMatch({ status: 'ONGOING' });
    act(() => {
      root.render(createElement(MatchNode, { match }));
    });
    const wrapper = container.querySelector('div');
    expect(wrapper?.className).toContain('border-green-600');
  });

  it('renders with opacity-60 class when status is BYE', () => {
    const match = makeMatch({ status: 'BYE', player1Id: null, player2Id: null });
    act(() => {
      root.render(createElement(MatchNode, { match }));
    });
    const wrapper = container.querySelector('div');
    expect(wrapper?.className).toContain('opacity-60');
  });

  it('renders with amber border when status is FORFEIT', () => {
    const match = makeMatch({ status: 'FORFEIT' });
    act(() => {
      root.render(createElement(MatchNode, { match }));
    });
    const wrapper = container.querySelector('div');
    expect(wrapper?.className).toContain('border-amber-700');
  });

  it('renders ONGOING pulse indicator', () => {
    const match = makeMatch({ status: 'ONGOING' });
    act(() => {
      root.render(createElement(MatchNode, { match }));
    });
    // The pulse dot has animate-pulse class
    const pulse = container.querySelector('.animate-pulse');
    expect(pulse).not.toBeNull();
  });

  it('does not render pulse indicator for PENDING status', () => {
    const match = makeMatch({ status: 'PENDING' });
    act(() => {
      root.render(createElement(MatchNode, { match }));
    });
    const pulse = container.querySelector('.animate-pulse');
    expect(pulse).toBeNull();
  });
});
