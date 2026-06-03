> Read-when: ELO-Formel anpassen, Bracket-Generierung, Swiss-Paarung, Tournament-Finalization, Faction-Snapshot/Cron.

## TL;DR

- **ELO**: Multi-Player Performance-Rating (A2, zero-sum bei gleichen Ratings), K=32 normal / K=48 Major — `computeEloDeltas()`. Pflegt `LeaderboardEntry.elo_rating` (Legacy, finalizes Tournament).
- **MMR (Welle 2) — ENTFERNT (2026-06-03)**: `lib/mmr.ts`, die Tabellen `FactionMastery`/`FactionMatchupStat`/`AntiFarmCap` und `LeaderboardEntry.season_points` wurden per Migration `drop_welle2_mmr_deprecated` (Branch `chore/phase2-consolidation`) gedroppt. Vollständig abgelöst vom dynamischen Rating-Modell (unten). Die MMR-Formel-Sektion weiter unten ist nur noch **historisch**.
- **Dynamic Weighted Leaderboard (Alex-Spec, 2026-06)**: derive-on-read. L2-regularisierte Logistic Regression `fitRatingModel()` in `lib/rating-model.ts` fittet `PlayerFactionSkill(player,faction)` + antisymmetrischen `MatchupEffect(X,Y)`. Punkte rein abgeleitet via `lib/scoring-service.ts` + aggregiert in `lib/leaderboard-service.ts`. Nichts gespeichert, jeder Punkt rekonstruierbar (`lib/breakdown-service.ts`).
- **Pairings** via `tournament-pairings` v2 — `SingleElimination`, `Swiss`, `RoundRobin` — alle drei Formate in je einer `lib/`-Datei.
- **Swiss-Tiebreaker** (Welle 2): Buchholz → Solkoff → Head-to-Head (kein ELO) — `sortSwissStandings()`.
- **Playoff-Generator** (Welle 2): `generatePlayoffBracket()` in `lib/playoff-generator.ts` — NONE/TOP4/TOP8 mit Auto-Fallback TOP8→TOP4 bei <16 checked-in.
- `finalizeTournament()` schreibt Placements → ELO-Deltas → Tournament-Points → upsert `LeaderboardEntry` + `TournamentResult` in einer Transaktion.

---

## Dynamic Weighted Leaderboard (`lib/rating-model.ts`, `scoring-service.ts`)

Derive-on-read; löst das Welle-2-MMR ab. Pures Modell + Punktelogik, gecacht über `rating-model-service.ts`.

**Modell** (A auf Faktion X vs B auf Faktion Y, A-Perspektive), natural log-odds:
```
ExpectedAdvantage(A) = PFS(A,X) − PFS(B,Y) + MatchupEffect(X,Y)
ExpectedChanceToWin  = logistic(adv) = 1 / (1 + exp(−adv))
RawPoints(Sieger)    = 100 · (1 − ExpectedChanceToWin)         // kein Cap/Floor
```
- `MatchupEffect(X,X)=0`, `MatchupEffect(X,Y)=−MatchupEffect(Y,X)` — **strukturell** erzwungen (nur obere Dreiecksmatrix X<Y als freie Parameter, untere per Negation).
- Kein allgemeiner Spieler-Skill — nur per-Faktion.
- Fit: **Batch-Gradient-Descent mit Adam**, deterministisch (Null-Init, feste Iterationen, kein Random → cachebar). Loss = binary log loss + L2 (`lambdaPlayerFaction` 0.1, `lambdaMatchup` 0.5; via `AdminConfig`-Keys `rating_model_*` überschreibbar). L2-Shrinkage macht das Modell identifizierbar (Gauge-Freiheit der PFS-Differenzen) und verhindert Extremwerte bei wenig Daten.

**Anti-Farming** (`scoring-service.ts`) — player-spezifisch, asymmetrisch, **nicht** auf Faktion/Matchup/Combo:
```
OpponentShare    = matchesVsOpponent / playerTotalMatches
OpponentModifier = total<20 → 1 ; share≤0.05 → 1 ; share≥0.10 → 0 ; sonst (0.10−share)/0.05
FinalPoints      = RawPoints · OpponentModifier ;  LeaderboardScore = Σ FinalPoints über Siege
```
Dynamische Erholung: viele andere Gegner spielen senkt die Share → frühere Punkte kommen zurück.

Tests: `test/{scoring-service,rating-model,leaderboard-service}.test.ts` (alle 8 Spec-Cases + Optimizer + DB-Integration inkl. Explainability-Invariante).

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

## Bracket — Double-Elimination (`lib/bracket.ts`, `routes/matches.ts`, `lib/finalize-tournament.ts`)

### 1. Bracket-Aufbau

Funktion: `generateDoubleElim(tournamentId, participantIds)` → `DEBracketMatchInput[]` (erweitert `BracketMatchInput` um `loser_next_match_id` + `bracket_side`).

**Rundenplan** (disjunkt, erfüllt `@@unique([tournament_id, round, match_number])`):

| Segment | Runden | Match-Anzahl pro Runde |
|---------|--------|------------------------|
| Winners Bracket (WB) | 1 … R_W | S/2, S/4, …, 1 — wobei R_W = log₂(S), S = nextPow2(N) |
| Losers Bracket (LB) | R_W+1 … R_W+R_L | alternierend "drop" + "consol", wobei R_L = 2·R_W − 1 |
| Grand Final (GF) | R_W + R_L + 1 | 1 Match, `bracket_side = GRAND_FINAL` |
| Reset Match | R_W + R_L + 2 | 1 Match, `bracket_side = GRAND_FINAL` |

**LB-Struktur** (True-DE — WB-Final-Verlierer fällt in die letzte LB-Runde, nicht direkt ins GF):

```
LB drop-Runde  (0-indexed r gerade)  ← WB-Runden-Verlierer
LB consol-Runde (0-indexed r ungerade) ← LB interne Konsolidierung
Match-Anzahl: S >> (floor(r/2) + 2), mind. 1  [bracket.ts:261]
```

WB-Runde-r-Verlierer (0-indexed) → LB-Drop-Runde-Index 2r. WB-Final-Verlierer (r = R_W−1) → letzte LB-Runde `lbIds[R_L−1][0]` (lbDropRoundIdx ≥ R_L, Sonderfall `bracket.ts:300–302`).

**Drop→Consol:** 1:1-Mapping (gleiche Match-Anzahl, `next_match_id = lbIds[r+1][i]`).
**Consol→Drop:** halbierende Fanout (`next_match_id = lbIds[r+1][floor(i/2)]`) — `bracket.ts:355–360`.

GF `player1` = WB-Champion (via WB-Final-Winner-Progression), `player2` = LB-Champion. GF `next_match_id = resetMatchId`. Reset `next_match_id = null`.

### 2. Seeding & BYEs

**`seedSlotOrder(size)`** (`bracket.ts:180–192`): erzeugt die Standard-Bracket-Seed-Order (z. B. size=4 → [1,4,2,3]; size=8 → [1,8,4,5,2,7,3,6]). BYE-Slots (seed > N) werden so auf die stärksten Seeds verteilt, dass jede WB-R1-Partie mindestens einen echten Spieler hat — kein leeres Match möglich.

**Topologischer BYE/Phantom-Pass** (Schritt 3, `bracket.ts:421–500`): Traversiert alle Matches in (round, match_number)-Reihenfolge — jeder Feeder ist vor seinem Ziel verarbeitet. Klassifiziert jedes Match als:

| Klasse | Bedingung | Effekt |
|--------|-----------|--------|
| `REAL` | ≥ 2 Spieler (konkret + undetermined) | bleibt PENDING |
| `BYE` | genau 1 Spieler determinierbar | `status=BYE`, `winner_id` gesetzt, Sieger wird via `placeForward` in Ziel-Match vorgeschoben |
| `PHANTOM` | 0 Spieler kommen je an | `status=BYE`, `winner_id=null` — terminiert, blockiert nie die Progression |

"Pass-through BYE" (Sieger wird erst zur Laufzeit bekannt): bleibt BYE-klassifiziert, aber noch kein `winner_id` — das Runtime-`checkAndPromoteBye` ergänzt den Rest.

GRAND_FINAL-Matches überspringen den Pass (bleiben `REAL`).

### 3. Progression (Runtime)

Alle Übergänge laufen in der `$transaction` von `POST /api/matches/:id/result` (`routes/matches.ts:274`).

**Winner-Advance:** `advanceToSlot(tx, next_match_id, winnerId, src, 'winner')` — für alle Matches mit `!isGFSource` (`routes/matches.ts:302–304`).

**Loser-Drop:** `advanceToSlot(tx, loser_next_match_id, loserId, src, 'loser')` — nur DE, nur wenn `winnerId !== null` (kein Draw-Drop) (`routes/matches.ts:308–311`).

**Slot-Zuweisung via `slotForFeeder`** (`bracket.ts:146–159`): Für DE wird die Ziel-Slot-Entscheidung nie per "first-free"-Heuristik getroffen. Stattdessen lädt `advanceToSlot` alle Feeder-Rows des Ziel-Matches aus der DB (alle `next_match_id = targetId` ODER `loser_next_match_id = targetId`) und sortiert sie nach `(round, matchNumber, role)` — `winner` vor `loser` bei Gleichstand. Index 0 → `player1_id`, Index 1 → `player2_id`. Dadurch landen Loser-Drop und Winner-Advance stets in verschiedenen Slots, unabhängig von der Reihenfolge der Ergebnismeldung.

**`checkAndPromoteBye(tx, matchId)`** (`routes/matches.ts:86–133`): Feeder-aware LB-BYE-Promotion. Wird nach jedem Advance aufgerufen. Logik:
1. Match muss PENDING sein und genau einen gesetzten Slot haben.
2. Zählt nicht-terminale Feeder (Status nicht COMPLETED/BYE/FORFEIT) via `count`-Query.
3. Wenn 0 offene Feeder → kein weiterer Spieler kann kommen → `status=BYE`, rekursiv `advanceToSlot` + `checkAndPromoteBye` auf `next_match_id`.
4. GRAND_FINAL-Matches werden nie automatisch zur BYE befördert (`bracket_side === 'GRAND_FINAL'` Guard).

### 4. Grand-Final- & Bracket-Reset-Semantik

`handleGrandFinalProgression(tx, gf, winnerId, loserId)` (`routes/matches.ts:135–162`):

- `gf.next_match_id === null` → Match ist bereits das Reset-Match; kein weiterer Schritt.
- `winnerId === gf.player1_id` (WB-Champion gewinnt GF): Reset-Match wird `FORFEIT`, bekommt aber `player1_id`, `player2_id` und `winner_id` gesetzt — kein zweites Spiel.
- `winnerId !== gf.player1_id` (LB-Champion gewinnt GF): Reset-Match wird mit `player1_id = gf.player1_id` (WB-Champ) und `player2_id = winnerId` (LB-Champ) bestückt — Reset ist zu spielen; erst Reset-Sieger erhält Placement 1.

`isGFSource`-Guard verhindert, dass `winner-advance` + `checkAndPromoteBye` das Reset-Match vorzeitig als BYE markiert, bevor beide Slots gefüllt sind (`routes/matches.ts:292, 301`).

### 5. Finalisierung

`computeDoubleElimPlacements(matches)` (`lib/finalize-tournament.ts:96–135`): **Rundenformel-frei** — keine `placementForRound`-Logik.

1. **Champion**: GRAND_FINAL-Match mit höchster Runde und `status = 'COMPLETED'` → `winner_id` = Platz 1, Verlierer = Platz 2.
2. **Restplatzierungen**: alle übrigen COMPLETED-Matches, absteigend nach Runde sortiert — jeder noch nicht platzierte Verlierer erhält die nächste Platznummer ab 3.
3. BYE- und FORFEIT-Matches werden übersprungen (kein realer Verlierer).

Trigger: identisch zu Single-Elim — letztes Match wechselt auf `COMPLETED` → `finalizeTournament()` in `routes/matches.ts`. **Kein Auto-Finalize** — der Organizer muss manuell finalisieren.

Einbindung in `finalizeTournament()`: `format === 'DOUBLE_ELIMINATION'` → `computeDoubleElimPlacements` (`finalize-tournament.ts:255–258`). Danach ELO + Tournament-Points-Berechnung + Transaktion identisch zum Single-Elim-Pfad.

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

## ~~MMR — 3-Faktor Win-Punkte-Formel (`lib/mmr.ts`)~~ — ENTFERNT (2026-06-03, nur historisch)

> ⚠️ **Dieser gesamte Abschnitt beschreibt totes System.** `lib/mmr.ts`, die Models und `season_points` wurden per `drop_welle2_mmr_deprecated` (Branch `chore/phase2-consolidation`) gedroppt; der Match-Result-Hook unten existiert nicht mehr. Aktuell gilt ausschließlich das **Dynamic Weighted Leaderboard** (Abschnitt darüber). Unten nur zur Nachvollziehbarkeit der Ablösung belassen.

**Alex-Spec (historisch):** No-Loss (Loss = 0), Win-Quality-skaliert, Anti-Farming.

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
