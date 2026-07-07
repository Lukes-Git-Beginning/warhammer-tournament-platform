# Changelog

All notable changes to Rizzotto (rizzotto.gg) are documented here.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/).
Entries are grouped by deploy wave (the platform ships continuously to `main`).

## [Unreleased]
_Nothing staged._

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

## 2026-06-27 — v1.0 launch
Rizzotto left beta and launched v1 on rizzotto.gg (21:00 CEST).
