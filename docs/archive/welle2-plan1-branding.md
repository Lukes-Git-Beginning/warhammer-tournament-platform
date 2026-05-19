# Welle 2 — Plan 1: Branding & Voice Renovation

> **Status:** Geplant 2026-05-19 (Alex-Briefing). Parallelitätsklasse A — komplett unabhängig, blockiert nichts. Kann ab Tag 1 mit Sub-Agent starten.
>
> **Master-Plan:** [`commands-f-r-das-neue-starry-hare.md`](../../../.claude/plans/commands-f-r-das-neue-starry-hare.md) (lokales Plan-File, nicht im Repo).
>
> **Sibling-Pläne:** [Plan 2 – Tournament-Mechanik](./welle2-plan2-tournament-mechanics.md) · [Plan 3 – Admin & Stats & MMR](./welle2-plan3-admin-stats-mmr.md)

## Context

Alex hat im 2026-05-19-Call angegeben:

- **Logo ist inkonsistent** — manchmal vertikal, manchmal geneigt. Soll näher an Vorlage `c:\Users\Luke\Downloads\WhatsApp Image 2026-05-14 at 11.12.22 AM.jpeg` (glossy 3D-Aubergine, diagonale Pose ~30° geneigt, Stiel oben-links, lila Hochglanz, Pink/Magenta Bokeh-Glow). Relief-Stil bleibt.
- **Logo zu klein im Header.** Aktuell `h-12 sm:h-14` → soll `h-20 sm:h-24` (+66%).
- **Wordmark "RizzOtto"** — die Großbuchstaben (R und O) sollen visuell 1.5x größer dargestellt werden als die regulären Buchstaben.
- **Voice ist zu altertümlich.** Komplett-Cleanup pauschal: Hall→Home, Roll of Honour→Leaderboard, Conclave→Profile, Forge→Library, Muster→Tournament, Workshop→Settings. Alle Latin/Khazalid-Mottos raus.
- **Tournaments-Tab im Header fehlt.** Soll als neuer Top-Nav-Tab mit 3 Sub-Tabs (Upcoming / Live / Archive) eingebaut werden. Live-Tournaments-Section bleibt zusätzlich auf Home.
- **Faction-Sigils Norsca + Ogre Kingdoms** sind aktuell als Initialen-Fallback gerendert. Alex hat fertige PNGs in seinen Downloads.

## Scope

### 1.1 Logo-Master-Prompt & Asset-Re-Generation

| Aktion | Pfad |
|--------|------|
| Master-Prompt aktualisieren (diagonale Pose, ~30°, Stiel oben-links, lila Hochglanz, Pink-Glow) | `docs/design/13-asset-generation.md` §2 |
| Neu-Generierung mit Seed-Pinning | `apps/frontend/public/img/rizzotto-sigil.{png,webp,avif}` |
| Bronze-Variante (Footer) | `apps/frontend/public/img/rizzotto-sigil-bronze.{png,webp,avif}` |
| OG-Image neu (1200×630) | `apps/frontend/public/og-image.png` |
| Favicon neu | `apps/frontend/public/favicon.png` |

**Konsistenz-Strategie:** Seed im Prompt-File committen. Falls Generierung instabil → SVG-Master (von einem Illustrator vektorisiert) als Source-of-Truth, alle Raster-Varianten daraus rendern.

### 1.2 Wordmark-Reset

| Aktion | Pfad |
|--------|------|
| "RizzOtto" mit Capitals 1.5x neu rendern | `apps/frontend/public/img/rizzotto-wordmark.{png,webp,avif}` |
| Bronze-Variante | `apps/frontend/public/img/rizzotto-wordmark-bronze.{png,webp,avif}` |
| Component bleibt — nur Asset wird ausgetauscht | `apps/frontend/src/components/icons/RizzottoWordmarkImage.tsx` |

**Optional:** SVG-Wordmark statt PNG für pixelperfekt-Skalierung. Falls SVG: handgemacht in Figma/Illustrator, dann committen.

### 1.3 Header-Größe + Tournaments-Tab

| Aktion | Pfad / Zeile |
|--------|-------------|
| Wordmark-Größe anheben | `apps/frontend/src/components/layout/Header.tsx:78` — `h-12 sm:h-14` → `h-20 sm:h-24` |
| Neuer Header-Tab "Tournaments" zwischen "Home" und "Factions" | `apps/frontend/src/components/layout/Header.tsx:26-66` |
| Neue Route registrieren | `apps/frontend/src/router.tsx` — `tournamentsListingRoute` |
| Neue Page mit 3 Sub-Tabs (Upcoming/Live/Archive) via Search-Params | `apps/frontend/src/routes/TournamentsListing.tsx` (NEU) |
| Listing-Komponente: Card-Grid, Filter über Tabs, Pagination | `apps/frontend/src/components/tournament/TournamentListGrid.tsx` (NEU) |
| Aktuelle "View all"-Verlinkung in ActiveMustersSection korrigieren | `apps/frontend/src/components/landing/ActiveMustersSection.tsx:145` (link auf `/tournaments?tab=live`) |

### 1.4 Voice-Cleanup pauschal

**i18n-Keys umbenennen** (`apps/frontend/src/i18n/locales/{en,de}/common.json`):

| Alt | Neu (EN) | Neu (DE) |
|-----|----------|----------|
| `header.home` "Hall" / "Halle" | "Home" | "Home" |
| `header.leaderboard` "Roll of Honour" | "Leaderboard" | "Leaderboard" |
| `conclave.heading` "The Conclave" | "Profile" | "Profil" |
| `conclave.cta` "Enter the Conclave" | "View Profile" | "Profil ansehen" |
| `forge_section.eyebrow` "The Forge" | "Library" | "Bibliothek" |
| `user_profile.workshop_title` "The Workshop" | "Settings" | "Einstellungen" |
| `user_profile.workshop_cta` "Revisit the Forge" | "Open Library" | "Bibliothek öffnen" |
| `musters.eyebrow` "Now Mustering" | "Live Tournaments" | "Live-Turniere" |
| `musters.heading` "Active Musters" | "Live Tournaments" | "Live-Turniere" |
| `tournament.create.title` "Call the Muster" | "Create Tournament" | "Turnier erstellen" |
| `tournament.create.aside.heading` "What is a Muster Call?" | "What is a Tournament?" | "Was ist ein Turnier?" |
| `tournament.create.aside.body` "A Muster Call is the formal summons…" | Modernes Tournament-Briefing |
| `onboarding.stage1.cta` "Enter the Forge" | "Open Library" | "Bibliothek öffnen" |
| `onboarding.stage3.cta` "Forge the List" | "Save List" | "Liste speichern" |
| `onboarding.stage5.cta` "Enter the Conclave" | "Go to Profile" | "Zum Profil" |
| `roll_of_honour.heading` "The Roll of Honour" | "Leaderboard" | "Leaderboard" |
| `leaderboard.title` "Roll of Honour" | "Leaderboard" | "Leaderboard" |
| `preset.empty_cta_first` "Forge the first preset →" | "Create your first preset →" | "Erstes Preset anlegen →" |
| `brand.motto` "Karaz Ankor · …" | nur "Where Lists Are Forged." | nur "Where Lists Are Forged." |

**Hardcoded Latin-Mottos entfernen** (alle als dekorative aria-hidden Spans):

- `apps/frontend/src/components/landing/HeroSection.tsx:95` — "Karaz Ankor" raus
- `apps/frontend/src/components/landing/SigillumSection.tsx:71` — "Karaz Ankor" raus
- `apps/frontend/src/components/landing/Footer.tsx:32` — Motto-Span komplett raus, ersetzt durch Plain-Text-Tagline
- `apps/frontend/src/components/landing/RollOfHonourSection.tsx:53` — "In Lapide Sigillata" raus
- `apps/frontend/src/components/onboarding/OnboardingStage4Action.tsx:44` — "Forgia Aeternitatis" raus

### 1.5 Faction-Sigils Norsca + Ogre Kingdoms

| Aktion | Quelle | Ziel |
|--------|--------|------|
| Ogre Kingdoms Sigil committen | `c:\Users\Luke\Downloads\OgreKingdoms.png` | `apps/frontend/public/img/factions/ogre-kingdoms.{png,webp,avif}` |
| Norsca Sigil committen | `c:\Users\Luke\Downloads\Norsca.png` | `apps/frontend/public/img/factions/norsca.{png,webp,avif}` |
| WebP/AVIF-Variants via sharp generieren | Build-Step | — |
| Faction-Lookup-Map prüfen | `apps/frontend/src/components/factions/FactionBadge.tsx` o.ä. | sicherstellen dass slug `norsca` / `ogre-kingdoms` korrekt auf Assets mappt |

## Critical Files

- `apps/frontend/src/components/layout/Header.tsx` — Logo-Größe + neuer Tab
- `apps/frontend/src/components/icons/RizzottoWordmarkImage.tsx` — neuer Asset-Source
- `apps/frontend/src/components/icons/RizzottoSigil.tsx` — neuer Asset-Source
- `apps/frontend/src/i18n/locales/en/common.json` + `de/common.json` — Voice-Cleanup
- `apps/frontend/src/router.tsx` — Tournaments-Route
- `apps/frontend/src/routes/TournamentsListing.tsx` (NEU) — Listing-Page
- `apps/frontend/src/components/tournament/TournamentListGrid.tsx` (NEU) — Card-Grid
- `apps/frontend/public/img/` — alle neuen Assets
- `docs/design/13-asset-generation.md` — Prompt-Master

## Dependencies

Keine. Plan 1 ist unabhängig von DB-Schema (Plan 2) und Admin-API (Plan 3). Kann komplett standalone ausgeführt werden.

## Verification

1. **Visual:** Header rendert neues Logo (diagonal, +66% Größe), Wordmark "RizzOtto" mit Capitals-Akzent, neuer Tournaments-Tab klickbar.
2. **Voice:** `grep -ri "Hall\|Conclave\|Karaz Ankor\|Roll of Honour\|Forgia\|In Lapide" apps/frontend/src` liefert null Treffer in User-facing Code.
3. **Tournaments-Listing:** Sub-Tabs Upcoming/Live/Archive funktionieren, Search-Param-Routing korrekt, Pagination + Empty-State.
4. **Faction-Sigils:** Norsca + Ogre rendern Sigil statt Initialen-Fallback.
5. **Type-Check:** `pnpm typecheck` clean.
6. **Lint:** `pnpm lint` clean.
7. **Manual E2E:** `pnpm dev` starten, alle Routes klicken, Voice-Konsistenz prüfen.

## Sub-Agent-Brief (Welle A.1)

```
Lies zuerst CLAUDE.md, docs/design/README.md, docs/design/13-asset-generation.md.

Implementiere Plan 1 aus docs/roadmap/welle2-plan1-branding.md.

Kritische Punkte:
1. Voice-Cleanup pauschal in i18n-Locales (en + de).
2. Logo + Wordmark-Größe in Header.tsx.
3. Faction-Sigils Norsca + Ogre aus c:\Users\Luke\Downloads\ ins Repo kopieren + WebP/AVIF generieren.
4. Tournaments-Listing-Page mit 3 Sub-Tabs.
5. Neue Logo-Generation: Falls Bild-Tools nicht verfügbar — Master-Prompt updaten und User informieren, dass Asset-Generation manuell durch User erfolgen muss.

Nach Implementation: pnpm typecheck, pnpm lint, pnpm dev und visuell prüfen.

Sonnet, max parallele Sub-Sub-Agents = 1.
```

## Phase-2-Erweiterungen (NICHT jetzt)

- Tournament-Series / Leagues-Branding
- Animierte Logo-Variante für Loading-Splash
- Dark/Light-Theme-Toggle
