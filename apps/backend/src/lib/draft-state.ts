/**
 * Pure Draft State-Machine — M4.1
 *
 * No I/O. No imports from prisma / redis / socket / fastify.
 * Only plain TypeScript + types from @rizzotto/types.
 *
 * All functions return new state objects (no mutation).
 */
import type {
  Actor,
  ApplyContext,
  CategoryLimit,
  DraftState,
  DraftTurn,
  DraftVariant,
} from '@rizzotto/types';

// ---------------------------------------------------------------------------
// Re-export ApplyContext so consumers can import from this module directly.
// ---------------------------------------------------------------------------
export type { ApplyContext, DraftState, DraftTurn };

// ---------------------------------------------------------------------------
// emptyState
// ---------------------------------------------------------------------------

export function emptyState(): DraftState {
  return {
    picks: { host: [], guest: [] },
    bans: [],
    exclusive_bans: { host: [], guest: [] },
    hidden_picks: { host: [], guest: [] },
    hidden_bans: { host: [], guest: [] },
    parallel_pending: { host: null, guest: null },
    hidden_pick_variants: { host: [], guest: [] },
    hidden_ban_variants: { host: [], guest: [] },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type Side = 'host' | 'guest';

function opponent(side: Side): Side {
  return side === 'host' ? 'guest' : 'host';
}

/**
 * Determine which side's arrays are the "acting" side.
 * When as_opponent is true, the actor acts ON BEHALF of their opponent
 * (e.g. host selects for guest).
 */
function actorSide(turn: DraftTurn): Side {
  if (turn.actor === 'admin') return 'host'; // admin always defaults to host unless as_opponent
  return turn.actor as Side;
}

function targetSide(turn: DraftTurn): Side {
  const acting = actorSide(turn);
  return turn.as_opponent ? opponent(acting) : acting;
}

/**
 * Shallow-clone DraftState so callers always get a fresh object.
 * Arrays inside each field are also cloned.
 */
function cloneState(s: DraftState): DraftState {
  return {
    picks: { host: [...s.picks.host], guest: [...s.picks.guest] },
    bans: [...s.bans],
    exclusive_bans: { host: [...s.exclusive_bans.host], guest: [...s.exclusive_bans.guest] },
    hidden_picks: { host: [...s.hidden_picks.host], guest: [...s.hidden_picks.guest] },
    hidden_bans: { host: [...s.hidden_bans.host], guest: [...s.hidden_bans.guest] },
    parallel_pending: { ...s.parallel_pending },
    hidden_pick_variants: {
      host: [...s.hidden_pick_variants.host],
      guest: [...s.hidden_pick_variants.guest],
    },
    hidden_ban_variants: {
      host: [...s.hidden_ban_variants.host],
      guest: [...s.hidden_ban_variants.guest],
    },
  };
}

/**
 * Count how many picks the given side has already made in a specific category.
 * For category 'default' this covers all picks (useful when max_picks check is
 * not per-category).
 */
function picksInCategory(state: DraftState, side: Side, cat: CategoryLimit): number {
  return state.picks[side].filter((f) => cat.factions.includes(f)).length;
}

function bansInCategory(state: DraftState, opponentSide: Side, cat: CategoryLimit): number {
  // exclusive_bans[opponentSide] contains factions banned FOR that side.
  return state.exclusive_bans[opponentSide].filter((f) => cat.factions.includes(f)).length
    + state.bans.filter((f) => cat.factions.includes(f)).length;
}

function getCategoryLimit(ctx: ApplyContext, categoryName: string): CategoryLimit | undefined {
  return ctx.categoryLimits.find((c) => c.category_name === categoryName);
}

// ---------------------------------------------------------------------------
// getAvailableFactions
// ---------------------------------------------------------------------------

/**
 * Returns which factions the given `perspective` side may choose on this turn.
 *
 * For as_opponent turns, the DraftService should pass `perspective = opponent(actorSide)`
 * so the available-list is computed from the target side's restrictions.
 */
export function getAvailableFactions(
  state: DraftState,
  turn: DraftTurn,
  ctx: ApplyContext,
  perspective: Side,
): string[] {
  const { allFactions, categoryLimits } = ctx;

  if (allFactions.length === 0) return [];

  // 1. Start with all factions (or category subset).
  let pool: string[];

  if (turn.category === 'default') {
    pool = [...allFactions];
  } else {
    const limit = getCategoryLimit(ctx, turn.category);
    if (!limit) {
      // Unknown category is a preset configuration error — return empty so
      // validateAction can catch it with a proper message.
      return [];
    }
    pool = allFactions.filter((f) => limit.factions.includes(f));
  }

  // 2. Remove globally banned factions.
  pool = pool.filter((f) => !state.bans.includes(f));

  // 3. Remove factions banned exclusively for `perspective`.
  pool = pool.filter((f) => !state.exclusive_bans[perspective].includes(f));

  // 4. Action-specific filtering.
  const action = turn.action;
  const variant = turn.variant;

  if (action === 'pick') {
    if (variant === 'exclusive') {
      // perspective cannot pick something they already own.
      pool = pool.filter((f) => !state.picks[perspective].includes(f));
    } else if (variant === 'global') {
      // No one can pick a faction already picked by either side.
      const allPicked = [...state.picks.host, ...state.picks.guest];
      pool = pool.filter((f) => !allPicked.includes(f));
    }
    // nonexclusive: no additional filtering — repeat picks allowed.

    // Check max_picks category limit for perspective.
    if (turn.category !== 'default') {
      const limit = getCategoryLimit(ctx, turn.category)!;
      if (limit.max_picks !== null) {
        const used = picksInCategory(state, perspective, limit);
        if (used >= limit.max_picks) return [];
      }
    }
  } else if (action === 'ban') {
    // Check max_bans category limit for the OPPONENT (exclusive_bans are pushed to opponent).
    const opp = opponent(perspective);
    if (turn.category !== 'default') {
      const limit = getCategoryLimit(ctx, turn.category)!;
      if (limit.max_bans !== null) {
        const usedBans = state.exclusive_bans[opp].filter((f) => limit.factions.includes(f)).length;
        if (usedBans >= limit.max_bans) return [];
      }
    }
  } else if (action === 'snipe' || action === 'steal') {
    // Can only target opponent's revealed picks.
    const opp = opponent(perspective);
    pool = [...state.picks[opp]];

    if (turn.category !== 'default') {
      const limit = getCategoryLimit(ctx, turn.category);
      if (!limit) return [];
      pool = pool.filter((f) => limit.factions.includes(f));
    }

    // For steal: check if perspective has already hit max_picks in category.
    if (action === 'steal' && turn.category !== 'default') {
      const limit = getCategoryLimit(ctx, turn.category)!;
      if (limit.max_picks !== null) {
        const used = picksInCategory(state, perspective, limit);
        if (used >= limit.max_picks) return [];
      }
    }
  }

  return pool;
}

// ---------------------------------------------------------------------------
// validateAction
// ---------------------------------------------------------------------------

export function validateAction(
  state: DraftState,
  turn: DraftTurn,
  factionId: string,
  actor: Actor,
  ctx: ApplyContext,
): { ok: true } | { ok: false; reason: string } {
  // Validate unknown category up front.
  if (turn.category !== 'default') {
    const limit = getCategoryLimit(ctx, turn.category);
    if (!limit) {
      return { ok: false, reason: `Unknown category "${turn.category}" in preset` };
    }
  }

  const action = turn.action;

  // Reveal actions do not take a factionId — skip further faction checks.
  if (action === 'reveal_picks' || action === 'reveal_bans' || action === 'reveal_all') {
    return { ok: true };
  }

  // Determine whose perspective to use for available-check.
  const actingSide = actor === 'admin' ? ('host' as Side) : (actor as Side);
  const perspective: Side = turn.as_opponent ? opponent(actingSide) : actingSide;

  const available = getAvailableFactions(state, turn, ctx, perspective);

  if (!available.includes(factionId)) {
    // Give specific reason when possible.
    if (state.bans.includes(factionId)) {
      return { ok: false, reason: `Faction "${factionId}" is globally banned` };
    }
    if (state.exclusive_bans[perspective].includes(factionId)) {
      return { ok: false, reason: `Faction "${factionId}" is exclusively banned for ${perspective}` };
    }
    if (action === 'snipe' || action === 'steal') {
      const opp = opponent(perspective);
      if (!state.picks[opp].includes(factionId)) {
        return {
          ok: false,
          reason: `Faction "${factionId}" is not in ${opp}'s picks — cannot ${action}`,
        };
      }
    }
    return { ok: false, reason: `Faction "${factionId}" is not available for this turn` };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// applyAction  (single, non-parallel turn)
// ---------------------------------------------------------------------------

export function applyAction(
  state: DraftState,
  turn: DraftTurn,
  factionId: string | null,
  actor: Actor,
): DraftState {
  const s = cloneState(state);
  const action = turn.action;

  // Reveal actions don't consume a factionId.
  if (action === 'reveal_picks') {
    return applyRevealPicks(s);
  }
  if (action === 'reveal_bans') {
    return applyRevealBans(s);
  }
  if (action === 'reveal_all') {
    return applyRevealBans(applyRevealPicks(s));
  }

  if (factionId === null) {
    // No-op for non-reveal turns without a faction — caller should guard.
    return s;
  }

  const actingSide: Side = actor === 'admin' ? 'host' : (actor as Side);
  const target: Side = turn.as_opponent ? opponent(actingSide) : actingSide;
  const opp: Side = opponent(target);
  const variant = turn.variant;

  if (action === 'pick') {
    if (turn.is_hidden) {
      // Defer the actual effect; store faction + variant for later reveal.
      s.hidden_picks[target].push(factionId);
      s.hidden_pick_variants[target].push(variant ?? 'global');
    } else {
      applyPickEffect(s, target, factionId, variant);
    }
  } else if (action === 'ban') {
    if (turn.is_hidden) {
      s.hidden_bans[target].push(factionId);
      s.hidden_ban_variants[target].push(variant ?? 'global');
    } else {
      applyBanEffect(s, target, factionId, variant);
    }
  } else if (action === 'snipe') {
    // Remove from opponent's revealed picks.
    s.picks[opp] = s.picks[opp].filter((f) => f !== factionId);
  } else if (action === 'steal') {
    // Remove from opponent's revealed picks and add to actor's.
    s.picks[opp] = s.picks[opp].filter((f) => f !== factionId);
    s.picks[target].push(factionId);
  }

  return s;
}

// ---------------------------------------------------------------------------
// Internal: apply pick / ban variant effects
// ---------------------------------------------------------------------------

function applyPickEffect(s: DraftState, owner: Side, f: string, variant: DraftVariant): void {
  s.picks[owner].push(f);
  if (variant === 'global') {
    // Globally consumed — nobody may pick it again.
    if (!s.bans.includes(f)) s.bans.push(f);
  } else if (variant === 'exclusive') {
    // Only the owner may not pick it again.
    if (!s.exclusive_bans[owner].includes(f)) s.exclusive_bans[owner].push(f);
  }
  // nonexclusive: no additional restriction.
}

function applyBanEffect(s: DraftState, banner: Side, f: string, variant: DraftVariant): void {
  const opp = opponent(banner);
  if (variant === 'global') {
    if (!s.bans.includes(f)) s.bans.push(f);
  } else {
    // exclusive OR nonexclusive → both result in exclusive_bans[opponent]
    // (nonexclusive is "visual only" for actor but still blocks opponent)
    if (!s.exclusive_bans[opp].includes(f)) s.exclusive_bans[opp].push(f);
  }
}

// ---------------------------------------------------------------------------
// Internal: reveal helpers
// ---------------------------------------------------------------------------

function applyRevealPicks(s: DraftState): DraftState {
  for (const side of ['host', 'guest'] as Side[]) {
    const factions = s.hidden_picks[side];
    const variants = s.hidden_pick_variants[side];
    for (let i = 0; i < factions.length; i++) {
      const f = factions[i]!;
      const v = variants[i] as DraftVariant ?? 'global';
      applyPickEffect(s, side, f, v);
    }
    s.hidden_picks[side] = [];
    s.hidden_pick_variants[side] = [];
  }
  return s;
}

function applyRevealBans(s: DraftState): DraftState {
  for (const side of ['host', 'guest'] as Side[]) {
    const factions = s.hidden_bans[side];
    const variants = s.hidden_ban_variants[side];
    for (let i = 0; i < factions.length; i++) {
      const f = factions[i]!;
      const v = variants[i] as DraftVariant ?? 'global';
      applyBanEffect(s, side, f, v);
    }
    s.hidden_bans[side] = [];
    s.hidden_ban_variants[side] = [];
  }
  return s;
}

// ---------------------------------------------------------------------------
// Parallel helpers
// ---------------------------------------------------------------------------

/**
 * Stores a parallel submission in parallel_pending without yet applying effects.
 */
export function submitParallel(
  state: DraftState,
  actor: Side,
  factionId: string,
): DraftState {
  const s = cloneState(state);
  s.parallel_pending[actor] = factionId;
  return s;
}

/**
 * Returns true when both sides have submitted their parallel choice.
 */
export function isParallelComplete(state: DraftState): boolean {
  return state.parallel_pending.host !== null && state.parallel_pending.guest !== null;
}

/**
 * Applies both pending parallel choices in deterministic order (host first, then guest).
 * Clears parallel_pending after applying.
 *
 * The `turn` argument describes the shared turn definition that both submissions used.
 * Each side's submission is applied as if they had taken the turn for their own side.
 */
export function commitParallel(state: DraftState, turn: DraftTurn): DraftState {
  let s = cloneState(state);

  const hostFaction = s.parallel_pending.host;
  const guestFaction = s.parallel_pending.guest;

  s.parallel_pending.host = null;
  s.parallel_pending.guest = null;

  // Build synthetic turns for each side (as_opponent already encoded in the actual turn).
  // For a standard parallel turn each side acts as themselves.
  const hostTurn: DraftTurn = { ...turn, as_opponent: false };
  const guestTurn: DraftTurn = { ...turn, as_opponent: false };

  if (hostFaction !== null) {
    s = applyAction(s, hostTurn, hostFaction, 'host');
  }
  if (guestFaction !== null) {
    s = applyAction(s, guestTurn, guestFaction, 'guest');
  }

  return s;
}

// ---------------------------------------------------------------------------
// isDraftComplete
// ---------------------------------------------------------------------------

/**
 * Returns true when the draft is done:
 *   1. currentTurn >= turns.length (no more scheduled turns), AND
 *   2. Each side has accumulated the expected number of revealed picks
 *      (snipes reduce the actual count, so a replacement turn would be
 *       injected by DraftService before this is called — but we still
 *       gate on expected vs actual to be safe).
 *
 * Expected picks per side = turns where actor === side AND action === 'pick'
 * AND as_opponent === false, PLUS turns where actor === opponent(side) AND
 * action === 'pick' AND as_opponent === true.
 */
export function isDraftComplete(
  state: DraftState,
  turns: DraftTurn[],
  currentTurn: number,
): boolean {
  if (currentTurn < turns.length) return false;

  // Count expected revealed picks for each side from the turn list.
  let expectedHost = 0;
  let expectedGuest = 0;

  for (const t of turns) {
    if (t.action !== 'pick') continue;
    const dest = targetSide(t);
    if (dest === 'host') expectedHost++;
    else expectedGuest++;
  }

  const actualHost = state.picks.host.length;
  const actualGuest = state.picks.guest.length;

  // If a snipe was performed, actual counts may be lower — not complete yet.
  return actualHost >= expectedHost && actualGuest >= expectedGuest;
}

// ---------------------------------------------------------------------------
// computeFinalFactions
// ---------------------------------------------------------------------------

/**
 * Returns the final faction selections for both sides based on the current
 * revealed picks in state.
 */
export function computeFinalFactions(state: DraftState): { host: string[]; guest: string[] } {
  return {
    host: [...state.picks.host],
    guest: [...state.picks.guest],
  };
}

// ---------------------------------------------------------------------------
// generateSnipeReplacementTurn
// ---------------------------------------------------------------------------

/**
 * Generates a replacement pick turn for the sniped actor.
 * Called by DraftService after a snipe reduces a player's pick count.
 */
export function generateSnipeReplacementTurn(
  snipedActor: Side,
  orderHint: number,
): DraftTurn {
  return {
    order: orderHint,
    actor: snipedActor,
    action: 'pick',
    variant: 'global',
    is_hidden: false,
    is_parallel: false,
    as_opponent: false,
    category: 'default',
  };
}
