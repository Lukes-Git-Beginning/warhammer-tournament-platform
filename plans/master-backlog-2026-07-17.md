# Master Backlog — Stand 2026-07-17

Konsolidiert aus `ROADMAP.md` + allen `plans/*.md` + den Deploys dieser Session.
Nummerierung #1–#50 ist **ad hoc vergeben und lückenhaft** (nicht kontinuierlich).
N-Items = neu aufgenommen 2026-07-16/17.

---

## 🆕 NEU — offene To-dos (2026-07-16/17)

| # | Item | Typ | Notiz |
|---|------|-----|-------|
| N1 | „I won"/„Opponent won"-Buttons reagieren nicht auf Hover — einheitlich (subtil) machen | 🔧 UX | Rest der UI hat Hover-States |
| N3 | Late-Join-Option darf bei **Single Elimination** nicht erscheinen | 🔧 | Late-Join ist ein Swiss/BaLi-Konzept |
| N4 | Default-Regeln: „Nutzung von Bugs/Exploits = Cheating → Disqualifikation" ergänzen | 📝 Copy | |
| N5 | Random-Map-Pick: Slot-Machine-Animation (Map-Bilder rollen ~1–2 s, wie Coin-Flip) | 🎨 UX | |
| N6 | **Skill-Band → Discord-Rollen-Sync** | 🆕 Feature | Platform-Seite baubar; braucht Server-seitig: 5 Rollen anlegen, Bot „Manage Roles", **Bot-Rolle über den Band-Rollen** (Hierarchie!). Offen: welches Band (Empf.: Gating-Band, nur-nach-oben), Unrated-Handling, Sichtbarkeit. Sync: Login-Hook + nächtlicher Cron. Infra ~90 % da (Bot fasst Mitglieder schon an, `auth.ts:122-138`). |
| N7 | **Verfügbarkeits-basierte Turnier-Einladungs-DM** | 🆕 Feature | DM an alle, deren `AvailabilitySlot` das Turnier abdeckt. **KOMPLEXER:** nicht nur Startzeit, sondern **Turnier-Zeitfenster (Dauer)** + **Late-Join-Fähigkeit des Formats** (wer erst später verfügbar ist, kann bei Swiss/BaLi noch rein — bei SE nicht, siehe N3). Spam-Suppression wie beim Availability-Ping (Live-Match/laufendes Turnier muten, Registrierte muten, Opt-out). Offen: an alle oder skill-band-gefiltert bei gegateten Turnieren. Existiert NICHT — nur Channel-Post (T1) + Check-in-DM an bereits Registrierte. |

| N8 | Formular-Reihenfolge: **Match Mechanics + Map Pool** direkt hinter **Automation** ziehen (vor Late-Join) | 🔧 UX | Gilt für **beide** Formulare: `TournamentCreateForm.tsx` (Match Mechanics ~Z.702, Map Pool ~Z.883, Automation-Ende ~Z.549) UND `TournamentEditPage.tsx`. Ziel-Reihenfolge: Format/Mode → Automation → **Match Mechanics → Map Pool** → Late-Join → Start/Availability → Max/Deadline → Rules → Discord/Stream/Poster. Großer JSX-Block-Move → bewusst machen. |

**N2 (Major-Wins zeigt Nicht-Sieger) — gestrichen: war ein Doppel-Post, kein Bug.**

---

## ◻️ Offen aus #1–#50 / Plänen

- **#16** — Auto-Size blendet Swiss-Rounds/Playoff-Optionen nicht aus (Branch `fix/balanced-hide-manual-config`, nicht gebaut).
- **#23 (a/b/c) / #50** — Ende-Swiss- & Playoff-DMs (DM-Katalog **P1–P7**): Playoff-Quali, Playoff-Pairing, Grand-Final/3rd, Run-over, Auto-Size-Änderung (P6), Stream-Link (P7). 📐 **designt, nicht gebaut.**
- **Durabler Pick/Ban-Event-Log** (append-only) — Pick/Bans gehen bei Void/Forfeit/Override verloren, nicht rückwirkend rekonstruierbar. 📐 designt.
- **Pick/Ban-Analytics** (Branch `feat/pickban-stats`, `636552b`) — „No data"-Fix + echte Fraktions-Agg + Matchups-Entity + „All Seasons". 🔨 **gebaut, nicht deployt.**
- **Bye-bewusstes Connector-Layout / Viertelkreis-Ecken** — Bracket-Connector liegen Ecke-auf-Ecke (sieht wie Kreuzung aus); Fix = abgerundete Ecken (`SVGBracket.tsx:169`, Radius r). Post-Turnier, do NOT touch while live.

---

## ✅ Nummerierte Items #1–#50 (Referenz-Status)

**#1–#19** (Quick-Wins-Backlog 15.07.):
1 Node-Edit-Modal off-screen — ✅ (Modal portalt zentriert; Edit in Admin-„All Games")
2 Faction-Pick-Timer global — ✅ · 3 Withdraw→Void-Integrität — ✅ (+ Playoff-Drop-Fix) · 4 Late-Byes = 0 Pkt — ✅ · 5 Late-Joiner Frontier — ✅ (BaLi 2.0) · 6 Major-Wins-Leaderboard — ✅ · 7 Open-Play „currently playing" — ✅ · 8 DM→Game-Kachel-Link — ✅ · 9 Free-Pick-Standings — ✅ · 10 Picker schließt bei Gegner-Drop — ✅ · 11 Map-Pack-Hinweis — ✅ · 12 Queue-Quelle-Metrik — ✅ · **13 Fraktions-Favourability + Model Strength — ✅ (heute)** · **14 General-Skill-Leaderboard — ✅ (heute)** · 15 Faction War — ✅ · **16 Auto-Size-Config ausblenden — ◻️ OFFEN** · 17 Admin-Report (unverifiziert/nie gespielt) — ✅ · 18 „Unrated"-Label — ✅ · 19 Underrated-Admin-View — ✅

**Höhere (code-referenziert):** 23 Ende-Swiss-DMs — 📐 designt · 25 Bracket-Fit — ✅ · 26 Swiss-Tiebreak deterministisch — ✅ · 27 Kalibrierungs-Audit — ✅ · 29 Host-Faction-Edit — ✅ · 30b Host-Remove-Teilnehmer — ✅ · 37 Auto-Sizing opt-in — ✅ · 40 Dynamisches Re-Sizing — ✅ (P6-DM designt) · 43 „3 Random Fraktionen"-Picker — ✅ · 49 Kein Auto-Start — ✅ (Guard) · 50 Stream-Link-DM — 📐 designt.
(#20–22, 24, 28, 31–36, 38–39, 42, 44–48 existieren nicht.)

---

## ✅ Milestones & Wellen — LIVE

- **M1–M8** komplett (Foundation/Single-Elim, Swiss/RR/DRR + Leaderboard, Faction-Stats/Meta/Heatmap, Draft-System, Polish/Admin/E2E, Hub H2H+Kalender+iCal+Major, **M8 Open Play/Ladder**).
- **Formate live:** Single-/Double-Elim, Swiss, Auto-Swiss, RR/DRR, Liechtenstein, **Balanced Liechtenstein 2.0**, MATRIX 3×3, BPT/SFT/SLT/Free-Pick, **1v3 (ONE_V_THREE, Bo2)**, **Faction War**.
- **Discord-Bot RizzBOTto** live (Check-in-/Match-Reminder, Lobby-Finder, Dispute-DMs, Auto-Guild-Join beim Login).
- **Diese Session live:** BaLi-2.0-Engine · Faction War · Major-Wins aus Match-Daten + Game-Wins-Tiebreaker · Playoff-Drop-Notify+Walkover · Heatmap-Vereinheitlichung (Official-Flag autoritativ) · Admin-„All Games" (inline-editierbar + Official-Toggle + Replay + Hard-Delete + **Game-Audit-Filter**) · Per-Game-Override-Modal · #13 · #14 · Check-in bei Single-Elim · **Bracket-Overlap-Fix**.

---

## 💭 Erwogen / zurückgestellt (post-v1)

2FT/3FT- & 2v2-Formate · MMR-Matchmaking-Format · 2×2-Ranked-Matchup (Borda) · Liechtenstein Early-Clinching + aktive Mirror-Vermeidung · **Auto-Replay-Verifikation** (ESF-Parser: Faction/Map/Spieler lesbar, Sieger braucht Type-Code-Walker; Nutzen: Anti-Cheat/Auto-Result) · `poster_url`-Upload · `LeaderboardEntry`-Feld-Cleanup · Cold-Fit-Kosten als Cron.

**Spätere Milestones:** M9 Datentiefe (Scraper-Write, News-Feed, Realtime-Ticker) · M10 UGC/Battle-Reports + Kommentare · M11 Team-Play (3v3, SfT) · M12 Army-List-Browser/SLT-Vertiefung.

---

## 🚫 Out-of-Scope

In-App-Listenbauer · Twitch-Embed · Coaching-Matching · Achievements/Badges · Federation/Multi-Tenant · Native-App (PWA-Pfad).
