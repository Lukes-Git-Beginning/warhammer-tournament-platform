# Warhammer Tournament Platform - Implementierungs-Prompt

## Teil 1/3: Projekt-Übersicht, Tech-Stack & Kern-Features

---

## 1. Projekt-Übersicht

### Vision
Community-Plattform für **Total War Warhammer 3** Turniere mit Discord-Login, Live-Tournament-Management, Captain's Mode Draft-System und umfassenden Statistiken.

### Kontext & Zielgruppe

**Spiel-Basis:**
- Total War Warhammer 3 (PC-Spiel)
- Angelehnt an The Old World Fantasy
- 24 spielbare Factions

**Community:**
- Größe: ~500 Besucher/Tag
- Turniere: 30-60 Spieler typisch
- Casual > Competitive (größtes Turnier: 2000€ Preisgeld)
- Community-Insider: Turnier-Leiter mit Fach-Input

**Team:**
- Developer (technische Umsetzung)
- Alex "Rizzotto" (öffentliches Gesicht, zukünftiger Streamer)
- Turnier-Insider (fachliche Beratung)

**Referenz-Seite:**
- https://totaltavern.com (insbesondere /factionstatistics und /tournament/2966)
- **Ziel:** Verbessern, NICHT kopieren (Community ist eigen, eigene Identität wichtig)

### Kritisches Problem (zu lösen!)

**Performance-Issue bei letztem Turnier:**
- Viele Besucher refreshten gleichzeitig während Live-Turnieren
- Server-Überlastung durch Polling
- **Lösung:** WebSockets für Live-Updates + Redis-Caching

---

## 2. Tech-Stack (Definitiv)

### Frontend
```
- React 18+ mit TypeScript
- Vite (Build-Tool, schnell & modern)
- TailwindCSS (Styling, Warhammer-Theme)
- React Router v6 (Client-Side Routing)
- Zustand oder Context API (State-Management, lightweight)
- Socket.io Client (WebSockets für Live-Updates)
- react-markdown (Markdown-Rendering für Turnier-Regeln)
- DOMPurify (HTML-Sanitization)
```

### Backend
```
- Fastify (Node.js + TypeScript, performant)
- Hybrid API:
  - REST für CRUD (Turniere, User, Matches)
  - GraphQL für Statistiken (komplexe Queries)
- Discord OAuth2 (Authentication)
- Socket.io (WebSockets für Draft & Live-Brackets)
- Prisma (PostgreSQL ORM, TypeScript-first)
```

### Datenbank & Caching
```
- PostgreSQL 15+ (primäre Datenbank)
- Redis (Caching & Session-Storage)
```

### Deployment
```
- Docker + Docker Compose (Containerisierung)
- Empfohlen: Railway.app oder Render.com (~15-30€/Monat)
  - Auto-Deploy via Git
  - PostgreSQL + Redis inklusive
  - SSL automatisch
  - Einfache Skalierung
- Alternative: Self-hosted VPS (günstiger, mehr Wartung)
```

### Testing
```
- Jest (Backend + Frontend Unit-Tests)
- React Testing Library (Component-Tests)
- Supertest (API Integration-Tests)
```

---

## 3. Performance & Skalierung (KRITISCH!)

### Problem: Refresh-Last während Live-Turnieren
**Symptom:** Server-Überlastung durch 100+ Nutzer die gleichzeitig F5 drücken

### Lösungen:

#### 3.1 Real-Time Updates (WebSockets)
```typescript
// Statt Polling alle 5 Sekunden:
// ❌ setInterval(() => fetch('/api/tournament/123'), 5000)

// WebSocket Push-Updates:
// ✅ Server pushed Updates automatisch
socket.on('bracket_update', (data) => {
  updateBracketView(data)
})

socket.on('match_result', (data) => {
  showNotification(`${data.winner} won!`)
})
```

**Implementierung:**
- Socket.io für Backend + Frontend
- Events: `bracket_update`, `match_result`, `draft_action`, `tournament_status_change`
- Reconnect-Logic (bei Disconnect automatisch neu verbinden)

#### 3.2 Redis-Caching
```typescript
// Häufig abgefragte Daten cachen:
const cachedLeaderboard = await redis.get('leaderboard:season:current')
if (cachedLeaderboard) {
  return JSON.parse(cachedLeaderboard)
}

const leaderboard = await db.calculateLeaderboard()
await redis.setex('leaderboard:season:current', 300, JSON.stringify(leaderboard)) // 5min TTL
return leaderboard
```

**Cache-Strategy:**
| Daten | TTL | Invalidierung |
|-------|-----|---------------|
| Leaderboard | 5min | Bei Turnier-Finalisierung |
| Faction-Stats | 15min | Bei Match-Ergebnis-Eintrag |
| Tournament-Listen | 2min | Bei Turnier-Erstellung/Update |
| Live-Brackets | Kein Cache | WebSocket-Updates |

#### 3.3 Datenbank-Optimierung
```sql
-- Indexes für häufige Queries:
CREATE INDEX idx_tournaments_date ON tournaments(start_date);
CREATE INDEX idx_tournaments_status ON tournaments(status);
CREATE INDEX idx_matches_tournament ON matches(tournament_id);
CREATE INDEX idx_leaderboard_season ON leaderboard_entries(season_id, total_points DESC);

-- Materialized View für Leaderboard (schnelle Abfragen):
CREATE MATERIALIZED VIEW mv_current_leaderboard AS
SELECT
  u.username,
  le.total_points,
  le.elo_rating,
  le.tournaments_played,
  RANK() OVER (ORDER BY le.total_points DESC) as rank
FROM leaderboard_entries le
JOIN users u ON u.id = le.user_id
WHERE le.season_id = (SELECT id FROM seasons WHERE is_active = true)
ORDER BY le.total_points DESC;

-- Refresh bei Bedarf:
REFRESH MATERIALIZED VIEW mv_current_leaderboard;
```

#### 3.4 Rate Limiting
```typescript
// Fastify Rate-Limiter Plugin
fastify.register(rateLimiter, {
  max: 100, // 100 Requests
  timeWindow: '1 minute',
  allowList: ['127.0.0.1'], // Localhost exempt
})

// Spezifische Limits für Auth-Endpoints:
fastify.register(rateLimiter, {
  max: 5,
  timeWindow: '1 minute',
}, { prefix: '/auth' })
```

#### 3.5 CDN für Assets
- Bilder (Poster, Avatars, Faction-Icons) → Cloudinary (Free-Tier) oder S3 + CloudFront
- Static Frontend-Assets → Railway/Render CDN (automatisch)

### Last-Ziele
- **Normal:** 500 Besucher/Tag (verteilt) → kein Problem
- **Spike:** 100+ concurrent users während Live-Turnier → WebSockets + Cache essentiell
- **Antwortzeit:** < 200ms für API-Calls, < 500ms für komplexe Stats-Queries

---

## 4. Factions (24 Total War Warhammer 3 Races)

### Komplette Liste
```
1.  Beastmen
2.  Bretonnia
3.  Chaos (Warriors of Chaos)
4.  Dark Elves
5.  Daemons of Chaos
6.  Dwarfs
7.  Empire
8.  Grand Cathay
9.  Greenskins
10. High Elves
11. Khorne
12. Kislev
13. Lizardmen
14. Nurgle
15. Norsca
16. Ogre Kingdoms
17. Skaven
18. Slaanesh
19. Tomb Kings
20. Tzeentch
21. Vampire Coast
22. Vampire Counts
23. Warriors of Chaos
24. Wood Elves
```

### Datenbank-Schema
```typescript
interface Faction {
  id: string
  name: string  // z.B. "High Elves"
  slug: string  // z.B. "high_elves" (für URLs)
  game_id: string  // TWW3 internal ID (z.B. "wh2_main_hef_high_elves")
  icon_url: string  // Icon-Bild
  color_hex: string  // Primärfarbe für UI (z.B. "#4169E1" für High Elves)
  category: string | null  // z.B. "chaos_gods" für Khorne/Nurgle/Slaanesh/Tzeentch
}
```

### Kategorien (für Draft-Preset Limits)
- `default`: Alle Factions
- `chaos_gods`: Khorne, Nurgle, Slaanesh, Tzeentch
- `order`: Empire, Bretonnia, High Elves, Dwarfs, Kislev, Grand Cathay
- `destruction`: Greenskins, Beastmen, Norsca, Ogre Kingdoms
- (Custom-Kategorien für Draft-Presets konfigurierbar)

---

## 5. Authentication & User-Management

### 5.1 Discord OAuth2

**Flow:**
1. User klickt "Login with Discord"
2. Redirect zu Discord OAuth
3. User autorisiert App
4. Callback zu `/auth/discord/callback` mit Code
5. Backend tauscht Code gegen Access-Token
6. Backend holt User-Info von Discord API
7. **Beim ERSTEN Login:** Timezone-Abfrage (Modal)
8. Erstelle/Update User in DB
9. Erstelle Session (JWT oder Cookie)
10. Redirect zu Dashboard

**Discord OAuth-Scopes:**
```
identify  # Username, Avatar, Discriminator
email     # Email (optional)
```

**Implementation (Backend):**
```typescript
// Fastify Route
fastify.get('/auth/discord', async (request, reply) => {
  const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=identify%20email`
  reply.redirect(authUrl)
})

fastify.get('/auth/discord/callback', async (request, reply) => {
  const { code } = request.query

  // Exchange code for token
  const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI
    })
  })
  const { access_token } = await tokenResponse.json()

  // Get user info
  const userResponse = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${access_token}` }
  })
  const discordUser = await userResponse.json()

  // Create/Update user in DB
  const user = await prisma.user.upsert({
    where: { discord_id: discordUser.id },
    update: {
      username: discordUser.username,
      avatar_url: `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
    },
    create: {
      discord_id: discordUser.id,
      username: discordUser.username,
      email: discordUser.email,
      avatar_url: `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`,
      timezone: null, // Wird später abgefragt
      role: 'user'
    }
  })

  // Wenn kein Timezone gesetzt → Flag für Frontend
  const needsTimezone = !user.timezone

  // Create JWT
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' })

  reply.setCookie('auth_token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 // 7 days
  })

  reply.redirect(`${FRONTEND_URL}/dashboard?needs_timezone=${needsTimezone}`)
})
```

**Timezone-Abfrage (Frontend):**
```typescript
// Wenn ?needs_timezone=true in URL:
function TimezoneModal() {
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)

  const handleSubmit = async () => {
    await fetch('/api/users/me', {
      method: 'PATCH',
      body: JSON.stringify({ timezone })
    })
    window.location.href = '/dashboard'
  }

  return (
    <Modal>
      <h2>Wähle deine Zeitzone</h2>
      <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
        {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
      </select>
      <button onClick={handleSubmit}>Speichern</button>
    </Modal>
  )
}
```

### 5.2 Rollen (Hierarchisch)

```typescript
enum Role {
  USER = 'user',          // Standard-Nutzer
  ORGANIZER = 'organizer', // Kann Turniere erstellen/verwalten
  MODERATOR = 'moderator', // Kann alle Turniere moderieren
  ADMIN = 'admin'         // Voller Zugriff
}
```

**Berechtigungen:**
| Action | User | Organizer | Moderator | Admin |
|--------|------|-----------|-----------|-------|
| Turnier anzeigen | ✅ | ✅ | ✅ | ✅ |
| Turnier erstellen | ❌ | ✅ | ✅ | ✅ |
| Eigenes Turnier bearbeiten | ❌ | ✅ | ✅ | ✅ |
| Fremdes Turnier bearbeiten | ❌ | ❌ | ✅ | ✅ |
| User-Rollen ändern | ❌ | ❌ | ❌ | ✅ |
| Season erstellen | ❌ | ❌ | ❌ | ✅ |

### 5.3 User-Schema (Datenbank)

```typescript
model User {
  id          String   @id @default(uuid())
  discord_id  String   @unique
  username    String
  email       String?
  avatar_url  String?
  timezone    String?  // IANA timezone (z.B. "Europe/Berlin")
  role        Role     @default(USER)

  // Preferences
  preferred_factions String[]  // Array von Faction-IDs

  // Timestamps
  created_at  DateTime @default(now())
  updated_at  DateTime @updatedAt
  last_login  DateTime @default(now())

  // Relations
  tournaments      Tournament[]       @relation("Organizer")
  participations   TournamentParticipant[]
  leaderboard_entries LeaderboardEntry[]
  army_lists       ArmyList[]
}
```

---

## 6. Tournament-Management (CRUD)

### 6.1 Tournament-Schema

```typescript
model Tournament {
  id        String   @id @default(uuid())

  // Basics
  name      String
  slug      String   @unique  // URL-friendly (z.B. "summer-invitational-2025")
  description String?
  poster_url  String?  // Turnier-Poster (Image-Upload)

  // Organisator
  organizer_id String
  organizer    User @relation("Organizer", fields: [organizer_id], references: [id])

  // Format & Mode
  format    TournamentFormat  // swiss, single_elimination, etc.
  mode      TournamentMode    // 1v1, 3v3, blind_pick, sft

  // Timing
  start_date     DateTime
  timezone       String  // IANA timezone
  registration_deadline DateTime?

  // Details
  rules      String  // Markdown
  discord_link String?
  max_participants Int?
  entry_fee     String?  // Freitext (z.B. "5€ via PayPal")

  // Draft-System
  draft_enabled   Boolean @default(false)
  draft_preset_id String?
  draft_preset    DraftPreset? @relation(fields: [draft_preset_id], references: [id])

  // Status & Settings
  status     TournamentStatus @default(DRAFT)
  counts_for_leaderboard Boolean @default(true)
  visibility TournamentVisibility @default(PUBLIC)

  // Meta
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt

  // Relations
  participants TournamentParticipant[]
  matches      Match[]
  results      TournamentResult[]
}

enum TournamentFormat {
  SWISS
  SINGLE_ELIMINATION
  DOUBLE_ELIMINATION
  ROUND_ROBIN
  DOUBLE_ROUND_ROBIN
}

enum TournamentMode {
  ONE_V_ONE       // Standard 1v1
  THREE_V_THREE   // 3v3 Team-Battles
  BLIND_PICK      // Spieler picken geheim
  SFT             // Single Faction Tournament
}

enum TournamentStatus {
  DRAFT                 // Erstellt, noch nicht öffentlich
  OPEN_REGISTRATION     // Anmeldung offen
  REGISTRATION_CLOSED   // Anmeldung geschlossen, vor Start
  ONGOING               // Turnier läuft
  COMPLETED             // Abgeschlossen
}

enum TournamentVisibility {
  PUBLIC   // Jeder kann sehen & anmelden
  PRIVATE  // Nur mit Einladung
}
```

### 6.2 Tournament-Erstellung (API)

**REST Endpoint:**
```
POST /api/tournaments
```

**Request-Body:**
```json
{
  "name": "Summer Invitational 2025",
  "description": "Großes Community-Turnier",
  "poster": "base64_image_or_url",
  "format": "swiss",
  "mode": "1v1",
  "start_date": "2025-07-15T18:00:00Z",
  "timezone": "Europe/Berlin",
  "registration_deadline": "2025-07-10T23:59:59Z",
  "rules": "# Regeln\n\n1. Keine Pause-Abuse\n2. ...",
  "discord_link": "https://discord.gg/...",
  "max_participants": 64,
  "entry_fee": null,
  "draft_enabled": true,
  "draft_preset_id": "uuid-of-preset",
  "counts_for_leaderboard": true,
  "visibility": "public"
}
```

**Response:**
```json
{
  "id": "uuid",
  "name": "Summer Invitational 2025",
  "slug": "summer-invitational-2025",
  "status": "draft",
  "organizer": {
    "id": "user-uuid",
    "username": "OrganizerName"
  },
  "created_at": "2025-06-01T10:00:00Z"
}
```

### 6.3 Tournament-Status-Flow

```
DRAFT
  ↓ (Organisator: "Veröffentlichen")
OPEN_REGISTRATION
  ↓ (Organisator: "Anmeldung schließen" ODER Deadline erreicht)
REGISTRATION_CLOSED
  ↓ (Organisator: "Turnier starten" → Bracket-Generierung)
ONGOING
  ↓ (Organisator: "Turnier finalisieren" → Stats-Berechnung)
COMPLETED
```

**Automatische Transitions:**
- `registration_deadline` erreicht → Status ändert sich automatisch zu `REGISTRATION_CLOSED` (Cron-Job)

### 6.4 Turnier-Formate (Detailliert)

#### A) Swiss-System
**Beschreibung:**
- Runden-basiert (typisch 5-7 Runden)
- Keine Elimination
- Pairung: Spieler mit ähnlicher Bilanz treffen aufeinander

**Pairing-Algorithmus (vereinfacht):**
```typescript
function generateSwissRound(standings: Standings[], roundNumber: number): Match[] {
  // Sortiere Spieler nach Punkten
  const sorted = standings.sort((a, b) => b.points - a.points)

  const matches: Match[] = []
  const paired = new Set<string>()

  for (const player of sorted) {
    if (paired.has(player.id)) continue

    // Finde besten Opponent (ähnliche Punkte, noch nicht gespielt)
    const opponent = sorted.find(opp =>
      !paired.has(opp.id) &&
      opp.id !== player.id &&
      !player.previousOpponents.includes(opp.id)
    )

    if (opponent) {
      matches.push({ player1: player, player2: opponent })
      paired.add(player.id)
      paired.add(opponent.id)
    }
  }

  return matches
}
```

**Implementierung:**
- Service: `SwissService.generateRound(tournamentId, roundNumber)`
- Verwendet Prisma-Queries um Standings zu berechnen
- Erstellt Match-Entities in DB
- WebSocket-Event: `new_round_generated`

#### B) Single/Double Elimination
**Beschreibung:**
- Bracket-Tree-Struktur
- Single: Verloren = raus
- Double: Zwei Leben (Winners + Losers Bracket)

**Bracket-Generierung:**
```typescript
function generateEliminationBracket(participants: Participant[]): BracketNode[] {
  const playerCount = participants.length
  const rounds = Math.ceil(Math.log2(playerCount))

  // Erstelle leeren Bracket-Tree
  const bracket: BracketNode[] = []

  // Seeding (optional: nach ELO oder manuell)
  const seeded = seedParticipants(participants)

  // Erste Runde: Paarungen
  for (let i = 0; i < seeded.length; i += 2) {
    bracket.push({
      round: 1,
      match_number: i / 2 + 1,
      player1: seeded[i],
      player2: seeded[i + 1] || null,  // Bye wenn ungerade Anzahl
      winner: null,
      next_match_id: calculateNextMatch(i / 2 + 1, rounds)
    })
  }

  return bracket
}
```

**Seeding-Strategien:**
- Random: Zufällige Reihenfolge
- ELO-based: Beste Spieler trennen (1 vs 16, 2 vs 15, etc.)
- Manual: Organisator setzt manuell

#### C) Round Robin / Double Round Robin
**Beschreibung:**
- Jeder gegen jeden (1x oder 2x)
- Alle Matches von Anfang an bekannt
- Keine Elimination

**Paarungs-Generierung (Round-Robin-Algorithmus):**
```typescript
function generateRoundRobin(participants: Participant[], doubleRR: boolean = false): Match[] {
  const n = participants.length
  const rounds = n % 2 === 0 ? n - 1 : n
  const matchesPerRound = Math.floor(n / 2)

  const matches: Match[] = []
  const players = [...participants]

  // Wenn ungerade Anzahl, füge "Bye" hinzu
  if (n % 2 !== 0) {
    players.push(null)  // Bye
  }

  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < matchesPerRound; i++) {
      const player1 = players[i]
      const player2 = players[players.length - 1 - i]

      if (player1 && player2) {  // Skip Byes
        matches.push({
          round: round + 1,
          player1,
          player2,
          scheduled_time: calculateMatchTime(round, i)
        })
      }
    }

    // Rotate (außer erstem Spieler)
    players.splice(1, 0, players.pop()!)
  }

  // Wenn Double Round Robin: Reverse Matches hinzufügen
  if (doubleRR) {
    const reverseMatches = matches.map(m => ({
      ...m,
      player1: m.player2,
      player2: m.player1,
      round: m.round + rounds
    }))
    matches.push(...reverseMatches)
  }

  return matches
}
```

**Performance:**
- Bis 200 Teilnehmer: ~20.000 Matches bei Double RR
- Berechnung muss < 5 Sekunden dauern
- Optimierung: Batch-Insert in DB

**Automatische Zeitplanung:**
```typescript
function calculateMatchTime(round: number, matchIndex: number): DateTime {
  const tournamentStart = tournament.start_date
  const matchDuration = 60  // 60 Minuten pro Match
  const breakBetweenRounds = 15  // 15 Minuten Pause

  const minutesOffset = (round * (matchDuration + breakBetweenRounds)) + (matchIndex * 5)
  return tournamentStart.plus({ minutes: minutesOffset })
}
```

### 6.5 Teilnehmer-Registrierung

**Schema:**
```typescript
model TournamentParticipant {
  id            String @id @default(uuid())
  tournament_id String
  tournament    Tournament @relation(fields: [tournament_id], references: [id])
  user_id       String
  user          User @relation(fields: [user_id], references: [id])

  // Faction-Wahl (für SFT-Modus)
  faction_id    String?
  faction       Faction? @relation(fields: [faction_id], references: [id])

  // Army-List (optional)
  army_list_id  String?
  army_list     ArmyList? @relation(fields: [army_list_id], references: [id])

  // Status
  status        ParticipantStatus @default(REGISTERED)

  // Meta
  registered_at DateTime @default(now())

  @@unique([tournament_id, user_id])
}

enum ParticipantStatus {
  REGISTERED
  CHECKED_IN
  DISQUALIFIED
  WITHDREW
}
```

**REST Endpoint:**
```
POST /api/tournaments/:id/register
```

**Request:**
```json
{
  "faction_id": "high_elves",  // Nur bei SFT-Modus
  "army_list_file": "base64_or_upload_id"  // Optional
}
```

---

## 7. Bracket-Ansicht (KRITISCH - VERBESSERUNG!)

### 7.1 Problem mit totaltavern.com

**Beobachtete Probleme:**
- Unübersichtlich bei > 32 Spielern
- Nicht responsive (Mobile unbrauchbar)
- Keine Interaktivität (Zoom, Filter)
- Zeitanzeige nur in UTC (keine Timezone-Konvertierung)
- Laufende Matches nicht hervorgehoben

### 7.2 Anforderungen für neue Bracket-View

**Must-Have:**
1. **Grafische Darstellung:** Bracket-Tree visuell mit Linien zwischen Matches
2. **Responsive:** Funktioniert auf Desktop, Tablet, Mobile
3. **Zoom/Pan:** Bei großen Brackets (> 32 Spieler) muss Zoom möglich sein
4. **Live-Updates:** WebSocket-Events → Bracket aktualisiert sich automatisch
5. **Timezone-Konvertierung:** Zeiten in User-Timezone anzeigen
6. **Highlight:** Laufende Matches grün umrandet, abgeschlossene grau

**Nice-to-Have:**
7. Collapse/Expand Runden
8. "Follow Player"-Modus (zeige nur Pfad eines bestimmten Spielers)
9. Faction-Icons neben Spieler-Namen
10. Click auf Match → Detail-Modal (Army-Lists, Screenshot, etc.)

### 7.3 Implementation-Ansätze

**Option A: React-Library (empfohlen für MVP)**
```bash
npm install react-brackets
```

**Vorteil:** Schnell, funktioniert out-of-the-box
**Nachteil:** Weniger Kontrolle über Design

**Option B: Custom SVG/Canvas (für volle Kontrolle)**
```typescript
// Rendere Bracket als SVG
function BracketView({ matches }: { matches: Match[] }) {
  const width = 1200
  const height = 800
  const nodeWidth = 200
  const nodeHeight = 80

  return (
    <svg width={width} height={height}>
      {matches.map((match, i) => (
        <g key={match.id}>
          {/* Match-Node */}
          <rect
            x={match.round * 250}
            y={i * 100}
            width={nodeWidth}
            height={nodeHeight}
            className={match.status === 'ongoing' ? 'live-match' : ''}
          />
          <text x={match.round * 250 + 10} y={i * 100 + 30}>
            {match.player1.username}
          </text>
          <text x={match.round * 250 + 10} y={i * 100 + 60}>
            {match.player2.username}
          </text>

          {/* Verbindungslinien zum nächsten Match */}
          {match.next_match_id && (
            <line
              x1={match.round * 250 + nodeWidth}
              y1={i * 100 + nodeHeight / 2}
              x2={(match.round + 1) * 250}
              y2={getNextMatchY(match.next_match_id)}
              stroke="#888"
            />
          )}
        </g>
      ))}
    </svg>
  )
}
```

**Zoom/Pan mit react-zoom-pan-pinch:**
```typescript
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch"

function ZoomableBracket() {
  return (
    <TransformWrapper>
      <TransformComponent>
        <BracketView matches={matches} />
      </TransformComponent>
    </TransformWrapper>
  )
}
```

### 7.4 Match-Node Component

```typescript
interface MatchNodeProps {
  match: Match
  userTimezone: string
}

function MatchNode({ match, userTimezone }: MatchNodeProps) {
  const scheduledTime = convertToTimezone(match.scheduled_time, userTimezone)
  const isLive = match.status === 'ongoing'

  return (
    <div className={`match-node ${isLive ? 'live' : ''}`}>
      {/* Player 1 */}
      <div className="player">
        <FactionIcon faction={match.player1_faction} />
        <span>{match.player1.username}</span>
        {match.winner_id === match.player1.id && <Trophy />}
      </div>

      {/* Score */}
      {match.score && (
        <div className="score">{match.score}</div>
      )}

      {/* Player 2 */}
      <div className="player">
        <FactionIcon faction={match.player2_faction} />
        <span>{match.player2.username}</span>
        {match.winner_id === match.player2.id && <Trophy />}
      </div>

      {/* Scheduled Time */}
      <div className="time">
        {scheduledTime.toFormat('HH:mm')}
      </div>
    </div>
  )
}
```

### 7.5 Live-Updates (WebSocket)

**Backend (Socket.io):**
```typescript
// Wenn Organisator Match-Ergebnis einträgt:
io.to(`tournament_${tournamentId}`).emit('match_result', {
  match_id: match.id,
  winner_id: winner.id,
  score: '2:1',
  bracket_updated: true
})
```

**Frontend (Socket.io Client):**
```typescript
useEffect(() => {
  socket.emit('join_tournament', tournamentId)

  socket.on('match_result', (data) => {
    // Update lokalen State
    setMatches(prev =>
      prev.map(m => m.id === data.match_id ? { ...m, winner_id: data.winner_id } : m)
    )

    // Optional: Notification
    toast.success(`${data.winner_name} won!`)
  })

  return () => {
    socket.emit('leave_tournament', tournamentId)
    socket.off('match_result')
  }
}, [tournamentId])
```

---

**Ende Teil 1**

---

## Nächste Schritte

**Teil 2** behandelt:
- Captain's Mode Draft-System (komplett)
- Army-Lists (.army_setup Parsing)
- Leaderboard-System (ELO + Hybrid)
- Season-Management
- Faction-Statistiken
- UI/UX Design
- Kern-Ansichten (Pages)

**Teil 3** behandelt:
- Scraper (totaltavern.com)
- Monetarisierung (Ads, Donations)
- Security & Datenschutz
- Testing
- Deployment & DevOps
- Projekt-Struktur
- Deliverables-Checkliste
- **Zeitschätzung & Phasen-Planung**
