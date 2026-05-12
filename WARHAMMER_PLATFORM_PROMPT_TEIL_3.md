# Warhammer Tournament Platform - Implementierungs-Prompt

## Teil 3/3: Stats, UI/UX, Deployment & Zeitplanung

---

## 12. Faction-Statistiken

### 12.1 Referenz

**Basis:** https://totaltavern.com/factionstatistics
**Ziel:** Nachbauen und verbessern (bessere Visualisierung, Filter, Trends)

### 12.2 Features

#### A) Global Faction-Stats
```typescript
interface FactionStats {
  faction_id: string
  season_id: string

  // Basis-Stats
  matches_played: number
  wins: number
  losses: number
  draws: number
  winrate: number  // Calculated: wins / matches_played * 100

  // Pick/Ban-Stats (für Draft-Turniere)
  pick_count: number
  ban_count: number
  pick_rate: number  // % aller Drafts
  ban_rate: number

  // Trend
  winrate_trend: number  // +5.2% = steigend über letzte 30 Tage
}
```

#### B) Matchup-Matrix (24x24)
```typescript
interface MatchupStats {
  faction_a_id: string
  faction_b_id: string
  season_id: string

  faction_a_wins: number
  faction_b_wins: number
  draws: number
  total_matches: number

  winrate_for_a: number  // Calculated
}
```

**Beispiel:**
```
High Elves vs Skaven:
- High Elves: 15 Wins
- Skaven: 25 Wins
- Draws: 0
- Winrate für High Elves: 37.5% (schwaches Matchup)
```

### 12.3 GraphQL-Schema

```graphql
type Query {
  # Alle Faction-Stats
  factionStats(
    seasonId: ID
    timeRange: TimeRange
    minMatches: Int = 10
  ): [FactionStat!]!

  # Matchup-Matrix
  matchupMatrix(
    seasonId: ID!
  ): [[MatchupCell!]!]!

  # Meta-Analyse
  metaAnalysis(
    seasonId: ID!
  ): MetaAnalysis!
}

type FactionStat {
  faction: Faction!
  winrate: Float!
  pickRate: Float!
  banRate: Float!
  matchesPlayed: Int!
  trend: Float!  # +5.2 = +5.2% steigend
}

type MatchupCell {
  factionA: Faction!
  factionB: Faction!
  winrateForA: Float!
  totalMatches: Int!
  verdict: MatchupVerdict!  # FAVORED, EVEN, UNFAVORED
}

enum MatchupVerdict {
  HEAVILY_FAVORED  # > 60%
  FAVORED          # 55-60%
  EVEN             # 45-55%
  UNFAVORED        # 40-45%
  HEAVILY_UNFAVORED # < 40%
}

type MetaAnalysis {
  topFactions: [FactionStat!]!          # Top 5 Winrate
  risingFactions: [FactionStat!]!       # Größter Trend-Anstieg
  fallingFactions: [FactionStat!]!      # Größter Trend-Abfall
  mostBanned: [FactionStat!]!           # Höchste Ban-Rate
  mostPicked: [FactionStat!]!           # Höchste Pick-Rate
}
```

### 12.4 Automatische Aktualisierung

**Trigger:** Wenn Match-Ergebnis eingetragen wird

```typescript
async function updateStatsAfterMatch(match: Match) {
  const season = await getCurrentSeason()

  // 1. Update Faction-Stats für beide Spieler
  await updateFactionStats(match.player1_faction_id, season.id, match.winner_id === match.player1_id)
  await updateFactionStats(match.player2_faction_id, season.id, match.winner_id === match.player2_id)

  // 2. Update Matchup-Stats
  await updateMatchupStats(
    match.player1_faction_id,
    match.player2_faction_id,
    season.id,
    match.winner_id
  )

  // 3. Invalidiere Cache
  await redis.del(`faction_stats:${season.id}`)
  await redis.del(`matchup_matrix:${season.id}`)
}

async function updateFactionStats(factionId: string, seasonId: string, won: boolean) {
  await prisma.factionStats.upsert({
    where: {
      faction_id_season_id: { faction_id: factionId, season_id: seasonId }
    },
    update: {
      matches_played: { increment: 1 },
      wins: won ? { increment: 1 } : undefined,
      losses: !won ? { increment: 1 } : undefined
    },
    create: {
      faction_id: factionId,
      season_id: seasonId,
      matches_played: 1,
      wins: won ? 1 : 0,
      losses: won ? 0 : 1,
      draws: 0
    }
  })
}
```

### 12.5 Frontend-Visualisierung

#### A) Faction-Overview (Grid)

```typescript
function FactionStatsGrid() {
  const { data } = useQuery(FACTION_STATS_QUERY, {
    variables: { seasonId: currentSeason.id }
  })

  return (
    <div className="faction-grid">
      {data.factionStats.map(stat => (
        <FactionStatCard key={stat.faction.id} stat={stat} />
      ))}
    </div>
  )
}

function FactionStatCard({ stat }: { stat: FactionStat }) {
  const winrateColor = stat.winrate > 55 ? 'green' : stat.winrate < 45 ? 'red' : 'gray'

  return (
    <div className="faction-card">
      <img src={stat.faction.icon_url} alt={stat.faction.name} />
      <h3>{stat.faction.name}</h3>

      <div className="stats">
        <div className={`winrate ${winrateColor}`}>
          {stat.winrate.toFixed(1)}% Winrate
        </div>
        <div>
          {stat.matchesPlayed} Matches
        </div>
        {stat.trend !== 0 && (
          <div className={stat.trend > 0 ? 'trending-up' : 'trending-down'}>
            {stat.trend > 0 ? '↗' : '↘'} {Math.abs(stat.trend).toFixed(1)}%
          </div>
        )}
      </div>
    </div>
  )
}
```

#### B) Matchup-Heatmap (24x24 Matrix)

```typescript
function MatchupHeatmap() {
  const { data } = useQuery(MATCHUP_MATRIX_QUERY)

  return (
    <div className="matchup-heatmap">
      <table>
        <thead>
          <tr>
            <th></th>
            {ALL_FACTIONS.map(f => (
              <th key={f.id}>
                <img src={f.icon_url} alt={f.name} title={f.name} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ALL_FACTIONS.map((factionA, i) => (
            <tr key={factionA.id}>
              <th>
                <img src={factionA.icon_url} alt={factionA.name} />
              </th>
              {ALL_FACTIONS.map((factionB, j) => {
                if (i === j) {
                  // Diagonal (selbst gegen selbst)
                  return <td key={factionB.id} className="diagonal">-</td>
                }

                const matchup = data.matchupMatrix[i][j]
                const winrate = matchup.winrateForA
                const color = getHeatmapColor(winrate)

                return (
                  <td
                    key={factionB.id}
                    className="matchup-cell"
                    style={{ backgroundColor: color }}
                    title={`${factionA.name} vs ${factionB.name}: ${winrate.toFixed(1)}% (${matchup.totalMatches} matches)`}
                  >
                    {winrate.toFixed(0)}%
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function getHeatmapColor(winrate: number): string {
  if (winrate > 60) return '#10b981'  // Grün (stark)
  if (winrate > 55) return '#84cc16'  // Hellgrün
  if (winrate >= 45) return '#6b7280' // Grau (ausgeglichen)
  if (winrate > 40) return '#f59e0b'  // Orange
  return '#ef4444'  // Rot (schwach)
}
```

---

## 13. UI/UX Design

### 13.1 Design-Richtung

**Warhammer Fantasy Ästhetik:**
- Mittelalterlich/Renaissance inspiriert
- Dunkle Farbpalette mit Gold/Bronze-Akzenten
- NICHT an totaltavern orientieren (eigene Identität!)
- Gaming-Look, aber professionell & lesbar

### 13.2 Farbschema

```css
:root {
  /* Backgrounds */
  --bg-primary: #1a1a1a;      /* Dunkelgrau/Schwarz */
  --bg-secondary: #2d2d2d;    /* Mittelgrau */
  --bg-elevated: #3a3a3a;     /* Cards/Modals */

  /* Primary Colors */
  --primary: #d4af37;         /* Gold */
  --primary-dark: #b8941f;
  --secondary: #8b4513;       /* Bronze/Braun */

  /* Accent */
  --accent: #b91c1c;          /* Rot (CTAs) */
  --accent-hover: #991b1b;

  /* Text */
  --text-primary: #f5f5f5;    /* Fast weiß */
  --text-secondary: #a3a3a3;  /* Grau */
  --text-muted: #737373;

  /* Borders */
  --border: #404040;
  --border-light: #525252;

  /* Status Colors */
  --success: #10b981;
  --warning: #f59e0b;
  --error: #ef4444;
  --info: #3b82f6;
}
```

### 13.3 Typography

```css
/* Headings: Serif (mittelalterlich) */
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&display=swap');

/* Body: Sans-Serif (Lesbarkeit) */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

body {
  font-family: 'Inter', sans-serif;
  font-size: 16px;
  line-height: 1.6;
  color: var(--text-primary);
  background-color: var(--bg-primary);
}

h1, h2, h3, h4, h5, h6 {
  font-family: 'Cinzel', serif;
  color: var(--primary);
}
```

### 13.4 Texturen & Hintergründe

```css
body {
  background-image: url('/textures/parchment-subtle.png');
  background-repeat: repeat;
  background-size: 200px;
  opacity: 0.05; /* Sehr subtil */
}

.card {
  background-color: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
}

/* Warhammer-Style Divider */
.divider {
  height: 2px;
  background: linear-gradient(to right, transparent, var(--primary), transparent);
  margin: 2rem 0;
}
```

### 13.5 Responsive Breakpoints (TailwindCSS)

```javascript
// tailwind.config.js
module.exports = {
  theme: {
    screens: {
      'sm': '640px',   // Mobile
      'md': '768px',   // Tablet
      'lg': '1024px',  // Desktop
      'xl': '1280px',  // Large Desktop
      '2xl': '1536px'  // Extra Large
    }
  }
}
```

---

## 14. Kern-Ansichten (UI-Pages)

### 14.1 Landing Page (`/`)

```typescript
function LandingPage() {
  return (
    <>
      {/* Hero-Section */}
      <section className="hero">
        <h1>Warhammer Tournament Platform</h1>
        <p>Die Community-Plattform für Total War Warhammer 3 Turniere</p>
        <div className="cta-buttons">
          <Link to="/tournaments">
            <button className="btn-primary">Browse Tournaments</button>
          </Link>
          <Link to="/auth/discord">
            <button className="btn-secondary">Login with Discord</button>
          </Link>
        </div>
      </section>

      {/* Featured Tournaments */}
      <section className="featured-tournaments">
        <h2>Kommende Turniere</h2>
        <TournamentCarousel tournaments={featuredTournaments} />
      </section>

      {/* Leaderboard Teaser */}
      <section className="leaderboard-teaser">
        <h2>Season Leaders</h2>
        <LeaderboardTop3 />
      </section>

      {/* Stats-Teaser */}
      <section className="stats">
        <div className="stat-box">
          <h3>150</h3>
          <p>Tournaments</p>
        </div>
        <div className="stat-box">
          <h3>1,200</h3>
          <p>Matches</p>
        </div>
        <div className="stat-box">
          <h3>24</h3>
          <p>Factions</p>
        </div>
      </section>
    </>
  )
}
```

### 14.2 Tournament-Liste (`/tournaments`)

```typescript
function TournamentListPage() {
  const [filters, setFilters] = useState({
    format: null,
    status: 'open_registration',
    mode: null,
    organizer: null
  })

  return (
    <div className="tournament-list-page">
      {/* Filter-Sidebar */}
      <aside className="filter-sidebar">
        <FilterPanel filters={filters} onChange={setFilters} />
      </aside>

      {/* Tournament-Grid */}
      <main className="tournament-grid">
        <h1>Turniere</h1>
        <TournamentGrid filters={filters} />
      </main>
    </div>
  )
}

function TournamentCard({ tournament }) {
  return (
    <div className="tournament-card">
      {tournament.poster_url && (
        <img src={tournament.poster_url} alt={tournament.name} />
      )}
      <h3>{tournament.name}</h3>
      <p>{tournament.organizer.username}</p>
      <div className="meta">
        <span>{format(tournament.start_date, 'dd.MM.yyyy HH:mm')}</span>
        <span>{tournament.format}</span>
        <span>{tournament.participants.length}/{tournament.max_participants}</span>
      </div>
      <StatusBadge status={tournament.status} />
      <Link to={`/tournaments/${tournament.id}`}>
        <button>View Details</button>
      </Link>
    </div>
  )
}
```

### 14.3 Tournament-Detail (`/tournaments/:id`)

```typescript
function TournamentDetailPage() {
  const { id } = useParams()
  const { data: tournament } = useTournament(id)

  return (
    <div className="tournament-detail">
      {/* Header */}
      <header className="tournament-header">
        {tournament.poster_url && (
          <img src={tournament.poster_url} className="poster" />
        )}
        <div className="title-section">
          <h1>{tournament.name}</h1>
          <p>Organisiert von {tournament.organizer.username}</p>
          <p>{formatTournamentDate(tournament.start_date, tournament.timezone)}</p>
          <StatusBadge status={tournament.status} />
        </div>
        {tournament.status === 'open_registration' && (
          <button className="btn-primary" onClick={handleRegister}>
            Jetzt anmelden
          </button>
        )}
      </header>

      {/* Tabs */}
      <Tabs>
        <Tab label="Overview">
          <MarkdownRenderer content={tournament.rules} />
          {tournament.discord_link && (
            <a href={tournament.discord_link} target="_blank">
              Join Discord
            </a>
          )}
        </Tab>

        <Tab label="Teilnehmer">
          <ParticipantTable participants={tournament.participants} />
        </Tab>

        {tournament.format.includes('elimination') && (
          <Tab label="Bracket">
            <BracketView matches={tournament.matches} />
          </Tab>
        )}

        {tournament.format.includes('round_robin') && (
          <Tab label="Pairings">
            <RoundRobinTable matches={tournament.matches} />
          </Tab>
        )}

        {tournament.status === 'completed' && (
          <Tab label="Results">
            <TournamentResults results={tournament.results} />
          </Tab>
        )}
      </Tabs>
    </div>
  )
}
```

---

## 15. Scraper (totaltavern.com)

### 15.1 Status & Zweck

**Status:** Bauen, aber noch nicht aktiv ausführen
**Timing:** In 2 Wochen rechtlich geklärt, dann ausführbar
**Zweck:** Historische Daten importieren für sofortigen Content

### 15.2 Scraping-Ziele (Priorität)

1. **Faction-Statistiken** (Prio 1)
   - URL: https://totaltavern.com/factionstatistics
   - Daten: Winrates, Matchups

2. **Turnier-Historie** (Prio 2)
   - URL: https://totaltavern.com/tournament/{ID}
   - Daten: Turniere, Brackets, Ergebnisse

3. **Spieler-Profile** (Prio 3, Optional)
   - Falls verfügbar: Spieler-Stats

### 15.3 Tech-Stack

**Node.js mit Cheerio:**
```bash
npm install cheerio axios cli-progress winston
```

**Projekt-Struktur:**
```
scraper/
├── src/
│   ├── index.ts              # Main-Script
│   ├── parsers/
│   │   ├── factionStats.ts
│   │   ├── tournaments.ts
│   │   └── players.ts
│   ├── utils/
│   │   ├── http.ts           # Rate-Limited Request-Wrapper
│   │   ├── mapping.ts        # Daten-Mapping
│   │   └── logger.ts
│   └── config.ts
├── package.json
└── SCRAPER_README.md
```

### 15.4 Implementation

```typescript
// src/index.ts
import { Command } from 'commander'
import { scrapeFactionStats } from './parsers/factionStats'
import { scrapeTournaments } from './parsers/tournaments'

const program = new Command()

program
  .name('totaltavern-scraper')
  .description('Scraper für totaltavern.com')
  .version('1.0.0')

program
  .command('factions')
  .option('--dry-run', 'Show what would be scraped without writing to DB')
  .action(async (options) => {
    await scrapeFactionStats(options.dryRun)
  })

program
  .command('tournaments')
  .option('--start-id <id>', 'Start-ID', '2000')
  .option('--end-id <id>', 'End-ID', '3000')
  .option('--dry-run', 'Dry-run mode')
  .action(async (options) => {
    await scrapeTournaments(
      parseInt(options.startId),
      parseInt(options.endId),
      options.dryRun
    )
  })

program.parse()
```

```typescript
// src/parsers/factionStats.ts
import axios from 'axios'
import * as cheerio from 'cheerio'
import { prisma } from '../db'
import { logger } from '../utils/logger'
import { rateLimitedRequest } from '../utils/http'

export async function scrapeFactionStats(dryRun: boolean = false) {
  logger.info('Scraping faction statistics...')

  const html = await rateLimitedRequest('https://totaltavern.com/factionstatistics')
  const $ = cheerio.load(html)

  const stats = []

  // Parse HTML (anpassen basierend auf tatsächlicher Struktur)
  $('.faction-stat').each((i, el) => {
    const factionName = $(el).find('.faction-name').text().trim()
    const winrate = parseFloat($(el).find('.winrate').text())
    const matchesPlayed = parseInt($(el).find('.matches').text())

    stats.push({ factionName, winrate, matchesPlayed })
  })

  logger.info(`Scraped ${stats.length} faction stats`)

  if (dryRun) {
    console.table(stats)
    return
  }

  // Write to DB
  for (const stat of stats) {
    const faction = await prisma.faction.findFirst({
      where: { name: { contains: stat.factionName, mode: 'insensitive' } }
    })

    if (!faction) {
      logger.warn(`Faction not found: ${stat.factionName}`)
      continue
    }

    await prisma.factionStats.upsert({
      where: {
        faction_id_season_id: {
          faction_id: faction.id,
          season_id: IMPORT_SEASON_ID
        }
      },
      update: {
        matches_played: stat.matchesPlayed,
        // Calculate wins/losses from winrate
        wins: Math.round(stat.matchesPlayed * stat.winrate / 100),
        losses: Math.round(stat.matchesPlayed * (1 - stat.winrate / 100))
      },
      create: {
        faction_id: faction.id,
        season_id: IMPORT_SEASON_ID,
        matches_played: stat.matchesPlayed,
        wins: Math.round(stat.matchesPlayed * stat.winrate / 100),
        losses: Math.round(stat.matchesPlayed * (1 - stat.winrate / 100)),
        draws: 0
      }
    })
  }

  logger.info('Faction stats imported successfully')
}
```

```typescript
// src/utils/http.ts
import axios from 'axios'
import { logger } from './logger'

const RATE_LIMIT_MS = 2000  // 2 Sekunden zwischen Requests

let lastRequestTime = 0

export async function rateLimitedRequest(url: string): Promise<string> {
  const now = Date.now()
  const timeSinceLastRequest = now - lastRequestTime

  if (timeSinceLastRequest < RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - timeSinceLastRequest))
  }

  logger.debug(`Fetching ${url}`)
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; WarhammerTournamentPlatform/1.0; +https://yourdomain.com)'
    }
  })

  lastRequestTime = Date.now()
  return response.data
}
```

### 15.5 Ausführung

```bash
# Dry-Run (zeigt was gescraped würde)
npm run scrape factions --dry-run

# Echtes Scraping (schreibt in DB)
npm run scrape factions

# Turniere scrapen (ID-Range)
npm run scrape tournaments --start-id 2000 --end-id 3000
```

---

## 16. Deployment & DevOps

### 16.1 Docker-Setup

**Dockerfile (Backend):**
```dockerfile
FROM node:18-alpine AS build

WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:18-alpine

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY package*.json ./

EXPOSE 3000
CMD ["npm", "run", "start:prod"]
```

**Dockerfile (Frontend):**
```dockerfile
FROM node:18-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**docker-compose.yml:**
```yaml
version: '3.8'

services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://warhammer:password@postgres:5432/warhammer_tournaments
      REDIS_URL: redis://redis:6379
      DISCORD_CLIENT_ID: ${DISCORD_CLIENT_ID}
      DISCORD_CLIENT_SECRET: ${DISCORD_CLIENT_SECRET}
      JWT_SECRET: ${JWT_SECRET}
      NODE_ENV: production
    depends_on:
      - postgres
      - redis
    restart: unless-stopped

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "80:80"
    depends_on:
      - backend
    restart: unless-stopped

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: warhammer
      POSTGRES_PASSWORD: password
      POSTGRES_DB: warhammer_tournaments
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

### 16.2 Deployment (Railway.app)

**Schritte:**

1. **GitHub-Repo erstellen** und Code pushen

2. **Railway.app:**
   - Account erstellen
   - "New Project" → "Deploy from GitHub"
   - Repo auswählen

3. **Services hinzufügen:**
   - PostgreSQL-Plugin
   - Redis-Plugin

4. **Environment-Variablen setzen:**
   ```
   DATABASE_URL (automatisch von PostgreSQL-Plugin)
   REDIS_URL (automatisch von Redis-Plugin)
   DISCORD_CLIENT_ID
   DISCORD_CLIENT_SECRET
   JWT_SECRET
   FRONTEND_URL
   ```

5. **Deploy triggern:**
   - Push zu `main` → Auto-Deploy
   - Railway generiert automatisch SSL-Zertifikat

**Kosten:** ~20-30€/Monat für 500 User/Tag

### 16.3 Alternative: Self-Hosted (VPS)

**Hetzner/DigitalOcean VPS (10€/Monat):**

```bash
# 1. SSH auf Server
ssh root@your-server-ip

# 2. Docker installieren
curl -fsSL https://get.docker.com | sh

# 3. Repo clonen
git clone https://github.com/your-repo/warhammer-platform.git
cd warhammer-platform

# 4. Environment-Variablen setzen
cp .env.example .env
nano .env  # Ausfüllen

# 5. Docker Compose starten
docker-compose up -d

# 6. Nginx Reverse-Proxy (für SSL)
# ... (Nginx-Config + Certbot)
```

---

## 17. Testing

### 17.1 Backend-Tests

**Unit-Tests (Jest):**
```typescript
// tests/unit/leaderboard.test.ts
describe('Leaderboard Points Calculation', () => {
  it('should calculate correct points for 1st place in 32-player tournament', () => {
    const result = calculateTournamentPoints(player, {
      placement: 1,
      tournament: { participants: 32, is_major: false }
    })

    expect(result).toBeCloseTo(87, 0)  // Siehe Beispielrechnung
  })

  it('should apply major tournament bonus', () => {
    const normalTournament = { participants: 32, is_major: false }
    const majorTournament = { participants: 32, is_major: true }

    const normalPoints = calculateTournamentPoints(player, { placement: 1, tournament: normalTournament })
    const majorPoints = calculateTournamentPoints(player, { placement: 1, tournament: majorTournament })

    expect(majorPoints).toBeCloseTo(normalPoints * 1.5, 0)
  })
})
```

**Integration-Tests (Supertest):**
```typescript
// tests/integration/tournaments.test.ts
describe('Tournament Lifecycle', () => {
  it('should create, register, start, and finalize tournament', async () => {
    // 1. Create tournament
    const createRes = await request(app)
      .post('/api/tournaments')
      .set('Authorization', `Bearer ${organizerToken}`)
      .send(tournamentData)
      .expect(201)

    const tournamentId = createRes.body.id

    // 2. Register participant
    await request(app)
      .post(`/api/tournaments/${tournamentId}/register`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ faction_id: 'high_elves' })
      .expect(200)

    // 3. Start tournament (triggers bracket generation)
    await request(app)
      .patch(`/api/tournaments/${tournamentId}/status`)
      .send({ status: 'ongoing' })
      .expect(200)

    // 4. Enter match results
    // ...

    // 5. Finalize (triggers stats + leaderboard update)
    await request(app)
      .patch(`/api/tournaments/${tournamentId}/status`)
      .send({ status: 'completed' })
      .expect(200)

    // 6. Verify leaderboard updated
    const leaderboard = await request(app)
      .get('/api/leaderboard')
      .expect(200)

    expect(leaderboard.body[0].total_points).toBeGreaterThan(0)
  })
})
```

### 17.2 Frontend-Tests

**Component-Tests (React Testing Library):**
```typescript
// tests/components/BracketView.test.tsx
describe('BracketView', () => {
  it('should render bracket with matches', () => {
    render(<BracketView matches={mockMatches} />)

    expect(screen.getByText('Player1')).toBeInTheDocument()
    expect(screen.getByText('Player2')).toBeInTheDocument()
  })

  it('should highlight live matches', () => {
    render(<BracketView matches={mockMatches} />)

    const liveMatch = screen.getByTestId('match-ongoing')
    expect(liveMatch).toHaveClass('live')
  })
})
```

---

## 18. Zeitschätzung & Phasen-Planung

### 18.1 Aufwands-Breakdown

**Legende:**
- 👤 = 1 Person Solo
- 👥 = 2 Personen Team

#### Phase 1: MVP (Funktionierendes Basis-System)

| Task | Solo | Team | Priorität |
|------|------|------|-----------|
| **Backend Setup** |  |  |  |
| Fastify + TypeScript + Prisma Setup | 1d | 0.5d | 🔴 Kritisch |
| Discord OAuth2 | 2d | 1d | 🔴 Kritisch |
| REST API (Tournaments, Users, Matches) | 5d | 3d | 🔴 Kritisch |
| PostgreSQL-Schema + Migrations | 2d | 1d | 🔴 Kritisch |
| Redis-Caching Setup | 1d | 0.5d | 🔴 Kritisch |
| WebSocket (Basis) | 2d | 1d | 🟡 Wichtig |
| **Frontend Setup** |  |  |  |
| React + Vite + TailwindCSS | 1d | 0.5d | 🔴 Kritisch |
| Routing + Layout | 1d | 0.5d | 🔴 Kritisch |
| Landing Page | 2d | 1d | 🟡 Wichtig |
| Tournament-Liste | 3d | 2d | 🔴 Kritisch |
| Tournament-Detail (ohne Draft) | 3d | 2d | 🔴 Kritisch |
| Basis-Bracket-View (Library) | 3d | 2d | 🔴 Kritisch |
| **Kern-Features** |  |  |  |
| Turnier-CRUD | 4d | 2d | 🔴 Kritisch |
| Teilnehmer-Registrierung | 2d | 1d | 🔴 Kritisch |
| Elimination-Bracket-Generator | 3d | 2d | 🔴 Kritisch |
| Einfaches Leaderboard (nur Season) | 3d | 2d | 🔴 Kritisch |
| Faction-Liste (statisch) | 1d | 0.5d | 🔴 Kritisch |
| **DevOps** |  |  |  |
| Docker-Setup | 1d | 0.5d | 🔴 Kritisch |
| Deployment (Railway) | 1d | 0.5d | 🔴 Kritisch |
| **SUMME PHASE 1** | **42 Tage** | **23 Tage** |  |

**Phase 1 Dauer:**
- Solo: ~8-10 Wochen (bei Vollzeit)
- Team: ~4-5 Wochen

---

#### Phase 2: Core Features (Draft, Stats, Improved Leaderboard)

| Task | Solo | Team | Priorität |
|------|------|------|-----------|
| **Draft-System** (KOMPLEX!) |  |  |  |
| Draft-Preset-Schema + DB | 2d | 1d | 🔴 Kritisch |
| Preset-Editor (Frontend) | 5d | 3d | 🔴 Kritisch |
| Draft-Engine (Backend-Logik) | 7d | 4d | 🔴 Kritisch |
| Live-Draft-Lobby (Frontend) | 5d | 3d | 🔴 Kritisch |
| WebSocket-Integration | 3d | 2d | 🔴 Kritisch |
| Draft-Testing | 2d | 1d | 🟡 Wichtig |
| **Leaderboard-Verbesserung** |  |  |  |
| ELO-System implementieren | 3d | 2d | 🔴 Kritisch |
| Hybrid-Punkteberechnung | 3d | 2d | 🔴 Kritisch |
| All-Time Leaderboard (Decay) | 2d | 1d | 🟡 Wichtig |
| Transparenz-Seite (Formel-Erklärung) | 1d | 0.5d | 🟡 Wichtig |
| **Faction-Statistiken** |  |  |  |
| GraphQL-Setup | 2d | 1d | 🟡 Wichtig |
| Stats-Berechnung (Backend) | 3d | 2d | 🔴 Kritisch |
| Faction-Grid (Frontend) | 3d | 2d | 🟡 Wichtig |
| Matchup-Heatmap | 4d | 2d | 🟡 Wichtig |
| Meta-Analysis Dashboard | 2d | 1d | 🟢 Nice-to-Have |
| **Round Robin** |  |  |  |
| RR-Algorithmus | 3d | 2d | 🟡 Wichtig |
| Performance-Optimierung (200 Spieler) | 2d | 1d | 🟡 Wichtig |
| RR-Table-View (Frontend) | 2d | 1d | 🟡 Wichtig |
| **Army-Lists** |  |  |  |
| Upload-Funktion | 2d | 1d | 🟢 Nice-to-Have |
| Parser (.army_setup) | 3d | 2d | 🟢 Nice-to-Have |
| Visualisierung (Frontend) | 2d | 1d | 🟢 Nice-to-Have |
| **Weitere Features** |  |  |  |
| Organisator-Dashboard | 4d | 2d | 🟡 Wichtig |
| Filter & Suche | 3d | 2d | 🟡 Wichtig |
| Season-Management | 2d | 1d | 🟡 Wichtig |
| **SUMME PHASE 2** | **67 Tage** | **39 Tage** |  |

**Phase 2 Dauer:**
- Solo: ~13-15 Wochen
- Team: ~7-8 Wochen

---

#### Phase 3: Advanced Features (Admin, Scraper, Polish)

| Task | Solo | Team | Priorität |
|------|------|------|-----------|
| **Admin-Panel** |  |  |  |
| User-Management | 3d | 2d | 🟡 Wichtig |
| Tournament-Moderation | 2d | 1d | 🟡 Wichtig |
| Season-Management (UI) | 2d | 1d | 🟡 Wichtig |
| Analytics-Dashboard | 3d | 2d | 🟢 Nice-to-Have |
| Audit-Log | 2d | 1d | 🟢 Nice-to-Have |
| **Scraper** |  |  |  |
| Scraper-Implementation | 5d | 3d | 🟡 Wichtig |
| Daten-Migration | 2d | 1d | 🟡 Wichtig |
| **Testing & QA** |  |  |  |
| Unit-Tests (Backend) | 4d | 2d | 🟡 Wichtig |
| Integration-Tests | 3d | 2d | 🟡 Wichtig |
| Frontend-Tests | 3d | 2d | 🟢 Nice-to-Have |
| E2E-Tests (Playwright) | 3d | 2d | 🟢 Nice-to-Have |
| **Polish** |  |  |  |
| UI-Verbesserungen | 4d | 2d | 🟡 Wichtig |
| Performance-Tuning | 3d | 2d | 🟡 Wichtig |
| SEO-Optimierung | 2d | 1d | 🟢 Nice-to-Have |
| **Dokumentation** |  |  |  |
| README + API-Docs | 2d | 1d | 🟡 Wichtig |
| Deployment-Guide | 1d | 0.5d | 🟡 Wichtig |
| **SUMME PHASE 3** | **44 Tage** | **25 Tage** |  |

**Phase 3 Dauer:**
- Solo: ~8-10 Wochen
- Team: ~5 Wochen

---

### 18.2 Gesamtaufwand

| Szenario | Vollzeit (8h/Tag) | Teilzeit (4h/Tag) |
|----------|-------------------|-------------------|
| **Solo (Alle 3 Phasen)** | 30-35 Wochen (~8 Monate) | 60-70 Wochen (~16 Monate) |
| **Team 2 Personen** | 16-18 Wochen (~4 Monate) | 32-36 Wochen (~8 Monate) |

**Empfehlung:**
- **Minimale lauffähige Version (MVP):** Phase 1 = 8-10 Wochen Solo
- **Produktionsreif mit Hauptfeatures:** Phase 1 + 2 = 20-25 Wochen Solo
- **Komplett fertig:** Alle 3 Phasen = 30-35 Wochen Solo

### 18.3 Priorisierungs-Empfehlung

**Wenn Zeit/Budget knapp:**

**MUSS (Phase 1):**
- Discord-Login
- Turnier-CRUD
- Elimination-Brackets
- Basis-Leaderboard
- Deployment

**SOLLTE (Phase 2):**
- Draft-System (KERN-FEATURE!)
- Faction-Stats
- Verbesserte Leaderboard
- Round Robin

**KANN (Phase 3):**
- Admin-Panel (erstmal nur für dich manuell via DB)
- Scraper (später nachholen)
- Advanced Analytics
- Army-Lists

---

## 19. Offene Punkte & Annahmen

### 19.1 Annahmen
1. Discord OAuth ist konfiguriert (Client ID/Secret vorhanden)
2. Faction-Icons liefert ihr oder ich nutze Platzhalter
3. Turnier-Organisatoren werden manuell von Admins ernannt
4. Season-Start initial manuell, dann automatisch
5. Bilder werden lokal gespeichert (später optional S3)

### 19.2 Offene Punkte
1. **Leaderboard-Formel finalisieren:** Nach 2-3 Test-Seasons adjustieren
2. **Scraping-Timing:** In 2 Wochen klären, dann ausführen
3. **Payment-Integration:** Später (erstmal nur Textfeld)
4. **Coffee-App Details:** URL reicht, Integration später
5. **"sft"-Modus Details:** Regelwerk mit Insider absprechen

---

## 20. Deliverables-Checkliste

### ✅ Dokumentation
- [ ] README.md (Projekt-Übersicht, Setup)
- [ ] ARCHITECTURE.md (System-Diagramme)
- [ ] API_DOCS.md (REST + GraphQL)
- [ ] LEADERBOARD_FORMULA.md (Punkteberechnung)
- [ ] DEPLOYMENT.md (Step-by-step)
- [ ] SCRAPER_README.md

### ✅ Backend
- [ ] Fastify + TypeScript + Prisma
- [ ] Discord OAuth2
- [ ] REST API (Tournaments, Users, Matches, Seasons)
- [ ] GraphQL API (Stats)
- [ ] WebSocket (Draft, Live-Brackets)
- [ ] Services (Round-Robin, Bracket, Draft, Leaderboard, Stats)
- [ ] Redis-Caching
- [ ] Tests (Unit + Integration)

### ✅ Frontend
- [ ] React + TypeScript + Vite
- [ ] Alle 10 Kern-Pages
- [ ] Draft-System (Preset-Editor + Live-Lobby)
- [ ] Bracket-View (interaktiv, responsive)
- [ ] Leaderboard-Tabelle
- [ ] Faction-Stats (Grid + Heatmap)
- [ ] Warhammer-Theme (CSS)
- [ ] Tests (React Testing Library)

### ✅ Draft-System
- [ ] Preset-Editor
- [ ] Live-Draft-Lobby
- [ ] WebSocket-Integration
- [ ] Pick/Ban/Snipe/Steal Logik
- [ ] Hidden/Parallel Modi

### ✅ Scraper
- [ ] totaltavern.com Scraper
- [ ] Faction-Stats Parser
- [ ] Turniere Parser
- [ ] Dry-Run Mode

### ✅ DevOps
- [ ] Dockerfile (Backend + Frontend)
- [ ] docker-compose.yml
- [ ] .env.example
- [ ] Railway/Render Deployment-Anleitung
- [ ] DB-Seed-Script

---

## 21. Zusammenfassung

**Das ist ein großes Projekt!** Das Draft-System alleine ist sehr komplex (~3-4 Wochen Solo).

**Realistische Zeitplanung:**
- **MVP (Phase 1):** 8-10 Wochen Solo → Basis-Funktionalität
- **Mit Draft (Phase 1+2):** 20-25 Wochen Solo → Produktionsreif
- **Komplett (Alle Phasen):** 30-35 Wochen Solo → Full-Featured

**Kosten (Hosting):**
- Railway/Render: ~20-30€/Monat
- VPS Self-Hosted: ~10€/Monat (mehr Aufwand)

**Kritische Erfolgs-Faktoren:**
1. **Performance:** WebSockets + Caching essentiell für Live-Turniere
2. **Draft-System:** Kernfeature, muss robust sein
3. **Leaderboard:** Formel muss fair sein, viel Testing nötig
4. **Community-Feedback:** Früh Testen mit echten Nutzern

**Viel Erfolg!** 🎮⚔️

---

**ENDE DER PROMPT-DOKUMENTATION**
