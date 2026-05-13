> Read-when: ELO-Formel anpassen, Bracket-Generierung, Swiss-Paarung, Tournament-Finalization, Faction-Snapshot/Cron.

## TL;DR

- **ELO**: Multi-Player Performance-Rating (A2, zero-sum bei gleichen Ratings), K=32 normal / K=48 Major — `computeEloDeltas()`.
- **Pairings** via `tournament-pairings` v2 — `SingleElimination`, `Swiss`, `RoundRobin` — alle drei Formate in je einer `lib/`-Datei.
- `finalizeTournament()` schreibt Placements → ELO-Deltas → Tournament-Points → upsert `LeaderboardEntry` + `TournamentResult` in einer Transaktion.

---

## ELO-Algorithmus (`lib/elo.ts`)

**Variante A2 — Multi-Player Performance Rating**, mathematisch zero-sum bei gleichen Ratings.

Formel:
```
scoreP_i    = (N - avgRank_i) / (N - 1)
expectedP_i = (1 / (N-1)) * Σ_{j≠i} [ 1 / (1 + 10^((R_j - R_i) / 400)) ]
delta_i     = round(K * (scoreP_i - expectedP_i))
```

**Zero-sum:** Bei gleichen Ratings ist `Σ expectedP_i = Σ scoreP_i`, d.h. `Σ delta_i ≈ 0` (Rundungsfehler maximal ±N/2).

**K-Faktoren:** `K = options.isMajor ? 48 : 32`

**Tie-Handling:** Spieler mit gleichem `placement` teilen den Durchschnitt ihrer Ordinalränge (`avgRank = (i + j + 1) / 2`).

**Kein ELO-Floor** — `newRating` kann unter 1200 fallen.

Signatur:
```typescript
export function computeEloDeltas(
  players: EloInput[],   // { userId, currentRating, placement }
  options: EloOptions,   // { isMajor: boolean }
): EloResult[]           // { userId, oldRating, newRating, delta }
```

Kern-Schleife:
```typescript
for (const player of players) {
  const scoreP = scoreMap.get(player.userId)!;
  let expectedSum = 0;
  for (const opponent of players) {
    if (opponent.userId === player.userId) continue;
    expectedSum += 1 / (1 + Math.pow(10, (opponent.currentRating - player.currentRating) / 400));
  }
  const expectedP = expectedSum / (N - 1);
  const delta = Math.round(K * (scoreP - expectedP));
  // ...
}
```

---

## Bracket — Single-Elimination (`lib/bracket.ts`)

Nutzt `SingleElimination` aus `tournament-pairings`. Funktion: `generateSingleElim(tournamentId, participantIds)`.

**BYE-Handling:** Library füllt auf — falls genau ein Slot besetzt ist → `status = 'BYE'`, `winner_id = Spieler`. BYE-Winner wird in 3. Pass in den freien Slot des Folge-Matches propagiert.

**`next_match_id`-Verkettung:** Zwei-Pass-Verfahren — erster Pass weist UUIDs zu, zweiter verknüpft via `m.win.round / m.win.match` → UUID-Map. Ermöglicht Live-Bracket-Updates über `next_match_id` in `Match`-Records.

```typescript
export function generateSingleElim(
  tournamentId: string,
  participantIds: string[],
): BracketMatchInput[]
```

---

## Swiss-System (`lib/swiss.ts`)

Nutzt `Swiss` aus `tournament-pairings`.

**Rematch-Avoidance:** Jeder `SwissPlayer` trägt ein `avoid: string[]`-Array (bereits getroffene Gegner). Die Library respektiert dieses Feld bei der Paarung.

**Score-Group-basiert:** Spieler werden nach `score` absteigend gepaart; bei ungerader Zahl erhält der Schlusslichte ein BYE (`winner_id = player1`, `player2 = null`).

**Tiebreaker:** `computeSwissStandings()` sortiert nach `score desc, buchholz desc` — Buchholz = Summe der Gegner-Scores.

**Rundenempfehlung:** `recommendNumberOfRounds(n) = clamp(ceil(log2(n)), 3, 7)`.

```typescript
export function generateSwissRound(
  tournamentId: string,
  players: SwissPlayer[],   // { userId, score, avoid, receivedBye }
  round: number,
): SwissMatchInput[]

export function computeSwissStandings(
  participantIds: string[],
  completedMatches: CompletedMatchRecord[],
): SwissStanding[]          // { userId, score, wins, losses, draws, byes, buchholz, ... }
```

---

## Round-Robin (`lib/round-robin.ts`)

Nutzt `RoundRobin` aus `tournament-pairings`. Funktion: `generateRoundRobin(tournamentId, participantIds, double)`.

- **Single RR:** Jeder gegen jeden genau einmal — `RoundRobin(ids, 1, true)`.
- **Double RR (DRR):** Zweite Runde mit vertauschten `player1/player2` (Home/Away-Reversal), Rundennummern ab `firstLegRounds + 1`.
- BYE-Handling identisch zu Swiss (ungerade Spielerzahl).

---

## Tournament-Finalization (`lib/finalize-tournament.ts`)

**Trigger:** Letztes Match wechselt auf `COMPLETED` → `finalizeTournament(prisma, tournamentId, actorId)` wird aus dem Match-Result-Hook in `routes/matches.ts` aufgerufen.

**Ablauf:**

1. **Placements berechnen:**
   - Swiss/RR/DRR → `computeRankedPlacements()` (Wins desc, Losses asc; Ties teilen denselben Rang)
   - Single-Elim → `computeSingleElimPlacements()` (`placementForRound(round, totalRounds)`)
2. **ELO berechnen:** `computeEloDeltas(eloInputs, { isMajor })` — liest bestehende `elo_rating` aus `LeaderboardEntry` (Default 1200)
3. **Points berechnen:** `calculateTournamentPoints({ placement, playerCount, isMajor })` aus `lib/tournament-utils.ts`
4. **Transaktion** — pro Participant:
   - `TournamentResult.upsert` (placement, points_earned, elo_change)
   - `LeaderboardEntry.upsert` (total_points increment, elo_rating überschreiben) — nur wenn `counts_for_leaderboard && seasonId`
5. **AuditLog**-Eintrag (`action: 'finalize'`)

Hinweis: `Tournament.status` wird in der aktuellen Implementierung **nicht** auf `FINALIZED` gesetzt — das Finalisierungs-Flag wird ausschließlich über `TournamentResult`-Existenz abgeleitet.

---

## Leaderboard mit RANK() OVER (`routes/leaderboard.ts`)

Tie-break-fähiges Ranking via Postgres-Window-Funktion:

```sql
RANK() OVER (
  ORDER BY le.total_points DESC, le.elo_rating DESC, le.wins DESC
) AS rank
FROM "LeaderboardEntry" le
INNER JOIN "User" u ON u.id = le.user_id
WHERE le.season_id = $seasonId::uuid
```

Implementiert via `prisma.$queryRaw`. Gibt `rank` als Zahl zurück (Postgres-`bigint` wird im Handler zu `Number()` gecastet).

---

## Faction-Snapshot — Cron (`plugins/cron.ts` + `lib/faction-snapshot.ts`)

- **Schedule:** `'5 0 * * *'` UTC (täglich 00:05 UTC) via `node-cron`
- **Job:** `takeFactionsSnapshot(prisma)` liest alle `FactionStats` der aktiven Season und schreibt sie als `FactionStatsSnapshot`-Zeilen für Zeitreihen-Diagramme
- **Idempotent:** `createMany({ skipDuplicates: true })` — doppelte `(faction_id, season_id, snapshot_date)`-Kombinationen werden lautlos übersprungen
- **Nur aktiv wenn** `withCron: true` (nicht in Test-Modus — `buildApp({ withCron: false })`)

```typescript
export async function takeFactionsSnapshot(
  prisma: PrismaClient,
  opts?: { seasonId?: string },
): Promise<number>  // Anzahl neu eingefügter Zeilen
```

---

## Heatmap (`lib/heatmap.ts`)

N×N-Matrix aus `MatchupStats` (alle Saison-Paarungen).

```typescript
export async function getMatchupMatrix(
  prisma: PrismaClient,
  seasonId: string,
): Promise<MatchupCell[]>
```

Raw-SQL via `prisma.$queryRaw` — berechnet `total` und `winrate_a` direkt in Postgres. `winrate_a` ist `faction_a_wins / total` (NULL wenn total = 0). Postgres-`bigint`-Felder werden via `Number()` normalisiert.

**Frontend:** Diverging-Color-Scale — 50% = neutral, < 50% = rot, > 50% = grün.

---

## MatchupStats-Konvention (`routes/matches.ts`)

Jedes Matchup wird **einmal** in der Tabelle gespeichert. Konvention: `faction_a_id < faction_b_id` (alphabetisch/lexikalisch via `[id1, id2].sort()`).

```typescript
// routes/matches.ts — Match-Result-Hook
const sorted = [effectiveP1FactionId, effectiveP2FactionId].sort();
const [aId, bId] = sorted;  // aId < bId garantiert
await tx.matchupStats.upsert({
  where: { faction_a_id_faction_b_id_season_id: { faction_a_id: aId, faction_b_id: bId, season_id } },
  // faction_a_wins / faction_b_wins abhängig davon, wer aId ist
});
```

---

## Konstanten

| Konstante | Wert | Quelle |
|-----------|------|--------|
| `K` (normal) | `32` | `lib/elo.ts` — `options.isMajor ? 48 : 32` |
| `K` (Major) | `48` | `lib/elo.ts` |
| Cron-Schedule | `'5 0 * * *'` UTC | `plugins/cron.ts` |
| ELO-Default | `1200` | `lib/finalize-tournament.ts` |
| Swiss-Runden min/max | `[3, 7]` | `lib/swiss.ts` — `recommendNumberOfRounds()` |

---

## Tests

Relevante Test-Files in `apps/backend/test/`:

| File | Abgedeckt |
|------|-----------|
| `elo.test.ts` | Zero-sum-Property, K-Faktor, Tie-Handling, Solo-Edge-Case |
| `bracket.test.ts` | BYE-Handling, `next_match_id`-Verkettung, Power-of-2 |
| `swiss.test.ts` | Rematch-Avoidance, Score-Groups, Buchholz |
| `round-robin.test.ts` | Single/Double-RR, BYE, Rundenzählung |
| `finalize-tournament.test.ts` | End-to-End-Placements, ELO-Upsert, Points |
| `faction-snapshot.test.ts` | Idempotenz (`skipDuplicates`), kein aktiver Season-Guard |
| `matchup-stats.test.ts` | Alphabetische Konvention, Win-Counter |
| `leaderboard.test.ts` | RANK() OVER, Tie-Break, Pagination |
| `heatmap.test.ts` | Matrix-Aufbau, `winrate_a`-Berechnung, NULL-Handling |
