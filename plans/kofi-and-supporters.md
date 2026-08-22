# Ko-Fi page + on-site supporter recognition

Decisions locked with Alex 2026-08-21/22. Two parts: (A) the Ko-Fi page content Alex enters on
ko-fi.com/rizzottogaming, and (B) the on-site feature we build (branch `feat/supporter-recognition`).

Positioning note: foreground the **ranked ladder** (Open Play), tournaments secondary. Plain tone —
NO grimdark/Karaz-Ankor lore voice (see memory feedback-no-karaz-ankor-tone). Brand name is
**RizzOtto's Arena** (capital R, capital middle O).

## Part A — Ko-Fi page content (ko-fi.com/rizzottogaming)

- **Display name:** RizzOtto's Arena
- **Subtitle/bio:** `Home of PvP — ranked matchmaking & tournaments for Total War: Warhammer.`
- **Profile picture:** the Sigil — `rizzotto.gg/img/rizzotto-sigil.png`
- **Cover banner:** `rizzotto.gg/og-image-v5.png` (painting with the wordmark already in it)
- **Coffee price:** €5 (Alex to confirm in settings)
- **Goal:** target **€365**, title `Build 2v2, Conquest & Siege + run the Arena`.
  (Full project ~€500; a supporter already gave ~€135 / 200 CAD OUTSIDE Ko-Fi, so the bar tracks the
  remaining ~€365 and the About text credits the head start.)
- **Membership tier (recurring):** `Lord` — €5/month.
- **Gallery:** 3 platform screenshots — the ladder, a tournament bracket, a leaderboard/profile with
  stats + skill rating.
- **Ko-Fi Gold:** skip for now (only saves the 5% membership fee; negligible at this scale. One-time
  donations are already 0% Ko-Fi fee — only PayPal/Stripe processing applies).

### About text (paste into Ko-Fi)

> **Home of PvP.**
>
> RizzOtto's Arena is a free, community-run home for competitive Total War: Warhammer. At its heart is
> a live **ranked ladder** — jump in, get matched with players at your level, and climb. Around it we
> run regular **tournaments**, from newcomer nights to open events.
>
> Every game feeds into statistics, the leaderboard and dynamically calculated skill ratings — and you
> can find the replay of every battle ever played. No ads, no paywalls. Built and run by players, for
> players.
>
> **What your support builds**
> We want to add three new battle modes — **2v2**, **Conquest** and **Siege** — and keep the servers
> running. Every contribution goes straight into building these and hosting the Arena. One supporter
> has already pledged ~€135 to get us started — this goal tracks the rest. Supporters are credited on
> the site.
>
> Thanks for helping build the next chapter. 🍆

## Part B — On-site supporter recognition (build)

### Recognition scheme (cumulative — a user can hold all three)
| Category | Who | Ko-Fi mechanic |
|---|---|---|
| **Supporter** | donated ≥ 1 coffee (any one-time) | one-time |
| **Lord** | active monthly member | membership |
| **Champion** | large one-time donation (≥ €50 = 10 coffees) | large one-time |

### Source of truth: Discord roles + admin override (cumulative union)
- Primary: three Discord roles in the guild (Supporter/Lord/Champion). Ko-Fi's Discord integration
  auto-assigns the Lord role to monthly members; Supporter/Champion assigned in Discord (manual for now).
- Override: an admin "Supporters" tab with checkboxes per user (any combination).
- Effective status per user = union(discord-derived tiers, admin-granted tiers).
- Discord role IDs configured via AdminConfig (fallback env).

### Badges (Lucide icons, single-colour, device-consistent)
- ☕ **Coffee** = Supporter (bronze) · 👑 **Crown** = Lord (gold) · 🏆 **Trophy** = Champion (red/crimson).
- Shown on the profile page (v1). Swappable later (one word each). Custom art is a later upgrade.

### Surfaces (v1 = "lean")
- **Supporters list:** extend the EXISTING `/support` page (`routes/SupportPage.tsx`) — add a section
  below the Ko-Fi button listing Champions → Lords → Supporters.
- **Profile badges:** on the user profile page.
- **Funding banner:** a slim, dismissible, site-wide top bar → ko-fi.com/rizzottogaming; hidden for
  anyone who is already a supporter; dismissal persists (localStorage).
- **Admin tab:** "Supporters" management with per-user checkboxes (Supporter/Lord/Champion).
- Out of v1 scope (later): custom badge art; badges inline next to names in leaderboard/standings/matches.

### Backend integration points (confirmed present)
- `auth.ts` already fetches `GET /guilds/{guildId}/members/{userId}` with the bot token on Discord login
  → capture `member.roles` there and store the derived tiers.
- `resolveGuildId()` + `DISCORD_BOT_TOKEN` in `lib/discord-notify.ts`; AdminConfig pattern exists
  (calibration catalog, rating-model config) for the role-ID config.

### Build steps
1. Prisma: add per-user supporter fields (discord-derived tiers + admin-override tiers) + migration.
2. `lib/supporter-status.ts`: pure resolution (union) + Discord-role → tier mapping.
3. Sync on Discord login (extend auth.ts member fetch) + a daily refresh cron.
4. Endpoints: `GET /api/supporters` (lists) + admin `PUT` override; role-ID config in AdminConfig.
5. Frontend: `SupporterBadge` component; extend `SupportPage`; profile badges; top funding banner;
   admin "Supporters" tab.
6. Tests (pure resolution logic), typecheck, lint. Changelog entry. Deploy = separate gate.
