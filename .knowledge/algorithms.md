> Read-when: ELO-Formel anpassen, Bracket-Generierung, Swiss-Paarung, Tournament-Finalization, Faction-Snapshot/Cron.

## TL;DR

- **ELO**: Multi-Player Performance-Rating (A2, zero-sum bei gleichen Ratings), K=32 normal / K=48 Major — `computeEloDeltas()`. Pflegt `LeaderboardEntry.elo_rating` (Legacy, finalizes Tournament).
- **MMR (Welle 2)**: 3-Faktor Win-Punkte-Formel — `computeWinPoints()` in `lib/mmr.ts`. No-Loss-Modus (Loss = 0). Faction-Mastery + Faction-Matchup-Win-Rate + Anti-Farm-Cap. Pflegt `LeaderboardEntry.season_points` zusätzlich + `FactionMastery` + `FactionMatchupStat` + `AntiFarmCap`.
- **Pairings** via `tournament-pairings` v2 — `SingleElimination`, `Swiss`, `RoundRobin` — alle drei Formate in je einer `lib/`-Datei.
- **Swiss-Tiebreaker** (Welle 2): Buchholz → Solkoff → Head-to-Head (kein ELO) — `sortSwissStandings()`.
- **Playoff-Generator** (Welle 2): `generatePlayoffBracket()` in `lib/playoff-generator.ts` — NONE/TOP4/TOP8 mit Auto-Fallback TOP8→TOP4 bei <16 checked-in.
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

**Tiebreaker:** `computeSwissStandings()` berechnet Score + Buchholz + Solkoff. Für Final-Sortierung (z.B. Playoff-Seed) `sortSwissStandings(standings, allMatches)` aufrufen — Hierarchie: `score desc, buchholz desc, solkoff desc, headToHeadWinner desc`. Solkoff = Buchholz minus höchstem und niedrigstem Opponent-Score (nur bei ≥3 Gegnern). H2H entscheidet nur bei genau 2 Spielern auf allen anderen Tiebreakern gleich.

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
): SwissStanding[]          // { userId, score, wins, losses, draws, byes, buchholz, solkoff, opponentsBeaten, ... }

export function sortSwissStandings(   // Welle 2 — Multi-Level-Tiebreaker
  standings: SwissStanding[],
  allMatches: CompletedMatchRecord[],
): SwissStanding[]
```

---

## Playoff-Generator (`lib/playoff-generator.ts`) — Welle 2

Generiert Single-Elimination-Bracket nach Swiss-Last-Round.

```typescript
export function generatePlayoffBracket(args: {
  tournament: Tournament;
  finalStandings: SwissStanding[];   // sorted via sortSwissStandings
  checkedInPlayerIds: Set<string>;
}): {
  format: 'NONE' | 'TOP4' | 'TOP8';
  matches: PlayoffMatch[];           // mit phase=PLAYOFF_QF|SF|FINAL
  fallbackApplied?: 'TOP8_TO_TOP4';
};
```

- `playoff_format=NONE`: leeres Bracket, Swiss-Standings = Final
- `playoff_format=TOP4`: SF1 = Seed1 vs Seed4, SF2 = Seed2 vs Seed3, Final
- `playoff_format=TOP8`: nur wenn `checked_in >= 16` — sonst Auto-Fallback auf TOP4. Seed 1v8 / 4v5 / 3v6 / 2v7. Drop-out 1h vor Playoff = exclusion.
- `game_count` aus `tournament.playoff_match_format` (Bo3/Bo5); Finale aus `finale_match_format`
- TBD-Player-IDs für SF/Final werden via `propagatePlayoffWinner()` aus Match-Result-Hook aufgefüllt

Hook in `routes/bracket.ts:next-round` — nach letzter Swiss-Runde aufrufen.

---

## MMR — 3-Faktor Win-Punkte-Formel (`lib/mmr.ts`) — Welle 2

**Alex-Spec:** No-Loss (Loss = 0), Win-Quality-skaliert, Anti-Farming.

**Formel:**
```
BASE = isTournament ? mmr_base_points_tournament (100) : mmr_base_points_casual (50)
MAJOR_BONUS = isMajor ? 1.5 : 1.0

matchup_winrate = FactionMatchupStat[season, winnerFaction, loserFaction].win_rate ?? 0.5
opponent_mastery_factor = clamp(0.5, 1.5, loser_mastery_rating / 1500)
my_mastery_dampener     = clamp(0.5, 1.0, 1.0 - (winner_mastery_rating - 1200) / 2000)
win_quality = (1 - matchup_winrate) * opponent_mastery_factor * my_mastery_dampener

anti_farm_modifier = isTournament ? 1.0
  : max(0, (max_cap - points_earned) / max_cap)

points = max(0, round(BASE * MAJOR_BONUS * win_quality * anti_farm_modifier))
```

**Faction-Mastery-Threshold:** Bei `games_played < 10` mit der Faction → mastery rating = 1200 (neutral). Anders: persistent Rating, Default 1200, +10 nach Win / −10 nach Loss, **Floor 800**.

**Anti-Farming-Cap:** Pro `(season, ordered(player_a, player_b), ordered(faction_a, faction_b))` ein Points-Cap (Default 200). Tournaments ignorieren Cap. Casual-Matches incrementieren via `incrementAntiFarmCap()`.

**Display:** Im Leaderboard nur `season_points` sichtbar (Tab `season_points` Default, plus Tabs `winrate` und `weighted_winrate`). FactionMastery intern für Matchmaking, nur im eigenen Profil sichtbar.

**Match-Result-Hook** (in `routes/matches.ts`) ruft:
1. `computeWinPoints(...)` → `points`
2. `LeaderboardEntry.season_points += points` für Winner
3. `updateFactionMasteryAfterMatch()` (winner + loser)
4. `updateFactionMatchupStat()` (beide Richtungen)
5. `incrementAntiFarmCap()` (nur casual)

Hook ist non-fatal: bei Fehler → Log, kein Match-Result-Failure.

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
