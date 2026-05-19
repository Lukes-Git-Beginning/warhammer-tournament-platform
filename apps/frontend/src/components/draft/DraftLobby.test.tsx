import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DraftView, DraftTurn, PublicDraftState } from '@rizzotto/types';
import { DraftStatusBanner } from './DraftStatusBanner';
import { DraftTimer } from './DraftTimer';
import { FactionGrid } from './FactionGrid';
import type { FactionDto } from '@rizzotto/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyState(): PublicDraftState {
  return {
    picks: { host: [], guest: [] },
    bans: [],
    exclusive_bans: { host: [], guest: [] },
    hidden_picks: { host: [], guest: [] },
    hidden_bans: { host: [], guest: [] },
    hidden_pick_variants: { host: [], guest: [] },
    hidden_ban_variants: { host: [], guest: [] },
    parallel_pending: { host: null, guest: null },
  };
}

function makeTurn(actor: 'host' | 'guest', action: 'pick' | 'ban' = 'pick'): DraftTurn {
  return {
    order: 0,
    actor,
    action,
    variant: 'global',
    is_hidden: false,
    is_parallel: false,
    as_opponent: false,
    category: 'default',
  };
}

function makeDraftView(overrides?: Partial<DraftView>): DraftView {
  const preset = {
    id: 'preset-1',
    name: 'Test Preset',
    description: null,
    created_by: 'user-1',
    is_public: true,
    category_limits: [],
    turns: [makeTurn('host', 'pick'), makeTurn('guest', 'ban')],
    turn_seconds: 30,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return {
    id: 'draft-1',
    match_id: 'match-1',
    preset_id: 'preset-1',
    preset,
    status: 'ONGOING',
    current_turn: 0,
    state: emptyState(),
    timer_expires_at: null,
    host_user_id: 'user-1',
    guest_user_id: 'user-2',
    completed_at: null,
    final_host_factions: [],
    final_guest_factions: [],
    viewer_role: 'host',
    ...overrides,
  };
}

function makeFaction(id: string): FactionDto {
  return {
    id,
    name: `Faction ${id}`,
    race: 'TestRace',
    category: 'default',
    color_hex: '#c41e3a',
    display_order: 1,
    icon_url: null,
    initials: id.slice(0, 2).toUpperCase(),
  };
}

// ---------------------------------------------------------------------------
// DraftStatusBanner tests
// ---------------------------------------------------------------------------

describe('DraftStatusBanner', () => {
  it('zeigt "YOUR TURN: PICK" wenn isMyTurn true', () => {
    const draft = makeDraftView({ status: 'ONGOING', viewer_role: 'host' });
    const currentTurn = makeTurn('host', 'pick');
    const html = renderToStaticMarkup(
      <DraftStatusBanner draft={draft} currentTurn={currentTurn} isMyTurn={true} />,
    );
    expect(html).toContain('YOUR TURN');
    expect(html).toContain('PICK');
  });

  it('zeigt Gegner-am-Zug wenn isMyTurn false und Turn vorhanden', () => {
    const draft = makeDraftView({ status: 'ONGOING', viewer_role: 'guest' });
    const currentTurn = makeTurn('host', 'ban');
    const html = renderToStaticMarkup(
      <DraftStatusBanner draft={draft} currentTurn={currentTurn} isMyTurn={false} />,
    );
    expect(html).toContain("turn"); // "Host's turn:"
    expect(html).not.toContain('YOUR TURN');
  });

  it('zeigt "Draft complete" bei COMPLETED', () => {
    const draft = makeDraftView({ status: 'COMPLETED' });
    const html = renderToStaticMarkup(
      <DraftStatusBanner draft={draft} currentTurn={null} isMyTurn={false} />,
    );
    expect(html).toContain('Draft complete');
  });

  it('zeigt "Draft cancelled" bei CANCELLED', () => {
    const draft = makeDraftView({ status: 'CANCELLED' });
    const html = renderToStaticMarkup(
      <DraftStatusBanner draft={draft} currentTurn={null} isMyTurn={false} />,
    );
    expect(html).toContain('Draft cancelled');
  });
});

// ---------------------------------------------------------------------------
// DraftTimer tests
// ---------------------------------------------------------------------------

describe('DraftTimer', () => {
  it('rendert ohne Crash mit gültigem expiresAt', () => {
    const future = new Date(Date.now() + 30_000).toISOString();
    const html = renderToStaticMarkup(<DraftTimer expiresAt={future} />);
    expect(html).toContain('s');
  });

  it('zeigt 0s wenn expiresAt in der Vergangenheit liegt', () => {
    const past = new Date(Date.now() - 5_000).toISOString();
    const html = renderToStaticMarkup(<DraftTimer expiresAt={past} />);
    expect(html).toContain('0s');
  });
});

// ---------------------------------------------------------------------------
// FactionGrid tests
// ---------------------------------------------------------------------------

describe('FactionGrid', () => {
  it('rendert alle Faction-Tiles', () => {
    const factions = ['a1', 'b2', 'c3'].map(makeFaction);
    const html = renderToStaticMarkup(
      <FactionGrid
        allFactions={factions}
        state={emptyState()}
        currentTurn={null}
        viewerRole="spectator"
        onPick={() => undefined}
      />,
    );
    expect(html).toContain('Faction a1');
    expect(html).toContain('Faction b2');
    expect(html).toContain('Faction c3');
  });

  it('Buttons sind disabled wenn kein aktiver Turn', () => {
    const factions = [makeFaction('x1')];
    const html = renderToStaticMarkup(
      <FactionGrid
        allFactions={factions}
        state={emptyState()}
        currentTurn={null}
        viewerRole="host"
        onPick={() => undefined}
      />,
    );
    // disabled attribute should be present
    expect(html).toContain('disabled');
  });

  it('rendert <img>-Sigil wenn Faction icon_url hat', () => {
    const factions = [{ ...makeFaction('zz'), icon_url: '/icons/factions/skaven.png' }];
    const html = renderToStaticMarkup(
      <FactionGrid
        allFactions={factions}
        state={emptyState()}
        currentTurn={null}
        viewerRole="spectator"
        onPick={() => undefined}
      />,
    );
    expect(html).toContain('src="/icons/factions/skaven.png"');
  });

  it('picked-host Faction erhält "Host" Badge', () => {
    const factions = [makeFaction('emp')];
    const state = emptyState();
    state.picks.host.push('emp');
    const html = renderToStaticMarkup(
      <FactionGrid
        allFactions={factions}
        state={state}
        currentTurn={null}
        viewerRole="host"
        onPick={() => undefined}
      />,
    );
    expect(html).toContain('Host');
  });
});
