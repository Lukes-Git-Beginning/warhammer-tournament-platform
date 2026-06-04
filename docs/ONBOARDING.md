# Onboarding — Rizzotto lokal aufsetzen (Windows)

> Schritt-für-Schritt-Anleitung, um das komplette Projekt auf einem frischen
> **Windows-PC** zum Laufen zu bringen — von der Tool-Installation über den Code
> bis zur Claude-Code-Konfiguration. Für macOS/Linux gelten dieselben Schritte;
> nur die Installationsbefehle unterscheiden sich (Homebrew/apt statt Installer).

**Zeitaufwand:** ~30–45 Minuten (plus Download-Zeiten).
**Voraussetzung:** keine — die Anleitung beginnt bei null.

---

## Teil 0 — Tooling installieren

Alle folgenden Tools einmalig installieren. Reihenfolge spielt keine Rolle, aber
**Node muss vor pnpm** da sein.

### 1. Git for Windows

- Download: <https://git-scm.com/download/win>
- Im Installer **„Git Bash"** mit installieren (Default). Git Bash brauchen wir
  später für `cp`/`openssl`-Befehle, die es unter klassischem CMD nicht gibt.
- Prüfen (in PowerShell oder Git Bash):
  ```bash
  git --version
  ```

### 2. Node.js 22

Das Projekt verlangt **Node ≥ 22** (siehe `.nvmrc` = `22`). Zwei Wege:

**Empfohlen — nvm-windows** (erlaubt mehrere Node-Versionen):
- Download: <https://github.com/coreybutler/nvm-windows/releases> → `nvm-setup.exe`
- Danach:
  ```powershell
  nvm install 22
  nvm use 22
  node --version    # sollte v22.x zeigen
  ```

**Alternativ — direkter Installer:** Node 22 LTS von <https://nodejs.org> (MSI).

### 3. pnpm 9.15.0

Das Projekt pinnt **pnpm 9.15.0** (Feld `packageManager` in `package.json`).
Node 22 bringt **Corepack** mit — das ist der sauberste Weg:

```powershell
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm --version    # sollte 9.15.0 zeigen
```

> Falls `corepack` nicht gefunden wird: `npm install -g corepack` und erneut versuchen.

### 4. Docker Desktop für Windows

Liefert Postgres + Redis als Container — keine manuelle DB-Installation nötig.

- Download: <https://www.docker.com/products/docker-desktop/>
- Im Installer **WSL2-Backend** wählen (Default, empfohlen).
- Nach der Installation **Docker Desktop starten** und laufen lassen (Whale-Icon im
  Tray). Container starten nur, wenn Docker Desktop läuft.
- Prüfen:
  ```powershell
  docker --version
  docker compose version
  ```

### 5. VS Code

- Download: <https://code.visualstudio.com/>
- Empfohlene Extensions (in VS Code unter *Extensions* installieren):
  - **ESLint** (`dbaeumer.vscode-eslint`)
  - **Prettier** (`esbenp.prettier-vscode`)
  - **Prisma** (`Prisma.prisma`)
  - **Tailwind CSS IntelliSense** (`bradlc.vscode-tailwindcss`)
  - **Playwright Test** (`ms-playwright.playwright`)
  - **EditorConfig** (`EditorConfig.EditorConfig`)

---

## Teil 1 — Code holen

Das Repo ist **öffentlich** — der Code wird einfach geklont, nichts muss per USB
oder Chat übertragen werden.

```bash
git clone https://github.com/Lukes-Git-Beginning/warhammer-tournament-platform.git
cd warhammer-tournament-platform
```

**Was automatisch mitkommt** (per `git clone`):
- der gesamte Quellcode (alle Workspaces)
- alle `CLAUDE.md` (Root + `apps/*`) und der `.knowledge/`-Hub (11 Topic-Files)
- `docs/` (Design-System, Archiv), `ROADMAP.md`, `DEPLOYMENT.md`
- `.env.example` (die Vorlage für Schritt 3 — **ohne** echte Werte)

**Was NICHT per git kommt** (in `.gitignore`) — für lokale Entwicklung irrelevant:
- `.env` → legst du in Teil 3 selbst an
- `node_modules/`, `packages/db/generated/` → entstehen via `pnpm install` / `pnpm db:generate`
- `secrets/` (Cloudflare-Zertifikate, nur Production)
- `apps/backend/uploads/` (echte Army-List-Uploads — Seed-Daten reichen lokal)

**Optional — falls du auch pushen können sollst:** Luke lädt dich unter
*GitHub → Repo → Settings → Collaborators* ein. Nach Annahme authentifizierst du dich
am einfachsten mit der GitHub CLI (`gh auth login`) oder einem Personal Access Token / SSH-Key.

---

## Teil 2 — Eigene Discord-OAuth2-App anlegen

Der Login läuft über Discord. Jeder Entwickler nutzt eine **eigene** Dev-App
(kostenlos, ~5 Minuten) — so werden keine Secrets geteilt.

1. <https://discord.com/developers/applications> öffnen → **New Application** → Name vergeben.
2. Tab **OAuth2**:
   - **Client ID** kopieren (für `DISCORD_CLIENT_ID`).
   - **Client Secret** → *Reset Secret* → kopieren (für `DISCORD_CLIENT_SECRET`).
3. Unter **OAuth2 → Redirects** diese URL **exakt** hinzufügen:
   ```
   http://localhost:3000/auth/discord/callback
   ```
4. Scopes brauchen keine Konfiguration in der App selbst — das Backend fragt
   `identify email` zur Laufzeit an.

> Behalte Client ID + Secret griffbereit, du brauchst sie gleich in der `.env`.

---

## Teil 3 — `.env` anlegen & befüllen

Die App liest **eine** `.env` im **Repo-Root** (auch das Backend und Prisma greifen
dort drauf zu — es gibt bewusst keine workspace-eigenen `.env`-Dateien).

```bash
# in Git Bash:
cp .env.example .env
# oder in PowerShell:
Copy-Item .env.example .env
```

Dann `.env` öffnen und nur diese drei Pflichtfelder setzen:

| Variable | Wert |
|---|---|
| `JWT_SECRET` | langer Zufallsstring (siehe unten) |
| `DISCORD_CLIENT_ID` | aus Teil 2 |
| `DISCORD_CLIENT_SECRET` | aus Teil 2 |

**`JWT_SECRET` generieren** (Windows-sicher, ohne extra Tools):
```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```
*(Alternativ in Git Bash: `openssl rand -base64 48`.)*
Den ausgegebenen String als `JWT_SECRET` eintragen.

**Alles andere bleibt auf den Defaults:**
- `DATABASE_URL` und `REDIS_URL` passen 1:1 zur `docker-compose.yml` → **nicht ändern**.
- `DISCORD_REDIRECT_URI` ist bereits korrekt (`…localhost:3000/auth/discord/callback`).
- Steam (`STEAM_*`) und `DISCORD_BOT_TOKEN` sind **optional** — leer lassen.
  Ohne Bot-Token werden Discord-Benachrichtigungen still übersprungen (kein Fehler).

---

## Teil 4 — Services, Datenbank & Dev-Server starten

**Docker Desktop muss laufen.** Dann im Repo-Root der Reihe nach:

```bash
pnpm install          # Dependencies (alle Workspaces)
pnpm docker:up        # Postgres 16 (:5432) + Redis 7 (:6379) im Hintergrund
pnpm db:migrate       # Prisma migrate dev — legt das DB-Schema an
pnpm db:generate      # Prisma Client generieren (sicherheitshalber)
pnpm db:seed          # Seed-Daten einspielen
pnpm -F @rizzotto/frontend run images:optimize   # AVIF/WebP-Bilder generieren (einmalig)
pnpm dev              # Backend (:3000) + Frontend (:5173) parallel via Turbo
```

> **`images:optimize` nicht überspringen:** Die AVIF/WebP-Varianten aller Bilder
> (Logo, Hero, Sigils) sind **gitignorierte Build-Artefakte**
> (`apps/frontend/.gitignore`) — sie kommen nicht per `git clone`. Ohne diesen
> Lauf sind Logo und alle Bilder lokal kaputt, denn der Browser fällt bei einem
> 404 auf der gewählten `<source>` **nicht** auf das PNG zurück. `pnpm build`
> führt den Schritt automatisch aus, `pnpm dev` nicht.

**Verifikation:** <http://localhost:5173> öffnen und den **Discord-Login** durchspielen.
Wenn du nach Discord-Autorisierung eingeloggt zurückkommst, läuft das volle Setup
(Frontend → Backend → DB → Auth).

> **Stoppen:** `Strg+C` beendet `pnpm dev`. `pnpm docker:down` fährt die Container herunter.

---

## Teil 5 — Claude Code installieren & konfigurieren

### Installation & Login
```powershell
npm install -g @anthropic-ai/claude-code
```
Dann im Repo-Verzeichnis `claude` starten und mit dem **eigenen** Anthropic-Account
einloggen (Pro/Max-Abo oder API-Key).

### Projekt-Kontext (kommt automatisch)
`CLAUDE.md` (Root + `apps/*`) und der `.knowledge/`-Hub sind im Repo eingecheckt —
Claude Code liest sie automatisch beim Start. **Hier ist nichts zu tun.**

### Globale Config (aus dem Handoff-Paket)
Luke übergibt dir separat einen Ordner `Warhammer-Alex-Handoff/` mit Vorlagen für die
**globale** (projektübergreifende) Claude-Config. Kopiere die Dateien nach
`%USERPROFILE%\.claude\` (= `C:\Users\<DeinName>\.claude\`):

| Aus dem Handoff | Zielort | Zweck |
|---|---|---|
| `claude-global-CLAUDE.md` | `~/.claude/CLAUDE.md` | Arbeitsweise-Guidelines (Sprache, Model-Routing, Git-Konventionen) — **deinen Namen/Präferenzen anpassen** |
| `claude-settings.template.json` | `~/.claude/settings.json` | empfohlene Settings (Prompt-Caching, Subagent-Model, Effort, Sprache) — vor Übernahme durchsehen |
| `session-end.md` | `<repo>/.claude/commands/session-end.md` | optionaler `/session-end`-Command (das lokale `.claude/` ist gitignored) |

> **Bewusst nicht übernommen:** Lukes persönliche `memory/` und seine vollständige
> `permissions.allow`-Liste (enthält projektfremde Pfade). Deine Permit-Liste baut sich
> durch normale Nutzung automatisch in `~/.claude/settings.local.json` auf.

### Optional — MCP-Server
Bei Bedarf später selbst einrichten: ein **Playwright-MCP** (für E2E/visuelle Tests)
und ein **Filesystem-MCP** auf `.knowledge/`. Für das Grund-Setup nicht nötig.

---

## Teil 6 — Smoke-Test / Verifikation

```bash
pnpm typecheck                  # tsc --noEmit über alle Workspaces
pnpm test                       # Backend- + Frontend-Unit-Tests (Vitest)

# Nur falls du E2E fahren willst (einmalig Chromium installieren):
pnpm -F @rizzotto/e2e exec playwright install chromium
pnpm test:e2e                   # Playwright (braucht laufende Services)
```

- Der zuverlässigste End-to-End-Check bleibt der **Discord-Login auf :5173**.
- **Visuelle Snapshot-Tests** sind plattformspezifisch (`-win32`); falls sie failen,
  lokal mit `--update-snapshots` neu generieren.

---

## Gut zu wissen / Stolpersteine

- **Prisma 7 (driver-adapter):** Die `datasource.url` lebt in
  `packages/db/prisma.config.ts`, **nicht** in `schema.prisma`. `prisma.config.ts`
  lädt die Root-`.env` selbst.
- **Kanonischer Migrate-Befehl:** `pnpm db:migrate` (= `prisma migrate dev`).
  Der Root-Befehl ohne Filter hakt teils — immer den `pnpm db:*`-Alias nutzen.
- **ESM-Imports:** In `.ts`-Files ist die `.js`-Extension am Import-Pfad
  zwingend (`./cache.js`, nicht `./cache`) — sonst Runtime-Fehler.
- **Frontend-Proxy:** Das Frontend hat keine `VITE_*`-Env-Vars; der Vite-Dev-Server
  proxyt `/api`, `/auth`, `/socket.io` transparent an `localhost:3000`.
- **Ports belegt?** Backend nutzt 3000, Frontend 5173, Postgres 5432, Redis 6379 —
  ggf. kollidierende Prozesse beenden (`Get-NetTCPConnection -LocalPort 3000`).

Weiterführend: `ROADMAP.md` (Stand & offene Items), `DEPLOYMENT.md` (Production),
`docs/design/README.md` (Design-System), `.knowledge/` (Architektur-Hub).
