# tww3-scraper

CLI tool to scrape faction statistics and tournament data from totaltavern.com
for the TWW3 tournament platform.

## Rechtlicher Status

**Der Scraper ist aktuell deaktiviert in CI (`process.env.CI` guard).**

Die rechtliche Klärung für automatisiertes Scraping von totaltavern.com ist
ausstehend (Stand: 2026-05-13). Bis dahin: nur manuell, lokal, mit defensiver
Rate-Limit-Konfiguration (Default 2000 ms zwischen Requests).

Ein User-Agent identifiziert die Plattform; die Site-Betreiber können
Scraping unterbinden, indem sie diesen User-Agent blocken.

## Installation

Build im Monorepo-Root:

```bash
pnpm --filter @tww3/scraper build
```

## Usage

### Factions

```bash
# Dry-run: parse + print, kein DB-Write
node scraper/dist/cli.js factions --dry-run

# Echter Lauf: schreibt in FactionStats der aktiven Season
node scraper/dist/cli.js factions

# Verbose mit höherer Logging-Granularität
node scraper/dist/cli.js factions --verbose --delay 3000
```

### Tournaments

```bash
node scraper/dist/cli.js tournaments --start-id 2000 --end-id 2100 --dry-run
```

Aktuell ist nur `--dry-run` für Tournaments unterstützt (kein Ziel-Schema
für externe Tournaments). Erweiterung erfordert ein `ExternalTournament`-
Model im Prisma-Schema.

## Audit-Log

Jeder Lauf erzeugt einen `ImportLog`-Eintrag in der DB mit Status, Anzahl
importierter Records, Start-/Endzeit und ggf. Error-Message. Abfragen via
Prisma-Studio oder SQL.

## Rate-Limit

Default 2000 ms zwischen Requests. Anpassbar via `--delay <ms>`. Niemals
unter 1000 ms gehen — totaltavern.com hat keine veröffentlichte Robots.txt-
Limit-Vorgabe, daher fahren wir defensiv.

## CI-Guard

Der CLI-Entry exit'ed sofort mit code 0 wenn `process.env.CI` gesetzt ist.
Build-Steps in CI sind weiterhin möglich (`pnpm build`), nur das Ausführen
ist gesperrt.

## Selector-Tuning

Die Cheerio-Selektoren in `src/scrapers/factions.ts` und
`src/scrapers/tournament.ts` sind best-effort und müssen beim ersten Live-
Lauf gegen die echte Site getuned werden.
