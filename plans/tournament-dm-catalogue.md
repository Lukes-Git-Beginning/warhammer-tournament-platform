# Tournament DM / Notification Catalogue

All tournament-related Discord notifications, active + planned. Voice = RizzOtto's
Arena grimdark-warm (⚔️/🏆/🎲/☕, "GG", "sharpen your blades"). Prefix DMs with
`[RizzOtto's Arena]`. Source of truth for active texts: `apps/backend/src/lib/discord-notify.ts`.

Placeholders: `{tournament.name}`, `{slug}`, `{url}` = `…/tournaments/{slug}`,
`{label}` (e.g. "Round 3" / "Semi-Finals" / "Final"), `<@{discord_id}>` (Discord ping),
`<t:{unix}:F>` / `:R>` (Discord timestamp), `{map}`, `{comment}`.

---

## Active — channel posts

### T1 · Tournament announced  *(channel embed, not a DM)*
- **Trigger:** tournament published. **To:** announce channel (`discord_announce_channel_id`), pings `discord_ping_role_id`.
- **Embed title:** `⚔️ Tournament Announced: {tournament.name}`
- **Body:** `A new tournament has been published on RizzOtto's Arena!\n\n**Start:** <t:{start}:F>` — links to `{url}`.

### T2 · Round pairings  *(channel embed + per-player DM T3)*
- **Trigger:** a round's matches are created. **To:** announce channel.
- **Embed title:** `⚔️ {label} Pairings — {tournament.name}`
- **Body:** one line per match: `• <@{p1}> vs <@{p2}>{ on *{map}*}`

---

## Active — DMs

### T3 · Round pairing (per player)
- **Trigger:** each round's matches. **To:** both players.
- **Text:** `**[RizzOtto's Arena] {label} Pairing — {tournament.name}**\nYou are playing against <@{opponent}>{ on *{map}*}.`

### T4 · Check-in reminder
- **Trigger:** cron, ~1 h before start. **To:** all REGISTERED.
- **Text:** `**[RizzOtto's Arena] Check-in Reminder: {tournament.name}**\n\nThe tournament starts <t:{start}:R>. Please check in at {url} before the start time!`

### T5 · Bye — advancing
- **Trigger:** player draws a bye (still in contention). **To:** the bye player.
- **Text:** `**[RizzOtto's Arena] Bye — {tournament.name}**\nYou drew a bye in {label} — a free win, and honestly a well-earned breather. ☕ You advance automatically, so rest up and sharpen your blades — you're back in the fray next round. Standings: <{url}>`

### T6 · Bye — eliminated (final Swiss round, playoffs out of reach)
- **Trigger:** bye on the last Swiss round with no path to playoffs. **To:** the bye player.
- **Text:** `**[RizzOtto's Arena] Bye — {tournament.name}**\nYou drew a bye in {label}, and that's a wrap on your run this time — a playoff spot is just out of reach now. No shame in it at all: the pairings roll the dice, and someone always draws the short straw. 🎲 Thanks for battling — GG!\nThe tournament rolls on without you in the fight — see if the remaining matches are being streamed and enjoy the show: <{url}>`

### T7 · Host: player dropped  *(B20)*
- **Trigger:** a participant withdraws/is dropped. **To:** host + co-hosts (excl. actor).
- **Text:** `**[RizzOtto's Arena] Player dropped — {tournament.name}**\n<@{user}> is no longer in the tournament. Review the bracket at <{url}>.`

### T8 · Host: match issue reported  *(P9)*
- **Trigger:** a player reports a match problem. **To:** host + co-hosts.
- **Text:** `**[RizzOtto's Arena] Match issue reported — {tournament.name}**\n<@{reporter}> reported an issue with their match:\n> {comment}\nReview the match at <{base}/matches/{matchId}>.`

### T9 · Match dispute
- **Trigger:** two conflicting results / dispute. **To:** host + all moderators.
- **Text:** `**[RizzOtto's Arena] ⚠️ Match Dispute — {tournament.name}**\n\nMatch ID: \`{matchId}\`\nReported by: <@{reporter}>\n\nPlease review and resolve the dispute at <{url}>`

---

## Planned — DMs (drafted, not yet built)

### P1 · Playoff qualification  *(#23a/#23c)*
- **Trigger:** last Swiss/group round done → this player made the playoffs. **To:** each qualifier.
- **Draft:** `**[RizzOtto's Arena] You're in the Playoffs — {tournament.name}** 🏆\nThe Swiss rounds are done, and you've fought your way through — congratulations, you've qualified for the playoffs! Sharpen your blades; the real battle begins now. Your bracket + next match: <{url}>`

### P2 · Run over (didn't qualify)  *(#23c)*
- **Trigger:** last Swiss/group round done → this player did NOT make the playoffs (and no bye T6). **To:** each eliminated player.
- **Draft:** `**[RizzOtto's Arena] Your run ends here — {tournament.name}**\nThe final Swiss round is in the books, and a playoff spot slipped just out of reach this time. You fought well — GG! The tournament rolls on; if the remaining matches are streamed, grab a drink and enjoy the show: <{url}>`

### P3 · Playoff pairing (special)  *(#23a — replaces the plain T3 for playoff rounds)*
- **Trigger:** a playoff round's matches (QF/SF). **To:** both players.
- **Draft:** `**[RizzOtto's Arena] {label} — {tournament.name}** 🏆\nCongratulations on reaching the {label}! You face <@{opponent}>{ on *{map}*}. This is where legends are forged — good luck, and may your dice run hot. <{url}>`

### P4 · Final / 3rd-place — the last match  *(#23b)*
- **Trigger:** the Grand Final or Third-Place match pairing. **To:** both players.
- **Draft (Final):** `**[RizzOtto's Arena] The Grand Final — {tournament.name}** 🏆\nThis is it — the last match of the tournament. You face <@{opponent}>{ on *{map}*}. Leave nothing on the field; the title is decided here. GG in advance, and may the best general win. <{url}>`
- **Draft (3rd place):** `**[RizzOtto's Arena] The Third-Place Match — {tournament.name}** 🥉\nOne last battle to close out the tournament — you face <@{opponent}>{ on *{map}*} for the bronze. Finish strong. GG! <{url}>`

### P5 · Last-round completion, generic  *(#23c — when neither playoff nor elimination applies, e.g. no-playoff formats)*
- **Trigger:** a player finishes the final round of a tournament that has no playoffs. **To:** the player.
- **Draft:** `**[RizzOtto's Arena] That's a wrap — {tournament.name}**\nYou've played your final round — thanks for battling through the whole event! Final standings are up: <{url}>. GG, and see you at the next muster. ⚔️`

### P6 · Auto-sizing adjusted  *(#40 round-end DM)*
- **Trigger:** at round-end, when dynamic auto-sizing changed rounds/playoff since the last round (display already updated live; DM batched to round-end to avoid spam).
- **To:** all active players (once per change).
- **Draft:** `**[RizzOtto's Arena] Bracket updated — {tournament.name}**\nThe field is now at {activeCount} players, so the tournament has been re-sized: **{rounds} rounds**{ · **{playoffFormat}** playoffs}{ · no playoffs}. Next-round pairings are up: <{url}>`

### P7 · Stream link in DMs  *(project-tournament-stream-link — enhancement, not a new type)*
- If the host set a stream link at setup, append to T5/T6/P2/P5 (spectator-facing DMs):
  `\n📺 Watch the action live: <{streamUrl}>`

---

## Out of scope here (Open Play, not tournament)
`notifyMatchFoundWithButtons`, `notifyScheduledMatchReminder`, `notifyChallengeMatchFound`,
`notifyReQueuePrompt`, `notifyOpenPlayDispute`, `notifyAvailabilityPing` — queue/challenge/
availability DMs, separate from the tournament flow.
