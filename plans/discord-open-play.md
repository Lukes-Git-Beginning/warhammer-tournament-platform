# Discord Open Play: `/join`, ticker, matches in DMs (Vermin League merge)

Status: steps 1–3 below **deployed** (v2.29.0 on 2026-11-01, join sources v2.30.0). Next: VL picking (§11), planned
2026-11-06, not built yet. Decisions below are Alex's; open points are marked.

**Rollout (Alex 2026-10-31: test it in a hidden channel first).** The deploy ships in testing mode (AdminConfig
`discord_open_play_rollout = { live, testerDiscordIds }`, default not live), so the community sees nothing:
`/join` is registered for server admins only (`default_member_permissions: "0"`) and not in DMs; `/join`, the
panel and ticker buttons answer non-testers "not open yet"; only testers (listed Discord ids or site admins) get
match cards, the other player in a tester's match keeps the usual match-found DM (so one tester can test against
any real opponent). The ticker channel is a
private channel only the testers and the bot can see; no ping role while testing. No CHANGELOG entry for the test
deploy (it posts publicly); the entry comes with go-live. Go-live = Admin → Settings → Discord Open Play → "Live for
everyone" (re-registers `/join` for everyone and in DMs).

## Why

Humanboy and the Under Empire (UE) admins agreed that Open Play replaces the Vermin League (VL) once it offers
roughly what the VL bot offers. The VL's main asks were **Land Battle and Bo3**, both live (v2.26.0, v2.18). The VL
call (Zoom notes in `E:\Dropbox\TWW3\RizzOtto's Arena\Bot-Integration der Germany League …`, where "Germany
League" is Zoom's mishearing of Vermin League) settled the integration: RizzBOTto joins the UE server instead of
the VL bot being patched. The UE admins have given permission for the bot; Alex requests the invite once this is
built.

## What the VL bot does today

- `!join` per mode (Land Battle, Conquest, Domination) in a "find matches" channel. Bo1 by default, a Best-of option.
- After a match is found it DMs the rules and the maps; the players settle the rest between themselves in DMs.
- Picking: a player names 3 factions, the opponent bans 1, the player picks from the other 2.
- 2 preset global faction bans per player, set outside matches and locked for a week (against target-banning).
- Extra VL bans and limits on top of the Fruit Rules (e.g. the Thunderbarge is banned).

## Decisions (Alex, 2026-10-30/31)

1. **The entry is `/join`, not `!join`.** The UE admins confirmed (2026-10-31) that the switch is no problem for
   their players. `/join` (and the panel button) opens a join DM with the full queue settings, as on the site. So the bot needs **no Gateway connection and no Message Content intent**: commands, buttons,
   selects and modals all arrive over the existing interactions endpoint.
2. **One channel per server, the ticker.** Only the bot posts there. `/join` and the panel button leave no message
   in the channel, so every open request notifies exactly once (the ticker post).
3. A whole match can be played in DMs: faction pick, lobby code and password, result, replay. The match also
   lives on the site, and the opponent can use either.
4. Registration stays: an account (Discord login) and a linked Steam account. A player without them gets a
   one-time setup link, and his pending join is remembered until he is done.
5. The ticker runs on both servers (UE and RizzOttoverse).
6. Who does what: all code = Claude. Channel permissions = the UE admin on UE, Alex on RizzOttoverse. Nothing to
   change in the Developer Portal.

## Design

### 1. Interactions only, no Gateway

- `routes/discord-interactions.ts` today answers PING and MESSAGE_COMPONENT buttons. It gains APPLICATION_COMMAND
  (`/join`), MESSAGE_COMPONENT string selects, and MODAL_SUBMIT.
- `/join` is registered as a **global command** at boot (`PUT /applications/{DISCORD_CLIENT_ID}/commands`, bulk
  overwrite, so it is idempotent), only when `DISCORD_BOT_TOKEN` is set. Allowed in servers and in the DM with the
  bot. Locally and in CI there is no token, so nothing is registered.
- No long-lived connection, no new dependency, no new failure mode. RizzBOTto keeps showing as offline in the member
  list (cosmetic; presence would be the only reason left for a Gateway).

### 2. Server config

AdminConfig `discord_open_play_guilds`, edited in Admin → Settings:

```
[{ guildId, label, tickerChannelId, pingRoleId?, panelMessageId? }]
```

`/join` works anywhere the command is available (any channel of those servers, the bot DM). The ticker only posts to
the configured channels.

### 3. Entry: `/join` and the panel button

- `/join` and the panel's "Find a game" button do the same thing: the bot sends the **join DM** and answers
  privately "Check your DMs" (or why it couldn't: DMs closed, not set up, cooldown, already queued).
- `/join` has no options. Most players pick two or more of the five battle types, which a slash option can't do.
  It works in every channel of the server and in the bot DM; a server admin can limit it to channels under Server
  Settings → Integrations → RizzBOTto.
- **Join DM** = the queue entry exactly as on the site, preset from the stored queue settings:
  battle types (multi-select), match format Bo1/Bo3 (multi-select), team size 1v1/2v2 (single select; 2v2 also
  picks the team when the captain has more than one), then "Join queue" (also saves the selection as the stored
  settings, like the Open Play page). The DM is edited in place: settings → "In the queue: Land Battle, Conquest ·
  Bo1, Bo3 · 1v1" with "Leave queue" → match card (§6).
- **Panel message**: Admin → "Post join panel" makes the bot post one message in the ticker channel with a "Find a
  game" button and a short how-to. The admin pins it.
- The shared join checks run when "Join queue" is pressed (account, Steam linked, not banned, no cooldown, not
  queued, no active Open Play match), through the same function as the site's join.
- Old VL channel: the bot can't read it, so the UE admin locks it and pins a pointer to the ticker channel.

### 4. Registration for new players

- Unknown `discord_id` or no Steam link: private reply with a button "Set up (one-time, about a minute)" to
  `/login?return_to=/discord/setup-done`. The Discord login runs, the existing Steam gate sends him to
  `/connect-steam`, and the end page says "All set, back to Discord".
- The pending join sits in Redis (`discord:pending_join:<discordId>`, 15 minutes, with his chosen prefs). When the
  Steam link completes, he joins the queue and gets the DM.
- Later option: a one-time signed link that skips the Discord login step (the bot already knows who he is).

### 5. Ticker

- On every queue JOIN (site, `/join`, panel, DM buttons) the bot posts to every configured ticker channel, anonymous
  like the availability DM: "Someone is looking for a game: Land Battle · Bo3", one button per offer (battle type ×
  format). A click claims the offer like `av_offer` does (`claimQueueOffer`).
- When the entry closes the post is edited to how it ended and deleted 15 minutes later (Alex 2026-10-31: whoever
  follows a ping must not find an empty channel, but the channel should stay short so the pinned panel stays in
  view; Discord pins don't stick to the top). Matched: "⚔️ Matched: @A vs @B · Land Battle · Bo3 · 1v1 · 3 minutes
  ago" (a match created for that queue id after the post). Names only once matched, so the two can find each other
  (Alex 2026-11-01: anonymous until the match); mentions in an edit notify nobody, 2v2 shows the team names. Left or timed out: a small grey "No longer looking · …" line, removed
  at once when the same player queues again (join/leave spam). Post ids per queue entry and guild live in Redis.
  Editing and deleting its own posts needs no extra permission, and edits don't notify.
- The panel carries a live line, "📊 Today: 12 matches · 2 in the queue right now" (Open Play matches created since
  site midnight, not cancelled), edited in place when it changes. Posting the panel again replaces the old one.
- Notifications: whoever sets the channel to "All messages" gets one push per open request. A ping role
  (`pingRoleId`) is optional and mentioned at most once per few minutes per guild (like the 5-minute cap on the DM
  wave). A mention inside the same post adds no second notification.
- A click by an unregistered player answers privately with the setup button (§4).
- The private "Only you can see this" confirmations in the channel ("Check your DMs", "Match found vs …") delete
  themselves after 5 minutes (Alex 2026-11-01); errors stay until dismissed.

### 6. Match in DMs

One **match card** per player: a single DM, edited as the match advances. It shows the opponent, battle type,
format, map, game n of N and the deadlines, plus a link button "Open on rizzotto.gg".

| State | Components |
|---|---|
| Faction pick | String select of the allowed factions (Open Play bans removed). Discord allows 25 options; past that, two steps. Locks through the same function as the site. |
| Lobby | "Set lobby code" opens a modal (code + password). The opponent's code shows once set. |
| Result | "I won" / "They won" / "Draw" (where the format allows one) opens a modal with a **file upload** field for the `.replay` (≤ 5 MB), whatever the result. Same report function as the site: verification, held mismatch, dispute. |
| Opponent reported | "Confirm" / "Dispute". |
| Any time | "Cancel match". |

- The replay upload uses Discord's modal File Upload component (type 19, inside a Label); the backend downloads the
  file from the attachment URL in the submit payload. To verify at build time: the exact payload shape. Fallback: a
  `/replay` command with an attachment option in the bot DM.
- Bo3: the card moves on to the next game (new map, new pick), as on the site.
- Sync: both cards are re-rendered whenever the match changes (pick, lobby, report, finalize, cancel), from the
  same place that emits the socket events. A pick on the site updates the DM and vice versa.
- Preview (Admin → Discord Open Play → "Send me a preview card", 2026-11-01): a card against RizzBOTto with every
  step clickable (pick, lobby, result with the real File Upload, the replay read like on the site, match over). No
  match, queue or stats are touched; state in Redis `rizzotto:dop:preview:<userId>`, buttons `pv_*`.

### 7. One code path

- The queue: `lib/open-play-queue-service.ts` (`joinOpenPlayQueue` / `leaveOpenPlayQueue`), used by the site route
  and every Discord entry. This closed the cooldown bypass in §8.
- Match actions (blind-pick lock, lobby code and password, result + replay, assert, confirm, reject, escalate,
  cancel): the DM handlers call the site's own routes as the player (`callAsUser`, `fastify.inject` with a
  short-lived token), so there is no second copy of that logic to keep in sync. The replay goes in as the same
  multipart upload the site sends.
- Card sync: an `onResponse` hook re-renders the cards after any successful change to a match (site or DM), and a
  per-minute reconcile catches crons and staff edits.

### 8. Fixes found while mapping the flow

- **Fixed:** `joinQueueViaDiscord` (buttons "Queue again" `op_queue` and `av_optin`) skipped the cooldown and the
  active-match checks; it now goes through `joinOpenPlayQueue`.
- **Fixed:** `av_join` created a Domination 1v1 Bo1 match whatever both had queued for; retired (old DMs get a
  pointer to `/join`).
- **Fixed:** the queue join now checks the Steam link on the server (it was only the frontend gate).
- `notifyMatchFoundWithButtons` calls `discordRequest` directly and bypasses `sendDm`'s opt-out and caps. Check
  whether that is intended (a match DM arguably should always go out).
- Noted, not in scope: 2v2 no-show penalties assume 1v1 ids; 2v2 members can't join the live socket room; a
  comment says a DISPUTED game frees the players to re-queue, which the join check doesn't seem to do.

### 9. Leaderboard in Discord (later)

`/ladder` (private reply) or a pinned, auto-updated message with the Monthly Ladder top N. A VL-only board stays
optional.

### 10. Where joins come from (Alex 2026-11-01)

The admin queue report shows joins per source (site, join DM, other DM buttons) and server, plus every Discord click
and what it led to (DM sent, setup link, match, too late, other). A join DM counts for the server of the player's last
`/join`, panel or ticker setup click, because Discord names no server inside a DM. Taking an offer never joins the
queue, so ticker and availability clicks only show as clicks. Discord tells a bot nothing about who merely reads a
channel, so views can't be measured.

### 11. VL picking (Alex with Humanboy, 2026-11-06)

**Decided:**

1. **Bo3 in Land Battle and Conquest: 3×3 matrix**, as in Matrix tournaments: both name three factions blind, then
   cells are struck in the grid until one matchup is left. Anew before every game of the series. Reuses the MATRIX
   code.
2. **Bo1 stays as today** (random map, blind pick).
3. **Weekly ban on the player profile.** Each player sets one faction there and can change it 7 days later at the
   earliest. In every Open Play match of his, that faction is banned for both players, so up to two per match. The
   ban lives on the profile, not per match or game.
4. The VL's pick 3 / ban 1 and its 2 preset bans per player **don't come**.
5. **No VL extra limits:** the Fruit Rules are enough (the VL didn't bring it up again after the call).

**Clarified with Alex (2026-11-06):**

6. Bo3 in Domination and Domquest stays blind pick; the matrix only in Land Battle and Conquest.
7. The profile ban applies everywhere in Open Play: every battle type, Bo1 as Bo3, and in 2v2 the bans of all four
   players. In the matrix nobody may put a banned faction among his three.
8. No per-game bans in Open Play, only the lasting ban from the profile. Tournaments keep their 0–2 per-game bans
   (Blind Pick, 3×3).
9. Matrix timers: the three picks 5 minutes as Open Play's pick today (then cancelled, strike for whoever hasn't
   picked); 30 s per strike and for the final pick, then a random one, as in Matrix tournaments.

**Fix first (live bug, found while mapping this):** in an Open Play series (Bo3, Siege Bo2) the pick timeout anchors
"neither has picked yet" at the *match's* creation. So game 2's blind pick qualifies at the first cron tick after the
game is created: the match is cancelled and both players get a no-show strike, unless one of them picked within that
minute. Both series on prod that reached a game 2 survived by luck (Conquest Bo3 2026-10-13: first pick 19 s after the
game was created; Siege Bo2 2026-10-11: 47 s). Fix: anchor at the game's creation (`MatchGame.created_at`). The
matrix is Bo3 only, so it needs this; it can also ship alone.

**Matrix in Open Play:**

- `Match.pick_mode` (TournamentMode, null = blind pick as today), stamped by `createOpenPlayMatch`: MATRIX for a 1v1
  Bo3 in Land Battle or Conquest. Stamped, not derived, so a later rule change never flips running or past matches.
- One helper, `factionPickMode(match)` = the tournament's mode, else `pick_mode`, else BPT / BPT_2V2. It replaces the
  `match.tournament?.mode` reads in the matrix routes (lock, strike), `finalizeGameResult`, the report gate
  (`isFactionStepDone`), the decision payload (`tournamentMode`) and the auto-resolve. The site's match page already
  renders the matrix from `tournamentMode === 'MATRIX'`; the Open Play bans go in as its `gameBans`.
- Next game of the series: random map as today, but no `MatchBlindPick`; the matrix row comes with the first lock,
  as in tournaments.
- No per-game bans in Open Play (`faction_bans_per_player` stays a tournament setting).
- Timers (decision 9): `cancelOpenPlayNoShows` learns matrix rows (5 minutes for the three picks, then cancelled and a
  strike for whoever hasn't picked). Strikes and the final pick keep the matrix's 30 s with a random strike. The
  matrix's random-three fallback stays for tournaments.
- The matrix auto-resolve runs outside a request, so after an automatic strike it refreshes both DM cards itself
  (the per-minute reconcile is too slow for 30 s turns). `/api/me/pending-faction-picks` learns matrix picks.
- Queue settings (site and join DM): one line that Bo3 in Land Battle and Conquest is played with the matrix.

**Matrix on the DM card** (through the site's own routes via `callAsUser`, like the blind pick):

- Three picks: one select with exactly 3 choices (25 factions today, minus the bans, so one select fits; if a DLC
  pushes it past 25, the pick needs two steps).
- Grid: his three as rows, the opponent's as columns, as 9 buttons in 3 rows ("Empire v Dwarfs"); struck cells
  disabled with ✖. The player on turn gets live buttons and "Your turn: strike 2 · ⏱ ends <t:…:R>", the other
  "Waiting for X". Last step: the coin-toss winner picks one of the two left. 3 grid rows + the cancel row = 4 of
  Discord's 5 rows.
- "Send me a preview card" gets a matrix variant, so it can be tried against RizzBOTto before anyone plays it.

**Weekly ban:**

- `User.weekly_ban_faction_id` + `User.weekly_ban_set_at`. `PUT /api/users/me/weekly-ban { factionId | null }`:
  the first one any time, every change (clearing too) 7 days after the last one at the earliest; otherwise 409 with
  the date it opens. An admin can reset it on the user view.
- Snapshot onto the match at creation (`Match.weekly_bans`, `[{ userId, factionId }]`: two in 1v1, up to four in
  2v2), so a series keeps its bans if one changes in between, and the match can say whose ban it was.
- Enforcement: `openPlayBannedFactionIds(match)` already feeds the decision payload, the blind-pick lock and the DM
  card's allowed factions; it also returns the snapshot bans. The matrix lock and the random picks use it too.
- Own profile: "Weekly Open Play ban" with a faction select and "You can change it on <date>". Shown on every profile
  (it shows in every match anyway). No ban set = nothing banned.
- Match page and DM card: "Banned: Empire (A's weekly ban), Dwarfs (B's weekly ban)".
- Join DM: shows the current ban, with a select while it is changeable (the VL players live in Discord).
- Copy: Open Play page, How to Play, CHANGELOG.

**Build order:** (1) the series timeout fix; (2) weekly ban; (3) matrix in Open Play on the site; (4) matrix on the
DM card + preview; (5) copy, CHANGELOG. Each deploys on Alex's go; (1) can go first and alone.

## Open points

- ~~**VL picking:** does the VL need pick 3 / ban 1 and the 2 weekly global bans in Open Play?~~ Decided
  2026-11-06: matrix in Bo3 Land Battle and Conquest, a weekly ban on the profile, no pick 3 / ban 1 (§11).
- ~~**VL extra limits** on top of the Fruit Rules~~ Decided 2026-11-06: none, the Fruit Rules are enough (§11).
- Ticker: anonymous (current default, like the availability DM) or with the player's name.
- To test on RizzOttoverse: `/join` in a channel where members may not send messages (Discord should only need
  "Use Application Commands"; the panel button works either way).
- 2v2 via DM: not in v1.

## Build order

1. Service layer + the fixes in §8 (shared join checks incl. Steam).
2. `/join` (command registration, join panel, queue DM), setup flow, panel message, ticker.
3. Match card in DMs (pick, lobby, result + replay upload, confirm/dispute, cancel, Bo3).
4. Test on RizzOttoverse, then Alex requests the UE invite.

Each step deploys on Alex's go.

## What Alex and the UE admin set up

- Ping role (optional): set it to "Allow anyone to @mention this role", or the bot can't ping it.
- Alex, on RizzOttoverse: a ticker channel where only the bot may send messages (members keep View Channel, Read
  Message History and Use Application Commands), optionally a ping role; enter them in Admin, post the panel and
  pin it.
- UE admin: accept the invite (scopes `bot` + `applications.commands`; View Channel, Send Messages, Embed Links in
  the ticker channel), set up the ticker channel the same way, lock the old VL channel with a pointer; then the same
  Admin entry for UE.
