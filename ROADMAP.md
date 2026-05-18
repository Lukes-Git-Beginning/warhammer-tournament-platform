# ROADMAP — Rizzotto

> **Stand:** 2026-05-13 · **Phase:** Post-Launch · **Nächstes Ziel:** M6 Hub-Foundation
>
> Diese Roadmap ist die SSOT für *was gebaut wurde*, *was als nächstes kommt* und *was bewusst nicht gebaut wird*. Sie wird laufend gepflegt — wenn ein Milestone landet, wird dort `✅ done` mit Datum gesetzt und neue Folgearbeit hier nachgezogen.

---

## TL;DR

- **M1–M5 sind durch** (Launch-Ready, 2026-05-13). Plattform ist live-tauglich für Single-Elim, Swiss, Round-Robin, Double-Round-Robin + Draft.
- **Heute offen (Tech-Debt):** DOUBLE_ELIMINATION als 501-Stub, `@tww3/*` Workspace-Rename, kosmetische Kommentare. Visual-Snapshots + M1.4-Kommentar wurden 2026-05-13 nachgezogen.
- **Kurzfristiger Asset-Block:** 24 Faction-Crests im "Sigil in the Stone"-Stil generieren (KI, sobald ChatGPT-Limit resettet) — ersetzt die aktuellen Initialen-Bubbles auf `/fraktionen`.
- **Mid-Term Hub-Roadmap:** M6 Quick-Wins → M7 Datentiefe → M8 UGC → M9 Team-Play. Details unten.
- **Bewusst geparkt:** In-App-Listenbauer, Live-Stream-Embed, Coaching/Mentorship, Achievements (siehe Out-of-Scope).

---

## Milestone-Status

| Milestone | Zeitraum | Status | Highlights |
|-----------|----------|--------|------------|
| **M1 — Foundation & Live-Core** | Woche 1–4 | ✅ done | Monorepo, Prisma 7 + Postgres, Discord-OAuth2, Tournament-CRUD, Single-Elim, Socket.IO + Redis-Adapter |
| **M2 — Swiss & Leaderboard** | Woche 5–7 | ✅ done | Swiss/RR/DRR via `tournament-pairings`, Season-Modell, ELO-Leaderboard, Redis-Caching |
| **M3 — Faction-Stats & Meta** | Woche 8–10 | ✅ done | GraphQL via mercurius, `FactionStats`, 24×24-Matchup-Heatmap, Meta-Dashboard, 30-Tage-Trend-Snapshots |
| **M4 — Draft-System** | Woche 11–17 | ✅ done | Draft-Engine als Service, Redis-Timer-Rehydration, Lobby-UI, Preset-Editor, Event-Log |
| **M5 — Polish, Scraper, Admin, E2E** | Woche 18–22 | ✅ done | Army-Upload + Parser, totaltavern-Scraper (read-only), Admin-Panel, Playwright-E2E, SEO, **Rizzotto-Rebrand** |
| **M5.5 — UI-Overhaul + Onboarding** | 2026-05 | ✅ done | Souls-like-Atmospheric-UI, DRY EmptyStates, Onboarding-Flow, Inner-Page-Atmosphere (`f185eec` … `ef0fdd2`) |

**Verdict:** Die Original-Schätzung (17–22 Wochen) wurde eingehalten. Plattform ist produktionsreif.

---

## Aktuelle Tech-Debt (Stand 2026-05-13)

Punch-List, nach Severity sortiert:

| # | Issue | Pfad | Severity | Status |
|---|-------|------|----------|--------|
| 1 | **DOUBLE_ELIMINATION** wirft 501, obwohl Enum + UI das Format anbieten | `apps/backend/src/routes/bracket.ts:191,257` | Mittel — silent feature break | Eigener Feature-Block, s. unten |
| 2 | Visual-Test-Snapshots committed | `apps/e2e/tests/visual/landing-overhaul.spec.ts-snapshots/` | — | ✅ `b898fa5` |
| 3 | Faction-Artwork sind Initialen-Platzhalter | `packages/db/prisma/seed.ts:33`, `apps/frontend/src/components/meta/FactionBadge.tsx` | Niedrig — Ästhetik | M6, blockiert auf Assets |
| 4 | `@tww3/*` Workspace-Rename ausstehend | Monorepo-weit | Niedrig — Tech-Debt | M6 |
| 5 | Veralteter M1.4-Kommentar in `api.ts` | `apps/frontend/src/lib/api.ts:46` | Trivial | ✅ `a5cc0d5` |
| 6 | `Tournament.poster_url` nie als Upload-Flow umgesetzt | `packages/db/prisma/schema.prisma:172` | Niedrig | M6 optional |
| 7 | `SigillumSection`-Community-Links sind Platzhalter | `apps/frontend/src/components/landing/SigillumSection.tsx:93` | Niedrig | M6 |
| 8 | `ImportLog` ohne Admin-UI sichtbar | — | Niedrig | M6 |
| 9 | `Team`/`TeamMember`-Models reserviert aber ungenutzt | `packages/db/prisma/schema.prisma:286` | — | M9 |
| 10 | Scraper-Tournament-Write-Path nicht implementiert | `scraper/src/cli.ts:148` | Mittel — Daten-Hebel | M7 |

Sonst überraschend sauber — keine `@ts-expect-error`, kein `FIXME`/`HACK`.

---

## Kurzfristig: Faction-Crests-Asset-Block

**Ziel:** Die 24 Initialen-Bubbles auf `/fraktionen` durch heraldische Crests ersetzen.

### Code-Aufwand (sobald Assets da sind): ~30–45 Min.

1. `FactionBadge.tsx` — `icon_url`-Prop annehmen, `<img>` rendern, Fallback auf Initialen bei `null`.
2. `FactionListPage.tsx` — `icon_url` an `FactionBadge` durchreichen.
3. Asset-Dateien nach `apps/frontend/public/icons/factions/<slug>.svg` (bzw. `.avif`/`.webp`) legen.

**Keine Schema-Migration.** `Faction.icon_url String?` existiert (`schema.prisma:145`), Seed füllt es bereits (`seed.ts:34`), Backend mappt es im DTO. Nur die Komponente ignoriert es aktuell.

### Asset-Beschaffung

**Empfehlung: KI-Generierung** (DALL-E / Gemini / ChatGPT-Image), nicht Online-Scrape.

| Option | IP-Recht | Konsistenz | Verdikt |
|--------|----------|------------|---------|
| Offizielle GW-Artworks | ❌ IP-Verletzung | Hoch | **Nein** |
| Wiki/Fan-Art zusammenklauben | ⚠️ rechtlich grau | Niedrig | Notlösung |
| KI generieren mit Style-Prompt | ✅ sauber bei generischen Prompts | Hoch (1 Style-Session) | **Empfehlung** |

### Prompt-Pattern (gehört nach `docs/design/13-asset-generation.md` Abschnitt "Faction Sigils")

Erweitert das Shared-Preamble dort. Vorschlag für die neue Sektion:

```
**Use**: Faction crest badges on /fraktionen, faction detail headers.

**Prompt** (template):
> [shared preamble] **Heraldic faction crest, carved bas-relief sigil on
> dark anthracite stone tablet, cold gold inlay highlights, single
> centered emblem, perfectly symmetric, vector-clean line work, 1:1
> square, transparent or solid dark background, no text, no banner. The
> emblem subject is: <SUBJECT>.**
```

**24 Subject-Phrasen** (slugs aus `seed.ts:34`):

| Slug | Subject-Phrase (IP-sauber, generisch) |
|------|---------------------------------------|
| `empire` | twin-tailed comet over hammer-cross |
| `bretonnia` | fleur-de-lis over crossed lances |
| `kislev` | double-headed bear over crossed axes |
| `grand_cathay` | imperial dragon coiled around mountain peak |
| `dwarfs` | rune-engraved warhammer over anvil |
| `high_elves` | upright phoenix over crescent moon |
| `lizardmen` | scaled serpent coiled around sun-disc |
| `greenskins` | jagged tribal mask with crossed cleavers |
| `dark_elves` | barbed crescent over inverted star |
| `skaven` | rat skull over crossed warp-blades |
| `norsca` | wolf head over crossed great-axes |
| `ogre_kingdoms` | bull skull over crossed clubs |
| `beastmen` | horned skull over broken pillar |
| `khorne` | brass skull over crossed cleavers |
| `nurgle` | three-circle plague mark over rotted leaves |
| `tzeentch` | nine-pointed star over coiled serpents |
| `slaanesh` | androgynous mask over crossed claws |
| `daemons_of_chaos` | eight-pointed star at center, no other elements |
| `warriors_of_chaos` | eight-pointed star over crossed great-swords |
| `chaos_dwarfs` | horned bull-skull over hammer |
| `vampire_counts` | bat-winged skull over scythe |
| `vampire_coast` | tricorn skull over crossed cutlasses |
| `tomb_kings` | golden Khopesh-bladed cross over sun-disc |
| `wood_elves` | leaf-wreathed antler crown over longbow |

**Workflow:**
1. Style-Prompt einmal an Fraktion 1 (z.B. Dwarfs) perfektionieren — das wird Master.
2. Subject pro Fraktion austauschen, Style-Block identisch lassen.
3. Bei Fraktion 13 Style-Reminder einfügen (Drift-Schutz).
4. Export: 1:1 PNG → SVG-Trace (Illustrator/Figma/`svgo`) oder als AVIF+WebP halten.
5. Filename: `<slug>.svg` (oder `.avif` mit fallback `.webp`).
6. Commit-Konvention: `feat(web): faction crest art (KI-generated, prompts pinned in docs/design/13-asset-generation.md)`.

**Fallback:** Initialen-Bubbles polieren (Typografie + dezenter Textur-Hintergrund), 1 h Arbeit.

---

## M6 — Hub-Foundation *(1–2 Wochen, hoher Impact, niedriges Risiko)*

Alle Punkte unter 1 Tag Arbeit, alle Daten existieren bereits.

### Ziele
Die Plattform fühlt sich nach M6 personalisiert, hierarchisch und visuell konsistent an.

### Scope

1. **Faction-Crests einbauen** (s.o.) — sobald Assets da sind
2. **Head-to-Head Player Stats** — Route `/users/:a/vs/:b`, Direktbegegnungs-History. Match-Daten existieren, nur Aggregation + UI. Gaming-Hub-Standard
3. **`preferred_factions`-Personalisierung** — Landingpage zeigt "Dein Meta" (Winrate-Trend der gewählten Fraktionen, 30 Tage). Feld existiert (`schema.prisma:107`), wird im Onboarding befüllt, aber nirgends ausgewertet
4. **Tournament-Kalender-View** + iCal-Export (RFC 5545) — alle Daten da, nur ein Render-Modus
5. **Major/Regular Tournament UI-Distinction** — Badge auf Cards, Filter auf Liste, Landingpage-Hervorhebung. `Tournament.is_major`-Flag existiert ungenutzt (`schema.prisma:187`)
6. **Echte Community-Links setzen** — Discord-Server-ID, GitHub-Repo, Reddit (`SigillumSection.tsx:93`)
7. **ImportLog Admin-UI** — Scraper-Lauf-Sichtbarkeit, paginierte Liste analog zu AuditLog
8. **Tech-Debt-Hausputz:** `@tww3/*` Workspace-Rename als dedizierter Refactor-PR
9. **`Tournament.poster_url`-Upload-Flow** (optional, niedrige Prio)

### Out: DOUBLE_ELIMINATION
Bewusst nicht in M6 — eigenständiger Feature-Block (s.u.), weil Schema-Migration.

---

## M7 — Datentiefe & Army-List-Database *(2–3 Wochen, sehr hoher Impact)*

### Ziele
Rizzotto wird zur **Inspirationsdatenbank** für Listenbau-Phase + bekommt echte externe Daten.

### Scope

1. **Army-List-Browser** — `ArmyList.parsed_data` ist ein JSON-Schatz (`{ battle_type, lord, units }`), aktuell upload-only. UI mit Filter (Faction/Lord/Battle-Type), Search, "neueste Listen", "meistgesehene Listen". Killer-Feature für Old-World-Spieler, die wochenlang an Listen feilen
2. **Scraper Write-Path implementieren** — `ExternalTournament`-Tabelle anlegen, totaltavern.com-Daten persistieren (`scraper/src/cli.ts:148` — heute explizit "write-path not implemented"). `FactionStats` profitiert dann von externer Match-Basis, nicht nur interne Spiele
3. **Realtime-Leaderboard** — Socket-Push bei ELO-Änderung nach Match-Result. Aktuell REST-Pull
4. **News-/Patch-Notes-Feed** — neue `News`-Tabelle (Admin-only-Posts), Frontend-Route `/news`, Landingpage-Integration. Hub-Layer #1
5. **Scraper-Erweiterung (Backup-Source)** — tabletop.to als zweite Datenquelle einbauen, damit `FactionStats` nicht an totaltavern-DOM-Änderungen stirbt

### Risiko
Scraper-Selektoren sind fragil — beide Quellen sollten Sentinel-Tests haben, die wöchentlich gegen Live-DOM laufen.

---

## M8 — UGC & Battle-Reports *(3–4 Wochen, transformativ)*

### Ziele
Plattform wird Content-Hub, nicht nur Tool-Hub. Spieler bringen ihre eigenen Geschichten ein.

### Scope

1. **Battle-Report-Editor** — Markdown + Photo-Upload (S3/Vercel-Blob), Match-Timeline, Card-Embeds für referenzierte Listen/Fraktionen. Verknüpft mit `Match.id` (optional, wenn das Spiel auf der Plattform geführt wurde)
2. **Comment-System** — auf Match-Detail-, Tournament- und Battle-Report-Seiten. Markdown, Soft-Delete, Moderation-Flag-System
3. **Discord-Bot zur Match-Reporting-Integration** — Spieler reportet Match-Ergebnis im Discord-Channel, Bot triggert Backend-Endpoint. Reduziert Friction bei Real-Life-Turnieren

### Risiko
UGC braucht Moderation. Plan ab ~50 aktive Schreiber: Flag-Queue + Auto-Throttle für neue Accounts.

### Henne-Ei-Caveat
M8-Features brauchen kritische Masse, sonst sind sie tote Knöpfe. M6/M7 zuerst, weil die auch mit einem Nutzer Wert haben (Daten + Personalisierung).

---

## M9 — Team-Play *(4+ Wochen, große Wette)*

### Ziele
3v3 / SfT / Blind Pick aktivieren — die turniertaugliche Old-World-Form in DACH.

### Scope

1. **Team-Management UI** — `Team`/`TeamMember`-Models existieren als "Phase 3 reserved" (`schema.prisma:286`). UI: Team gründen, Mitglieder einladen, Team-Profil
2. **`TournamentMode.THREE_V_THREE` aktivieren** — Schema vorhanden, Backend-Logik: Match-Tisch zwischen Teams, individuelle Match-Ergebnisse aggregieren zum Team-Result
3. **Blind-Pick-Modus** — Pick ohne Sicht auf Gegner-Listen bis zur ersten Runde
4. **SfT (Swiss-for-Teams)** — Swiss-Pairing-Algorithmus für Teams (Team-ELO oder Team-Score als Pairing-Basis)

### Vorab
Spec-Klärung mit Insidern bevor das Schema final wird (s. Original-ROADMAP-Risk-Mitigation #3). 3v3 ist ein anderes Datenmodell.

---

## DOUBLE_ELIMINATION — eigenständiger Feature-Block

**Re-scope nach 2026-05-13-Recherche:** Im ursprünglichen Plan stand "Hausputz", nach Code-Lesen ist das *nicht* trivial.

### Warum nicht Hausputz
Das `Match`-Schema hat aktuell nur `next_match_id` (Single-Link, `schema.prisma:258`). Für DoubleElim braucht's:

1. **Prisma-Migration:**
   - Neues Feld `loser_next_match_id String? @db.Uuid` mit Self-Relation
   - Neues Enum `BracketSide { WINNERS, LOSERS, GRAND_FINAL }` + Feld `Match.bracket BracketSide @default(WINNERS)`
   - Optional: `Match.grand_final_reset Boolean @default(false)` für Bracket-Reset-Match
2. **Lib-Funktion** `generateDoubleElim()` in `apps/backend/src/lib/bracket.ts` — entweder via `tournament-pairings.DoubleElimination()` oder selbst gebaut nach Single-Elim-Pattern (`bracket.ts:28`)
3. **Loser-Drop-Progression** in `apps/backend/src/routes/matches.ts` — beim Match-Result: Gewinner geht zu `next_match_id`, Verlierer (falls Winners-Bracket) zu `loser_next_match_id`. Im Losers-Bracket: Verlierer scheidet aus. Grand-Final mit Bracket-Reset-Logik
4. **`BracketResponse`-DTO erweitern** in `packages/types/src/api-schemas.ts` — separate Listen für Winners/Losers/Grand-Final
5. **Frontend-Rendering** — `TournamentDetail.tsx` muss zwei Bracket-Trees getrennt rendern + Grand-Final hervorgehoben. Aktuell rendert die UI nur einen Baum
6. **Tests** — Unit für Lib + Integration für Progression + Visual für Frontend

### Aufwands-Schätzung
**1–2 Tage solide Arbeit** für einen geübten Implementator. Eigener PR, eigener Plan-File.

### Status
Geparkt — sobald M6 läuft oder direkt nach M6 als Single-PR. UI bietet das Format heute schon an, daher: **mittelschwer-priorisiert** als silent-bug-Fix.

---

## Out-of-Scope (bewusst geparkt oder verworfen)

| Idee | Begründung |
|------|------------|
| **In-App-Listenbauer** (Drag-Drop-Army-Editor) | Externe Tools (Old World Builder, Old World Almanack) decken das gut ab. Reinventing the wheel. **Skip.** |
| **Live-Stream-Twitch-Embed** | Old-World-Stream-Szene zu klein für Featurewert. **Wait** (Re-Evaluation nach M9) |
| **Coaching-/Mentorship-Matching** | Nische zu klein, Moderations-Aufwand zu hoch. **Skip** |
| **Achievements/Badges** | Gamification kann billig wirken. **Wait** bis M8 steht und UGC-Engagement messbar ist |
| **Federation/Multi-Tenant** | Original-Spec-Entscheidung: Single-Tenant bleibt. **Permanent skip** |
| **Mobile-Native-App** | PWA-Pfad ist pragmatischer. Falls Bedarf entsteht: PWA-Manifest in M6+ ergänzen, nicht Native |

---

## Architektur-Anker (von Tag 1, bleibt verbindlich)

Diese Entscheidungen wurden vor dem ersten Commit getroffen und haben sich gehalten. Werden für M6+ nicht angerührt:

- **Single-Tenant** — keine Mandanten-Spalten in Tables
- **Socket.IO mit `@socket.io/redis-adapter`** — Multi-Instance-fähig ab Tag 1
- **Draft-Timer-State in Redis** (`draft:{id}:state`) — Backend rehydriert aus `timerExpiresAt`, keine Memory-Source-of-Truth
- **Auth: JWT in HTTP-Only-Cookie** — kein Server-Session-Storage, WebSocket-Auth via Cookie-Handshake
- **Stats: Inkrementelle Counter** (`FactionStats`, `FactionStatsSnapshot`, `MatchupStats`) — keine Live-Aggregation aus Match-Rohdaten
- **Pairing: `tournament-pairings`-Library** — Algorithmus-Korrektheit nicht selbst verantworten
- **Prisma 7 driver-adapter** — `datasource.url` in `prisma.config.ts`, nicht in `schema.prisma`

---

## Risk-Mitigation-Anker (Original, mit aktuellem Stand)

| # | Komplexität | Original-Strategie | Stand 2026-05-13 |
|---|-------------|--------------------|------------------|
| 1 | Draft-Timer-Recovery | Redis-Hash `draft:{id}:state`, ephemere `setTimeout` rehydrieren | ✅ implementiert in M4 |
| 2 | Double Elimination Bracket | `tournament-pairings` + custom 2-teilige SVG | ⏳ als 501-Stub, eigener Feature-Block |
| 3 | Swiss-Pairing | `tournament-pairings` mit `avoidRematches: true` | ✅ implementiert in M2 |
| 4 | WebSocket-Scaling | `@socket.io/redis-adapter` mit gleichem Redis | ✅ implementiert in M1 |
| 5 | Army-List-Parser | Phased Best-Effort | ✅ Basis in M5, Browse-/Search-UI offen für M7 |
| 6 | 3v3/Blind-Pick/SFT | Enum reservieren, 501-Handler, "(Coming Soon)" | ⏳ Schema vorhanden, M9 |

---

## Verifikation (E2E-Coverage-Stand)

Aktuelle Playwright-Suite (`apps/e2e/tests/`) deckt ab:

1. ✅ **Tournament Lifecycle Happy Path** — 16-Spieler Single-Elim
2. ✅ **Live-Draft end-to-end** — zwei Browser-Tabs, echte WebSocket-Verbindungen
3. ✅ **Swiss Rematch-Avoidance** — 8 Spieler, 4 Runden
4. ✅ **Leaderboard-Punkte-Korrektheit** — drei Turniere gegen Formel
5. ✅ **Reconnect-Recovery bei laufendem Draft** — Backend-Restart
6. ✅ **Visual-Regression** — Landing, Leaderboard, Login (Desktop/Tablet/Mobile)

**Manuell vor jedem Major-Turnier:** Vollständiger Draft im Staging, Swiss-Bye-Logik bei ungerader Spielerzahl, Timezone-Anzeige für nicht-europäische User, Mobile-Bracket-View.

**Noch nicht abgedeckt:** DoubleElim-Lifecycle (sobald implementiert), Army-List-Browse-Flow (M7), Battle-Report-Editor (M8).

---

## Pflege-Konvention

- Wenn ein Milestone landet: **`✅ done` mit Datum + Commit-Hash** in der Status-Tabelle setzen
- Wenn Tech-Debt entdeckt wird: in die Punch-List oben aufnehmen, mit Pfad + Severity
- Wenn ein Out-of-Scope-Punkt re-evaluiert wird: Datum + Begründung im Skip-Eintrag aktualisieren
- Wenn ein neuer Milestone gestartet wird: Sub-Skill-Plan unter `~/.claude/plans/m<N>-*.md` ablegen, hier nur die Übersicht halten

---

## Cross-Referenzen

| Thema | Datei |
|-------|-------|
| Design-System, Tokens, Brand, Asset-Prompts | `docs/design/README.md` (Hub), `docs/design/13-asset-generation.md` (Prompt-Bibliothek) |
| Datenmodell, Prisma | `.knowledge/database.md` |
| Caching | `.knowledge/caching.md` |
| Auth, JWT, Discord-OAuth2 | `.knowledge/auth.md` |
| Socket.IO, Realtime | `.knowledge/realtime.md` |
| Draft-System State-Machine | `.knowledge/draft-system.md` |
| Frontend-Patterns, Router | `.knowledge/frontend-patterns.md` |
| Tests | `.knowledge/testing.md` |
| ELO/Swiss/Bracket-Algorithmen | `.knowledge/algorithms.md` |
| Shared Types, Zod-Contracts | `.knowledge/types-contracts.md` |
| Backend-Architektur | `.knowledge/backend-architecture.md` |
| Top-Level-Commands, Stack | `.knowledge/stack.md` |

---

## Quellen-Specs (historisch)

Die ursprünglichen Spec-Dokumente bleiben als Historie erhalten — nicht löschen, aber auch nicht aktualisieren. Sie spiegeln den **Plan vor M1**, nicht den heutigen Stand.

- `WARHAMMER_PLATFORM_PROMPT_TEIL_1.md` — Projekt-Übersicht, Tech-Stack, Auth, Tournament-Management, Bracket-View
- `WARHAMMER_PLATFORM_PROMPT_TEIL_2.md` — Draft-System (Captain's Mode), Army-Lists-Parser, Leaderboard, Season-Management
- `WARHAMMER_PLATFORM_PROMPT_TEIL_3.md` — Faction-Statistiken, UI/UX-Design, Scraper, Deployment, Testing, Zeitplanung
