# Pick/Ban Data — collection + analytics backlog

Alex 2026-07-13. Priority: **keep the raw data collected durably**; the analysis can
come later. Triggered by the admin "Pick / Ban Stats" panel showing "No data".

## What we already collect (raw)

- **Map bans/picks — fully.** `MatchMapDecision.bans_top` (top player's map bans),
  `bans_bottom` (bottom player's), `picked_map_id`. So "which maps, banned by whom
  (top vs bottom player)" is in the raw data.
- **Faction picks/bans — raw yes.** `MatchFactionMatrix` (MATRIX + 1v3 + free-pick):
  `p1_factions`/`p2_factions` (the 3 blind picks), `bans` (banned "row,col" cells),
  `picked_cell` (final pick). `MatchBlindPick` for BPT. Faction bans only exist for
  MATRIX (the 3×3 grid) → limited volume.

## Durability gap (the important one for "keep collecting")

The decision records hang off `MatchGame` via `onDelete: Cascade`. A few flows
**hard-delete the games** → the pick/ban records cascade away with them:
- Forfeit / match-drop (`matches.ts:712`)
- Withdraw→void survivor forfeit (`matches.ts:809`)
- No-Contest (`matches.ts:837`)
- Admin override/void (`admin.ts:1666`)

So: **normal completed games retain their pick/ban data; forfeited / no-contest /
voided / admin-overridden games lose it.** Mostly a small, arguably-appropriate
subset (those games often had no real pick/ban), but it is NOT a permanent archive.

**Option for a bulletproof guarantee:** an **append-only pick/ban event log** — a
separate immutable table that records each pick/ban action as it happens
(season, tournament, mode, game, actor, entity, action=pick|ban), never deleted,
decoupled from the game lifecycle. Write one row per action in the existing
decision endpoints. Then the meta history accumulates forever regardless of resets.
This is the only thing that CANNOT be done retroactively — you can't recover
pick/ban from already-deleted games.

## Known display bugs (analysis side — later)

- **Response-shape mismatch:** `GET /api/admin/stats/pickban-stats` returns a bare
  array; the frontend (`PickBanStatsChart`) reads `data.data` (expects
  `{ data, entity }`) → **always "No data"**, for BOTH tabs, even when data exists.
- **"All" season** resolves to the ACTIVE season only (`admin.ts:878-880`), not all.
- **Faction ban aggregation is a stub:** `recompute-faction-stats.ts` sets
  `ban_count = 0` and `pick_count = games-played` (not real picks). The raw
  `MatchFactionMatrix` bans/picks are never aggregated.

## What would be valuable to analyse (ranked, Alex-discussed)

1. **Faction ban/contest rate (pick+ban), per MODE** — the meta pulse; ban rate =
   what players fear. Feeds the **restricted-faction loop** (most-feared → restrict;
   still-top-banned-while-restricted → nerf insufficient). Highest value.
2. **Win-rate × pick-rate quadrant** — over-/under-rated factions.
3. **Per-mode split** — blind-pick (MATRIX/BPT) vs counter-pick (1v3) differ hard.
4. **Map ban rate + "by whom"** — map-pool curation; a map the coin-flip winner
   always bans = too big a first-move advantage. Highest data volume → lights up first.
5. (Later / niche) per-player tendencies (scouting), matchup-conditional bans.

## Suggested order

1. **Durable append-only pick/ban log** (protects data going forward — do first if we
   want a permanent archive; can't be recreated).
2. Fix the display bug (`{ data, entity }` wrap + "All" = all seasons) → Maps tab
   lights up immediately with real data.
3. Real faction pick/ban aggregation from `MatchFactionMatrix` (or from the new log).
4. The analytics views (contest rate per mode, WR×pick quadrant, map curation).
