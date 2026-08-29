# Postmortem: rizzotto.gg — 35 Minuten ohne API (2026-08-28)

**Schweregrad:** hoch (Seite für alle Nutzer unbrauchbar) · **Dauer:** 18:37:56 – 19:12:50 UTC
(20:37 – 21:12 CEST), 35 Minuten · **Datenverlust:** keiner

## Zusammenfassung

Ein von einem Spieler hochgeladenes Replay ließ den Replay-Parser in eine praktisch endlose
Schleife laufen. Der Parser läuft synchron im Request-Handler, Node ist single-threaded — damit
stand der gesamte Event-Loop. Der Prozess lebte weiter, antwortete aber auf nichts mehr. Caddy
lieferte 502, systemd sah einen kerngesunden Service und griff nicht ein. Erst ein manueller
Redeploy durch Alex (`workflow_dispatch`, Run #311) hat den Prozess neu gestartet.

## Zeitleiste (UTC)

| Zeit | Ereignis |
|---|---|
| 27.08. 10:17:37 | Regulärer Deploy #310 (`f35b4be`). Backend startet, läuft danach 33 h ohne Störung. |
| 28.08. 18:36:21 | Das später fatale Replay wird im Spiel aufgezeichnet. |
| 28.08. 18:37:55.860 | `POST /api/matches/fe229901…/games/1/result` geht ein (`reqId: req-3x06`). |
| 28.08. 18:37:55.979 | Letzte Log-Zeile überhaupt. `req-3x06` loggt **nie** ein `request completed`. |
| 28.08. 18:38 – 19:12 | Caddy protokolliert 1065 × `dial tcp 127.0.0.1:3000: i/o timeout`. Alle `/api/*` → 502. |
| 28.08. ~19:06 | Alex meldet den Ausfall. |
| 28.08. 19:12:50 | Redeploy #311 startet den Prozess neu. Seite sofort wieder da. |
| 28.08. 19:13:00 | Der Match wird abgeschlossen — 10 s nach dem Neustart. |

## Root Cause

`apps/backend/src/lib/replay-parser.ts` läuft den ESF-Baum eines Replays ab. Für jeden Record wird
die Anzahl der Gruppen als CAULEB128-Varint gelesen — ein Format ohne jede Obergrenze. In diesem
Replay lieferte diese Stelle für einen 29 Byte großen Block:

```
groupCount = 7 452 418 767 438 641 000
```

Die Gruppen-Schleife hatte keine Invariante, die das abfängt. Der innere Cursor stand bereits
hinter dem Blockende, also tat jede Iteration **nichts** außer den Zähler zu erhöhen — gemessene
1,5 Mio Iterationen/s, hochgerechnete Laufzeit rund **157 000 Jahre**.

Aufgerufen wird der Parser aus `verifyGameReplay()` heraus, synchron im Handler von
`POST /api/matches/:id/games/:gameNumber/result`. Damit war es kein hängender Request, sondern ein
stehender Prozess.

### Warum es so lange gedauert hat

Drei Schutzmechanismen hätten greifen können. Keiner konnte:

1. **`Restart=always`** reagiert ausschließlich auf einen Prozess, der *endet*. Dieser endete nicht.
   Aus systemds Sicht war alles in Ordnung — `active (running)`, keine einzige Lifecycle-Zeile im
   Journal zwischen dem Deploy und dem Redeploy.
2. **Kein Health-Check.** Nichts hat je geprüft, ob der Prozess noch *antwortet*.
3. **Kein Monitoring.** Der Ausfall wurde bemerkt, weil ein Nutzer sich gemeldet hat.

Das Fehlerbild in Caddys Log ist dabei diagnostisch eindeutig: `dial tcp … i/o timeout`, nicht
`connection refused`. Der Listen-Socket war offen, aber niemand rief `accept()` — die Accept-Queue
lief voll und der Kernel verwarf die SYNs. Genau so sieht ein blockierter Event-Loop aus.

## Was wir geändert haben

| Bereich | Änderung |
|---|---|
| **Der Bug** | Gruppen-Schleife bekommt ihre fehlende Invariante (keine Gruppe kann am/hinter dem Blockende beginnen, da jede mindestens ein Byte belegt) plus ein Walk-weites Step-Budget als Backstop. Beide degradieren über das bestehende Fail-Open-`catch`. |
| **Regressionstest** | `test/replay-parser.test.ts` — synthetischer ESF-Buffer mit absurdem `groupCount`, mit Zeitschranke. |
| **Erkennung** | `rizzotto-health.timer` probt minütlich `/health` und startet nach 2 Fehlschlägen neu (~2 min statt 35). Neuer `/health/deep` prüft zusätzlich Postgres + Redis. |
| **Alarmierung** | `rizzotto-alert@.service` als `OnFailure=`-Ziel; Watchdog meldet Restart **und** Erholung nach Discord. Externer Uptime-Monitor auf `/health/deep`. |
| **Deploy-Gate** | Der Smoke-Test prüfte nur `https://rizzotto.gg` — statische Cloudflare-Assets, 200 auch bei totem Backend. Jetzt zusätzlich `/health`, `/health/deep` und ein echter API-Read, **jeweils mit Inhaltsprüfung**. |
| **Reverse-Proxy** | Caddys `path`-Matcher listete `/health` und matcht damit *exakt* — `/health/deep` fiel in den SPA-Fallback und antwortete 200 mit `index.html`. Beim ersten Rollout war der neue Smoke-Test dadurch grün, ohne irgendetwas zu prüfen. Matcher auf `/health /health/*` erweitert; seitdem prüfen alle Backend-Checks zusätzlich den Response-Inhalt, damit ein Fallback nie wieder als „gesund" durchgeht. |
| **systemd** | `StartLimitIntervalSec`/`StartLimitBurst` standen in `[Service]` statt `[Unit]` und wurden ignoriert (systemd loggte das bei jedem `daemon-reload`). Dazu `MemoryMax` + `OOMPolicy=stop`, damit ein Speicherleck nicht den Kernel-OOM-Killer auf Postgres ansetzt. |
| **Crash-Guard** | `unhandledRejection`/`uncaughtException` loggen jetzt `fatal` mit Stack und beenden bewusst — vorher wäre ein solcher Tod spurlos gewesen. |
| **Shutdown** | `app.close()` bekommt 10 s, danach hartes Exit. Vorher wartete systemd bei drei von vier Restarts die vollen 90 s bis SIGKILL ab — **jeder Deploy hatte ein 90-Sekunden-502-Fenster**. |
| **Backups** | `pg_dump` lag ausschließlich lokal auf demselben Server. Jetzt zusätzlich Off-Site nach Cloudflare R2, mit Verifikation und Failure-Alert. |

## Verifikation des Fixes

Gegen 60 echte Production-Replays (die 12 größten plus eine Zufallsstichprobe):

- Alter Parser: hängt an **genau** der Incident-Datei, verarbeitet die anderen 59.
- Neuer Parser: verarbeitet alle 60, Ergebnisse auf den 59 gemeinsamen **identisch**, max. 9 ms.
- Die zuvor hängende Datei parst jetzt korrekt (beide Spieler samt Fraktionen).

## Lehren

- **Frontend-200 heißt nicht, dass die Seite lebt.** Ein Smoke-Test, der nur statische Assets von
  einem CDN abfragt, misst das CDN. Und ein Statuscode allein reicht nicht: ein SPA-Fallback
  antwortet auf *jeden* nicht geroutenen Pfad mit 200. Ein Check muss den Inhalt sehen, den er
  erwartet — sonst prüft er, dass die Fehlerseite erreichbar ist. Genau das ist uns beim ersten
  Rollout dieses Fixes passiert.
- **`Restart=` ist kein Health-Check.** Es deckt „Prozess tot" ab, nicht „Prozess antwortet nicht".
  Das sind verschiedene Ausfälle und sie brauchen verschiedene Mechanismen.
- **Jede Schleife über eine aus Nutzerdaten gelesene Zahl braucht eine Obergrenze aus der Struktur
  selbst.** Hier: eine Gruppe belegt mindestens ein Byte, also kann es nie mehr Gruppen geben als
  der Block Bytes hat. Diese Invariante existierte, war aber nicht hingeschrieben.
- **Die Log-Lücke war der Schlüssel.** Ein Request mit `incoming request` und ohne
  `request completed`, gefolgt von völliger Stille, ist die Signatur eines blockierten Event-Loops.

## Offen

- Backend für Production kompilieren statt `tsx` zur Laufzeit zu fahren (Speicher, Bootzeit) —
  eigene, separat zu testende Änderung.
- Log-Level: 600–1200 Zeilen/Minute auf `info` (jeder Request zweimal). Hat hier die Analyse
  gerettet, ist auf Dauer aber Journal-Ballast.
- **`app.close()` kommt weiterhin nicht durch.** Der 10-s-Guard begrenzt den Schaden (Deploy-Fenster
  90 s → 10 s, und die Unit stoppt jetzt sauber statt per SIGKILL), aber im Journal steht bei jedem
  Restart `graceful shutdown timed out — exiting anyway`. Irgendein Handle hält die Instanz offen —
  Verdacht: die beiden `setInterval`s aus `plugins/cron.ts` oder Socket.IO. Das ist ein Pflaster,
  keine Heilung: offene Requests werden beim Deploy weiterhin hart abgeschnitten.
