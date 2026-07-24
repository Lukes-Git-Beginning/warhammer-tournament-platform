# Changelog

All notable changes to **Rizzotto** (rizzotto.gg) are documented here.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/); entries are grouped by deploy wave (the platform ships continuously to `main`).

**Versioning** (SemVer, adapted for continuous deploy): `Fix → patch (1.1.x)` · `Update / new capability → minor (1.x.0)` · `New pillar → major`. **v1.0.0** = the public launch (2026-06-27, 21:00 CEST); everything before was Beta (0.x). The many small deploys between launch and the first tagged patch make up the **1.1** line; from **[1.1.1]** on, notable releases carry a version tag.

## [Unreleased]
Still planned for the **v1.2** line (see `plans/v1.2-planning.md`): format mouseover tooltips, an optional lobby-password field, and imgur → local map hosting plus three new maps (Otsuchi Castle, Blasphemous Snowfield, Excavation Site). Later: custom challenges + asynchronous challenge events, and website invite/referral tracking.

## [1.2.0] — unreleased — Skill-leaderboard win-rate + fairness & robustness fixes
First minor since 1.1: the Skill leaderboard now surfaces real win-rate, alongside a batch of pairing, playoff-trigger and data-integrity fixes.

### Added
- **Skill-leaderboard win-rate** — the Skill board now carries a real win-rate column (wins / games from the match-game source) beside the model skill, still ranked by skill. The old standalone Win Rate tab is retired. (#8)

### Changed
- **Skill-leaderboard cutoff** raised to 20 games (was 5) — the board no longer lists players with only a handful of games.

### Fixed
- **BaLi bye choice** now minimises play-ups — among the eligible weakest candidates it byes the one that strands the fewest peers into cross-band rematches (the weakest still wins ties), fixing avoidable double play-ups seen in live rounds.
- **BaLi playoff auto-generation** no longer stalls after a burst of withdrawals — the pairing tick coalesces a dropped trigger and re-runs on the settled field, so playoffs generate without a manual nudge.
- **Start-Playoffs button** is no longer hidden by a cancelled final-round match — a last-round withdrawal cancels its match, and the completeness check now ignores CANCELLED.
- **Declining a re-join** no longer erases a player's history — a withdrawn player who re-requested and was declined is reverted to WITHDREW instead of hard-deleted, so they stay in the standings and bracket (fixes a played player collapsing to a raw user id).

### Ops
- **Changelog automation** — a `post-changelog` script publishes the newest release section to the Discord changelog channel (dry-run by default).

## [1.1.1] — 2026-07-24 — BaLi fairness + display fixes
First tagged release since launch.

### Fixed
- **BaLi pairing:** the odd-count bye is pre-assigned to the weakest player by handicap-adjusted score *before* the pairing optimum runs — a lone weak player takes a bye instead of a hopeless 3-band play-up. The Δ2 band-gap cost rose to 2.1 (two adjacent play-ups beat one 2-band jump; a rematch beats a 2-band stomp).
- **BaLi standings:** no longer re-sorted by playoff result — they keep Swiss order (division → points → tiebreakers); the 1st/2nd/3rd badges come only from the top division's playoff, and each finalist banner is tinted to the division whose final that player reached. Fixes a completed tournament showing the wrong player in 1st.
- **BaLi byes:** a provisional bye now reads "BYE · pending" instead of the misleading "Catch-up · 0 pts"; only a genuine late-join catch-up bye shows the 0-point label.
- **BaLi late-join:** a late joiner can no longer inherit a several-band-away opponent — the bye reclaim is gated so a late-join pairing is never the round's biggest band-gap (and never an immediate rematch).
- **Open Play:** the front-page availability heatmap shows matchmaking availability only (was mixing in tournament availability).
- **Standings:** Free Pick mode keeps "Free Pick" until a host sets a faction (was showing the first faction picked).
- **Tournaments:** auto-sized tournaments show "Rounds TBD" before they start, instead of the default count.

## 2026-07-21 — Discord self-config & atmospheric backdrop
### Added
- **Atmospheric page backdrop** — a darkened nocturnal-ruins painting behind every page (Open Play included).
### Fixed
- **Discord bot self-configures its guild** from its token (env override → auto-detect → fallback), fixing the "not configured" report and a silent login auto-join failure.

## 2026-07-20 — Balanced Liechtenstein playoff size & undrop
### Changed
- **Playoff size is a host choice** — removed from the auto-sizer, with a homogeneous-vs-large explanation and a default of Top 2. Fixes 16+ check-ins forcing a single mixed Top-8 and discarding the divisional concept.
### Fixed
- **Undrop / catch-up-bye backfill is idempotent** — it skips already-played rounds, and undrop folds a returning player back into the group phase.

## 2026-07-18 — Quick-wins, capacity & ops fixes
### Added
- **Minimum-participants field** with a 2×2 capacity layout (start / deadline, min / max) and a soft start-warning the host can override; shown on the tournament page.
- **"Not in Discord" account report** and split **Reports** admin sub-tabs (less scrolling).
### Changed
- Create form reordered — poster first, Discord/stream under the description, rules between the map and faction pools; the Discord invite is pre-filled.
### Fixed
- Division-champion marker; "Majors only" wording; **host transfer** (was sending the wrong body field → every transfer 400'd); **co-host edit access** (the edit page now uses the server `can_manage` flag).

## 2026-07-17 — BaLi 2.0, Faction War, Majors & tournament ops
### Added
- **BaLi 2.0 pairing engine** — provisional-optimum "commit-when-free" pairing, a progressive/asymmetric band-gap cost, pending-bye reclaim, and a playoff-seeding handicap that discounts wins from lower divisions.
- **Faction War** mode; a **major-tournament-wins leaderboard** derived from match data.
- **Per-game override** in the score modal — a non-Bo1 override shows map, factions and winner/draw per game.
### Changed
- Heatmap stat-eligibility unified (a shared void-cascade); the major tiebreaker uses game-wins.
### Fixed
- Playoff-drop notify + walkover; game editing in the admin "All Games" tab.

## 2026-07-16 — Quick-wins batch + majors
### Added
- Faction-pick timer; majors leaderboard; admin reports & "underrated players"; Open Play match origin (queue vs availability DM); an "unrated" flag.
### Fixed
- Free-pick / picker fixes; closed the availability-ping gap that pinged a player mid-tournament (in-session = live or <30 min; REGISTERED muted).

## 2026-07-14 — Open Play suppression & queue-abuse ladder
### Added
- **Education-first queue-abuse escalation** — hint → 1h → 24h with a 7-day decay and a queue-activity log, plus an admin cooldown reset on the player profile.
### Changed
- Open Play availability DMs are suppressed during a live match or a real-time tournament session; the staff availability heatmap is de-anonymized (names on hover).

## 2026-07-13 — UI polish
### Added
- Posters on the tournament listing cards; format/mode hover tooltips from a shared source.
### Changed
- "Majors only" wording (i18n); the landing page shows "The Ladder" as live (Open Play) instead of "coming".

## 2026-07-11 — Balanced Liechtenstein & Swiss robustness
### Fixed
- A late joiner now gets a 0-point catch-up bye (no gifted points); withdraw → void is handled cleanly (BaLi cancel + re-pair, Swiss forfeit-win), and dropped players sort to the end of the standings.

## 2026-07-09 — Manual-match safety, late join, calibration audit & skill stats

### Added
- **Host-approved late join** — hosts can enable *Allow late-join requests* per
  tournament (create + edit forms). After start, a player runs the normal sign-up
  (faction / band / free pick) to send a join **request** instead of entering. The
  host approves or declines it from a Discord DM and a requests panel above the
  live view; approved players are folded in (a bye for the current Swiss round, or
  the Balanced Liechtenstein pairing tick).
- **Create a bye match** from the Create Match UI — leave Player 2 empty.
- **Admin calibration audit** — search a player in the Skill Calibration tab (or
  the Users tab) to see their questionnaire answers, the band floor each answer
  implies, and their full skill classification. (#27)
- **Skill-level distribution chart** in Admin › Statistics — how many players sit
  in each skill band (New … Top), **stacked** by whether they filled in the
  questionnaire or are rated from games alone. Players with neither stay
  "unclassified" (never counted as New).
- **Reset a player's questionnaire** — admins clear a botched questionnaire from
  the player's profile (an *Admin · skill calibration* panel with a Reset button),
  so the player re-takes it fresh. The calibration audit now lives on user profiles
  (moved off the Users admin tab).

### Fixed
- **Manually created matches & byes now stamp the format-correct phase** (only
  Swiss group matches are `SWISS`; every other format is `null`), so a manual
  Balanced Liechtenstein match/bye no longer lands outside the division group.
- **Balanced Liechtenstein playoffs auto-launch** even when a group match carries
  a stray `SWISS` phase — a manual/forfeit match no longer blocks playoff generation.

## 2026-07-03 — Balanced Liechtenstein & the Skill engine (major feature deploy)
### Added
- **Balanced Liechtenstein** — a skill-banded asynchronous Swiss format: players are paired within their skill division, each division plays its own auto-sized playoff (with a third-place match), and results are finalised from the Swiss record.
- **Skill classification engine** + a **public adaptive calibration wizard** (only asks questions that can still raise your band) + an **admin-editable question catalogue**; opt-in **band-up at registration**. Band colours (White/Rust/Bronze/Silver/Gold), play-up arrows, division standings and finalist stars.
- **Host/co-host draft visibility** — unpublished tournament drafts are visible to their staff.
### Changed
- Restricted factions stay pickable (nerfed, not banned); Steam re-link is hardened (admin-only reset, with an audit trail).

## 2026-07-02 — Matchmaking DM rewrite & chart polish
### Changed
- **Open Play matchmaking** moved to a central tick with rate-limited DM waves and a "Match Now" action; result reporting moved **fully on-site** (the Discord declare-win/loss buttons were removed and a replay is mandatory); on-site disputes DM the moderators.
### Fixed
- Standard-ruleset card values align to a shared column; faction-popularity chart labels fit on one line.

## 2026-06-30 — Phase-2 feature batch

### Added
- **Tournament ruleset section** — a "Rules" block with an *Enable standard rules*
  checkbox (a fixed Community Standard: Default Funds · Ultra · 1500 Tickets ·
  Unit Caps · Masque/Dreadmaw banned · 10 min ready / 40 min round limit), plus
  separate **Custom Rules** and **Custom Restrictions** fields. (N17)
- **Persistent Open Play queue activity log** with an admin "Queue Activity" tab
  (join / leave / match / cancel / win / lose / draw). (N14/N15)
- **Global active-match indicator** in the header — pulses when you have an open
  game you're not currently viewing; click to jump to it. (N16)
- **Community availability heatmap** on the create-tournament form, so hosts pick
  a start time when most players are around. (N8)
- **Live queue & availability counter** on the Open Play page. (N9)
- **Proficiency column** in a faction's Top Players table. (N3)
- **Banned & restricted factions** shown on the tournament detail page. (N11)
- Faction allowlist now **defaults to all-selected** in create/edit forms. (N10)
- Faction replays **filterable by opponent faction** (dropdown + matchup-row link). (N12)
- Anti-farming admin view now flags opponents **approaching** the cap. (N7)
- Player and faction mentions are **clickable app-wide** (→ profile / faction page). (N4)
- Player names in **Discord bot DMs are clickable** (`<@id>`). (N5)

### Changed
- **Game counts unified** across the Meta page: a draw counts as a played game,
  admin-voided matches are excluded — "Total Games" and "All Games" now agree. (N1)
- **Matchup heatmap computed live** from completed games (no longer a stale
  snapshot), so it always matches the games list. (N1)

### Performance
- Faction top-player proficiency now read from the cached rating model
  (removed a per-player N+1 query). (N3)

## 2026-06-28 — Tournament B-batch + 2D3 mode

### Added
- **2D3 tournament mode** — pick 3 factions; one is drawn at random per game.
- **TOP2 playoff format** + auto-reduce Top4→Top2 when fewer than 8 active players. (B6)
- **NO_CONTEST double-bye** for technical aborts (both players +1, no Buchholz). (B10)
- **Global min-weight Swiss pairing** — hard-avoids rematches & no-contests. (B8)
- Hosts can add late participants, set factions, and create/delete matches & BYE
  nodes before/after start; **co-hosts get the full management UI** (`can_manage`). (B12, B18, B19, B21)
- **Auto check-in** during the check-in window and **re-registration after withdraw**. (B5, B15)
- **Discord notifications** for round 1, all playoff matches, and host drop alerts. (B20, B22)
- Required map-pack notice on every tournament page. (B11)
- Undrop is allowed **before** a tournament starts. (N13)

### Changed
- Renamed tournament **"Organizer" → "Host"** across schema, code and UI. (B13)
- Later Swiss rounds **pair only checked-in players**. (B14)
- RANDOM_PICK_BAN excludes maps either player has already played. (B4)

### Fixed
- Playoff start now honors the **configured round count** (was a log2 heuristic
  that broke above 32 players).
- 2D3 per-game faction is revealed **before** map selection.
- Drop is **decoupled** from tournament withdraw; "dropped" derived from status. (B1)
- Faction master data served independently of an active season.
- Tournament view live-refreshes on status change (B7); game-history page no
  longer overflows horizontally (B2); `Europe/Kiev` normalized to `Europe/Kyiv`. (B17)

## [1.0.0] — 2026-06-27 — v1 launch
Rizzotto left beta and launched v1 on rizzotto.gg (21:00 CEST). Discord + Steam authentication; tournament creation (Swiss, Single & Double Elimination, Round Robin) with a live bracket and standings; a real-time faction draft (blind pick, ban patterns, faction matrix); placement-based leaderboards (ELO removed for fairness during beta); faction meta and popularity pages; a Souls-like / grimdark design system; and a Discord bot (check-in and match reminders, Open Play queue and lobby finder).
