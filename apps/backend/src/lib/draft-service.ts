/**
 * DraftService — I/O layer over the pure Draft State-Machine.
 *
 * Responsibilities:
 *  - Redis-backed hot state (hash per draft)
 *  - DB persistence via Prisma (Draft row + DraftEvent log)
 *  - Timer management (setTimeout per active draft)
 *  - Socket emit via draft-emit helpers
 *  - Concurrency guard via Redis SETNX lock
 */
import { type PrismaClient, Prisma } from '@tww3/db';
import type { Redis } from 'ioredis';
import type { AppIOServer } from '../plugins/socket.js';
import type { DraftState, DraftTurn, ApplyContext, DraftView } from '@tww3/types';
import { DraftTurnSchema, CategoryLimitSchema } from '@tww3/types';
import * as DraftSM from './draft-state.js';
import * as DraftEmit from './draft-emit.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class BusyError extends Error {
  constructor(draftId: string) {
    super(`Draft ${draftId} is locked — concurrent action in progress`);
    this.name = 'BusyError';
  }
}

export class DraftNotFoundError extends Error {
  constructor(draftId: string) {
    super(`Draft ${draftId} not found`);
    this.name = 'DraftNotFoundError';
  }
}

export class InvalidActionError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InvalidActionError';
  }
}

// ---------------------------------------------------------------------------
// Internal snapshot shape (all fields loaded from Redis/DB)
// ---------------------------------------------------------------------------

interface DraftSnapshot {
  draftId: string;
  matchId: string;
  status: 'PENDING' | 'ONGOING' | 'COMPLETED' | 'CANCELLED';
  currentTurn: number;
  state: DraftState;
  timerExpires: Date | null;
  presetId: string;
  hostUserId: string;
  guestUserId: string;
  turnSeconds: number;
  extraTurns: DraftTurn[]; // snipe-generated replacement turns
  // Preset data (loaded once)
  presetTurns: DraftTurn[];
  categoryLimits: ApplyContext['categoryLimits'];
}

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export interface StartDraftParams {
  matchId: string;
  presetId: string;
  hostUserId: string;
  guestUserId: string;
  allFactionIds: string[];
}

// ---------------------------------------------------------------------------
// Redis key helpers
// ---------------------------------------------------------------------------

const REDIS_STATE_KEY = (id: string) => `draft:${id}:state`;
const REDIS_LOCK_KEY = (id: string) => `draft:${id}:lock`;
const REDIS_ACTIVE_KEY = 'draft:active';

// ---------------------------------------------------------------------------
// DraftService
// ---------------------------------------------------------------------------

export class DraftService {
  /** In-memory timer handles, keyed by draftId */
  private timers = new Map<string, NodeJS.Timeout>();

  /** Lazy-loaded faction ID cache */
  private cachedFactionIds: string[] | null = null;

  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
    private io: AppIOServer | undefined,
    private clock: () => Date = () => new Date(),
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async startDraft(p: StartDraftParams): Promise<{ draftId: string }> {
    const { matchId, presetId, hostUserId, guestUserId, allFactionIds } = p;

    // Cache faction IDs
    if (!this.cachedFactionIds) {
      this.cachedFactionIds = allFactionIds.length > 0
        ? allFactionIds
        : await this.loadAllFactionIds();
    }

    // Load preset
    const preset = await this.prisma.draftPreset.findUnique({ where: { id: presetId } });
    if (!preset) throw new InvalidActionError(`Preset ${presetId} not found`);

    // Validate match exists and has no existing draft
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: { draft: true },
    });
    if (!match) throw new InvalidActionError(`Match ${matchId} not found`);
    if (match.draft) throw new InvalidActionError(`Match ${matchId} already has a draft`);

    const presetTurns = z.array(DraftTurnSchema).parse(preset.turns);
    const categoryLimits = z.array(CategoryLimitSchema).parse(preset.category_limits);
    const turnSeconds = preset.turn_seconds;

    const initialState = DraftSM.emptyState();
    const now = this.clock();
    const timerExpires = new Date(now.getTime() + turnSeconds * 1000);

    // Prisma transaction: create Draft + initial DraftEvent
    const draft = await this.prisma.$transaction(async (tx) => {
      const created = await tx.draft.create({
        data: {
          match_id: matchId,
          preset_id: presetId,
          status: 'ONGOING',
          current_turn: 0,
          state: initialState as object,
          timer_expires_at: timerExpires,
          host_user_id: hostUserId,
          guest_user_id: guestUserId,
        },
      });

      await tx.draftEvent.create({
        data: {
          draft_id: created.id,
          turn_index: 0,
          actor: 'system',
          action: 'start',
          faction_id: null,
          is_auto_selected: false,
          payload: { presetName: preset.name },
        },
      });

      return created;
    });

    const draftId = draft.id;

    // Write Redis hash
    const snapshot: DraftSnapshot = {
      draftId,
      matchId,
      status: 'ONGOING',
      currentTurn: 0,
      state: initialState,
      timerExpires,
      presetId,
      hostUserId,
      guestUserId,
      turnSeconds,
      extraTurns: [],
      presetTurns,
      categoryLimits,
    };
    await this.writeRedisState(draftId, snapshot);

    // Add to active set
    await this.redis.sadd(REDIS_ACTIVE_KEY, draftId);

    // Emit draft_started
    const startPayload = {
      draftId,
      matchId,
      presetId,
      turnSeconds,
      hostUserId,
      guestUserId,
    };
    DraftEmit.emitDraftStarted(this.io, draftId, hostUserId, guestUserId, startPayload);

    // Schedule first turn timer
    this.scheduleTimer(draftId, timerExpires);

    // Emit turn_started for the first turn
    await this.emitTurnStarted(snapshot, 0, timerExpires);

    return { draftId };
  }

  async handleAction(draftId: string, userId: string, factionId: string): Promise<void> {
    // Acquire lock
    const lockKey = REDIS_LOCK_KEY(draftId);
    const lockAcquired = await this.redis.set(lockKey, '1', 'PX', 5000, 'NX');
    if (lockAcquired === null) {
      throw new BusyError(draftId);
    }

    try {
      const snapshot = await this.loadDraftSnapshot(draftId);
      if (!snapshot) throw new DraftNotFoundError(draftId);
      if (snapshot.status !== 'ONGOING') {
        throw new InvalidActionError(`Draft ${draftId} is not ongoing (status: ${snapshot.status})`);
      }

      const actor = this.resolveActor(snapshot, userId);
      if (!actor) {
        throw new InvalidActionError(`User ${userId} is not a player in this draft`);
      }

      const allFactions = await this.getAllFactionIds();
      const ctx: ApplyContext = {
        allFactions,
        categoryLimits: snapshot.categoryLimits,
      };

      const turn = this.currentTurn(snapshot);
      if (!turn) {
        throw new InvalidActionError('No current turn available');
      }

      // Idempotency: check turn hasn't already advanced beyond what we expect
      // (lock prevents double-submit, but just in case)
      const expectedTurnIndex = snapshot.currentTurn;

      if (turn.is_parallel) {
        await this.handleParallelAction(snapshot, turn, actor, factionId, ctx, expectedTurnIndex);
      } else {
        await this.handleSingleAction(snapshot, turn, actor, factionId, ctx, expectedTurnIndex);
      }
    } finally {
      await this.redis.del(lockKey);
    }
  }

  async forceAutoSelect(draftId: string): Promise<void> {
    // Acquire lock
    const lockKey = REDIS_LOCK_KEY(draftId);
    const lockAcquired = await this.redis.set(lockKey, '1', 'PX', 5000, 'NX');
    if (lockAcquired === null) {
      // Another action is in progress — skip auto-select, it will handle the turn
      return;
    }

    try {
      const snapshot = await this.loadDraftSnapshot(draftId);
      if (!snapshot) return;
      if (snapshot.status !== 'ONGOING') return;

      const turn = this.currentTurn(snapshot);
      if (!turn) return;

      const allFactions = await this.getAllFactionIds();
      const ctx: ApplyContext = {
        allFactions,
        categoryLimits: snapshot.categoryLimits,
      };

      const action = turn.action;

      // Reveal turns don't need a faction — apply directly
      if (action === 'reveal_picks' || action === 'reveal_bans' || action === 'reveal_all') {
        const newState = DraftSM.applyAction(snapshot.state, turn, null, turn.actor);
        await this.commitAndAdvance(snapshot, turn, newState, null, turn.actor, true);
        return;
      }

      // For parallel turns: auto-select for each side that hasn't submitted
      if (turn.is_parallel) {
        let state = snapshot.state;
        let anyAuto = false;

        for (const side of ['host', 'guest'] as const) {
          if (state.parallel_pending[side] === null) {
            const available = DraftSM.getAvailableFactions(state, turn, ctx, side);
            if (available.length === 0) continue;
            const chosen = available[Math.floor(Math.random() * available.length)]!;
            state = DraftSM.submitParallel(state, side, chosen);
            anyAuto = true;
          }
        }

        if (!anyAuto) return;

        if (DraftSM.isParallelComplete(state)) {
          const committed = DraftSM.commitParallel(state, turn);
          await this.commitAndAdvance(snapshot, turn, committed, null, 'system', true);
        } else {
          // Still waiting for one side — update state but don't advance
          const updated: DraftSnapshot = { ...snapshot, state };
          await this.writeRedisState(draftId, updated);
        }
        return;
      }

      // Determine acting perspective
      const actorSide: 'host' | 'guest' = turn.actor === 'admin' ? 'host' : turn.actor;
      const perspective: 'host' | 'guest' = turn.as_opponent
        ? (actorSide === 'host' ? 'guest' : 'host')
        : actorSide;

      const available = DraftSM.getAvailableFactions(snapshot.state, turn, ctx, perspective);
      if (available.length === 0) {
        // No factions available — skip turn by applying null
        const newState = DraftSM.applyAction(snapshot.state, turn, null, turn.actor);
        await this.commitAndAdvance(snapshot, turn, newState, null, turn.actor, true);
        return;
      }

      const chosen = available[Math.floor(Math.random() * available.length)]!;
      const validation = DraftSM.validateAction(snapshot.state, turn, chosen, turn.actor, ctx);
      if (!validation.ok) {
        // Fallback: just pick first available
        const fallback = available[0]!;
        const newState = DraftSM.applyAction(snapshot.state, turn, fallback, turn.actor);
        await this.commitAndAdvance(snapshot, turn, newState, fallback, turn.actor, true);
        return;
      }

      const newState = DraftSM.applyAction(snapshot.state, turn, chosen, turn.actor);
      await this.commitAndAdvance(snapshot, turn, newState, chosen, turn.actor, true);
    } finally {
      await this.redis.del(lockKey);
    }
  }

  async getDraftView(draftId: string, viewerUserId: string | null): Promise<DraftView> {
    const snapshot = await this.loadDraftSnapshot(draftId);
    if (!snapshot) throw new DraftNotFoundError(draftId);

    let viewerRole: 'host' | 'guest' | 'spectator' | 'admin' = 'spectator';
    if (viewerUserId !== null && viewerUserId === snapshot.hostUserId) viewerRole = 'host';
    else if (viewerUserId !== null && viewerUserId === snapshot.guestUserId) viewerRole = 'guest';

    const maskRole: 'host' | 'guest' | 'spectator' =
      viewerRole === 'host' || viewerRole === 'guest' ? viewerRole : 'spectator';

    const maskedState = DraftEmit.maskStateForViewer(snapshot.state, maskRole);

    // Load preset data
    const preset = await this.prisma.draftPreset.findUnique({
      where: { id: snapshot.presetId },
    });
    if (!preset) throw new DraftNotFoundError(`Preset ${snapshot.presetId} not found`);

    return {
      id: draftId,
      match_id: snapshot.matchId,
      preset_id: snapshot.presetId,
      preset: {
        id: preset.id,
        name: preset.name,
        description: preset.description ?? null,
        created_by: preset.created_by,
        is_public: preset.is_public,
        category_limits: snapshot.categoryLimits,
        turns: snapshot.presetTurns,
        turn_seconds: preset.turn_seconds,
        created_at: preset.created_at.toISOString(),
        updated_at: preset.updated_at.toISOString(),
      },
      status: snapshot.status,
      current_turn: snapshot.currentTurn,
      state: maskedState,
      timer_expires_at: snapshot.timerExpires?.toISOString() ?? null,
      host_user_id: snapshot.hostUserId,
      guest_user_id: snapshot.guestUserId,
      completed_at: null, // loaded from DB if needed
      final_host_factions: [],
      final_guest_factions: [],
      viewer_role: viewerRole,
    };
  }

  async cancelDraft(draftId: string, actorUserId: string): Promise<void> {
    const snapshot = await this.loadDraftSnapshot(draftId);
    if (!snapshot) throw new DraftNotFoundError(draftId);
    if (snapshot.status === 'COMPLETED' || snapshot.status === 'CANCELLED') return;

    this.clearTimer(draftId);

    await this.prisma.$transaction(async (tx) => {
      await tx.draft.update({
        where: { id: draftId },
        data: { status: 'CANCELLED', updated_at: this.clock() },
      });
      await tx.draftEvent.create({
        data: {
          draft_id: draftId,
          turn_index: snapshot.currentTurn,
          actor: 'system',
          action: 'cancel',
          faction_id: null,
          is_auto_selected: false,
          payload: { cancelledBy: actorUserId },
        },
      });
    });

    // Update Redis
    await this.redis.hset(REDIS_STATE_KEY(draftId), 'status', 'CANCELLED');
    await this.redis.expire(REDIS_STATE_KEY(draftId), 86400);
    await this.redis.srem(REDIS_ACTIVE_KEY, draftId);
  }

  async initActiveDrafts(): Promise<number> {
    const activeDrafts = await this.prisma.draft.findMany({
      where: { status: 'ONGOING' },
      include: {
        preset: true,
      },
    });

    let count = 0;

    for (const draft of activeDrafts) {
      try {
        const presetTurns = z.array(DraftTurnSchema).parse(draft.preset.turns);
        const categoryLimits = z.array(CategoryLimitSchema).parse(draft.preset.category_limits);

        // Check if Redis already has this draft
        const existing = await this.redis.hgetall(REDIS_STATE_KEY(draft.id));

        let snapshot: DraftSnapshot;

        if (existing && existing.status) {
          // Redis has data — use it as SoT
          snapshot = this.parseRedisSnapshot(draft.id, existing, presetTurns, categoryLimits);
          // Ensure draft:active is maintained even if only the Set was lost
          await this.redis.sadd(REDIS_ACTIVE_KEY, draft.id);
        } else {
          // Rehydrate from DB
          const dbState = draft.state as unknown as DraftState;
          const extraTurns = (draft as any).extra_turns
            ? z.array(DraftTurnSchema).parse((draft as any).extra_turns)
            : [];

          snapshot = {
            draftId: draft.id,
            matchId: draft.match_id,
            status: 'ONGOING',
            currentTurn: draft.current_turn,
            state: dbState,
            timerExpires: draft.timer_expires_at,
            presetId: draft.preset_id,
            hostUserId: draft.host_user_id ?? '',
            guestUserId: draft.guest_user_id ?? '',
            turnSeconds: draft.preset.turn_seconds,
            extraTurns,
            presetTurns,
            categoryLimits,
          };

          await this.writeRedisState(draft.id, snapshot);
          await this.redis.sadd(REDIS_ACTIVE_KEY, draft.id);
        }

        // Schedule timer or trigger immediate auto-select
        const now = this.clock();
        if (snapshot.timerExpires && snapshot.timerExpires <= now) {
          // Expired — trigger immediately
          void this.forceAutoSelect(draft.id).catch((err) => {
            console.error(`[DraftService] initActiveDrafts forceAutoSelect error for ${draft.id}:`, err);
          });
        } else if (snapshot.timerExpires) {
          this.scheduleTimer(draft.id, snapshot.timerExpires);
        }

        count++;
      } catch (err) {
        console.error(`[DraftService] Failed to rehydrate draft ${draft.id}:`, err);
      }
    }

    return count;
  }

  /** Clear all in-memory timers (called on plugin shutdown). */
  shutdown(): void {
    for (const [draftId, handle] of this.timers) {
      clearTimeout(handle);
      this.timers.delete(draftId);
    }
  }

  // ---------------------------------------------------------------------------
  // Private: action helpers
  // ---------------------------------------------------------------------------

  private async handleSingleAction(
    snapshot: DraftSnapshot,
    turn: DraftTurn,
    actor: 'host' | 'guest',
    factionId: string,
    ctx: ApplyContext,
    expectedTurnIndex: number,
  ): Promise<void> {
    const action = turn.action;

    // Reveal turns don't need validation
    if (action === 'reveal_picks' || action === 'reveal_bans' || action === 'reveal_all') {
      // Only admin turns or system triggers for reveals
      const newState = DraftSM.applyAction(snapshot.state, turn, null, turn.actor);
      await this.commitAndAdvance(snapshot, turn, newState, null, actor, false);
      return;
    }

    // Validate
    const validation = DraftSM.validateAction(snapshot.state, turn, factionId, actor, ctx);
    if (!validation.ok) {
      throw new InvalidActionError(validation.reason);
    }

    const newState = DraftSM.applyAction(snapshot.state, turn, factionId, actor);
    await this.commitAndAdvance(snapshot, turn, newState, factionId, actor, false);
  }

  private async handleParallelAction(
    snapshot: DraftSnapshot,
    turn: DraftTurn,
    actor: 'host' | 'guest',
    factionId: string,
    ctx: ApplyContext,
    expectedTurnIndex: number,
  ): Promise<void> {
    // Validate
    const perspective: 'host' | 'guest' = turn.as_opponent
      ? (actor === 'host' ? 'guest' : 'host')
      : actor;
    const available = DraftSM.getAvailableFactions(snapshot.state, turn, ctx, perspective);
    if (!available.includes(factionId)) {
      throw new InvalidActionError(`Faction ${factionId} is not available for parallel turn`);
    }

    // Store submission
    const newState = DraftSM.submitParallel(snapshot.state, actor, factionId);

    if (DraftSM.isParallelComplete(newState)) {
      // Both submitted — commit
      const committed = DraftSM.commitParallel(newState, turn);
      await this.commitAndAdvance(snapshot, turn, committed, factionId, actor, false);
    } else {
      // Only one side submitted — save intermediate state
      const updated: DraftSnapshot = { ...snapshot, state: newState };
      await this.writeRedisState(snapshot.draftId, updated);

      // Also persist partial state to DB
      await this.prisma.draft.update({
        where: { id: snapshot.draftId },
        data: {
          state: newState as object,
          updated_at: this.clock(),
        },
      });

      // Emit partial action_committed (hidden from spectators by convention)
      DraftEmit.emitActionCommitted(
        this.io,
        snapshot.draftId,
        snapshot.hostUserId,
        snapshot.guestUserId,
        {
          draftId: snapshot.draftId,
          turnIndex: snapshot.currentTurn,
          actor,
          action: turn.action,
          isAutoSelected: false,
          isHiddenFromYou: false,
        },
        factionId,
        true, // treat parallel pending as hidden
        actor,
      );
    }
  }

  private async commitAndAdvance(
    snapshot: DraftSnapshot,
    turn: DraftTurn,
    newState: DraftState,
    factionId: string | null,
    actor: 'host' | 'guest' | 'admin' | 'system',
    isAutoSelected: boolean,
  ): Promise<void> {
    const draftId = snapshot.draftId;
    const nextTurnIndex = snapshot.currentTurn + 1;

    // Check for snipe/steal — may need replacement turn
    let extraTurns = [...snapshot.extraTurns];
    if (turn.action === 'snipe' || turn.action === 'steal') {
      const snipedActor: 'host' | 'guest' = turn.action === 'steal'
        ? (turn.actor === 'host' ? 'guest' : 'host')
        : (turn.actor === 'host' ? 'guest' : 'host');

      // Count expected picks for sniped actor from preset turns
      const allTurns = [...snapshot.presetTurns, ...extraTurns];
      const expectedPicks = allTurns.filter((t) => {
        const target = t.as_opponent
          ? (t.actor === 'host' ? 'guest' : 'host')
          : t.actor;
        return t.action === 'pick' && target === snipedActor;
      }).length;

      const actualPicks = newState.picks[snipedActor].length;

      if (actualPicks < expectedPicks) {
        // Need replacement turn
        const replacement = DraftSM.generateSnipeReplacementTurn(
          snipedActor,
          allTurns.length,
        );
        extraTurns = [...extraTurns, replacement];
      }
    }

    // Persist via Prisma transaction
    const now = this.clock();
    const allTurnsForComplete = [...snapshot.presetTurns, ...extraTurns];
    const isDone = DraftSM.isDraftComplete(newState, allTurnsForComplete, nextTurnIndex);

    const timerExpires = isDone
      ? null
      : new Date(now.getTime() + snapshot.turnSeconds * 1000);

    await this.prisma.$transaction(async (tx) => {
      await tx.draft.update({
        where: { id: draftId },
        data: {
          state: newState as object,
          current_turn: nextTurnIndex,
          timer_expires_at: timerExpires,
          status: isDone ? 'COMPLETED' : 'ONGOING',
          completed_at: isDone ? now : null,
          final_host_factions: isDone ? newState.picks.host : undefined,
          final_guest_factions: isDone ? newState.picks.guest : undefined,
          updated_at: now,
        },
      });

      await tx.draftEvent.create({
        data: {
          draft_id: draftId,
          turn_index: snapshot.currentTurn,
          actor: actor as string,
          action: turn.action,
          faction_id: factionId,
          is_auto_selected: isAutoSelected,
          payload: turn.is_hidden
            ? ({ hidden: true } as Prisma.InputJsonValue)
            : Prisma.NullableJsonNullValueInput.DbNull,
        },
      });

      if (isDone) {
        await tx.draftEvent.create({
          data: {
            draft_id: draftId,
            turn_index: nextTurnIndex,
            actor: 'system',
            action: 'complete',
            faction_id: null,
            is_auto_selected: false,
            payload: Prisma.NullableJsonNullValueInput.DbNull,
          },
        });
      }
    });

    // Update Redis
    const updatedSnapshot: DraftSnapshot = {
      ...snapshot,
      state: newState,
      currentTurn: nextTurnIndex,
      timerExpires,
      extraTurns,
      status: isDone ? 'COMPLETED' : 'ONGOING',
    };
    await this.writeRedisState(draftId, updatedSnapshot);

    // Emit action_committed
    DraftEmit.emitActionCommitted(
      this.io,
      draftId,
      snapshot.hostUserId,
      snapshot.guestUserId,
      {
        draftId,
        turnIndex: snapshot.currentTurn,
        actor,
        action: turn.action,
        isAutoSelected,
        isHiddenFromYou: turn.is_hidden,
      },
      factionId,
      turn.is_hidden,
      actor,
    );

    // Handle reveal turns — emit full state sync so clients see uncovered data
    if (
      turn.action === 'reveal_picks' ||
      turn.action === 'reveal_bans' ||
      turn.action === 'reveal_all'
    ) {
      // Emit to each player-room and spectator with appropriate masking
      for (const [role, userId] of [
        ['host', snapshot.hostUserId],
        ['guest', snapshot.guestUserId],
      ] as const) {
        const masked = DraftEmit.maskStateForViewer(newState, role);
        DraftEmit.emitDraftStateSync(this.io, DraftEmit.draftPlayerRoom(draftId, userId), {
          draftId,
          state: masked,
          currentTurn: nextTurnIndex,
          timerExpiresAt: timerExpires?.toISOString() ?? null,
          status: updatedSnapshot.status,
        });
      }
      const specMasked = DraftEmit.maskStateForViewer(newState, 'spectator');
      DraftEmit.emitDraftStateSync(this.io, DraftEmit.draftSpectatorRoom(draftId), {
        draftId,
        state: specMasked,
        currentTurn: nextTurnIndex,
        timerExpiresAt: timerExpires?.toISOString() ?? null,
        status: updatedSnapshot.status,
      });
    }

    // Clear old timer
    this.clearTimer(draftId);

    if (isDone) {
      // Complete draft
      await this.redis.srem(REDIS_ACTIVE_KEY, draftId);
      await this.redis.expire(REDIS_STATE_KEY(draftId), 86400);

      const finalFactions = DraftSM.computeFinalFactions(newState);
      DraftEmit.emitDraftComplete(this.io, draftId, {
        draftId,
        matchId: snapshot.matchId,
        finalFactions,
      });
    } else {
      // Schedule next turn timer
      if (timerExpires) {
        this.scheduleTimer(draftId, timerExpires);
      }
      // Emit turn_started for next turn
      await this.emitTurnStarted(updatedSnapshot, nextTurnIndex, timerExpires);
    }
  }

  // ---------------------------------------------------------------------------
  // Private: turn helpers
  // ---------------------------------------------------------------------------

  private currentTurn(snapshot: DraftSnapshot): DraftTurn | null {
    const idx = snapshot.currentTurn;
    if (idx < snapshot.presetTurns.length) {
      return snapshot.presetTurns[idx] ?? null;
    }
    const extraIdx = idx - snapshot.presetTurns.length;
    return snapshot.extraTurns[extraIdx] ?? null;
  }

  private async emitTurnStarted(
    snapshot: DraftSnapshot,
    turnIndex: number,
    timerExpires: Date | null,
  ): Promise<void> {
    const turn = this.currentTurn({ ...snapshot, currentTurn: turnIndex });
    if (!turn) return;

    const allFactions = await this.getAllFactionIds();
    const ctx: ApplyContext = {
      allFactions,
      categoryLimits: snapshot.categoryLimits,
    };

    const actorSide: 'host' | 'guest' = turn.actor === 'admin' ? 'host' : turn.actor;
    const perspective: 'host' | 'guest' = turn.as_opponent
      ? (actorSide === 'host' ? 'guest' : 'host')
      : actorSide;

    const availableFactions = DraftSM.getAvailableFactions(snapshot.state, turn, ctx, perspective);

    DraftEmit.emitTurnStarted(this.io, snapshot.draftId, {
      draftId: snapshot.draftId,
      turnIndex,
      actor: turn.actor,
      action: turn.action,
      isHidden: turn.is_hidden,
      isParallel: turn.is_parallel,
      asOpponent: turn.as_opponent,
      category: turn.category,
      availableFactions,
      timerExpiresAt: timerExpires?.toISOString() ?? new Date().toISOString(),
    });
  }

  // ---------------------------------------------------------------------------
  // Private: actor resolution
  // ---------------------------------------------------------------------------

  private resolveActor(snapshot: DraftSnapshot, userId: string): 'host' | 'guest' | null {
    if (userId === snapshot.hostUserId) return 'host';
    if (userId === snapshot.guestUserId) return 'guest';
    return null;
  }

  // ---------------------------------------------------------------------------
  // Private: Redis I/O
  // ---------------------------------------------------------------------------

  private async loadDraftSnapshot(draftId: string): Promise<DraftSnapshot | null> {
    const redisSnap = await this.loadDraftFromRedis(draftId);
    if (redisSnap) return redisSnap;
    return this.loadDraftFromDb(draftId);
  }

  private async loadDraftFromRedis(draftId: string): Promise<DraftSnapshot | null> {
    const hash = await this.redis.hgetall(REDIS_STATE_KEY(draftId));
    if (!hash || !hash.status) return null;

    // Load preset turns and category limits from hash (stored as JSON)
    let presetTurns: DraftTurn[] = [];
    let categoryLimits: ApplyContext['categoryLimits'] = [];

    try {
      presetTurns = JSON.parse(hash.preset_turns ?? '[]') as DraftTurn[];
      categoryLimits = JSON.parse(hash.category_limits ?? '[]') as ApplyContext['categoryLimits'];
    } catch {
      // If preset data missing from Redis, load from DB
      const preset = await this.prisma.draftPreset.findUnique({
        where: { id: hash.preset_id ?? '' },
      });
      if (preset) {
        presetTurns = z.array(DraftTurnSchema).parse(preset.turns);
        categoryLimits = z.array(CategoryLimitSchema).parse(preset.category_limits);
      }
    }

    return this.parseRedisSnapshot(draftId, hash, presetTurns, categoryLimits);
  }

  private parseRedisSnapshot(
    draftId: string,
    hash: Record<string, string>,
    presetTurns: DraftTurn[],
    categoryLimits: ApplyContext['categoryLimits'],
  ): DraftSnapshot {
    return {
      draftId,
      matchId: hash.match_id ?? '',
      status: (hash.status ?? 'ONGOING') as DraftSnapshot['status'],
      currentTurn: parseInt(hash.current_turn ?? '0', 10),
      state: JSON.parse(hash.state ?? '{}') as DraftState,
      timerExpires: hash.timer_expires ? new Date(hash.timer_expires) : null,
      presetId: hash.preset_id ?? '',
      hostUserId: hash.host_user_id ?? '',
      guestUserId: hash.guest_user_id ?? '',
      turnSeconds: parseInt(hash.turn_seconds ?? '30', 10),
      extraTurns: JSON.parse(hash.extra_turns ?? '[]') as DraftTurn[],
      presetTurns,
      categoryLimits,
    };
  }

  private async loadDraftFromDb(draftId: string): Promise<DraftSnapshot | null> {
    const draft = await this.prisma.draft.findUnique({
      where: { id: draftId },
      include: { preset: true },
    });
    if (!draft) return null;

    const presetTurns = z.array(DraftTurnSchema).parse(draft.preset.turns);
    const categoryLimits = z.array(CategoryLimitSchema).parse(draft.preset.category_limits);
    const extraTurns = (draft as any).extra_turns
      ? z.array(DraftTurnSchema).parse((draft as any).extra_turns)
      : [];

    const snapshot: DraftSnapshot = {
      draftId: draft.id,
      matchId: draft.match_id,
      status: draft.status as DraftSnapshot['status'],
      currentTurn: draft.current_turn,
      state: draft.state as unknown as DraftState,
      timerExpires: draft.timer_expires_at,
      presetId: draft.preset_id,
      hostUserId: draft.host_user_id ?? '',
      guestUserId: draft.guest_user_id ?? '',
      turnSeconds: draft.preset.turn_seconds,
      extraTurns,
      presetTurns,
      categoryLimits,
    };

    // Write back to Redis so future loads are fast
    await this.writeRedisState(draftId, snapshot);

    return snapshot;
  }

  private async writeRedisState(draftId: string, snapshot: DraftSnapshot): Promise<void> {
    const key = REDIS_STATE_KEY(draftId);
    await this.redis.hset(key, {
      match_id: snapshot.matchId,
      current_turn: String(snapshot.currentTurn),
      status: snapshot.status,
      timer_expires: snapshot.timerExpires?.toISOString() ?? '',
      preset_id: snapshot.presetId,
      state: JSON.stringify(snapshot.state),
      host_user_id: snapshot.hostUserId,
      guest_user_id: snapshot.guestUserId,
      turn_seconds: String(snapshot.turnSeconds),
      extra_turns: JSON.stringify(snapshot.extraTurns),
      preset_turns: JSON.stringify(snapshot.presetTurns),
      category_limits: JSON.stringify(snapshot.categoryLimits),
    });
  }

  // ---------------------------------------------------------------------------
  // Private: timer management
  // ---------------------------------------------------------------------------

  private scheduleTimer(draftId: string, expiresAt: Date): void {
    this.clearTimer(draftId);

    const delay = expiresAt.getTime() - this.clock().getTime();

    if (delay <= 0) {
      // Already expired — queue microtask
      queueMicrotask(() => {
        void this.forceAutoSelect(draftId).catch((err) => {
          console.error(`[DraftService] forceAutoSelect error for ${draftId}:`, err);
        });
      });
      return;
    }

    const handle = setTimeout(() => {
      this.timers.delete(draftId);
      void this.forceAutoSelect(draftId).catch((err) => {
        console.error(`[DraftService] forceAutoSelect error for ${draftId}:`, err);
      });
    }, delay);

    this.timers.set(draftId, handle);
  }

  private clearTimer(draftId: string): void {
    const handle = this.timers.get(draftId);
    if (handle !== undefined) {
      clearTimeout(handle);
      this.timers.delete(draftId);
    }
  }

  // ---------------------------------------------------------------------------
  // Private: faction IDs cache
  // ---------------------------------------------------------------------------

  private async getAllFactionIds(): Promise<string[]> {
    if (this.cachedFactionIds) return this.cachedFactionIds;
    this.cachedFactionIds = await this.loadAllFactionIds();
    return this.cachedFactionIds;
  }

  private async loadAllFactionIds(): Promise<string[]> {
    const factions = await this.prisma.faction.findMany({
      select: { id: true },
      orderBy: { display_order: 'asc' },
    });
    return factions.map((f) => f.id);
  }
}
