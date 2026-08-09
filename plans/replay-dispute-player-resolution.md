# Replay Dispute — Player-Driven Resolution

Design note (Alex + Claude, 2026-08-09). Turn the replay-mismatch "held for host review" dead-end into
a self-service, two-party confirmation with the **replay as the source of truth** and the host only as
a fallback. Extends the host `resolve-dispute` action already shipped (commit 9d7196e), which becomes
the fallback path here.

## Why

Today a replay mismatch that the reporter "explains" is held **DISPUTED** and the match never completes
until a host acts — but there was no clear host action, so it stalled (the `bottom-of-the-barrel-2d3`
case). Also, the replay already tells us what was *actually* played (factions, map, players — via the
ESF tree walk `extractReplayPlayers`, ~98% per-player), so a faction/map mismatch is best resolved by
**applying the replay's values**, confirmed by the opponent, not adjudicated by the host.

## Source of truth

- **Factions + map** come from the **replay** (they are pre-game settings the replay records faithfully).
- **Winner** comes from the **report** — the only post-match input, and the confirming opponent would
  reject it if it were wrong. The replay cannot recover the winner (no battle-result parse).

## Flow

1. Reporter uploads replay + result → verification (existing `verifyGameReplay`).
2. **Clean** → finalize immediately (existing).
3. **Mismatch (faction/map):** the reporter's dialog shows, side by side, what they reported vs **what
   the replay says** (parsed factions per player + map). Two choices:
   - **Replace replay** (it was the wrong file) → re-verify.
   - **"The replay is correct"** → the reported winner stands, but the game's factions/map are taken
     from the replay. Move to **awaiting-opponent-confirmation**.
4. **Ambiguous parse** (faction not cleanly attributable — e.g. the Chaos-god family, `diffIsChaosGodOnly`)
   → skip the opponent step, go straight to **DISPUTED / host review** (conservative).
5. **Awaiting-opponent-confirmation:** the opponent gets a DM + an in-app dialog showing the replay's
   contents and the reported winner, with **Confirm ("yes, this is the match we played")** or
   **Reject ("this isn't our game")**. The host gets an **informational notification** only.
   - **Confirm** → finalize the game with the replay's factions + map + the reported winner
     (`finalizeGameResult` → `completeMatch`). Bracket + standings update. Host notified (resolved).
   - **Reject** → **DISPUTED**, host review (the shipped `resolve-dispute` host action). Host notified
     (needs action).
6. **No opponent response:**
   - **Tournament:** stays pending — the GameTile stays open and the round is blocked, so there is
     natural pressure to resolve it promptly; DM nudge(s) to the opponent; the host can resolve it any
     time (fallback). No auto-finalize.
   - **Open Play:** the waiting reporter gets a **"Opponent isn't responding → escalate to admin"**
     button that **closes the match, holds the result pending (admin), and frees both players to queue
     again** (mirrors the existing "held result doesn't lock Open Play" rule).

## State

Reuse the game `verification` JSON to carry the sub-state without a new enum value where possible:
- `{ issues, explanation }` — held, as today.
- add `awaitingOpponent: true` + `replayValues: { player1FactionSlug, player2FactionSlug, mapName }`
  once the reporter asserts "replay is correct" (so the opponent dialog + the finalize both read the
  frozen parsed values, and we don't re-parse divergently).
- On confirm: map slugs → faction IDs, map name → map ID, write them to the game, then finalize.

(If a dedicated status reads cleaner than a JSON flag, a `AWAITING_OPPONENT` MatchGameStatus is an
option — decide at build time; the JSON-flag route avoids a migration.)

## Reused building blocks

- `extractReplayPlayers(buf)` → per-player `{ name, faction slug }`; `parseReplayMeta` → map/terrain;
  `mapNameFromTerrain`. Attribute replay players to `player1/player2` by normalised name (`normName`).
- Faction slug → `Faction` id (by slug); replay map name → `Map` id (by name).
- Opponent DM (`notifyReplayMismatchHeld` → extend to a confirm-request), host notifications.
- Host `resolve-dispute` endpoint + `/matches/:id` box (9d7196e) = the fallback path.
- Open Play "held result frees the queue" logic.

## New surface

- Backend: `POST …/games/:n/assert-replay-correct` (reporter → awaiting-opponent, stores replayValues),
  `POST …/games/:n/opponent-confirm` (finalize with replay values), `POST …/games/:n/opponent-reject`
  (→ DISPUTED + host), `POST …/games/:n/escalate` (Open Play: close + free queue + pending).
- Frontend: reporter mismatch dialog (replace / assert-correct, with the replay-contents panel), opponent
  confirm dialog (replay-contents + confirm/reject), Open Play escalate button, host notification banner.
- Notifications: opponent confirm-request DM, host informational + host-action DMs.

## Open questions
- State representation: `verification` JSON flag vs. a new `AWAITING_OPPONENT` status (migration). Lean
  JSON-flag; revisit if it complicates the games query.
- DM nudge cadence for a non-responding opponent in tournaments (once? every N hours?).

## Build order (proposed)
1. Shared replay→values resolver: parse + attribute + slug/map → IDs (pure-ish, testable).
2. `assert-replay-correct` (reporter) — store replayValues + awaitingOpponent; ambiguous → DISPUTED.
3. Opponent confirm / reject endpoints + DMs + host notification.
4. Open Play escalate endpoint (close + free queue + pending).
5. Frontend dialogs (reporter, opponent) + Open Play escalate + host banner.
6. Tests: resolver mapping, confirm→finalize→completeMatch, reject→DISPUTED, ambiguous→host.
