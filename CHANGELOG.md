# Changelog

All notable changes to **Rizzotto** (rizzotto.gg) are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/); the platform ships continuously to `main`, and each deploy wave carries its own version.

**Versioning** (SemVer, adapted for continuous deploy): `Fix → patch (1.x.Y)` · `Update / new capability → minor (1.X.0)` · `New pillar → major`. **v1.0.0** = the public launch (2026-06-27, 21:00 CEST); everything before was Beta (0.x). Every deploy wave since launch is versioned below, oldest at the bottom.

## [1.25.0] — 2026-08-02 — BaLi: no more idle waiting for a pairing (#36)
### Fixed
- **Balanced Liechtenstein no longer parks free players needlessly.** When several same-skill players were still finishing their round, the pairing engine could reserve *every* free player against a still-playing one and commit no matches — so players who'd already finished sat idle for minutes with clean opponents right there. It now commits a free-vs-free pairing the moment it's provably downside-free (a same-band, non-rematch pair that a cost check confirms won't strand a weaker player into a play-up), while still reserving a partner for a genuinely scarce/weaker player. Prompt pairings in the common case, no loss to the stomp-avoidance that reservation protects.

## [1.24.0] — 2026-08-02 — Bye DMs, division ordering & re-seed marker fixes
### Fixed
- **Balanced Liechtenstein byes now DM the player.** A bye never notified the player before (BaLi created bye rows outside the notification path). Now a mid-tournament bye that becomes final sends the encouraging "you advance" DM, and a **final-round bye** gets a tailored message: it's the final round, a *provisional* playoff outlook (in / just outside the spots, from the current division standings — can still shift), and "if you make the playoffs, I'll ping you when the bracket is set". Provisional (still-reclaimable) byes and 0-point catch-up byes stay silent.
- **Division playoffs are ordered top-division-first.** The stacked division brackets were ordered by creation order (so e.g. Advanced could sit above Top); they now sort by skill band, highest first.
- **Re-seeding a playoff drop no longer leaves a stale "opponent withdrew" marker.** Backfill and swap (like restore/full-reset in v1.23.0) now clear the withdrawal marker when the withdrawn player is replaced, so the picker is no longer blocked on the re-seeded match.

## [1.23.0] — 2026-07-28 — Host match ops: Full Reset + playoff backfill
### Added
- **Full Reset on any match node.** A host/mod/admin can wipe a match back to a clean, unplayed placeholder — it deletes the games, draft, picked map, factions and lobby code (so a swapped-in player never inherits the old data) and pulls any winner it had already advanced back out of the next bracket node (→ TBD). Unlike "Restore to Pending" (which only cleared the top-level result), nothing stale survives; the tournament-level (SFT) faction is kept.
- **Backfill the next seed into a playoff drop.** When a player drops out of an entry-round playoff match, instead of walking the survivor over, a host can fill the open slot with the next non-qualified group seed (for Balanced Liechtenstein, from the survivor's own division) — so nobody is in the final "by default" and the survivor plays for the spot. Typical flow: Full Reset the walkover node, then Backfill.

## [1.22.0] — 2026-07-27 — Solkoff in the standings
### Added
- **Solkoff (SK) is now shown in the standings**, right after Buchholz. It's the tiebreaker applied immediately after Buchholz (score → Buchholz → games lost → **Solkoff** → head-to-head), so a two-player tie on score *and* Buchholz is now readable at a glance instead of looking arbitrary. Appears in both the flat Swiss table and the per-division Balanced Liechtenstein tables.

## [1.21.0] — 2026-07-26 — Provisional bracket / current plan
### Added
- **The full bracket structure is visible up-front now.** Every round-based tournament (Swiss, Auto Swiss, classic + Balanced Liechtenstein) shows a live **"Current plan"** — how many rounds there are and what the playoffs currently look like (Top-X, and for BaLi how many divisions) — plus a **placeholder playoff bracket** of TBD slots *before* the playoffs are even generated. It's computed with the exact same sizing rules as real generation (so it can't mislead) and reshapes live as the field changes (drops / late-joins). Also sets up the auto-advance into playoffs (#37b).

## [1.20.0] — 2026-07-26 — Lobby password
### Added
- **Optional lobby password** on a match's game, right next to the lobby code — set and shared the same way (by a participant or staff, one-click copy, masked from non-participants). For custom-battle lobbies that need both a name/code *and* a password to join.

## [1.19.3] — 2026-07-26 — Admin Matches list: recent-first + timestamps
### Fixed
- **The admin Matches list now sorts most-recent-first and shows a real date + time.** Cancelled/BYE rows (which have no play time) were floating to the top and every Date cell read "—"; now played matches sort by play time (newest first), cancelled/BYE fall to the bottom, and every row shows a **date + time** (the play time, or the created time — dimmed — for cancelled/BYE). Makes it easy to find the match someone just reported wrong.

## [1.19.2] — 2026-07-26 — Auto-sizer correction (BaLi-specific rounds)
### Fixed
- **Reverted the v1.18.1 round-count change for Swiss / Auto Swiss.** Those formats deliberately target **7 total rounds** for predictable scheduling — 5 Swiss + a 2-round Top 4, or 4 Swiss + a 3-round Top 8 — so the 8+ tier having *more* Swiss rounds than 16+ is intentional, not a bug. The v1.18.1 "monotonic fix" is undone.
- **Balanced Liechtenstein now sizes on its own:** 3 rounds under 8 players, 4 from 8 up (Top 8 almost never applies to BaLi, and its playoff size is the host's choice — independent of the round count). No-shows also no longer inflate a BaLi round count when it re-sizes mid-run.

## [1.19.1] — 2026-07-25 — Fix wrong Ladder / completed-match results
### Fixed
- **A wrong result on a Ladder (Open Play) match can finally be corrected.** The result editor was hidden for Open Play *and* for completed matches, so the All Games tab's "use the match result editor" led nowhere for a ladder game. Hosts / mods / admins now get an **Edit Result** button on any match page (Ladder included, completed included), and the All Games rejection links straight to that match.

## [1.19.0] — 2026-07-25 — No auto-finalise + un-finalise
### Fixed
- **Tournaments are never finalised automatically anymore.** An auto-advance path closed a tournament the moment the last *existing* playoff match finished — and a Top-4 bracket generates the final only after the semis, so the tournament finalised itself **right after the semis**, before a final was ever created. Both automatic-finalise paths are removed; closing a tournament is always a manual host action now.
### Added
- **Un-finalise.** A host/admin can reopen a finalised tournament (COMPLETED → ONGOING). It also undoes the finalisation's placement results and recomputes the season-leaderboard points, so a host can fix the bracket (e.g. play the final that was skipped) and re-finalise cleanly.

## [1.18.1] — 2026-07-25 — Auto-sizer round-count fix
### Fixed
- **Auto-sized round counts are monotonic again** — a mid-size field no longer gets *more* rounds than a large one. The 8+ and 16+ tiers had their round counts swapped (8+ forced 5 rounds while 16+ got only 4); now 8+ → 4 rounds, 16+ → 5.
- **No-shows no longer inflate the schedule** — once check-in has begun, a player who registered but never checked in is treated as a no-show when the tournament re-sizes mid-run (it already was at start). Drops now correctly shrink the round count instead of a phantom head-count keeping it high.

## [1.18.0] — 2026-07-25 — Changelog channel 📜
### Added
- **This channel.** Release notes now land here automatically — after every deploy, RizzBOTto posts what changed, each entry versioned and stamped with the exact time it went live. The full history above was backfilled the moment the channel went online.

## [1.17.0] — 2026-07-25 — Skill-leaderboard win-rate + fairness & robustness fixes
### Added
- **Skill-leaderboard win-rate** — the Skill board now carries a real win-rate column (wins / games from the match-game source) beside the model skill, still ranked by skill. The old standalone Win Rate tab is retired.
### Changed
- **Skill-leaderboard cutoff** raised to 20 games (was 5) — the board no longer lists players with only a handful of games.
### Fixed
- **BaLi bye choice** now minimises play-ups — among the eligible weakest candidates it byes the one that strands the fewest peers into cross-band rematches (the weakest still wins ties).
- **BaLi playoff auto-generation** no longer stalls after a burst of withdrawals — the pairing tick coalesces a dropped trigger and re-runs on the settled field.
- **Start-Playoffs button** is no longer hidden by a cancelled final-round match.
- **Declining a re-join** no longer erases a player's history — a played player who re-requested and was declined is reverted to WITHDREW instead of hard-deleted.

## [1.16.1] — 2026-07-24 — BaLi fairness + display fixes
### Fixed
- **BaLi byes:** the odd-count bye is pre-assigned to the weakest player by handicap-adjusted score *before* the pairing optimum runs — a lone weak player takes a bye instead of a hopeless 3-band play-up.
- **BaLi standings** keep Swiss order in the playoffs; 1st/2nd/3rd badges come only from the top division's final, and each finalist banner is tinted to that player's division.
- **BaLi byes:** a provisional bye reads "BYE · pending" instead of the misleading "Catch-up · 0 pts".
- **BaLi late-join:** the bye reclaim is gated so a late-join pairing is never the round's biggest band-gap (and never an immediate rematch).
- **Open Play:** the front-page heatmap shows matchmaking availability only.
- **Standings:** Free Pick mode keeps "Free Pick" until a host sets a faction.
- **Tournaments:** auto-sized tournaments show "Rounds TBD" before they start.

## [1.16.0] — 2026-07-21 — Atmospheric backdrop
### Added
- A darkened moonlit-ruins painting behind every page (Open Play included), replacing the flat page backdrop.

## [1.15.2] — 2026-07-20 — Discord self-config
### Fixed
- The Discord bot self-configures its guild from its token (env override → auto-detect → fallback), fixing the "not configured" report and a silent login auto-join failure.

## [1.15.1] — 2026-07-20 — Playoff size & idempotent byes
### Changed
- **Playoff size is a host choice** — removed from the BaLi auto-sizer, with a homogeneous-vs-large explanation and a default of Top 2. Fixes 16+ check-ins forcing a single mixed Top-8.
### Fixed
- Undrop / catch-up-bye backfill is idempotent — it skips already-played rounds, and undrop folds a returning player back into the group phase.

## [1.15.0] — 2026-07-18 — Capacity, reports & polish
### Added
- **Minimum-participants target** with a 2×2 capacity layout (start / deadline, min / max) and a soft start-warning the host can override.
- **"Not in Discord" account report** and split **Reports** admin sub-tabs.
### Changed
- Create form reordered — poster first, Discord/stream under the description; the Discord invite is pre-filled.
### Fixed
- Category-2 fixes (calendar "Majors only" wording, division-champion marker, start-check-in warning); **host transfer** (wrong body field → every transfer 400'd); **co-host edit access**; the skill-leaderboard load error.

## [1.14.0] — 2026-07-17 — BaLi 2.0, Faction War, Majors & game tools
### Added
- **BaLi 2.0 pairing engine** — provisional-optimum "commit-when-free" pairing, a progressive/asymmetric band-gap cost, pending-bye reclaim, and a playoff-seeding handicap that discounts wins from lower divisions.
- **Faction War** mode (SFT with globally exclusive factions); a **major-tournament-wins leaderboard** and a **General Skill leaderboard** derived from game data.
- **Per-game override** in the score modal — a non-Bo1 override shows map, factions and winner/draw per game; staff can edit a game's factions/map/winner.
- **Faction pages** gain model matchup favourability + general strength (#13).
- Admin **All Games** goes full-width with a replay column, an editable Official flag, hard-delete, and a game-audit filter.
### Changed
- Both matchup heatmaps unified onto one game-level set; the major tiebreaker uses total game wins.
### Fixed
- Exactly one champion credited per major; playoff-drop notify + walkover; check-in status shown for elimination formats; a round count only shows for round-based formats; bye-vs-bye layout overlap.

## [1.13.0] — 2026-07-16 — Quick-wins, faction timer & majors
### Added
- **Faction-pick timer** surfaced on the game tile and site-wide; **majors leaderboard**; admin **engagement** and **underrated-players** reports; an **"Unrated"** flag for unclassified players; Open-Play match origin (queue vs availability DM); the pairing DM now links to the tournament.
### Changed
- Auto-sizing hides the rounds + playoff-format fields; Free Pick stays in standings and the picker closes when an opponent drops.
### Fixed
- Closed the availability-ping gap that pinged a player mid-tournament; withdrawal DM links to the tournament page; bracket node-edit modal rendered via a portal.

## [1.12.0] — 2026-07-14 — Open-Play anti-abuse ladder
### Added
- **Education-first queue-abuse escalation** — a warning on the first offense, then a gradual level decay logged to the Queue Activity, plus an admin lift of the cooldown from the user profile.
### Fixed
- Pings are muted between rounds in a live real-time tournament; the admin lift drops to level 1 (warned), not a full pardon.

## [1.11.0] — 2026-07-13 — Poster cards, tooltips & The Ladder
### Added
- Tournament **posters on the list cards**, format/mode **tooltips**, and an English "Majors only" label.
- The landing page announces **The Ladder (Open Play)** as live, not "coming".

## [1.10.0] — 2026-07-12 — 1v3 mode + BaLi hardening
### Added
- **1v3 faction mode** (Set Faction vs. one of three counterpicks) with an optional **BO2 two-leg** home/away series (1–1 = Draw).
- Per-division playoff generation for Balanced Liechtenstein.
### Fixed
- BaLi: excluded phantom finalists + zero-point catch-up byes, prevented a late-joiner double bye, took the tournament podium from the top division's playoff (not group rank), and replayed rematch-locked leftovers instead of double-byeing them.

## [1.9.0] — 2026-07-11 — Robust late-join & drop handling
### Added
- Robust late-join & mid-tournament drops for both Balanced Liechtenstein and Swiss.
### Fixed
- Posters resolve to the writable path under systemd; numeric edit-form inputs are coerced so PATCH sends numbers, not strings.

## [1.8.1] — 2026-07-10 — Poster storage hotfix
### Fixed
- Tournament posters are stored outside the repo checkout (so a redeploy can't wipe them).

## [1.8.0] — 2026-07-09 — Late-join requests & host controls
### Added
- **Host-approved late-join requests** — an applicant-facing "Request to join" CTA, a host approval UI, and a per-tournament toggle.
- **Manual host controls (#49):** tournaments never auto-start or auto-close — the host opens and closes both.
- A match's **faction shows on the bracket node** as soon as it is locked (#6); the **stream link** is appended to spectator DMs (#50).
- Admin **skill-level distribution** chart, a calibration reset moved to profiles, and a create-a-bye-match UI.
### Fixed
- BaLi playoffs auto-launch despite lingering SWISS-phase group matches; manually created matches/byes get the format-correct phase; Free Pick "pick later" added to the non-balanced standings dialog.

## [1.7.0] — 2026-07-08 — Free Pick cluster + min-cost BaLi pairing
### Added
- **Enticity's Free Pick** cluster — privacy, faction-first flow, matrix polish.
- **Balanced Liechtenstein pairing** now uses global min-cost matching (#18); dynamic auto-sizing (#40) and a host pre-start drop (#41).
- Delete voided matches (#21); a readable, full-width, full-height bracket; the manual round cap raised to 8; per-tournament Swiss tiebreak; a calibration audit.

## [1.6.0] — 2026-07-07 — Matrix redesign + Free Pick mode
### Added
- **Enticity's Free Pick mode** (SFT/Matrix hybrid, #36); a **Matrix + map-decision redesign** with a red/green vignette (#35, #34, #7).
- Scheduled matchups **expire at their proposed play time** (#28); poster upload in the create form (#32); auto-sizing/auto-advancement externalised from AUTO_SWISS (#37).
### Fixed
- The Free Pick / faction step is chained correctly on BaLi + SFT/2D3 signup; withdrawn players can re-register before start (#30a); BaLi division playoffs auto-launch.

## [1.5.0] — 2026-07-06 — Paket 1 quick wins
### Added
- **Paket 1 quick wins** — standard-rules default, allowlist-aware auto-pick, "viewer left" handling, matrix order/map, header polish, a skill marker, hints, and draw display.
- Matrix ban order follows a balanced 1-2-2-2 pattern; matrix auto-resolve with 30s timeouts and an allowlist-aware pool.
### Fixed
- The Swiss next-round guard respects the configured `rounds_count`.

## [1.4.0] — 2026-07-03 — Balanced Liechtenstein + skill calibration
### Added
- **Balanced Liechtenstein tournament format** — skill-banded divisions with distinct band colours, play-up at registration, per-division playoff brackets, and a top-band seat reserved in each division final.
- **Skill calibration** — an admin-editable, adaptive questionnaire (asks only floor-raising questions) with retuned default floors.
- **Admin user tools** — reset a user's Steam verification, edit profile fields, and delete users (anonymize + release); a full leaderboard on one page with player search; **sticky Steam links** that block a silent account swap.
- The bye player is DM'd each round (encouraging; last-round elimination note).
### Fixed
- Restricted factions are pickable in matrix and blind-pick; BaLi standings columns align across divisions; hosts can find their own draft tournaments.

## [1.3.0] — 2026-07-02 — Open Play on-site reporting + charts
### Added
- **Open Play result reporting moved fully on-site** — the matchmaking DM system was rewritten, Discord result buttons dropped, and mods are notified of on-site disputes.
- **Faction popularity** chart (games played) and an **admin usage-over-time** chart (tournament / ladder / challenge per day); new "Cole's Desolation" empty-state art.
### Fixed
- Challenge heatmaps key on local weekday+hour (not raw UTC); empty-state and ruleset-card alignment.

## [1.2.0] — 2026-07-01 — Poster upload & Open Play polish
### Added
- **Tournament poster upload** with a hero banner and card thumbnail.
- A **read-only match modal** with issue reporting; standard ruleset shown in the queue and challenges; Ladder vs Challenge Open-Play matches distinguished in All Games; the launch countdown replaced with a live queue pulse.
- Match games backfilled for legacy matches.
### Fixed
- Context-aware availability heatmaps + a 3-way Open Play view toggle; playoff Discord pairings labelled by phase; staff can upload Open Play replays; hosts can resolve DISPUTED matches; queue eviction keyed on real join time.

## [1.1.0] — 2026-06-29 — 2D3, min-weight Swiss & the B-batch
### Added
- **2D3 tournament mode** — pick 3 factions, one drawn at random per game.
- **Global min-weight Swiss pairing** — rematch/no-contest hard-avoid, ΔScore² cost, seeded (B8).
- **Per-tournament co-hosts** with full host parity and a server-computed `can_manage` (B12); **NO_CONTEST** double-bye for technical aborts (B10); a **TOP2 playoff format** with an auto-reduce below 8 players (B6).
- **Tournament ruleset** with a standard-rules toggle; a faction allowlist that defaults to all-selected; banned/restricted factions shown on the detail page.
- **Open Play** gets a live queue + availability counter, a community availability heatmap on the create form, a persistent queue activity log, and clickable player/faction mentions app-wide; a global active-match indicator in the header.
- Discord notifications for round 1, all playoff matches, and host drop alerts (B20, B22); Ko-fi donation support.
### Fixed
- Auto check-in during the check-in window + re-register after withdraw (B5, B15); only checked-in players paired in later rounds (B14); undrop restores Swiss forfeits (B1); unified meta game counts (draws count, voided excluded); legacy Kiev→Kyiv timezone canonicalisation (B17).

## [1.0.0] — 2026-06-27 — Public launch 🎉
The Rizzotto public launch, marked by the launch tournament (2026-06-27, 21:00 CEST). Everything before this was Beta (0.x): Discord + Steam auth, tournament creation, Swiss & bracket play, live draft picks, the Open Play ladder, the leaderboard, and the Souls-like/grimdark design system.
