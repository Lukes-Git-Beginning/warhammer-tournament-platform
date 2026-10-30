# Discord Open Play: `/join`, ticker, matches in DMs (Vermin League merge)

Status: **DESIGN, not built** (2026-10-30, entry switched to `/join` 2026-10-31). Decisions below are Alex's; open
points are marked.

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
   their players. So the bot needs **no Gateway connection and no Message Content intent**: commands, buttons,
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

- `/join` runs the **shared join checks** (account, Steam linked, not banned, no cooldown, not queued, no active
  Open Play match) and answers **privately** (ephemeral) with the **join panel**: battle types (multi-select, preset
  from the saved queue prefs), Bo1/Bo3, buttons "Join" and "Join and save as default".
- Options for a direct join: `/join battle_type:Conquest format:Bo3`. Discord shows them as dropdowns, so no
  command words to learn.
- **Panel message**: Admin → "Post join panel" makes the bot post one message in the ticker channel with a "Find a
  game" button (opens the same private join panel) and a short how-to. The admin pins it. For players who don't
  know slash commands.
- After joining, the bot DMs a short "You're in the queue: Land Battle · Bo3" with a "Leave queue" button. If that
  DM fails (DMs closed), the private reply says so and points to the site, because the match card needs DMs.
- Failures (cooldown, already queued, banned) answer privately with the reason.
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
- When the entry closes (matched, left, timed out) the post is deleted, so the channel only shows open requests and
  the panel. Post ids per queue entry and guild live in Redis. Deleting its own posts needs no extra permission.
- Notifications: whoever sets the channel to "All messages" gets one push per open request. A ping role
  (`pingRoleId`) is optional and mentioned at most once per few minutes per guild (like the 5-minute cap on the DM
  wave). A mention inside the same post adds no second notification.
- A click by an unregistered player answers privately with the setup button (§4).

### 6. Match in DMs

One **match card** per player: a single DM, edited as the match advances. It shows the opponent, battle type,
format, map, game n of N and the deadlines, plus a link button "Open on rizzotto.gg".

| State | Components |
|---|---|
| Faction pick | String select of the allowed factions (Open Play bans removed). Discord allows 25 options; past that, two steps. Locks through the same function as the site. |
| Lobby | "Set lobby code" opens a modal (code + password). The opponent's code shows once set. |
| Result | "I won" / "They won" opens a modal with a **file upload** field for the `.replay` (≤ 5 MB). Same report function as the site: verification, held mismatch, dispute. |
| Opponent reported | "Confirm" / "Dispute". |
| Any time | "Cancel match". |

- The replay upload uses Discord's modal File Upload component (type 19, inside a Label); the backend downloads the
  file from the attachment URL in the submit payload. To verify at build time: the exact payload shape. Fallback: a
  `/replay` command with an attachment option in the bot DM.
- Bo3: the card moves on to the next game (new map, new pick), as on the site.
- Sync: both cards are re-rendered whenever the match changes (pick, lobby, report, finalize, cancel), from the
  same place that emits the socket events. A pick on the site updates the DM and vice versa.

### 7. One service layer

Move the logic that sits inline in route handlers into lib functions callable with a userId, so the routes and the
Discord handlers share it:

- queue join (HTTP route and `joinQueueViaDiscord` today differ, see §8)
- blind-pick lock (`routes/match-decision.ts`)
- lobby code and password (`routes/match-games.ts`)
- result report incl. `settleVerifiedReport`, opponent confirm, reject, escalate (`routes/match-games.ts`)

### 8. Fixes found while mapping the flow

- **`joinQueueViaDiscord`** (buttons "Queue again" `op_queue` and `av_optin`) skips the cooldown and the
  active-match checks of the HTTP join, so a player on a strike cooldown can queue through the button. Live today.
- **`av_join`** creates a Domination 1v1 Bo1 match no matter what both players queued for. Only reachable from
  old DMs (the wave now sends `av_offer`), so remove or route it through `claimQueueOffer`.
- **No backend route enforces the Steam link.** `requireSteamLink` exists but is unused; the frontend gate is the
  only one. The shared join checks add it.
- `notifyMatchFoundWithButtons` calls `discordRequest` directly and bypasses `sendDm`'s opt-out and caps. Check
  whether that is intended (a match DM arguably should always go out).
- Noted, not in scope: 2v2 no-show penalties assume 1v1 ids; 2v2 members can't join the live socket room; a
  comment says a DISPUTED game frees the players to re-queue, which the join check doesn't seem to do.

### 9. Leaderboard in Discord (later)

`/ladder` (private reply) or a pinned, auto-updated message with the Monthly Ladder top N. A VL-only board stays
optional.

## Open points

- **VL picking:** does the VL need pick 3 / ban 1 and the 2 weekly global bans in Open Play? (A player also asked
  for matrix picking as an option.)
- **VL extra limits** on top of the Fruit Rules: list needed. They would go into the mod or the ruleset.
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

- Alex, on RizzOttoverse: a ticker channel where only the bot may send messages (members keep View Channel, Read
  Message History and Use Application Commands), optionally a ping role; enter them in Admin, post the panel and
  pin it.
- UE admin: accept the invite (scopes `bot` + `applications.commands`; View Channel, Send Messages, Embed Links in
  the ticker channel), set up the ticker channel the same way, lock the old VL channel with a pointer; then the same
  Admin entry for UE.
