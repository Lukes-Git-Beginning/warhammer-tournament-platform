# M3 Smoke-Test mit Guide — Start-Prompt für neue Session

Kopier den Block unter `--- PROMPT START ---` in eine frische Claude-Code-Session.

---

## --- PROMPT START ---

Wir machen jetzt einen geführten End-to-End-Smoke-Test der gerade fertig gepushten M3-Features für die TWW3-Tournament-Platform. Lies erst Memory (`~/.claude/projects/C--Users-Luke-Documents-Warhammer/memory/MEMORY.md` plus die verlinkten Files) und den Plan unter `~/.claude/plans/m3-mit-standard-decisions-durchballern-nifty-swing.md` für Kontext.

**Stand:** main bei Commit `38f4660`. CI grün. Lokal 141/141 Backend-Tests + 13/13 Frontend-Tests. M3.0–M3.10 alle gepusht. Manuelle Verifikation steht aus.

### Ablauf

1. **Stack hochfahren** — als drei Background-Tasks (run_in_background), warte auf Ready via `until grep -q ... log` Polling. Keine Sleep-Loops.
   - Docker prüfen: `tww3-postgres` und `tww3-redis` Container müssen `healthy` sein (sind sie aktuell). Falls nicht: `pnpm docker:up`.
   - Backend: `pnpm --filter @tww3/backend dev` → wartet auf "listening" in stdout, lauscht auf Port 3000.
   - Frontend: `pnpm --filter @tww3/frontend dev` → wartet auf "Local:" oder "ready in", Port 5173.
   - Prisma Studio: `pnpm db:studio` → Port 5555. Bekannte Falle: Studio hält einen zufälligen Hilfs-Port (z.B. 51212). Wenn EADDRINUSE: in PowerShell `Get-NetTCPConnection -LocalPort 51212 -State Listen | Stop-Process -Id $_.OwningProcess -Force` (analog für andere Ports im 49152+ Range). Falls ein orphan Socket im LISTENING-State ohne aktiven Prozess hängt: Windows TCP needs a real reset — `Restart-Service -Name "iphlpsvc"` oder Neustart des Terminals, sonst Studio einfach NICHT starten und stattdessen Prisma-Daten via `curl http://localhost:3000/api/...` lesen.
   - Smoke-Check: `curl http://localhost:3000/health` muss `{"status":"ok",...}` geben.

2. **Smoke-Checkliste** — geh die Punkte mit mir durch. Pro Punkt: erklär kurz was getestet wird, gib mir den exakten Klick-/curl-Befehl, warte auf meine Rückmeldung ("✓", "✗ Fehler: ...", "übersprungen"). Bei Failure: debugge interaktiv (Backend-Log streamen, DB-Query, Netzwerk-Tab).

   **T1 — Role-Cache-Fix (M3.1, der Pre-M3-Bug):**
   - In Prisma Studio: meinen User in `User`-Tabelle finden, `role` von `USER` auf `ORGANIZER` setzen.
   - Mit altem JWT-Cookie (also ohne Logout) auf http://localhost:5173 → "Erstellen" klicken → Tournament-Create-Form muss erreichbar sein und der POST muss klappen.
   - Erwartung: Wirkt sofort, kein Re-Login nötig. Cache TTL ist 60s, also frühestens nach PATCH /api/users/:id/role wirkt es im Cache. Hier setzen wir direkt in der DB → erster requireRole-Call hat Cache-Miss und liest aktuelle Rolle.

   **T2 — Faction-API + Meta-Dashboard (M3.4, M3.6):**
   - `curl http://localhost:3000/api/factions | jq '.data | length'` → muss `24` sein.
   - http://localhost:5173/meta → Overview-Cards (Total Matches, Diversity) + Top-Listen + 24×24-Heatmap. Bei leerer DB: Heatmap-Zellen mit Opacity 0.3 (n<5-Marker).
   - http://localhost:5173/factions → 24 Cards mit color_hex-Badges + 2-Letter-Initialen ("EM" Empire, "HE" High Elves, "DC" Daemons of Chaos).
   - http://localhost:5173/factions/empire → Detail-Page mit StatCards + (vermutlich leerer) 30d-Trend.

   **T3 — GraphQL (M3.9):**
   - http://localhost:3000/graphiql öffnen (NODE_ENV!=production aktiviert GraphiQL).
   - Query laufen lassen: `{ factions { data { faction { id name colorHex initials } } } }` → 24 Einträge.
   - Optional: `{ matchupHeatmap { cells { factionAId factionBId winrateA } } }` → leeres Array bei leerer DB ist ok.

   **T4 — ELO-Workflow end-to-end (M3.2 + M3.3 + M3.7):**
   - Als ORGANIZER Tournament anlegen, Format z.B. `SWISS` mit 4 Teilnehmern. Wenn nicht genug echte Discord-Accounts: in Prisma Studio direkt 3 weitere Test-User mit `discord_id` und `username` anlegen, dann via `TournamentParticipant` registrieren.
   - In Prisma Studio: dieses Tournament-Row `is_major: true` setzen (M3-Standards: ADMIN setzt is_major manuell — UI-Toggle ist M5-Polish).
   - Bracket generieren, alle Matches reportieren mit verschiedenen Faction-Kombinationen (z.B. R1: Empire vs Bretonnia, Dwarfs vs Khorne). Pro Match Score und winner setzen.
   - Tournament-Status auf `COMPLETED` setzen — entweder via API-Call (`curl -X PATCH http://localhost:3000/api/tournaments/<slug> -H "Cookie: auth_token=..." -d '{"status":"COMPLETED"}'`) oder direkt in der UI falls Toggle vorhanden.
   - Erwartete Effekte:
     - `LeaderboardEntry.elo_rating` für jeden Teilnehmer ist NICHT mehr 1200 (zumindest bei einigen): K=48 (is_major), Top-Platz +24, Bottom-Platz -24 (siehe Plan-File Sektion A).
     - `TournamentResult.elo_change` ist befüllt.
     - http://localhost:5173/leaderboard zeigt geänderte ELO mit Pfeil ▲/▼ via EloRatingDisplay.
     - http://localhost:5173/users/`<meine-id>` "Recent Tournaments" hat eine ELO-Spalte mit `+24` / `-8` in Grün/Rot.
     - `MatchupStats` in der DB: pro Faction-Paarung ein Row mit `faction_a_id < faction_b_id` (z.B. Match Empire vs Bretonnia → Row `bretonnia/empire`). Mirror-Matches (gleiche Faction beidseitig) sind ok.
     - http://localhost:5173/meta nach Reload: Heatmap-Zellen für die gerade gespielten Matchups werden farbig.

   **T5 — Cache-Invalidate (M3.10):**
   - Erster Aufruf: `curl http://localhost:3000/api/meta/overview` → speichere Antwort.
   - Match-Result reportieren (oder ein Tournament finalisieren).
   - Zweiter Aufruf: `curl http://localhost:3000/api/meta/overview` → Antwort muss frisch sein (z.B. `total_matches` höher), nicht stale aus dem 120s-Cache.

3. **Daily-Snapshot manuell triggern (M3.8) — optional aber empfohlen:**
   - `node -e "import('./apps/backend/dist/lib/faction-snapshot.js').then(m => import('./packages/db/dist/index.js').then(db => m.takeFactionsSnapshot(db.prisma).then(console.log)))"` (Pfade ggf. anpassen, ggf. `pnpm build` vorher)
   - Oder über `pnpm --filter @tww3/backend exec tsx -e "..."` mit Source-Imports.
   - Erwartung: returns N (Anzahl FactionStats-Rows der aktiven Season), und `FactionStatsSnapshot`-Tabelle hat N neue Rows mit heutigem Datum. Zweiter Aufruf returns 0 (skipDuplicates).

4. **Aufräumen:** Am Ende alle drei Background-Tasks via TaskStop beenden, oder PowerShell-Kill via `Get-NetTCPConnection -LocalPort 3000,5173,5555 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`.

### Wichtige Konventionen aus Memory

- Yolo-Mode aktiv — frag nur bei force-push, migrate-reset, repo-delete. Sonst durchballern.
- Deutsch in Kommunikation, Englisch in Commits/Code.
- Bei Hängern Diagnose vor Workaround. Nie destruktive Shortcuts.
- Wenn ein Test Bug zeigt: zuerst notieren, ich entscheide ob direkt fixen oder als Follow-up-PR.

Plan-File-Referenz für ELO-Erwartungswerte: `~/.claude/plans/m3-mit-standard-decisions-durchballern-nifty-swing.md`, Sektion A Test-Tabelle.

Starte mit Schritt 1.

## --- PROMPT END ---

---

## Smoke-Run 2026-05-12 — Ergebnisse

Alle Tests T1–T5 + M3.8 grün. Inline gefixt:

- `apps/backend/src/lib/factions.ts` — `computeInitials` mit Stop-Word-Filter (`of`, `the`, `and`) + Override-Map für Vampire-Counts/Coast → `DC`, `WC`, `VCs`, `VCo`. Tests in `factions.test.ts` und `graphql.test.ts` ergänzt; Length-Assert auf 2–3 relaxed. 141/141 grün.
- `apps/frontend/src/components/meta/MatchupHeatmap.tsx` — Diverging-Color-Scale (Saturation 15→70 %, Lightness 85→30 % skalieren mit Distanz zur Mitte). Heatmap deutlich besser unterscheidbar.

## Follow-up-TODOs

- [ ] **A — Test-Suite nicht hermetisch.** Zwei Symptome aufgefallen:
  1. Nach `pnpm -F @tww3/backend test` ist `Season.is_active` für alle Rows `false` — „Season 2026" muss reaktiviert werden, sonst liefert `/api/factions` 404.
  2. Tests `matchup-stats.test.ts`, `leaderboard.test.ts`, `faction-snapshot.test.ts` nutzen hardcoded Seed-User-IDs (`b0000000-…-001` = EmpirePlayer, `2000…-001` = Alpha etc.) und löschen die per `deleteMany`. Wenn der echte Stack diese User als `TournamentParticipant` oder `LeaderboardEntry` referenziert (wie in unserem Smoke geschehen), schlägt der Cleanup mit FK-Violation fehl. **Cleanup vor nächstem Test-Lauf nötig**: alle `TournamentResult`/`LeaderboardEntry`/`MatchupStats`/`FactionStats`/`FactionStatsSnapshot` für `Season 2026` (`4faf7717-…`) löschen (Docker war abgestürzt, die Smoke-Daten sind noch da). Strukturell: Tests sollten eigene Test-Users mit unique-Prefix anlegen (`test-…`) statt Seed-IDs zu greifen.
- [ ] **B — `pick_count` ist 0 statt `matches_played` in der API-Response.** Plan-Sektion D sagte „M3 setzt nur matches_played, exponiert das als pick_count in Response", aber `asFactionStatsDto` reicht das DB-Feld `pick_count` (in M3 nicht befüllt) durch. Im Response steht z. B. `matches_played: 3, pick_count: 0`. Fix passt in M4-Draft (wenn pick/ban-Counts ohnehin angefasst werden).
- [ ] **C — Kein Header-Nav-Link zu `/factions` und `/factions/$id`.** Routes existieren, aber sind nur direkt per URL erreichbar. Header hat nur „Meta". M5-Polish: Card-Click in MetaDashboard → FactionDetailPage, plus optional „Factions"-Link.
- [ ] **D — `prisma studio` Default-Port ist 51212, nicht 5555** (Annahme im Prompt oben). Beim nächsten Smoke entweder explizit `--port 5555` setzen oder die Doku-Stelle in Schritt 1 anpassen.
