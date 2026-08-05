### v1.1.0 (Jun 29 2026) [d0a77ca..ae0d6fa]
feat: add Ko-fi donation support
fix: honor configured rounds_count when starting playoffs
feat: add 2D3 tournament mode (pick 3 factions, one drawn at random per game)
fix: widen tournament game history page to stop horizontal overflow (B2)
fix: offer Europe/Kyiv and normalize legacy Europe/Kiev in profile timezone (B17)
fix: live-refresh tournament view on status change (B7)
fix: exclude maps already played by either player from RANDOM_PICK_BAN sub-pool (B4)
feat: auto check-in during check-in window and allow re-register after withdraw (B5, B15)
fix: pair only checked-in players in later Swiss rounds (B14)
feat: Discord notifications for round 1, all playoff matches, and host drop alerts (B22, B20)
feat: show required map pack notice on every tournament page (B11)
feat: add participants pre-start and create BYE nodes via create-match (B21, B18)
feat: add TOP2 playoff format and auto-reduce Top4->Top2 below 8 active players (B6)
fix: point match swap/delete/forfeit at host (canManage) routes so hosts can manage matches (B12)
fix: undrop now restores Swiss forfeits too, so it visibly reverses a drop (B1)
fix: decouple match-drop from tournament withdraw; derive dropped flag from current status (B1)
feat: NO_CONTEST double-bye for technical aborts (both players +1, 0 BH) (B10)
feat: allow deleting BYE nodes directly from the bye modal (B19)
feat: expose server-computed can_manage so co-hosts get the full management UI (B12)
feat: global min-weight Swiss pairing (rematch/no-contest hard-avoid, ΔScore² cost, seeded) (B8)
feat: host-accessible add-late/set-faction/create-match + scope match controls to owner (B12 polish)
fix: reveal 2D3 per-game faction on the tile before map selection
fix: serve faction master data independently of an active season
feat: allow undrop before the tournament starts (N13)
fix: keep already-played REGISTERED players in later Swiss rounds (B14 regression)
fix: canonicalize Europe/Kiev -> Europe/Kyiv in stored timezones
feat: faction allowlist defaults to all-selected in create/edit forms
feat: show banned and restricted factions on tournament detail page
feat: add proficiency column to faction top players table
feat: add live queue and availability counter to Open Play page
feat: filter faction replays by opponent faction with matchup-row shortcut
perf: read faction top-player proficiency from cached rating model
feat: make player mentions in bot DMs clickable via <@id>
feat: flag opponents approaching the anti-farming cap
feat: show community availability heatmap on create-tournament form
feat: link player and faction mentions to their pages app-wide
feat: global active-match indicator in the header
feat: persistent Open Play queue activity log with admin view
fix: unify meta game counts (draws count, voided excluded) and compute matchup heatmap live
feat: tournament ruleset with standard-rules toggle and custom restrictions field

### v1.2.0 (Jul 01 2026) [ae0d6fa..23142a3]
fix: context-aware availability heatmaps + 3-way Open Play view toggle (P8)
fix: label playoff Discord pairings by phase (P7) + suppress link embeds on host/dispute DMs (P6)
fix: allow staff to upload Open Play replays, not just the winner (AT3)
fix: condense admin nav to xl breakpoint (P2) + repair broken oklch bg/text in Dialog & Popover (P4)
feat: highlight the current day/hour in the availability heatmap (P5)
fix: preserve reported game results on open play match cancel
feat: replace launch countdown with live open-play queue pulse
feat: read-only match modal with issue reporting
feat: backfill match games for legacy matches
fix: widen stats pages so game history and admin tables fit
fix: truncate Discord/Steam IDs with click-to-copy in admin user table
feat: show standard ruleset in open-play queue and challenges
fix: make admin tab URL-driven so re-clicking Admin returns to dashboard
fix: evict from open-play queue based on real join time, not user.updated_at
feat: distinguish Ladder vs Challenge open-play matches in All Games
feat: tournament poster upload with hero banner and card thumbnail
fix: make poster upload dir creation non-fatal at startup
fix: let hosts resolve DISPUTED matches from the match page

### v1.3.0 (Jul 02 2026) [23142a3..9b547b5]
fix: challenges heatmap keys on local weekday+hour, not raw UTC hour (#22)
fix: left-align empty-state banner on all breakpoints (#25)
feat: faction popularity chart (games played) on the factions page (#21)
feat: admin usage-over-time chart — tournament/ladder/challenge per day (#23)
feat: replace empty-musters art with Cole's Desolation (1836), renamed for cache-bust (#24)
feat: rewrite Open Play matchmaking DM system
feat: move Open Play result reporting fully on-site, drop Discord result buttons
feat: notify mods on on-site Open Play disputes
fix: suppress the OG embed on the Open Play dispute DM (P6, compact alert)
fix: align standard ruleset card values to a shared column on desktop
fix: give every faction popularity bar a single-line label

### v1.4.0 (Jul 03 2026) [9b547b5..35875d9]
feat: admin can reset a user's Steam verification and edit profile fields
feat: admin can delete users (anonymize + release)
feat: full leaderboard on one page + player search
feat: DM the bye player each round (encouraging; last-round elimination note)
fix: make restricted factions pickable in matrix and blind-pick
feat: make Steam links sticky (block silent account swap)
feat: add Balanced Liechtenstein tournament format
feat: Balanced Liechtenstein division playoffs
fix: let hosts find their own draft tournaments in the list
feat: Balanced Liechtenstein UI polish — level colours + division playoffs
fix: Balanced Liechtenstein finalization uses Swiss-based placement
feat: admin-editable calibration questionnaire (backend)
feat: admin Skill Calibration tab — edit the calibration questionnaire
feat: retune default calibration floors (NPT/IPT/domination)
feat: Balanced Liechtenstein play-up at registration (backend)
feat: Balanced Liechtenstein band visuals + play-up dialog
feat: distinct band colours (white / rust / bronze / silver / gold)
fix: pair the earliest compatible opponent in Balanced Liechtenstein
fix: align Balanced Liechtenstein standings columns across divisions
feat: weigh eventual rematch against play-up in Balanced Liechtenstein
feat: adaptive calibration questionnaire — ask only floor-raising questions
feat: adopt Alex's revised calibration questionnaire
feat: reserve a top-band seat in each Balanced division final + mark all finalists
feat: Balanced Liechtenstein — auto rounds + real per-division playoff brackets
feat: render stacked per-division brackets for Balanced Liechtenstein playoffs
fix: group a TOP2 division's final + third place into one bracket section
fix: hide auto-derived config fields for Balanced Liechtenstein in setup forms
fix: list divisions high-to-low in the play-up picker

### v1.5.0 (Jul 06 2026) [35875d9..8191cf0]
fix: honor configured rounds_count in the Swiss next-round guard
feat: Paket 1 quick wins (standard rules default, allowlist auto-pick, viewer-left, matrix order/map, header, skill marker, hints, draw display)
feat: paket 1 frontend quick wins
fix: swiss next-round guard respects tournament rounds_count
feat: draft auto-pick respects tournament faction allowlist
feat: blind-pick auto-resolve respects tournament faction allowlist
feat: matrix ban order follows balanced 1-2-2-2 pattern
feat: matrix auto-resolve — 30s timeouts + allowlist-aware pool

### v1.6.0 (Jul 07 2026) [8191cf0..fd7ae64]
feat: scheduled matchups expire at their proposed play time (#28)
feat: poster upload available in the create form too (#32)
feat: matrix + map decision redesign (#35, #34, #7, red/green vignette)
feat: Enticity's Free Pick mode (#36)
feat: externalise auto-sizing + auto-advancement from AUTO_SWISS (#37)
fix: name the mode 'Enticity's Free Pick — SFT/Matrix Hybrid'
fix: ask the Free Pick choice on Balanced Liechtenstein + Free Pick signup
fix: also chain the faction step for BaLi + SFT/2D3 signup
fix: let withdrawn players re-register before start (#30a)
fix: auto-launch Balanced Liechtenstein division playoffs

### v1.7.0 (Jul 08 2026) [fd7ae64..a83441d]
feat: BaLi auto-sizing toggle, per-tournament Swiss tiebreak, calibration audit
feat: Enticity's Free Pick cluster — privacy, faction-first, matrix polish
feat: host pre-start drop (#41), dynamic auto-sizing (#40), stage DMs (#23)
feat: delete voided matches (#21) + readable full-width bracket (#25)
feat: Balanced Liechtenstein pairing uses global min-cost matching (#18)
feat: raise manual round cap to 8 and grow bracket viewport to full height

### v1.8.0 (Jul 09 2026) [a83441d..d6af9d1]
feat: add admin calibration audit viewer (#27-UI)
fix: auto-launch Balanced Liechtenstein playoffs despite SWISS-phase group matches
fix: stamp format-correct phase on manually created matches and byes
feat: create a bye match from the Create Match UI
feat: host-approved late-join requests (backend + host UI + toggle)
feat: applicant-facing 'Request to join' CTA for late join
feat: admin skill-level distribution chart (Statistics tab)
feat: calibration reset + move audit to profiles + stacked skill chart
feat: quick-wins batch — check-in visibility, faction edit, participant removal, stream link, cancel fix
feat: #49 — never auto-start or auto-close tournaments (host controls both manually)
feat: #6 — show a match's faction on the bracket node as soon as it's locked
feat: #50 — append the stream link to spectator DMs (T5/T6/P2/P5)
feat: reach faction-edit mid-tournament + show Free Pick faction on map step
fix: add Free Pick (pick-later) option to the non-balanced standings dialog

### v1.8.1 (Jul 10 2026) [d6af9d1..867f277]
fix: store tournament posters outside the repo checkout

### v1.9.0 (Jul 11 2026) [867f277..535ae26]
fix: resolve poster dir to the writable ReadWritePaths root under systemd
feat: robust late-join & mid-tournament drops for BaLi + Swiss
fix: coerce numeric edit-form inputs so PATCH sends numbers not strings

### v1.10.0 (Jul 12 2026) [535ae26..41b9a22]
feat: add 1v3 faction mode (Set Faction vs. One of Three Counterpicks)
feat: add BO2 two-leg series (1v3 home/away, 1–1 = Draw)
fix(bali): exclude phantom finalists + zero-point catch-up byes
fix(bali): prevent late-joiner double bye; robust Big Bees test
feat(bali): per-division playoff generation
fix(bali): tournament podium from top division's playoff, not group rank
revert(1v3): don't touch the leaderboard on a BO2 draw
fix(bali): replay two rematch-locked leftovers instead of double-bye (#3)
fix(1v3): return set_faction_id from tournament GET so the set faction persists

### v1.11.0 (Jul 13 2026) [41b9a22..3c9bdac]
feat(ui): poster on list cards, English 'Majors only', format/mode tooltips
feat(landing): The Ladder is live (Open Play), not 'coming'; refresh tournaments copy

### v1.12.0 (Jul 14 2026) [3c9bdac..33d8a09]
feat: queue/availability wave (#1, #12, #14)
feat(#1): also mute pings between rounds in a live real-time tournament
fix(#14): education-first escalation — warn on first offense, no sanction
feat(#14): gradual level decay + log escalation to Queue Activity
feat(#14): admin lift of queue cooldown on the user profile + collapse calibration
fix(#14): admin lift drops to level 1 (warned), not a full pardon

### v1.13.0 (Jul 16 2026) [33d8a09..b1db62b]
fix(#3): withdrawal DM links to the tournament page, not /matches/:id
feat: quick-wins #8 (pairing DM link), #11 (map-pack note), #7 (playing count)
feat(#16): auto-sizing hides the rounds + playoff-format fields
fix(#1): render the bracket node-edit modal via a portal to document.body
feat(#9,#10): keep Free Pick in standings; close picker on opponent drop
feat(#2): surface the faction-pick timer on the game tile and site-wide
feat(#18): show unclassified players as 'Unrated' instead of band-1 'New'
feat(#17): admin engagement report — unverified + verified-never-played
feat(#19): admin underrated-players report (data rating vs self-claim)
feat(#12): distinguish Open-Play match origin (queue vs availability DM)
feat(#6): major-tournament-wins leaderboard
fix(#1): close the availability-ping gap that pinged Enticity mid-tournament

### v1.14.0 (Jul 17 2026) [b1db62b..1f930ed]
feat(bali-2.0): pairing cost table + playoff seeding handicap (pure, tested)
feat(bali-2.0): provisional-optimum pairing engine + playoff/late-join overhaul
feat: add Faction War mode (SFT with globally exclusive factions)
fix(#6): credit exactly one champion per major on the wins leaderboard
fix(drop): notify + walkover-advance opponent on a playoff-phase drop
feat(leaderboard): break major-wins ties by total game wins across majors
fix(stats): unify both matchup heatmaps onto one game-level game set
feat(games): staff edit for a game's factions, map and winner
feat(matches): per-game map/faction/winner in the host override modal
fix(matches): derive Bo_N result from per-game winners; show game-wins for played draws
fix(ui): only show a round count for round-based formats
feat(admin): full-width All Games with replay column + editable Official flag
feat(admin): hard-delete a game from the All Games tab
feat(admin): game-audit filter to surface bogus games for cleanup
fix(tournament): show check-in status for elimination formats before start
feat(leaderboard): #14 General Skill leaderboard from game data
feat(factions): #13 model matchup favourability + general strength on faction pages
fix(bracket): stop bye-vs-bye round matches overlapping in the layout

### v1.15.0 (Jul 18 2026) [1f930ed..25dcb25]
fix(factions): stop the favourability column overlapping the win-rate bar
feat: quick-wins batch (N1/N3/N4/N5/N9/N10) + fix skill-leaderboard load
feat: add optional min-participants target + 2x2 capacity layout
feat: category-2 fixes (Z53/Z34/Z50)
feat: reorder create-tournament form + default discord link
fix: host transfer sent wrong body field (host_id vs new_host_id)
fix: let co-hosts open the tournament edit page
feat(#47): admin report for fully-registered users not in the Discord server

### v1.15.1 (Jul 19 2026) [25dcb25..5189a6c]
fix(bali): host-owned playoff size + idempotent catch-up byes

### v1.15.2 (Jul 20 2026) [5189a6c..3d89ef7]
fix(discord): auto-resolve guild id from the bot token

### v1.16.0 (Jul 21 2026) [3d89ef7..1b7d4c6]
feat(ui): replace page backdrop with darkened moonlit-ruins painting
feat(ui): add atmospheric backdrop to Open Play

### v1.16.1 (Jul 24 2026) [1b7d4c6..3d6151d]
fix(bali): pre-assign the odd-count bye to the weakest player
fix(bali): keep Swiss standings order in playoffs, colour finalist banner by division
fix(bali): stop showing a provisional bye as a 0-point catch-up bye
fix(open-play): show only matchmaking availability on the front-page heatmap
fix(standings): keep 'Free Pick' in FREE_PICK standings
fix(bali): auto-sized 'Rounds TBD' + apply BaLi standings decoration on the tournament page
fix(bali): gate the late-join bye reclaim so it is never the round's biggest gap

### v1.17.0 (Jul 25 2026) [3d6151d..a8c5bf0]
fix(tournaments): declining a played player's re-join no longer deletes their record
fix(bracket): cancelled matches no longer hide the Start Playoffs button
feat(leaderboard): win-rate column in the Skill leaderboard, 20-game cutoff, drop the Win Rate tab
fix(bali): play-up-minimising bye choice + reliable playoff auto-trigger

