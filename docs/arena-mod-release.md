# Release of RizzOtto's Arena Mod on rizzotto.gg (v3.0.0)

The site side of the mod's public release (plan: `tww3-modding/docs/platform/README.md`). Everything lives on
the branch `feat/arena-mod-release` and goes live together with the mod. The texts below are for Alex to
proofread before release.

## What the branch contains

- **Domquest** as the fifth battle type (`DOMQUEST`): own skill rating (start from Domination, or Conquest when
  the player played more Conquest; no questionnaire block), leaderboards, quarterly final, Open Play queue,
  tournaments, Standard Ruleset (`DOMQUEST_SETTINGS`, bans and conduct as Domination), icon, map pool (copy of
  every Domination map that is available at deploy time, slug suffix `-domquest`).
- `GET /api/maps` answers 400 for an unknown `battle_type` (the mod build can tell a missing pool apart).
- `GET /api/meta/arena-mod`: Workshop link and current version, read from the Workshop description
  (`Current version: 1.0`), cached 15 minutes. While the item is unlisted Steam answers result 9 and the site
  shows the mod without a version.
- Rule cards show only what players watch themselves (arena mode with the mod, conduct incl. Land Battle's rules
  of play) plus a note on what the mod enforces. The Fruit Rules links (Drive PDFs) are gone from the cards.
- Required-mod notice: RizzOtto's Arena Mod for every battle type, with version and "How to install".
- Header tabs **How to Play** (new page: install, what's in the mod, Domquest, rules, a match, FAQ) and **Fruit Rules**
  (public, in the sitemap, new intro). "What's in the mod" and "Domquest" follow the Workshop description
  (`tww3-modding/domquest/workshop/description_en.txt`); when the mod changes, update both. Its lobby settings and
  the rules come from the live Standard Rulesets, split into what every type shares and what each adds.
- Open Play: two boxes instead of one rule card per battle type. **Rules**: what the mod enforces, then what each
  selected type adds (Land Battle's attacking rules). **Code of Conduct**: your part and why strikes exist; what
  gets a strike, what a strike does and cancelling are folded in under "How strikes work". How to Play has it all
  unfolded as section 5. The strike numbers live in `OPEN_PLAY_CONDUCT` (`@rizzotto/types`), which the backend enforces.
- Standard Ruleset: new list `tournament_conduct` (round limit, "Cheating results in disqualification."), shown on
  tournaments only; migration `20261027100300` moves them out of `conduct`. Admin editor field "Conduct,
  tournaments only".
- Strike DMs name the right reason (missed faction pick vs. leaving the queue) and link to How to Play; the queue's
  cooldown message names the wait, not a cause.
- Onboarding is one welcome page (Discord server + the mod), shown once after a player's first login. The old
  overlay (settings, spotlight tour) had been unmounted since 2026-06-13 and is gone; migration `20261027100400`
  marks every existing player as onboarded, so only new players see it. `/api/users/me` carries `discord_member`,
  so the Discord card says "Logging in added you" when the bot saw him there.
- Release banner for existing players who are not on the RizzOttoverse Discord server, dismissable for good.
- Weekly Discord prompt: every Monday 00:00 (site time) the bot checks every player with Steam linked; whoever
  is not on the server gets a full-screen prompt on his next visit ("Join the server" / "Continue to the site"),
  again each week until he is on the server. No permanent opt-out. The first check runs on the first Monday
  after the deploy.
- Discord login always asks for `guilds.join`, so logging in adds players to the server.

## Release day, in order

1. **Mod:** the Workshop item is listed and its description carries `Current version: 1.0`.
2. **Domination pool:** final as wanted. The deploy copies every available Domination map into the Domquest pool.
3. **Branch:** rebase `feat/arena-mod-release` onto `main`, CI green, set the `## [3.0.0]` date to the release
   day, Alex's go, no ongoing tournament.
4. **Deploy:** fast-forward `main`. The changelog bot posts 3.0.0 on boot.
5. **Check on prod:** `/api/meta/arena-mod` shows `listed: true` and the version (at most 15 minutes after
   listing); `/api/maps?battle_type=DOMQUEST` returns the pool; the How to Play and Fruit Rules tabs; a ruleset
   card; the Domquest filter on Tournaments and Leaderboard.
6. **Ban lists (Alex, Admin → Settings → Standard Ruleset):** remove what the mod now fixes or rebalances
   (Dechala, Zombie Dragon, Manticore Mount (Dieter Helsnicht), Chalice of Blood & Darkness, Ghostly Howl) from
   every combo. The lists only show in the admin editor, so nothing else depends on it.
7. **Welcome banner:** Admin → Welcome Banner, text below.
8. **Broadcast DM:** to everyone the bot may DM, text below.
9. **Discord posts / video:** Alex.
10. Optional: replace `public/img/how-to-play/lobby-warning.jpg` with a screenshot from the release build (the
   current one shows the test build's version line), at a new file name (CDN rule).

## Texts to proofread

### Welcome banner (Markdown)

```
**RizzOtto's Arena Mod is out.** Every game on the Arena now runs with it: one mod with the arena modes, our map pools and the rules, plus the new battle type **Domquest**. [How to Play](/how-to-play)
```

### Broadcast DM

```
Hey! RizzOtto's Arena Mod is out on the Steam Workshop, and from now on every game on RizzOtto's Arena runs with it.

- One mod for everything: the arena modes in the custom battle lobby, our map pools, the lobby settings and bans, and the Fruit Rules in Land Battle, Conquest and now Siege.
- You no longer need the Total Tavern map pack or Loupi's Fruit Rules mod. Disable both and enable only the arena mod.
- New battle type Domquest: think Conquest on the Domination engine, with a Conquest-sized army, a small reinforcing army as a sideboard and one capture point in the middle. It has its own rating, leaderboards and queue.

How to install it and everything else: <https://rizzotto.gg/how-to-play>
Workshop: <https://steamcommunity.com/sharedfiles/filedetails/?id=3827143159>
```

### Already on the branch (proofread in place)

- Changelog `## [3.0.0]` in `CHANGELOG.md`.
- How to Play: `apps/frontend/src/routes/HowToPlayPage.tsx`.
- Welcome page: `onboarding.welcome.*` in `apps/frontend/src/i18n/locales/en/common.json`.
- Release banner: `apps/frontend/src/components/layout/ArenaModReleaseBanner.tsx`.
- Rule card and required-mod notice: `StandardRulesetCard.tsx`, `RequiredModsNotice.tsx`.
- Fruit Rules intro: top of `apps/frontend/src/content/fruit-rules/fruit_rules_interpretation.md` (the site's own
  text; the mod repo's copy still has the old intro).
