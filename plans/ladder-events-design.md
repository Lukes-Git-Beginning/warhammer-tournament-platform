# Ladder Events — Framework Design

Status: **DESIGN / not built.** Answers Alex's question "Ladder events — how could
those work as a framework?" (raised 2026-08-13 alongside the AFK-penalty and
segmented-popularity items). Nothing here is committed as code yet; this is the
architecture proposal + the open decisions to settle before a build.

## The gap this fills

"The Ladder" (Open Play, `Match.type = OPEN_PLAY`, `source IN (QUEUE, AVAILABILITY)`)
is **always-on but flat**: you queue, you get matched, you play, it feeds the skill
rating and the ladder leaderboard. There is no seasonal hook, no urgency, no shared
"right now" moment. Tournaments sit at the other extreme — registration, a bracket,
a host, a schedule — heavy, deliberate, one-off.

**Ladder events are the middle rung:** lightweight, time-boxed, themed happenings
layered *on top of* the always-on ladder. You opt in simply by playing during the
window. Each event has its own leaderboard and its own recognition/reward, but reuses
the existing matchmaking, replay verification and results plumbing. The goal is
engagement spikes and variety without the overhead of a formal tournament.

---

## Three models

### Model A — Ladder Seasons (recurring reset windows)
The ladder runs in named seasons (e.g. monthly or quarterly). Each season keeps its
own leaderboard; at season end the top players are immortalised (Roll of Honour entry,
a season badge) and ratings soft-reset / decay toward the mean so every season is a
fresh climb.

- **Framework:** `LadderSeason { starts_at, ends_at, status }`. Ladder games already
  carry `Match.season_id`, so attribution is largely there. Leaderboard filters by the
  active season; an end-of-season job snapshots standings → awards, then applies decay.
- **Pros:** the familiar competitive-ladder shape (every ranked game has seasons);
  sustained, cyclical engagement; a natural reset cadence.
- **Cons:** resets can feel punishing if decay is mistuned; a "season" is a big
  commitment and a big design surface (decay curve, placement matches, soft vs hard
  reset). Heaviest of the three to get right.

### Model B — Themed Challenge Events (modifiers over a window)
A time-boxed event (a weekend, a week) applies a **ruleset/modifier** to ladder play
and scores a **separate event leaderboard** for the games that qualify. Examples:
- *Faction Spotlight* — only Dwarfs vs Greenskins games count.
- *Underdog Weekend* — bonus event-points for beating a higher-rated opponent.
- *Map Madness* — only a specific fixed map counts.
- *Blind Ladder* — every game is blind-pick.

- **Framework:** `LadderEvent { starts_at, ends_at, ruleset(JSON), scoring(JSON) }`.
  During the window any ladder game matching the ruleset is attributed to the event and
  scored on the event's own points formula. Event leaderboard + reward at the end.
- **Pros:** enormously flexible/extensible — the ruleset is *data*, so new event types
  are new config, not new code; fun and varied; low commitment (just play in the
  window); reuses matchmaking wholesale.
- **Cons:** needs a small scoring-modifier engine; if an event *gates* matchmaking
  (only-Dwarfs actually restricts the pick) it touches the blind-pick engine — see
  open decision #1.

### Model C — Sprints / Races (activity events, no rule change)
A short race on top of normal ladder play: "most ladder wins in 48h", "first to 10
ladder wins", "longest win-streak this weekend". No rule change — pure aggregation of
qualifying results over the window with a live event leaderboard; reward the leader or
the first to hit the target.

- **Framework:** `LadderEvent { scoring: { type: 'RACE', metric: 'wins'|'games'|'streak', target? } }`.
- **Pros:** cheapest to ship (aggregate over existing games, zero matchmaking or
  rule changes); drives raw volume; live drama (streak/race tickers).
- **Cons:** rewards grinding/volume unless capped or win-rate-weighted; less
  "skill-defining" than a season.

---

## Recommendation — one entity, three presets

**Build Model B's generic `LadderEvent` as the SSOT, and express A and C as presets of
it.** They are not three separate features — they are one entity with a pluggable
ruleset + scoring:

| Preset  | ruleset            | scoring                          | extra                          |
|---------|--------------------|----------------------------------|--------------------------------|
| Race (C)| empty              | `{ type: 'RACE', metric, target?}`| —                              |
| Themed (B)| filters (faction/map/mode/band) | `{ type: 'POINTS', modifiers[] }` | —                        |
| Season (A)| empty (or band)  | `{ type: 'POINTS' }` (standard)  | end-snapshot → awards + decay  |

This is the extensible answer the "framework" question is really asking for: **one
schema, presets on top, new event types = new registered predicate/modifier — no schema
change.**

### Schema sketch (additive)
```prisma
model LadderEvent {
  id          String   @id @default(cuid())
  slug        String   @unique
  name        String
  description String?
  starts_at   DateTime
  ends_at     DateTime
  status      LadderEventStatus  // SCHEDULED | ACTIVE | ENDED
  ruleset     Json     // { factions?: slug[], maps?: id[], mode?: 'BLIND', minBand?, maxBand? }
  scoring     Json     // { type: 'RACE'|'POINTS', metric?, target?, modifiers?: [...] }
  reward      Json?    // { rollOfHonour?: bool, badge?: slug }
  created_at  DateTime @default(now())
}

model LadderEventGame {   // durable attribution + audit (like season_id / faction-war)
  event_id      String
  match_game_id String
  points        Float     // resolved at report time from the event's scoring
  @@id([event_id, match_game_id])
}
```

### Attribution
A ladder game (`OPEN_PLAY`, `source IN (QUEUE, AVAILABILITY)`) played within
`[starts_at, ends_at]` and matching `ruleset` is attributed to every active event it
qualifies for, at **report time**, into `LadderEventGame` with its resolved points.
Prefer the durable join table (mirrors how faction-war and `season_id` already work)
so event leaderboards are cheap, auditable, and survive rule changes — rather than
recomputing on the fly.

### Extensibility hooks
- **Ruleset predicates** and **scoring modifiers** are small pure functions registered
  by key (`factionFilter`, `bandFilter`, `underdogBonus`, `winStreak`, …). A new event
  type is a new registered function + a config row, never a schema migration.
- Reuses the existing skill/matchup model (`lib/matchmaking.ts`) for anything
  rating-aware (e.g. the underdog bonus reads the same favourability rating the
  Faction-War pairing uses).

### Suggested build order (cheapest → richest)
1. **Race preset (C)** first — pure aggregation, no matchmaking or rule risk. Proves the
   `LadderEvent` + `LadderEventGame` + leaderboard + reward vertical end-to-end.
2. **Themed / scoring-only (B)** — add the ruleset predicate + scoring-modifier
   registry. Events *score a subset* of normally-played games; matchmaking untouched
   (see open decision #1).
3. **Seasons (A)** last — only once decay/reset is designed; it's the biggest surface
   and the least reversible.

---

## Open decisions (settle with Alex before building)

1. **Gate vs score.** Does a themed event *gate* matchmaking (an only-Dwarfs event
   actually restricts the faction pick / the queue), or does it only *score* the subset
   of games that happen to match while normal matchmaking runs unchanged?
   Scoring-only = zero matchmaking risk, ship fast. Gating = a stronger theme but it
   reaches into the blind-pick / queue engine.
2. **Rewards.** Roll of Honour entry + a badge only, or something richer (cosmetics, a
   Ko-Fi/supporter tie-in)? This decides how much reward plumbing the first build needs.
3. **Concurrency.** Can several events run at once (a weekend theme *and* an ongoing
   season)? Recommended **yes** — a single game attributes to every event it qualifies
   for; the join table already models many-to-many.
4. **Rating impact.** Do gimmick/themed event games still feed the **global** skill
   rating, or are they rating-neutral (event leaderboard only)? A "Blind Ladder" or
   "underdog bonus" event arguably shouldn't move someone's real rating.
5. **Who runs them.** Admin-only curated calendar, or can hosts propose events? Start
   admin-only (curated) for quality control; open up later if wanted.

## Not in scope here
Bracket/tournament events (those are the existing tournament system), and the decay/
placement-match maths for Model A (its own design once seasons are greenlit).
