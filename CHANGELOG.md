# Changelog

All notable changes to **Rizzotto** (rizzotto.gg) are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/); the platform ships continuously to `main`, and each deploy wave carries its own version.

**Versioning** (SemVer, adapted for continuous deploy): `Fix → patch (1.x.Y)` · `Update / new capability → minor (1.X.0)` · `New pillar → major`. **v1.0.0** = the public launch (2026-06-27, 21:00 CEST); everything before was Beta (0.x). Every deploy wave since launch is versioned below, oldest at the bottom.

## [1.51.0] — 2026-09-04 — Message your participants
### Added
- **Hosts can now send a direct message to everyone in their tournament, straight from the tournament page** (great for a quick "we start in 15 minutes, please check in"). The bot delivers it, with a short header saying it is from the host of that tournament. Admins have a matching tool for wider community announcements. To avoid noise, a broadcast is limited to one per hour.

## [1.50.2] — 2026-09-04 — Consistent poster aspect ratio
### Fixed
- Tournament posters now display at a single, consistent 10:3 aspect ratio everywhere (the create and edit previews, the tournament page, and the browse cards), so a poster is cropped the same way in every place. Previously each surface used a different height, so the upload preview did not match how the poster actually appeared.

## [1.50.1] — 2026-09-03 — Tournament setup and browsing fixes
### Fixed
- The tournament browse tab now lists upcoming tournaments soonest-first, matching the landing page (it was showing the furthest-out ones first).
- Corrected the Balanced Liechtenstein auto-size hint: it now reads 4–7 players → 3 rounds, 8+ → 4 rounds (it previously showed a wrong 5-round tier).
### Changed
- When creating a tournament, the default start time is now **today at the next full hour** instead of tomorrow evening, so same-day events are no longer scheduled for the next day by accident.

## [1.50.0] — 2026-09-02 — Admin tooling
### Changed
- Refinements to the behind-the-scenes announcement tooling for tournament operators. No player-facing changes.

## [1.49.0] — 2026-08-31 — Admin tooling
### Added
- Behind-the-scenes attribution reporting for tournament operators, so we can see which communities our announcements actually reach. No player-facing changes.

## [1.48.0] — 2026-08-30 — Admin tooling
### Added
- More behind-the-scenes tooling for tournament operators. No player-facing changes.

## [1.47.0] — 2026-08-30 — Balanced Liechtenstein: manual pairing is locked to protect the bracket
### Changed
- **In Balanced Liechtenstein, hosts can no longer hand-edit pairings — the format pairs players automatically, and manual edits were silently breaking brackets.** BaLi decides each player's next round from how many rounds they've completed; filling a bye, swapping a player, or creating/deleting a match by hand desynced that count and cascaded into phantom byes that wrecked the whole bracket (for example, forcing two resting players across a large skill-band gap into a match — which the engine deliberately avoids, both to keep rounds fair and to stop a playoff contender from picking up a cheap win). Those structure-editing actions (fill-bye, swap-player, create/delete match, full-reset, backfill) are now disabled for hosts in BaLi, with a clear message; admins keep them for emergency repair but must explicitly confirm each one. Correcting a result, forfeits/no-contest, and the normal drop/withdraw flow are unchanged — they never touched the auto-pairing.

## [1.46.0] — 2026-08-29 — Admin tooling
### Added
- Behind-the-scenes tooling for tournament operators. No player-facing changes.

## [1.45.0] — 2026-08-29 — Tournament event log: a durable, timestamped record of everything that happens
### Added
- **Every tournament now keeps a durable, append-only event log, and a new Admin "Tournament Log" tab lists all tournaments — click one to see a timestamped timeline of everything that happened to it.** It records joins, check-ins, drops/withdrawals and undrops; match creation (Swiss, Balanced Liechtenstein, the bracket formats, and manual matches), match completion and replay disputes; playoff plan freezes and division generation; and every host action — start, finalise/unfinalise, bracket reset, forced playoff generation, the match overrides (void, restore, cancel, forfeit, no-contest, full-reset, backfill, swap, resolve-dispute, per-game override), tournament edits, host transfer and co-host changes. Each entry captures who did it, who was affected and a compact detail payload, so a forensic question like "why did this player miss the playoffs?" becomes a single query instead of detective work. The log is forward-only (it captures events from when it goes live) and covers tournament matches only (Open Play is excluded).

## [1.44.0] — 2026-08-28 — Balanced Liechtenstein playoffs: one bracket until a second is truly full, and no stranded players
### Fixed
- **A skill band that is too small to be its own playoff bracket no longer gets a downgraded mini-bracket beside a full one — everyone shares one bracket until the field can support a second full one.** With TOP8 chosen, a division needs 16 players; a leftover group of, say, 7 was being kept as its own downgraded TOP2 division next to the TOP8. Now a trailing group that can't reach the host's chosen size (16 for TOP8, 8 for TOP4) merges up into the one division, so a 28-player TOP8 forms a single 24-strong bracket and a second bracket appears only once there are enough players for two full ones.
- **A player can no longer be dropped from every playoff bracket by a late join-and-leave.** When a borrowed player left after the top bracket was already generated, the frozen plan would re-borrow the next band's leader up into that already-fixed top bracket — placing them nowhere while also removing them from their own bracket. An already-generated division now only keeps the players actually seated in it; anyone it would newly borrow stays available for their own bracket, so a division leader with a perfect record can never end up in no playoff at all.

## [1.43.0] — 2026-08-27 — Supporter badges now show across the whole site
### Added
- **Supporter badges now appear next to a player's name everywhere their name shows, not just on their profile.** You will now see them on every leaderboard tab (Season, All-Time, Majors and Skill), in tournament participant lists, in Swiss and elimination standings, and on the match page. To keep the ranking tables clean, dense rows show only the single highest tier a player holds (one small icon), while the match page and the Hall of Fame still show the full set. Every icon keeps its plain-language tooltip (Supporter, Lord, Champion), so the recognition follows supporters into the parts of the site people actually look at.

## [1.42.0] — 2026-08-26 — The funding bar now updates itself from Ko-Fi
### Added
- **The on-site funding progress bar now tracks the Ko-Fi goal automatically, no manual updates needed.** A background job reads the public Ko-Fi page every 30 minutes (its goal percentage and target are server-rendered) and mirrors them into the site's bar, so it stays in sync with Ko-Fi (the seeded head start included) as donations come in. It is fail-safe: if the fetch or parse ever fails, the bar keeps its last value instead of breaking, and the admin funding-goal field still works as a manual override.

## [1.41.0] — 2026-08-26 — Ko-Fi funding drive: goal bar, supporter badges, Hall of Fame
### Added
- **The Arena now runs a Ko-Fi funding drive on the site, with a goal progress bar, supporter badges and a Supporter Hall of Fame.** A prominent funding band sits at the top of the landing page (above the hero) and on the /support page, showing a live progress bar toward the goal and linking straight to Ko-Fi. Supporters are recognised with cumulative badges (Coffee for Supporter, Crown for Lord, Trophy for Champion), each with a plain-language tooltip, shown next to their name on their profile and collected in a Supporter Hall of Fame on /support. A new admin "Supporters" tab manages it all: an always-visible list of current supporters, user search, per-user tier checkboxes, the funding goal (amount raised and target), and an optional Discord role mapping. Recognition is admin-granted by default, and the optional Discord-role sync stays a safe no-op until role IDs are set.

## [1.40.0] — 2026-08-25 — The Standard Ruleset is now editable in Admin → Settings
### Added
- **Admins can now edit the community Standard Ruleset from Admin → Settings.** The Settings, Banned Units, and Conduct lines shown on tournaments (when Standard Rules are enabled), in the Open Play queue, and on challenges were previously hard-coded. There is now a Standard Ruleset editor (one entry per line, with a live preview) that saves the ruleset centrally; the card everywhere reads the saved values and falls back to the original defaults until an admin changes them, so nothing looks different until you edit it.

## [1.39.3] — 2026-08-25 — Hosts are told when players settle a replay dispute themselves
### Added
- **When two players resolve a replay dispute by agreeing on the replay's values, the host (and co-hosts) now get a short "resolved by agreement — no action needed" DM.** Previously this auto-resolution was silent: a host who had a disputed game on their radar had no signal that the players had already settled it (applying the replay's map + factions). The notification names both players and the applied map/factions and links to the match. Only player-settled replay disputes trigger it — ordinary agreed results (no dispute) still send nothing, so hosts are not spammed.

## [1.39.2] — 2026-08-24 — Replay disputes: clear side-by-side, resolve onto the replay's map
### Fixed
- **A replay mismatch now shows a clear "Site says / Replay says" side-by-side, and resolving applies the replay's map + factions automatically.** Two problems: (1) the reporter (and the opponent/host) only saw a terse "Reported X — replay shows Y" line — now the differing map and factions are shown as an explicit side-by-side compare, and the reporter picks which is correct (the replay is right → apply it and the opponent confirms; the report is right → explain for host review; wrong file → re-upload). (2) When a host resolved a dispute, only the winner was set — the site's generated map and factions stayed, so the map had to be hand-corrected through the override modal every single time. Resolution now applies the replay's attributed map + factions (the replay is the ground truth for what was played), and those values are preserved through an opponent rejection so the escalated host resolution still lands on the correct map.
- **A reclaim never re-pairs two players who just faced each other.** Filling a freed player into another's provisional bye (e.g. after a drop) skipped the immediate-rematch check unless a still-catching-up late joiner was involved, so an ordinary reclaim could pair two players who had just met. The hard block on an immediate rematch now applies to every reclaim, catch-up or not.

## [1.39.1] — 2026-08-24 — Balanced Liechtenstein pairing: no forced rematch, waiting players get matched
### Fixed
- **Two players who just faced each other are never paired again in the very next round.** In Balanced Liechtenstein, when such a pair happened to finish a round *last* — with everyone else already paired — the engine could be left with only the two of them and fall back to an immediate rematch. Root cause: the rule "only commit a pairing that fits an optimal bracket" was enforced on a secondary pass only, while the primary pass could commit a cheap same-band pair that belonged to no optimum and stranded the two. That check now governs *every* committed pairing, so a still-playing pair always has fresh opponents held for them and the forbidden rematch can no longer form.
- **Two waiting players are now paired automatically instead of both sitting out.** When one player rested on a provisional bye and another was a late joiner catching up — both at the same round — the engine only rescued a *freshly*-byed player into an existing bye, so two already-resting players (e.g. a drop survivor and a late joiner) stayed unmatched and a host had to build the match by hand. The pairing tick now reconciles two resting same-round players into a real match whenever it is a legal pairing, so nobody is needlessly left idle.

## [1.39.0] — 2026-08-22 — Tournament entry uses the skill band shown on your profile
### Changed
- **The skill band on your profile is now exactly the band that decides which restricted tournaments you can enter.** Entry gates (and the "You are rated as X" line) previously used a separate, deliberately-conservative internal band that only ever moved up and lagged ~100 games behind real results — while your profile and Balanced Liechtenstein seeding already used your live competition band. They are now one and the same: entry gating reads the competition band shown on your profile. Together with the v1.38.0 soft-floor, a player who out-performs their questionnaire climbs out of beginner/intermediate-restricted tournaments quickly, and what you see is what governs your access. The data-only skill leaderboard is unchanged; the old conservative band is retained internally for admin diagnostics only.

## [1.38.0] — 2026-08-21 — Skill classification: climb fast, fall slow
### Changed
- **Players who perform above their questionnaire level now rise in recognised skill much faster, while a bad run no longer drags anyone down quickly.** The questionnaire used to act as a symmetric anchor worth ~50 games, so a genuinely strong player who answered modestly stayed seeded near their claim for well over a hundred games before the results caught up. It is now an asymmetric **soft floor**: results *above* your questionnaire overtake it in ~10–30 games (so sandbaggers and fast improvers get recognised quickly), while results *below* it are resisted (~60+ games), so a rough patch only slowly pulls you under your own baseline. This affects only the recognised skill rating and Balanced Liechtenstein division seeding — **tournament entry rules and how you register are unchanged.**

## [1.37.6] — 2026-08-21 — Balanced Liechtenstein reseed keeps the cross-band handicap
### Fixed
- **When a Balanced Liechtenstein player drops out of a division semi/final, the freed seat now goes to the correct next player.** Filling a vacated playoff seat re-ran the cross-band seeding handicap (which discounts a lower-band player borrowed up into a higher division) with a round count that could silently fall to 1 when a tournament's stored round count was unset — a quarter of its proper strength. With the handicap that weak, a lower-band player with a slightly better raw record could jump ahead of a higher-band player who should have held the seat (a band-3 raw-2 player displacing a band-5 raw-1 player). The reseed now floors the handicap at the rounds actually played, so it can never collapse, and both reseed paths (automatic walkover backfill and the host's manual "backfill next seed") use the same guarded value. Added diagnostic logging of every reseed decision.

## [1.37.5] — 2026-08-20 — Fair Solkoff tiebreaker across byes and late joins
### Fixed
- **The Solkoff tiebreaker no longer hands a player with a bye an unfair advantage.** Solkoff (Buchholz minus the single highest and single lowest opponent score) was only trimmed for players with 3+ opponents — so anyone with a bye, a No Contest double-bye or a late-join catch-up (and therefore fewer real opponents) kept their *untrimmed* Buchholz as their Solkoff, which almost always beat a properly-trimmed opponent. Every non-played round now counts as a virtual 0-score opponent, so all players have the same opponent count and Solkoff always drops one top and one bottom score. Buchholz is unchanged — a bye still only "costs" the missing opponent's points, never more.

## [1.37.4] — 2026-08-19 — "No Contest" is now visible in the bracket
### Fixed
- **A match resolved as "No Contest" now actually shows it in the bracket.** A no-contest (a technical-abort double-bye — both players advance, no winner) was applied correctly under the hood but rendered like an unplayed match: no label, no marker, indistinguishable from a pending game. The bracket node now reads as a no-contest — a dashed border with a "No Contest" badge and both players kept (neither is marked out), matching how byes are shown.

## [1.37.3] — 2026-08-19 — Balanced Liechtenstein playoff size is a true ceiling
### Fixed
- **A Balanced Liechtenstein host's chosen playoff size (e.g. Top 2) is now a hard ceiling and is never silently upgraded to a bigger bracket.** Each division's bracket was sized purely by that division's player count — so a Top 2 tournament with a large same-skill-band division (say 12 players in one band) still generated and previewed a Top 4 bracket, quietly making the tournament run longer than the host intended. The division bracket is now capped at the host's choice: Top 2 stays Top 2 however big a division grows, and Top 4 only ever *downgrades* to Top 2 for a small (<8-player) division — the same ceiling rule the Swiss/Auto-Swiss playoffs already follow. (This is separate from v1.37.1, which stopped the auto-sizer overwriting the stored size at start.)

## [1.37.2] — 2026-08-19 — Check-in reminders now actually reach everyone
### Fixed
- **Check-in reminder DMs now go out for every tournament format, even while registration is still open.** The T-60min reminder only fired for tournaments already in the "registration closed" state (or, separately, for Auto-Swiss while open) — but hosts keep registration open until start to welcome last-minute entries, so in practice the reminder never fired for the manually-run formats (Swiss, Balanced Liechtenstein, Free Pick, elimination…). It now DMs every still-registered (not-yet-checked-in) player in the hour before start, whether registration is open or closed, once per player (deduplicated).

## [1.37.1] — 2026-08-19 — Balanced Liechtenstein keeps the host's playoff size
### Fixed
- **A Balanced Liechtenstein tournament no longer flips the host's chosen playoff size from Top 4 to Top 8 when 16 or more players join.** Starting an auto-sized tournament reused the Auto-Swiss sizing table, which derives a Top 8 playoff at 16+ players — and for Balanced Liechtenstein that silently overwrote the host's deliberate Top 4 choice at start. The playoff size shapes the divisions (Top 4 = homogeneous, band-pure divisions; Top 8 = fewer large mixed brackets), so it must stay the host's call. Auto-sizing now only shortens the round count for Balanced Liechtenstein (3 rounds under 8 players, 4 from 8 up) and never touches the playoff size.

## [1.37.0] — 2026-08-18 — Faction War: fair, varied elimination-bracket seeding
### Added
- **Faction War now seeds elimination brackets for fair faction matchups — and varies them between tournaments.** Faction-War Swiss rounds were already balanced for fair faction-vs-faction duels, but Single and Double Elimination were seeded faction-blind, so a bracket could open with lopsided matchups. Both formats are now seeded so that **every player's opening game is as close to a 50/50 faction matchup as the ratings allow** — and for the players who sit out round 1 on a bye, it looks one round ahead, balancing their round-2 game against *both* possible opponents rather than just one. Instead of always producing the single mathematically-optimal bracket, it picks at random among the (up to five) equally-fairest brackets, so a recurring same-faction field doesn't always draw the identical matchups. The choice is fixed per tournament (the same tournament always seeds the same bracket), and only Faction War is affected — every other mode is untouched.

## [1.36.3] — 2026-08-17 — Open Play faction-pick timer really is 5 minutes now
### Fixed
- **The Open Play (ladder) faction-pick page now actually shows 5 minutes, not 2.** The previous fix used the tournament mode to tell Open Play apart from a Blind Pick Tournament — but an Open Play match reports the same mode, so the pick page kept showing the 2-minute tournament countdown on the ladder. The decision now carries an explicit Open-Play flag, so the countdown correctly reads 5 minutes on the ladder (then the match is cancelled) and 2 minutes in a tournament (then a random faction is auto-assigned).

## [1.36.2] — 2026-08-17 — Remove the auto-swiss "repair" that could corrupt elimination tournaments
### Fixed
- **A completed elimination tournament can no longer be silently converted into an Auto-Swiss with bogus playoffs.** A legacy startup "repair" — meant for old mis-saved Auto-Swiss tournaments — used too broad a rule and, on a server restart, could mistake a finished Single/Double-Elimination tournament for a stuck one, flip its format, and generate a spurious playoff bracket. That repair (and its manual admin counterpart) has been removed entirely, and an admin recovery action restores any tournament it already affected — without ever touching the original bracket's results.

## [1.36.1] — 2026-08-17 — Faction-pick timer: 5 min on the ladder, 2 min in tournaments
### Fixed
- **The blind faction-pick timer is now consistent everywhere: 5 minutes in Open Play (the ladder), 2 minutes in a Blind Pick Tournament.** The pick page always showed a 2-minute countdown regardless of context, so Open Play looked like it still only gave 2 minutes even though the ladder actually cancels a no-show after 5 — and the tournament side had drifted to 5 minutes. Every surface now agrees: the pick-page countdown, the game-tile countdown, the deadline reminder and the server-side auto-resolve all use 5 minutes on the ladder (then the match is cancelled and the no-show penalised) and 2 minutes in a tournament (then the missing side is auto-assigned a random faction, so the bracket keeps moving).

## [1.36.0] — 2026-08-16 — Hosts see committed factions & divisions before start
### Added
- **Hosts can now see which factions players have committed to before a tournament starts.** For SFT, Free Pick and Faction War, a player's chosen faction stays hidden from everyone during registration so nobody can counter-pick — but the host, co-hosts, moderators and admins now see the committed factions on the roster ahead of the start. (Regular players still see nothing until it begins.)
- **Balanced Liechtenstein rosters now show each player's chosen division before start.** The host sees a "Div N" marker per player on the pre-start participant list, so it's clear who has signed up into which division (and whether a division is over- or under-subscribed) before the group phase is generated.
### Fixed
- **Faction War tournaments can be edited again once registration is open.** Saving any edit (even just a description tweak) on a Faction War tournament failed with `"mode" can only be changed while the tournament is in draft`, because the edit form didn't recognise the Faction War mode and silently tried to switch it to BPT. The form now knows the mode, and the backend only blocks a *genuine* change to a structural field — re-saving the unchanged mode is a no-op.

## [1.35.2] — 2026-08-13 — Double-Elimination loser-bracket seeding
### Fixed
- **Double-Elimination brackets no longer force early loser-bracket rematches.** When you lost in the winners bracket you could be dropped straight back onto someone you'd just beaten (or lost to) in the very next loser-bracket round — a seeding flaw, not bad luck. Winners-bracket losers now cross-seed into the loser bracket in reversed order, so two players who met in the winners bracket can't meet again until the loser final at the earliest. (Rematches deep in the loser bracket, where the two halves converge, are unavoidable and still possible — as they are in any double-elimination format.)

## [1.35.1] — 2026-08-13 — Popularity-bar colours
### Fixed
- **The segmented popularity bar's colours now read the right way round.** The faction's main bar (everyone else) is the standard gold, and the single most prolific player's share is the darker carved-out slice — instead of the reverse.

## [1.35.0] — 2026-08-13 — Segmented faction popularity & Open Play no-show penalty
### Added
- **The Factions popularity bar is now segmented by its most prolific player.** Each faction's bar shows — as a highlighted segment — how many of its games were played by the single player who plays it most; hover to see that player's name and count (e.g. Dark Elves: most RAD|ponti, 310). It's now obvious when a faction is carried by one specialist versus spread across the field.
### Changed
- **Open Play no longer auto-picks a random faction when you're slow — it cancels the match instead.** The blind faction pick is the one interaction that matters, so if a player hasn't picked within 5 minutes (was 2) the match is cancelled, both players are freed back into matchmaking, and the player who didn't pick takes a queue-abuse escalation step. The ladder — shared with queue-ghosting and decaying over clean time — is now explicit: warning → 1h → 24h → 7 days → permanent (until an admin lifts it). Whoever did pick walks away with no penalty. (Blind Pick Tournaments keep the random-faction fallback, since a tournament match must produce a result.)

## [1.34.1] — 2026-08-13 — Bracket-preview & ladder-stats fixes
### Fixed
- **Balanced Liechtenstein playoff previews no longer vanish when the first division generates.** The in-bracket "TBD" preview was all-or-nothing — the first generated division hid the previews for all the others. Generated and not-yet-generated divisions now render together in one band-ordered stack (each slot is either the real bracket or a placeholder), so the remaining divisions stay previewed until each one is ready.
- **The admin "usage over time" chart no longer undercounts ladder games.** The Ladder line counted only queue matchmaking and dropped availability-calendar matches entirely (e.g. 2026-08-11 showed 13 instead of 31 ladder games). Ladder now counts both queue and availability matchmaking; only a targeted challenge stays its own line.

## [1.34.0] — 2026-08-12 — Faction War fair pairings & in-bracket playoff preview
### Changed
- **Faction War now pairs every round for the fairest faction matchups.** Each round is optimised so the faction-vs-faction duels land as close to 50/50 as the data allows — using the skill-adjusted matchup rating (opponent strength removed) rather than the raw win-rate. The opening round is driven purely by fairness; later rounds keep the Swiss standings primary and use fairness only to break ties. Faction pairings with no game history are avoided rather than treated as an even guess.
- **Projected playoffs now show inside the bracket.** During a Swiss or Balanced Liechtenstein group phase, the upcoming playoff rounds appear as greyed-out "TBD" placeholder nodes directly in the main bracket tree — replacing the old separate preview box — so the whole tournament shape is visible at a glance and fills in as the group phase ends.
### Fixed
- **Hardened Swiss round pairing against a rare crash.** The bracket-matching engine behind every Swiss round could throw on certain pairing constellations; the issue surfaced while building the Faction War fairness pairing and is now patched, so round generation can't fail on it.

## [1.33.1] — 2026-08-11 — Open Play dispute-flow fixes
### Fixed
- **The "the replay is correct" prompt no longer flickers away.** When your reported replay didn't match, the prompt with its three options (upload the right file / "the replay is correct → ask opponent" / explain) could vanish on the next background refresh, leaving only a single button. It now stays put until you pick an option.
- **Open Play matches no longer show tournament points.** A stray points number (a Swiss-scoring value) was shown next to Open Play players; only the game score (e.g. 0–1) belongs there, so the points are now hidden in Open Play.

## [1.33.0] — 2026-08-11 — Skill-gated tournaments, faction analytics & UX polish
### Added
- **Hosts can gate a tournament by skill band.** When creating or editing any tournament, a host can set a min/max skill-band range — only players whose band falls inside it can register. Players who haven't been classified yet are asked to complete the quick skill questionnaire first, then the gate applies.
- **The Factions page gained two new charts.** Alongside Popularity (games played), there are now Model Strength (skill-adjusted win-chance) and Win-rate charts, and each faction tile shows its Model Strength as a percentage — the same figure as on the faction page.
- **Balanced Liechtenstein hosts can turn the third-place match off.** Each division's small final used to be forced on; it's now a toggle (default on) in the create and edit forms.
### Changed
- **The landing page orders live tournaments more sensibly.** Ongoing tournaments stay pinned at the top; upcoming ones are now sorted soonest-first instead of newest-first.
- **In Open Play, entering a lobby code auto-fills the password with `123`** (still editable), so a freshly shared lobby is always joinable.
- **In 2D3, the drawn faction now shows on the bracket node as soon as it's rolled** — previously it only appeared after the game was reported.
### Fixed
- **The Swiss playoff preview now shows the format you'll actually get.** With fewer than 16 (or 8) checked-in players it previews Top 4 (or Top 2) live as the field changes, instead of a ghost Top 8.

## [1.32.3] — 2026-08-11 — Set the map when overriding an Open Play result
### Fixed
- **The result-override modal now lets you pick the map for Open Play / Ladder matches too.** It loaded maps only from a tournament's pool, so overriding an Open Play result showed the factions and winner for each game but no map selector at all. It now falls back to the full map list when the match isn't part of a tournament.

## [1.32.2] — 2026-08-11 — Open Play replay disputes: resolvable, never a dead-end
### Fixed
- **An Open Play replay dispute can now actually be resolved.** Open Play has no tournament host, so a disputed replay had no owner — the game just sat on "waiting for host to resolve" with no way forward, for anyone. Staff can now resolve Open Play disputes directly (the one-click "approve the result" that already exists for tournaments), and every escalation reliably pings the right people: mods/admins for Open Play, the host for a tournament (previously some escalations notified no one at all).
- **The opponent always gets a say now.** When a reporter says their replay is correct, the opponent is always asked to confirm or reject it — before, depending on how the mismatch was flagged, the opponent could be stuck with only a "waiting" message and no button. An unreadable replay goes to staff for review (who are notified), and the opponent sees a clear "under review" note rather than a silent dead-end.

## [1.32.1] — 2026-08-09 — Replay dispute: resolve it where you report
### Changed
- **The "the replay is correct → ask my opponent to confirm" step now sits right in the game tile** where a replay mismatch appears — so you no longer have to open the separate match page to start it.

## [1.32.0] — 2026-08-09 — Double Elimination: bracket reset (true double elim)
### Added
- **Double Elimination now plays a bracket reset.** If the Losers-bracket finalist wins the Grand Final, a second, decisive final is played — both have one loss at that point, so it's only fair. The Winners-bracket finalist, who reached the final undefeated, still needs just one win. It's **on by default** for new Double Elimination tournaments and can be toggled off (a single Grand Final) when creating or editing one; you can also give the reset match its own Best-of (default: same as the Grand Final).

## [1.31.1] — 2026-08-09 — Reopen registration button
### Added
- **A "Reopen registration" button** now sits next to "Start tournament" once registration is closed — so undoing an accidental close is a click, no console needed.

## [1.31.0] — 2026-08-09 — Replay disputes resolve themselves
### Added
- **A replay that doesn't match the report is now sorted out by the players, not stuck waiting for a host.** When the factions or map in your uploaded replay don't match what you reported, you can either replace the file or say "the replay is correct" — the platform reads the replay's actual factions and map and asks your opponent to confirm it's the game you played. On confirm, those values are applied and the result is recorded (the reported winner stands — a replay can't tell who won, and your opponent would reject it if it were wrong). An ambiguous replay (e.g. a Chaos-god matchup that can't be read cleanly) or a rejection goes to a host, who now has a one-click "approve the result" that finalises the game and completes the match. In Open Play, if your opponent never responds you can escalate to an admin — which frees you both to queue again.

## [1.30.3] — 2026-08-09 — Edit a bracket's Semis & Grand Final format
### Fixed
- **Editing a Single/Double Elimination tournament now exposes the Semis and Grand Final formats**, not just the base Match format — the same three you can set when creating it.

## [1.30.2] — 2026-08-09 — Balanced Liechtenstein: No Contest fairness
### Fixed
- **A No Contest frees both players for the next round immediately** — previously they were only re-paired on the once-a-minute safety-net pass, so it looked like nothing happened.
- **A No Contest now counts as a rest-bye.** It is a double-bye (both players get a bye point with no decisive game), so a player who has had one is no longer also handed a free bye on top — which had let a player reach the semi-finals on two bye points and no wins.

## [1.30.1] — 2026-08-09 — Reopen a tournament's registration
### Fixed
- **A host can undo an accidental "close registration".** Registration status was strictly one-way; reopening (Registration closed → Open registration) is now allowed — safe because no matches exist before the tournament starts.

## [1.30.0] — 2026-08-09 — Balanced Liechtenstein: division playoffs stay stable when the field changes
### Fixed
- **Once the first division's playoff starts, the playoff structure is locked in.** Previously a drop after playoffs had begun could re-shuffle how the remaining divisions were formed — in the worst case a small lower division folded into an already-running upper one and its players were left with no bracket at all. Now the structure (how many divisions, their skill anchors and target sizes) is frozen the moment the first division generates; only the membership flexes, and a division that comes up short pulls the nearest replacement from a neighbouring division — the just-missed players first — instead of stranding anyone.
- **A seat vacated before it's played is refilled, not walked over.** When a seeded player withdraws before their playoff match has been played, the surviving opponent's "we didn't play" now reseeds the next eligible player from that division's own pool into the slot, rather than handing out a free walkover. A player who never won a group game (an organic 0-point record) still counts toward a division's size but is never given a bracket seat.

## [1.29.0] — 2026-08-08 — Balanced Liechtenstein: host force-playoffs + pairing/playoff robustness
### Added
- **Hosts can force a single division's playoff early.** In the playoff plan preview each division now has a "Force generate" control — seeded from the current standings — for when a division is still waiting on another skill band or failed to generate on its own. It shows the current seeds, warns you exactly which players are still playing, requires an explicit override for a blocked division, and asks a second confirmation before it commits. Ready divisions still generate on their own; this is the manual escape hatch.
### Fixed
- **Playoffs no longer get stranded after a manual fix.** Forfeiting a match, or creating/deleting a match by hand, now re-runs the pairing step — so completing the field manually generates the playoffs instead of leaving them stuck. (Previously only the normal result-report path triggered generation, which is why a manually-dropped no-show could leave playoffs un-generated.)
- **A far-band mismatch that a better pairing could avoid is gone.** In the last group round the engine could strand the lone top-band player into a three-band play-up, because the "never bye twice" rule wasn't known to the incremental matcher. A player who can't take another bye is now force-matched, so the pairing picks the minimal-gap option instead.
- **The semi-final drop replacement now comes from the right pool.** When a semi-finalist withdraws, the backfill pulls the next seed from that division's actual pool — which can span several bands because a short division borrows from below — rather than only the survivor's own band.
- **A safety net regenerates stuck playoffs on its own.** Once a minute a reconciler re-checks every running Balanced Liechtenstein tournament and generates any playoffs a missed trigger left behind. It's idempotent (never double-creates) and a no-op mid-round.

## [1.28.4] — 2026-08-07 — Balanced Liechtenstein: three live-tournament pairing & playoff fixes
### Fixed
- **A caught-up late joiner is no longer shoved into a big skill mismatch.** The "never bye twice" rule was counting a late joiner's 0-point catch-up bye as a real rest, so a player with no peer in their own band got force-matched three bands up instead of resting. Catch-up byes no longer count toward that rule, so the pairing keeps the band gap minimal.
- **You can't be handed an immediate rematch out of a still-running match.** While two players were still playing their current-round match, the engine hadn't yet registered them as opponents, so it could pair them again the very next round. An ongoing match now counts as already-played for rematch avoidance.
- **"Start playoffs" no longer fails on a division that had matches removed.** Generating the division playoffs could collide on an internal match number when earlier rows had been deleted, which blocked the button. Numbering now accounts for those removed rows.

## [1.28.3] — 2026-08-04 — Replay verification: stop false-flagging honest reports on clan tags
### Fixed
- **A correct replay is no longer flagged as "not matching" because of a clan tag.** The game strips bracket characters when it records a name (Steam `[-ODM-] flower` is saved as `-ODM- flower` in the replay), so the exact-name check wrongly told honest players their replay didn't match. The player check now compares your current Steam name against the names the replay actually recorded on an alphanumeric basis (brackets, pipes and spacing ignored), and only flags when *neither* reported player appears — a genuine wrong-replay upload. A single rename or tag change no longer trips it.

## [1.28.2] — 2026-08-04 — Admin replay audit: reliable per-player faction (ESF tree parse)
### Changed
- **The replay audit now reads each player's actual handle and faction straight from the replay's structure**, and lists the two factions the replay contains — so at a glance you can tell a rename (same person, different spelling) from a faction misreport from an entirely wrong replay.
- **Per-player faction is now reliable (~98%), not a guess.** The attribution added in 1.28.1 located players by text proximity, which validated at scale to only ~60% (a coin flip — the replay doesn't place a player's name next to their own faction). This replaces it with a real ESF tree walk that pairs each army with its player through the file's actual record structure — verified 8/8 on labelled replays and 229/233 across production games, where the few misses are genuine wrong-replay uploads or Chaos-god ambiguity (exactly what the audit should surface).

## [1.28.1] — 2026-08-04 — Admin replay audit: per-player faction attribution
### Changed
- **The admin replay-audit now reports, per player, the faction they actually had in the replay** (attributed by locating the player next to their own army) and whether their Steam name is present — alongside the reported name/faction. Makes it clear at a glance whether a flagged game is a rename, a faction misreport, or an entirely wrong replay.

## [1.28.0] — 2026-08-04 — Admin: search the All Games list
### Added
- **The admin All Games list is searchable.** One smart box: type player names to find their games (e.g. `RizzOtto Welshlion` for a head-to-head), or use operators — `winner:`, `map:`, `faction:`, `tournament:` (and a bare `ladder` for Open Play) — combined and case-insensitive, so a specific game is easy to locate and fix. Searches the whole history server-side, not just the current page.

## [1.27.1] — 2026-08-04 — Replay uploads: .replay only
### Fixed
- **Only the real `.replay` extension is accepted now.** The upload picker and validator previously also allowed `.rec`/`.wrep` — extensions Total War: Warhammer doesn't actually export. Tidied to `.replay` only (the ESF signature check remains the real gate).

## [1.27.0] — 2026-08-03 — Replay verification
### Added
- **Uploaded replays are now verified against the reported game.** When you report a result, the replay is checked against what was recorded — the **factions**, the **map**, the **players** (via their Steam names) and the **recording time** (so an old replay can't be recycled). If everything matches, nothing changes. If the replay doesn't match, you're shown exactly what's off and can either **upload the correct replay** or, if the report really is right (e.g. you agreed to play a different matchup), **explain the deviation** — which holds the game for a host/admin to review and notifies your opponent. In Open Play a held result doesn't lock you: both players are free to queue again while it's pending. Verification is fail-open — it never blocks an honest report on a parser hiccup.
- **Admin: a one-shot replay audit** (`/api/admin/replay-audit`) runs the full verification across every stored replay to surface historical discrepancies — validated over 2209 real replays (94% clean, the flags a mix of genuine wrong-replay uploads and known-ambiguous Chaos-god matchups, which the engine now deliberately doesn't false-flag).

## [1.26.2] — 2026-08-02 — Replay uploads are validated
### Fixed
- **Security: replay uploads are now checked.** Both upload paths accepted *any* file — a player could upload a `.jpg` in place of a `.replay` and it was stored and served. An upload must now be a real Total War replay: a `.replay`/`.rec`/`.wrep` name **and** the actual ESF file signature, so a renamed image is rejected too.

## [1.26.1] — 2026-08-02 — Visibility editable in the Edit dialog
### Fixed
- **The Edit Tournament dialog now lets you change Public/Private after the draft too** — the dropdown was still disabled ("Locked — registration is open") for non-draft tournaments, mirroring the old rule. It matches v1.26.0 now: a host can flip visibility any time from the dialog, no console needed.

## [1.26.0] — 2026-08-02 — Change tournament visibility any time
### Changed
- **A host can now switch a tournament between Public and Private at any time**, not only while it's a draft. Visibility is a pure access flag (it doesn't touch matches or standings), so locking it to the draft stage was needless — run a tournament private during setup and flip it public on announcement, or hide a finished event. Format and mode stay draft-only (those are structural).

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
