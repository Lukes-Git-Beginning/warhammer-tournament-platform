# Discord Open Play: `!join`, ticker, matches in DMs (Vermin League merge)

Status: **DESIGN, not built** (2026-10-30). Decisions below are Alex's; open points are marked.

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

## Decisions (Alex, 2026-10-30)

1. `!join` works as it does on the VL bot. The bot reads channel messages over the Gateway with the Message
   Content intent. `/join` exists as well.
2. The bot deletes the `!join` message once it has handled it. The channel only shows the bot's ticker posts.
3. A whole match can be played in DMs: faction pick, lobby code and password, result, replay. The match also
   lives on the site, and the opponent can use either.
4. Registration stays: an account (Discord login) and a linked Steam account. A player without them gets a
   one-time setup link, and his pending `!join` is remembered until he is done.
5. A ticker channel on both servers (UE and RizzOttoverse).
6. Who does what: the Gateway and all code = Claude. The Message Content intent = Alex as bot owner, one toggle in
   the Developer Portal that applies to every server. Channel permissions = the UE admin on UE, Alex on
   RizzOttoverse.

## Design

### 1. Gateway connection

- `lib/discord-gateway.ts` with `@discordjs/ws` (WebSocketManager: heartbeat, resume, reconnect). Intents: GUILDS,
  GUILD_MESSAGES, MESSAGE_CONTENT, DIRECT_MESSAGES.
- Started from `server.ts` only when `DISCORD_BOT_TOKEN` is set and `DISCORD_GATEWAY` isn't `off`. Prod runs one
  systemd process, so there is exactly one connection. Locally and in CI there is no token, so no connection.
- Handles MESSAGE_CREATE only: guild messages in configured channels (`!join`, legacy redirect) and DMs that
  carry a `.replay` attachment.
- A failure stays isolated: if the Gateway can't connect, the site and all buttons keep working (buttons, menus
  and modals come in over the existing interactions endpoint, not the Gateway).
- Side effect: RizzBOTto shows as online.

### 2. Server config

AdminConfig `discord_open_play_guilds`, edited in Admin → Settings:

```
[{ guildId, label, joinChannelIds[], tickerChannelId, pingRoleId?, legacyChannelIds[] }]
```

The bot ignores `!join` everywhere else.

### 3. Entry: `!join` and `/join`

- `!join` in a join channel: delete the message (needs Manage Messages there), resolve the user by `discord_id`,
  run the **shared join checks** (account, Steam linked, not banned, no cooldown, not queued, no active Open Play
  match), then DM the **join panel**: battle types (multi-select, preset from the saved queue prefs), Bo1/Bo3,
  buttons "Join" and "Join and save as default".
- `!join` with arguments (e.g. `!join conquest bo3`) joins directly. Argument names: open, see below.
- A failure (DMs closed, cooldown, already queued) gets a short reply in the channel that deletes itself after
  about 20 seconds. `/join` answers privately (ephemeral) instead.
- `/join` is a global application command and works without the Gateway.
- Legacy VL channel: `!join` there gets the pointer "Open Play now runs in #…", auto-deleted.

### 4. Registration for new players

- Unknown `discord_id` or no Steam link: DM with a button "Set up (one-time, about a minute)" to
  `/login?return_to=/discord/setup-done`. The Discord login runs, the existing Steam gate sends him to
  `/connect-steam`, and the end page says "All set, back to Discord".
- The pending join sits in Redis (`discord:pending_join:<discordId>`, 15 minutes, with his chosen prefs). When the
  Steam link completes, he joins the queue and gets the DM.
- Later option: a one-time signed link that skips the Discord login step (the bot already knows who he is).

### 5. Ticker

- On every queue JOIN (site, DM, `!join`) the bot posts to every configured ticker channel, anonymous like the
  availability DM: "Someone is looking for a game: Land Battle · Bo3", one button per offer (battle type ×
  format). A click claims the offer like `av_offer` does (`claimQueueOffer`).
- When the entry closes (matched, left, timed out) the post is deleted, so the channel only shows open requests.
  Post ids per queue entry and guild live in Redis.
- Ping role: mention `pingRoleId` at most once per few minutes per guild (like the 5-minute cap on the DM wave).
- A click by an unregistered player answers privately with the setup button (§4).

### 6. Match in DMs

One **match card** per player: a single DM, edited as the match advances. It shows the opponent, battle type,
format, map, game n of N and the deadlines, plus a link button "Open on rizzotto.gg".

| State | Components |
|---|---|
| Faction pick | String select of the allowed factions (Open Play bans removed). Discord allows 25 options; past that, two steps. Locks through the same function as the site. |
| Lobby | "Set lobby code" opens a modal (code + password). The opponent's code shows once set. |
| Result | "I won" / "They won", then "send the replay file to this DM" (Gateway DM attachment, `.replay`, ≤ 5 MB). Same report function as the site: verification, held mismatch, dispute. |
| Opponent reported | "Confirm" / "Dispute". |
| Any time | "Cancel match". |

- Bo3: the card moves on to the next game (new map, new pick), as on the site.
- Sync: both cards are re-rendered whenever the match changes (pick, lobby, report, finalize, cancel), from the
  same place that emits the socket events. A pick on the site updates the DM and vice versa.
- The interactions handler gains string selects and modal submits (today it only handles buttons).

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

`!ladder` or a pinned, auto-updated message with the Monthly Ladder top N. A VL-only board stays optional.

## Open points

- **VL picking:** does the VL need pick 3 / ban 1 and the 2 weekly global bans in Open Play? (A player also asked
  for matrix picking as an option.)
- **VL extra limits** on top of the Fruit Rules: list needed. They would go into the mod or the ruleset.
- `!join` argument names, ideally the VL's current command words.
- Ticker: anonymous (current default, like the availability DM) or with the player's name.
- 2v2 via DM: not in v1.

## Build order

1. Service layer + the fixes in §8 (shared join checks incl. Steam).
2. Gateway, server config, `!join` / `/join`, setup flow, ticker.
3. Match card in DMs (pick, lobby, result + replay, confirm/dispute, cancel, Bo3).
4. Test on RizzOttoverse, then Alex requests the UE invite.

Each step deploys on Alex's go.

## What Alex and the UE admin set up

- Alex: Developer Portal → Bot → "Message Content Intent" on, before step 2 deploys.
- Alex: on RizzOttoverse, a join/ticker channel and optionally a ping role; enter them in Admin.
- UE admin: accept the invite with View Channel, Send Messages, Embed Links, Use Application Commands, and
  Manage Messages in the join/ticker channel; then the same Admin entry for UE.
