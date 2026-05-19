# Warhammer Tournament Platform - Implementierungs-Prompt

## Teil 2/3: Draft-System, Army-Lists, Leaderboard, Stats & UI

---

## 8. Captain's Mode Draft-System (KOMPLEX - KERN-FEATURE!)

### 8.1 Konzept-Übersicht

**Inspiriert von:** https://aoe2cm.net (Age of Empires 2 Captains Mode)

**Was ist es?**
- Rundenbasiertes Pick/Ban-System für Faction-Auswahl
- Zwei Spieler (Host & Guest) durchlaufen Draft-Sequenz
- Organisator erstellt **Draft-Preset** (Vorlage mit Pick/Ban-Regeln)
- Timer: 30 Sekunden pro Zug, sonst zufällige Auswahl
- Ergebnis: Beide Spieler haben finale Faction(s) für Match

**Wann wird es genutzt?**
- Organisator aktiviert Draft beim Turnier-Erstellen
- Jedes Match beginnt mit Draft-Phase (wenn enabled)
- Besonders bei kompetitiven Turnieren

### 8.2 Draft-Preset-System

**Preset = Vorlage für Draft-Ablauf**

```typescript
interface DraftPreset {
  id: string
  name: string  // z.B. "3x3 Matrix", "Standard 1v1"
  created_by: string  // User-ID (Organisator/Admin)
  is_public: boolean  // Public Presets kann jeder nutzen

  // Kategorie-Limits (z.B. max 2 Chaos-Gods)
  category_limits: CategoryLimit[]

  // Draft-Sequenz (Reihenfolge der Züge)
  turns: DraftTurn[]

  created_at: DateTime
}
```

#### Kategorie-Limits

**Zweck:** Begrenze wie viele Factions aus einer Kategorie gepickt/gebannt werden können

```typescript
interface CategoryLimit {
  category_name: string  // z.B. "default", "chaos_gods"
  factions: string[]     // Faction-IDs in dieser Kategorie
  max_picks: number | null  // Null = unlimited
  max_bans: number | null
}
```

**Beispiel:**
```json
{
  "category_name": "chaos_gods",
  "factions": ["khorne", "nurgle", "slaanesh", "tzeentch"],
  "max_picks": 2,
  "max_bans": null
}
```
→ Spieler kann max 2 Chaos-Gods picken

#### Draft-Züge (Turns)

```typescript
interface DraftTurn {
  order: number  // Position in Sequenz (1, 2, 3, ...)
  actor: 'host' | 'guest' | 'admin'  // Wer macht den Zug?

  // Action-Type
  action: 'pick' | 'ban' | 'snipe' | 'steal' | 'reveal_picks' | 'reveal_bans' | 'reveal_all'

  // Action-Variant (nur für pick/ban)
  variant: 'global' | 'exclusive' | 'nonexclusive' | null

  // Modifiers
  is_hidden: boolean      // Wahl vor Gegner versteckt bis REVEAL
  is_parallel: boolean    // Beide Spieler machen Zug gleichzeitig
  as_opponent: boolean    // Spieler wählt FÜR Gegner

  // Kategorie-Filter
  category: string  // "default" oder spezifische Kategorie
}
```

### 8.3 Action-Typen (Detailliert)

#### A) PICK-Varianten

**1. Global Pick (gpick):**
```
Spieler wählt Faction → NIEMAND kann diese Faction mehr wählen
```
Beispiel: Host pickt "High Elves" → High Elves für beide gesperrt

**2. Exclusive Pick (epick):**
```
Spieler wählt Faction → NUR dieser Spieler kann sie nicht nochmal wählen
```
Beispiel: Host pickt "High Elves" → Host kann HE nicht nochmal picken, Guest schon

**3. Nonexclusive Pick (npick):**
```
Spieler wählt Faction → BEIDE können sie später nochmal wählen
```
Selten genutzt, für spezielle Modi (z.B. Mirror-Matches)

#### B) BAN-Varianten

**1. Global Ban (gban):**
```
Faction für BEIDE Spieler gebannt
```
Standard-Ban

**2. Exclusive Ban (eban):**
```
Faction für GEGNER gebannt, Spieler kann sie nicht nochmal bannen
```
Taktisch: Sperre Faction für Gegner, aber behalte sie für dich offen

**3. Nonexclusive Ban (nban):**
```
Faction für GEGNER gebannt, Spieler KÖNNTE sie nochmal bannen
```
Selten sinnvoll (warum dieselbe Faction zweimal bannen?)

#### C) Spezial-Actions

**1. Snipe:**
```
Entfernt eine Faction, die Gegner zuvor gepickt hat
```
Beispiel: Guest hat "Skaven" gepickt → Host sniped → Skaven weg, Guest muss neu wählen

**2. Steal:**
```
Entfernt Faction von Gegner UND nimmt sie selbst
```
Beispiel: Guest hat "Skaven" → Host steals → Host hat jetzt Skaven, Guest verliert sie

**3. Reveal (Admin-Züge):**
```
reveal_picks:  Deckt alle hidden picks auf
reveal_bans:   Deckt alle hidden bans auf
reveal_all:    Deckt alles auf
```
Wichtig bei Hidden-Modi

### 8.4 Modifiers

#### HIDDEN
```
Wahl wird Gegner nicht sofort gezeigt
Erst nach REVEAL-Zug sichtbar
```

**Use-Case:** Blind-Pick-Phase, dann Reveal, dann Ban-Phase basierend auf Picks

**Beispiel-Sequenz:**
```
1. Host: Hidden Pick
2. Guest: Hidden Pick
3. Admin: Reveal Picks
4. Host: Ban (basierend auf Guest's Pick)
5. Guest: Ban (basierend auf Host's Pick)
6. Host: Final Pick
7. Guest: Final Pick
```

#### PARALLEL
```
Beide Spieler machen Zug GLEICHZEITIG
Timer läuft parallel
```

**Implementation:** Beide bekommen denselben Zug, Server wartet bis beide gewählt haben

**Beispiel:**
```
1. Parallel: Host + Guest bannen gleichzeitig
2. Parallel: Host + Guest picken gleichzeitig
```

#### AS_OPPONENT
```
Spieler wählt im Namen des Gegners
Gegner MUSS diese Faction spielen
```

**Use-Case:** "Forced Pick"-Modi

**Beispiel:**
```
Host wählt "Norsca" as_opponent → Guest MUSS Norsca spielen
```

### 8.5 Preset-Editor (Frontend)

**UI-Komponenten:**

```typescript
function PresetEditor() {
  const [preset, setPreset] = useState<DraftPreset>({
    name: '',
    turns: [],
    category_limits: []
  })

  return (
    <div className="preset-editor">
      {/* Basic Info */}
      <input
        placeholder="Preset-Name (z.B. '3x3 Matrix')"
        value={preset.name}
        onChange={e => setPreset({ ...preset, name: e.target.value })}
      />

      {/* Kategorie-Limits */}
      <CategoryLimitsEditor
        limits={preset.category_limits}
        onChange={limits => setPreset({ ...preset, category_limits: limits })}
      />

      {/* Draft-Sequenz */}
      <DraftSequenceTimeline turns={preset.turns} />

      {/* Buttons zum Züge hinzufügen */}
      <div className="add-turn-buttons">
        <button onClick={() => addTurn('host')}>+ Host-Zug</button>
        <button onClick={() => addTurn('guest')}>+ Guest-Zug</button>
        <button onClick={() => addTurn('admin')}>+ Admin-Zug (Reveal)</button>
      </div>

      {/* Turn-Editor (für jeden Zug) */}
      {preset.turns.map((turn, i) => (
        <TurnEditor
          key={i}
          turn={turn}
          onChange={updatedTurn => updateTurn(i, updatedTurn)}
          onDelete={() => deleteTurn(i)}
        />
      ))}

      {/* Save */}
      <button onClick={savePreset}>Preset speichern</button>
      <button onClick={createDraft}>Neuen Draft mit diesem Preset erstellen</button>
    </div>
  )
}
```

**Turn-Editor Component:**
```typescript
function TurnEditor({ turn, onChange, onDelete }: TurnEditorProps) {
  return (
    <div className="turn-editor">
      <div className="turn-header">
        <span>Zug {turn.order}</span>
        <button onClick={onDelete}>🗑️ Löschen</button>
      </div>

      {/* Actor */}
      <label>Akteur:</label>
      <select value={turn.actor} onChange={e => onChange({ ...turn, actor: e.target.value })}>
        <option value="host">Host</option>
        <option value="guest">Guest</option>
        <option value="admin">Admin (Reveal)</option>
      </select>

      {/* Action */}
      {turn.actor !== 'admin' && (
        <>
          <label>Aktion:</label>
          <select value={turn.action} onChange={e => onChange({ ...turn, action: e.target.value })}>
            <option value="pick">PICK</option>
            <option value="ban">BAN</option>
            <option value="snipe">SNIPE</option>
            <option value="steal">STEAL</option>
          </select>
        </>
      )}

      {/* Variant (nur für Pick/Ban) */}
      {(turn.action === 'pick' || turn.action === 'ban') && (
        <>
          <label>Variant:</label>
          <select value={turn.variant} onChange={e => onChange({ ...turn, variant: e.target.value })}>
            <option value="global">Global</option>
            <option value="exclusive">Exclusive</option>
            <option value="nonexclusive">Nonexclusive</option>
          </select>
        </>
      )}

      {/* Reveal-Type (nur für Admin) */}
      {turn.actor === 'admin' && (
        <>
          <label>Reveal:</label>
          <select value={turn.action} onChange={e => onChange({ ...turn, action: e.target.value })}>
            <option value="reveal_picks">Reveal Picks</option>
            <option value="reveal_bans">Reveal Bans</option>
            <option value="reveal_all">Reveal All</option>
          </select>
        </>
      )}

      {/* Modifiers */}
      <div className="modifiers">
        <label>
          <input
            type="checkbox"
            checked={turn.is_hidden}
            onChange={e => onChange({ ...turn, is_hidden: e.target.checked })}
          />
          Hidden (vor Gegner versteckt)
        </label>

        <label>
          <input
            type="checkbox"
            checked={turn.is_parallel}
            onChange={e => onChange({ ...turn, is_parallel: e.target.checked })}
          />
          Parallel (beide gleichzeitig)
        </label>

        <label>
          <input
            type="checkbox"
            checked={turn.as_opponent}
            onChange={e => onChange({ ...turn, as_opponent: e.target.checked })}
          />
          As Opponent (für Gegner wählen)
        </label>
      </div>

      {/* Kategorie */}
      <label>Kategorie:</label>
      <select value={turn.category} onChange={e => onChange({ ...turn, category: e.target.value })}>
        <option value="default">Alle Factions</option>
        <option value="chaos_gods">Nur Chaos Gods</option>
        {/* Weitere Custom-Kategorien */}
      </select>
    </div>
  )
}
```

### 8.6 Live-Draft-Execution (WebSocket)

**Backend-Logik:**

```typescript
class DraftService {
  async startDraft(matchId: string, presetId: string) {
    const preset = await prisma.draftPreset.findUnique({ where: { id: presetId }, include: { turns: true } })
    const match = await prisma.match.findUnique({ where: { id: matchId } })

    // Erstelle Draft-Instance
    const draft = await prisma.draft.create({
      data: {
        match_id: matchId,
        preset_id: presetId,
        status: 'ONGOING',
        current_turn: 0,
        state: {
          picks: { host: [], guest: [] },
          bans: [],
          hidden_picks: { host: [], guest: [] },
          hidden_bans: []
        }
      }
    })

    // Notify beide Spieler
    io.to(match.player1_id).emit('draft_started', { draft_id: draft.id })
    io.to(match.player2_id).emit('draft_started', { draft_id: draft.id })

    // Starte ersten Zug
    this.executeTurn(draft.id, 0)
  }

  async executeTurn(draftId: string, turnIndex: number) {
    const draft = await prisma.draft.findUnique({ where: { id: draftId }, include: { preset: true } })
    const turn = draft.preset.turns[turnIndex]

    if (!turn) {
      // Draft abgeschlossen
      this.completeDraft(draftId)
      return
    }

    // Timer starten (30 Sekunden)
    const timerId = setTimeout(() => {
      this.autoSelectRandom(draftId, turnIndex)
    }, 30000)

    // Update Draft-State
    await prisma.draft.update({
      where: { id: draftId },
      data: {
        current_turn: turnIndex,
        timer_expires_at: new Date(Date.now() + 30000)
      }
    })

    // Notify Clients
    io.to(`draft_${draftId}`).emit('turn_started', {
      turn_number: turnIndex + 1,
      actor: turn.actor,
      action: turn.action,
      time_remaining: 30,
      available_factions: this.getAvailableFactions(draft, turn)
    })

    // Speichere Timer-ID für Cleanup
    this.activeTimers.set(draftId, timerId)
  }

  async handleDraftAction(draftId: string, userId: string, factionId: string) {
    const draft = await this.getDraft(draftId)
    const turn = draft.preset.turns[draft.current_turn]

    // Validiere: Ist User am Zug?
    const actor = this.getActorForUser(draft, userId)
    if (actor !== turn.actor) {
      throw new Error('Not your turn')
    }

    // Validiere: Ist Faction verfügbar?
    const available = this.getAvailableFactions(draft, turn)
    if (!available.includes(factionId)) {
      throw new Error('Faction not available')
    }

    // Führe Action aus
    const newState = this.applyAction(draft.state, turn, factionId)

    // Update Draft
    await prisma.draft.update({
      where: { id: draftId },
      data: { state: newState }
    })

    // Clear Timer
    clearTimeout(this.activeTimers.get(draftId))

    // Notify Clients
    io.to(`draft_${draftId}`).emit('action_completed', {
      actor,
      action: turn.action,
      faction_id: turn.is_hidden ? null : factionId,  // Wenn hidden, nicht senden
      is_hidden: turn.is_hidden
    })

    // Nächster Zug
    setTimeout(() => {
      this.executeTurn(draftId, draft.current_turn + 1)
    }, 2000)  // 2 Sekunden Pause zwischen Zügen
  }

  applyAction(state: DraftState, turn: DraftTurn, factionId: string): DraftState {
    const newState = { ...state }

    switch (turn.action) {
      case 'pick':
        if (turn.is_hidden) {
          newState.hidden_picks[turn.actor].push(factionId)
        } else {
          newState.picks[turn.actor].push(factionId)
        }

        if (turn.variant === 'global') {
          newState.bans.push(factionId)  // Global Pick = niemand kann mehr wählen
        }
        break

      case 'ban':
        if (turn.is_hidden) {
          newState.hidden_bans.push(factionId)
        } else {
          newState.bans.push(factionId)
        }
        break

      case 'snipe':
        // Entferne Faction von Gegner's Picks
        const opponent = turn.actor === 'host' ? 'guest' : 'host'
        newState.picks[opponent] = newState.picks[opponent].filter(f => f !== factionId)
        break

      case 'steal':
        // Entferne von Gegner, füge zu eigenem hinzu
        const opp = turn.actor === 'host' ? 'guest' : 'host'
        newState.picks[opp] = newState.picks[opp].filter(f => f !== factionId)
        newState.picks[turn.actor].push(factionId)
        break
    }

    return newState
  }

  getAvailableFactions(draft: Draft, turn: DraftTurn): string[] {
    let factions = ALL_FACTIONS

    // Filter nach Kategorie
    if (turn.category !== 'default') {
      const categoryLimit = draft.preset.category_limits.find(cl => cl.category_name === turn.category)
      if (categoryLimit) {
        factions = factions.filter(f => categoryLimit.factions.includes(f))
      }
    }

    // Filter: Bereits gebannte Factions
    factions = factions.filter(f => !draft.state.bans.includes(f))

    // Filter: Global picks
    const allPicks = [...draft.state.picks.host, ...draft.state.picks.guest]
    factions = factions.filter(f => !allPicks.includes(f))

    return factions
  }
}
```

### 8.7 Draft-Lobby (Frontend)

```typescript
function DraftLobby({ draftId }: { draftId: string }) {
  const [draftState, setDraftState] = useState<DraftState | null>(null)
  const [currentTurn, setCurrentTurn] = useState<DraftTurn | null>(null)
  const [timeRemaining, setTimeRemaining] = useState(30)
  const [availableFactions, setAvailableFactions] = useState<string[]>([])
  const userRole = useUserRole()  // 'host' oder 'guest'

  useEffect(() => {
    socket.emit('join_draft', draftId)

    socket.on('turn_started', (data) => {
      setCurrentTurn(data)
      setTimeRemaining(data.time_remaining)
      setAvailableFactions(data.available_factions)

      // Start local timer
      const interval = setInterval(() => {
        setTimeRemaining(prev => Math.max(0, prev - 1))
      }, 1000)

      return () => clearInterval(interval)
    })

    socket.on('action_completed', (data) => {
      // Update draft state
      if (!data.is_hidden) {
        setDraftState(prev => ({
          ...prev,
          picks: {
            ...prev.picks,
            [data.actor]: [...prev.picks[data.actor], data.faction_id]
          }
        }))
      }
    })

    socket.on('draft_complete', (data) => {
      // Draft fertig, zeige Ergebnis
      alert(`Draft abgeschlossen! Du spielst: ${data.your_factions.join(', ')}`)
    })

    return () => {
      socket.emit('leave_draft', draftId)
      socket.off('turn_started')
      socket.off('action_completed')
      socket.off('draft_complete')
    }
  }, [draftId])

  const handleFactionClick = (factionId: string) => {
    if (currentTurn?.actor !== userRole) {
      toast.error('Nicht dein Zug!')
      return
    }

    socket.emit('draft_action', { draft_id: draftId, faction_id: factionId })
  }

  return (
    <div className="draft-lobby">
      {/* Timeline */}
      <DraftTimeline turns={preset.turns} current={currentTurn?.order} />

      {/* Timer */}
      <div className={`timer ${timeRemaining < 10 ? 'urgent' : ''}`}>
        {timeRemaining}s
      </div>

      {/* Status */}
      <div className="status">
        {currentTurn?.actor === userRole ? (
          <h2>Dein Zug: {currentTurn.action.toUpperCase()}</h2>
        ) : (
          <h2>Gegner ist am Zug...</h2>
        )}
      </div>

      {/* Faction-Grid */}
      <div className="faction-grid">
        {ALL_FACTIONS.map(faction => {
          const isAvailable = availableFactions.includes(faction.id)
          const isPicked = draftState?.picks.host.includes(faction.id) || draftState?.picks.guest.includes(faction.id)
          const isBanned = draftState?.bans.includes(faction.id)

          return (
            <FactionCard
              key={faction.id}
              faction={faction}
              status={
                isBanned ? 'banned' :
                isPicked ? 'picked' :
                !isAvailable ? 'unavailable' :
                'available'
              }
              onClick={() => isAvailable && handleFactionClick(faction.id)}
            />
          )
        })}
      </div>

      {/* Draft-Historie (Sidebar) */}
      <div className="draft-history">
        <h3>Bisherige Züge</h3>
        {draftState?.picks.host.map((factionId, i) => (
          <div key={i}>Host picked: {factionId}</div>
        ))}
        {draftState?.picks.guest.map((factionId, i) => (
          <div key={i}>Guest picked: {factionId}</div>
        ))}
        {draftState?.bans.map((factionId, i) => (
          <div key={i}>Banned: {factionId}</div>
        ))}
      </div>
    </div>
  )
}
```

---

## 9. Army-Lists (.army_setup Format)

### 9.1 Datei-Format

**Total War Warhammer 3 `.army_setup` Struktur:**
```
wh_dlc05_wef_wood_elves
domination
wh2_dlc16_wef_cha_drycha_0:wh_dlc05_wef_wood_elves:1 * wh2_dlc16_lord_passive_fanatical_resolve_1 ...
wh_dlc05_wef_inf_glade_guard_0:wh_dlc05_wef_wood_elves:0 none
wh_dlc05_wef_inf_glade_guard_1:wh_dlc05_wef_wood_elves:0 none
...
```

**Zeilen-Bedeutung:**
- Zeile 1: Faction-ID
- Zeile 2: Battle-Type (`domination`, `land_battle`, etc.)
- Ab Zeile 3: Units im Format `unit_id:faction:rank [abilities/spells]`
  - Lords: `_cha_` im unit_id + Abilities nach `*` oder `#`
  - Units: Normale Infantry/Cavalry/Monsters
  - Regiments of Renown: `_ror_` im unit_id

### 9.2 Upload-Funktion

**Schema:**
```typescript
model ArmyList {
  id          String   @id @default(uuid())
  user_id     String
  user        User     @relation(fields: [user_id], references: [id])

  tournament_id String?
  tournament    Tournament? @relation(fields: [tournament_id], references: [id])

  faction_id  String
  faction     Faction @relation(fields: [faction_id], references: [id])

  // Datei
  file_url    String  // Upload-Link
  file_name   String
  file_type   String  // "army_setup" oder "screenshot"

  // Optional: Geparste Daten
  parsed_data Json?  // { battle_type, lord, units }

  created_at  DateTime @default(now())
}
```

**Upload-Endpoint:**
```
POST /api/army-lists
Content-Type: multipart/form-data

file: [.army_setup oder .png/.jpg]
tournament_id: uuid (optional)
```

### 9.3 Parser (Backend)

```typescript
interface ParsedArmy {
  faction: string
  battle_type: string
  lord: {
    unit_id: string
    abilities: string[]
    spells: string[]
  } | null
  units: {
    unit_id: string
    rank: number
    count: number
  }[]
}

function parseArmySetup(fileContent: string): ParsedArmy | null {
  try {
    const lines = fileContent.trim().split('\n')
    if (lines.length < 3) return null

    const faction = lines[0].trim()
    const battleType = lines[1].trim()
    const units: ParsedArmy['units'] = []
    let lord: ParsedArmy['lord'] = null

    for (let i = 2; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      // Split unit-part und meta-part
      const parts = line.split(/[*#]/)
      const unitPart = parts[0].trim()
      const [unitId, factionId, rankStr] = unitPart.split(':')
      const rank = parseInt(rankStr) || 0

      // Ist es ein Lord/Hero?
      if (unitId.includes('_cha_')) {
        lord = {
          unit_id: unitId,
          abilities: extractAbilities(parts.slice(1)),
          spells: extractSpells(parts.slice(1))
        }
      } else {
        // Zähle gleiche Units
        const existing = units.find(u => u.unit_id === unitId)
        if (existing) {
          existing.count++
        } else {
          units.push({ unit_id: unitId, rank, count: 1 })
        }
      }
    }

    return { faction, battle_type: battleType, lord, units }
  } catch (error) {
    console.error('Army parsing failed:', error)
    return null
  }
}

function extractAbilities(parts: string[]): string[] {
  const abilities: string[] = []
  for (const part of parts) {
    // Abilities starten oft mit "wh_" oder "wh2_" oder "wh3_"
    const matches = part.match(/\b(wh\d?_\w+_abilities_\w+)/g)
    if (matches) abilities.push(...matches)
  }
  return abilities
}

function extractSpells(parts: string[]): string[] {
  const spells: string[] = []
  for (const part of parts) {
    const matches = part.match(/\b(wh\d?_\w+_spell_\w+)/g)
    if (matches) spells.push(...matches)
  }
  return spells
}
```

### 9.4 Visualisierung (Frontend)

```typescript
function ArmyListView({ armyList }: { armyList: ArmyList }) {
  if (!armyList.parsed_data) {
    // Parsing fehlgeschlagen → nur Download
    return (
      <div>
        <a href={armyList.file_url} download>📥 Download Army List</a>
      </div>
    )
  }

  const { lord, units, battle_type } = armyList.parsed_data

  return (
    <div className="army-list-view">
      <h3>Army Composition</h3>
      <p>Battle-Type: {battle_type}</p>

      {/* Lord */}
      {lord && (
        <div className="lord">
          <h4>Lord</h4>
          <UnitCard unitId={lord.unit_id} />
          {lord.spells.length > 0 && (
            <div className="spells">
              <strong>Spells:</strong> {lord.spells.join(', ')}
            </div>
          )}
          {lord.abilities.length > 0 && (
            <div className="abilities">
              <strong>Abilities:</strong> {lord.abilities.join(', ')}
            </div>
          )}
        </div>
      )}

      {/* Units */}
      <div className="units">
        <h4>Units</h4>
        <ul>
          {units.map((unit, i) => (
            <li key={i}>
              {unit.count}x <UnitCard unitId={unit.unit_id} inline /> (Rank {unit.rank})
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
```

### 9.5 Upload-Integration (Turnier-Registrierung)

**Nice-to-Have für Phase 2:**

```typescript
function TournamentRegistrationForm({ tournamentId }) {
  const [factionId, setFactionId] = useState('')
  const [armyListFile, setArmyListFile] = useState<File | null>(null)

  const handleSubmit = async () => {
    // 1. Upload Army-List (wenn vorhanden)
    let armyListId = null
    if (armyListFile) {
      const formData = new FormData()
      formData.append('file', armyListFile)
      formData.append('tournament_id', tournamentId)

      const response = await fetch('/api/army-lists', {
        method: 'POST',
        body: formData
      })
      const { id } = await response.json()
      armyListId = id
    }

    // 2. Registrierung
    await fetch(`/api/tournaments/${tournamentId}/register`, {
      method: 'POST',
      body: JSON.stringify({
        faction_id: factionId,
        army_list_id: armyListId
      })
    })

    toast.success('Erfolgreich angemeldet!')
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>Faction:</label>
      <select value={factionId} onChange={e => setFactionId(e.target.value)}>
        {FACTIONS.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>

      <label>Army-List (optional):</label>
      <input
        type="file"
        accept=".army_setup,.png,.jpg"
        onChange={e => setArmyListFile(e.target.files?.[0] || null)}
      />

      <button type="submit">Anmelden</button>
    </form>
  )
}
```

---

**FORTSETZUNG folgt in Teil 2 (Leaderboard, Stats, UI)...**

---

## 10. Leaderboard-System (HYBRID ELO + TOURNAMENT POINTS)

### 10.1 Problem mit totaltavern.com

**Beobachtetes Problem:**
- Inkonsistente Punktevergabe
- Spieler mit 4 Siegen auf Platz 2, während Platz 1 mit 10 Siegen weniger Punkte hat
- Keine Transparenz der Formel
- Kein Fairness-System für Casual-Spieler (die weniger Zeit haben)

### 10.2 Lösungs-Ansatz: Hybrid-System

**Kombination aus:**
1. **ELO-Rating** (berücksichtigt Gegnerstärke)
2. **Turnierplatzierung-Punkte** (Belohnung für Teilnahme & Erfolg)
3. **Turniergröße-Multiplikator** (größere Turniere = mehr Punkte)
4. **Format-Gewichtung** (Major-Turniere zählen mehr)

### 10.3 Zwei Leaderboards

#### A) Season Leaderboard (Primär)
```sql
SELECT
  u.username,
  le.total_points,
  le.elo_rating,
  le.tournaments_played,
  le.wins,
  le.losses,
  RANK() OVER (ORDER BY le.total_points DESC) as rank
FROM leaderboard_entries le
JOIN users u ON u.id = le.user_id
WHERE le.season_id = :current_season_id
ORDER BY le.total_points DESC
LIMIT 100
```

- Zeigt nur Punkte der aktuellen Season
- Reset bei Season-Ende
- Fokus für Community

#### B) All-Time Leaderboard (Sekundär)
```sql
SELECT
  u.username,
  SUM(
    le.total_points *
    CASE
      WHEN s.id = :current_season THEN 1.0
      WHEN s.end_date > NOW() - INTERVAL '4 months' THEN 0.7
      WHEN s.end_date > NOW() - INTERVAL '8 months' THEN 0.5
      WHEN s.end_date > NOW() - INTERVAL '12 months' THEN 0.3
      ELSE 0.1
    END
  ) as weighted_points,
  COUNT(DISTINCT le.season_id) as seasons_participated
FROM leaderboard_entries le
JOIN users u ON u.id = le.user_id
JOIN seasons s ON s.id = le.season_id
GROUP BY u.id, u.username
ORDER BY weighted_points DESC
LIMIT 100
```

- **Degressiver Decay**: Alte Seasons zählen weniger
- Verhindert dass alte Spieler uneinholbar sind
- Belohnt Langzeit-Engagement

### 10.4 Punkteberechnung (Pro Turnier)

**Formel (Option A - Balanced):**

```typescript
function calculateTournamentPoints(
  player: Player,
  result: TournamentResult,
  tournament: Tournament
): number {
  // 1. Platzierungs-Punkte (Basis)
  const placementPoints = getPlacementPoints(result.placement, tournament.participants.length)

  // 2. ELO-Änderung (berücksichtigt Gegnerstärke)
  const eloChange = calculateEloChange(player, result, tournament)

  // 3. Turniergröße-Multiplikator
  const sizeMultiplier = getTournamentSizeMultiplier(tournament.participants.length)

  // 4. Format-Gewichtung
  const formatWeight = tournament.is_major ? 1.5 : 1.0

  // Hybrid-Formel: 40% ELO + 60% Platzierung
  const basePoints = (eloChange * 0.4) + (placementPoints * 0.6)

  // Apply Multipliers
  const totalPoints = basePoints * sizeMultiplier * formatWeight

  return Math.max(0, Math.round(totalPoints))
}
```

**Platzierungs-Punkte (Tabelle):**
```typescript
function getPlacementPoints(placement: number, totalPlayers: number): number {
  // Prozentual basiert auf Platzierung
  const percentile = (totalPlayers - placement) / totalPlayers

  if (placement === 1) return 100
  if (placement === 2) return 70
  if (placement === 3) return 50
  if (placement === 4) return 35
  if (placement <= 8) return 20
  if (placement <= 16) return 10
  return 5
}
```

**Turniergröße-Multiplikator:**
```typescript
function getTournamentSizeMultiplier(playerCount: number): number {
  if (playerCount >= 65) return 1.5
  if (playerCount >= 33) return 1.25
  if (playerCount >= 17) return 1.0
  if (playerCount >= 8) return 0.75
  return 0.5  // Kleine Turniere (< 8 Spieler)
}
```

**ELO-Berechnung (Standard):**
```typescript
function calculateEloChange(player: Player, result: TournamentResult, tournament: Tournament): number {
  let totalEloChange = 0

  // Für jedes Match im Turnier:
  for (const match of result.matches) {
    const opponentElo = match.opponent.elo_rating
    const playerElo = player.elo_rating
    const outcome = match.won ? 1 : 0

    // Expected Score
    const expectedScore = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400))

    // ELO Change (K-Faktor = 32)
    const eloChange = 32 * (outcome - expectedScore)
    totalEloChange += eloChange
  }

  return totalEloChange
}
```

### 10.5 Drei Varianten (zur Auswahl)

#### Option A: Balanced (empfohlen)
```
40% ELO + 60% Platzierung
Turniergröße-Multiplikator
Saisonaler Decay für All-Time
```
**Vorteil:** Belohnt sowohl Skill (ELO) als auch Engagement (Teilnahme)
**Nachteil:** Komplex zu kommunizieren

#### Option B: ELO-fokussiert
```
70% ELO + 30% Platzierung
```
**Vorteil:** Starke Gegner zu schlagen wird stark belohnt
**Nachteil:** Casual-Spieler haben es schwerer

#### Option C: Aktivitäts-fokussiert
```
30% ELO + 50% Platzierung + 20% Aktivitäts-Bonus
Aktivitäts-Bonus: +5 Punkte pro Turnier/Monat
```
**Vorteil:** Belohnt häufige Teilnahme
**Nachteil:** Risiko von "Spam"-Turnieren für Punkte

**Empfehlung:** Startet mit Option A, sammelt Feedback nach 2-3 Seasons, adjustiert

### 10.6 Datenbank-Schema

```typescript
model LeaderboardEntry {
  id          String   @id @default(uuid())
  user_id     String
  user        User     @relation(fields: [user_id], references: [id])
  season_id   String
  season      Season   @relation(fields: [season_id], references: [id])

  // Punkte & Stats
  total_points      Decimal  @default(0)
  elo_rating        Int      @default(1200)
  tournaments_played Int     @default(0)
  wins              Int      @default(0)
  losses            Int      @default(0)
  draws             Int      @default(0)

  updated_at  DateTime @updatedAt

  @@unique([user_id, season_id])
  @@index([season_id, total_points])
}

model TournamentResult {
  id            String   @id @default(uuid())
  tournament_id String
  tournament    Tournament @relation(fields: [tournament_id], references: [id])
  user_id       String
  user          User     @relation(fields: [user_id], references: [id])

  // Ergebnis
  placement     Int  // Platzierung im Turnier
  points_earned Decimal  // Punkte für dieses Turnier
  elo_change    Int  // ELO-Änderung

  // Faction
  faction_id    String
  faction       Faction @relation(fields: [faction_id], references: [id])

  created_at    DateTime @default(now())

  @@unique([tournament_id, user_id])
}
```

### 10.7 Transparenz (Frontend)

**"Wie funktioniert Ranking?"-Seite:**

```markdown
# Leaderboard-System

Unser Leaderboard verwendet ein **Hybrid-System** aus ELO-Rating und Turnierplatzierung.

## Punkteberechnung

Für jedes abgeschlossene Turnier erhältst du Punkte basierend auf:

### 1. Platzierung (60%)
| Platz | Basispunkte |
|-------|-------------|
| 1.    | 100         |
| 2.    | 70          |
| 3.    | 50          |
| 4.    | 35          |
| 5-8   | 20          |
| 9-16  | 10          |
| 17+   | 5           |

### 2. ELO-Änderung (40%)
- Siege gegen stärkere Gegner bringen mehr Punkte
- Basiert auf Standard-ELO-Formel (Chess-System)
- Start-ELO: 1200

### 3. Turniergröße-Multiplikator
- 65+ Spieler: **1.5x**
- 33-64 Spieler: **1.25x**
- 17-32 Spieler: **1.0x**
- 8-16 Spieler: **0.75x**
- < 8 Spieler: **0.5x**

### 4. Major-Turnier-Bonus
- Vom Admin als "Major" markierte Turniere: **1.5x**

## Beispielrechnung

**Turnier:** 32 Spieler, 2. Platz, Major-Turnier
**Platzierungs-Punkte:** 70
**ELO-Änderung:** +40 (gute Gegner geschlagen)
**Berechnung:**
```
Basis = (40 * 0.4) + (70 * 0.6) = 16 + 42 = 58
Mit Multiplikator = 58 * 1.0 (Größe) * 1.5 (Major) = 87 Punkte
```

## Season vs All-Time

**Season Leaderboard:**
- Nur aktuelle Season
- Reset bei Season-Ende (alle 3-4 Monate)

**All-Time Leaderboard:**
- Alle Seasons, aber mit Decay:
  - Aktuelle Season: 100%
  - Season -1 (< 4 Monate alt): 70%
  - Season -2 (< 8 Monate alt): 50%
  - Season -3 (< 12 Monate alt): 30%
  - Älter: 10%
```

**Punkte-Breakdown (im Profil):**
```typescript
function PointsBreakdown({ result }: { result: TournamentResult }) {
  return (
    <div className="points-breakdown">
      <h4>{result.tournament.name}</h4>
      <table>
        <tr>
          <td>Platzierung:</td>
          <td>{result.placement}. Platz</td>
          <td>→ {result.placement_points} Punkte</td>
        </tr>
        <tr>
          <td>ELO-Änderung:</td>
          <td>+{result.elo_change}</td>
          <td>→ {result.elo_points} Punkte</td>
        </tr>
        <tr>
          <td>Turniergröße:</td>
          <td>{result.tournament.participant_count} Spieler</td>
          <td>→ {result.size_multiplier}x</td>
        </tr>
        <tr>
          <td>Major-Bonus:</td>
          <td>{result.tournament.is_major ? 'Ja' : 'Nein'}</td>
          <td>→ {result.tournament.is_major ? '1.5x' : '1.0x'}</td>
        </tr>
        <tr className="total">
          <td><strong>Gesamt:</strong></td>
          <td></td>
          <td><strong>{result.points_earned} Punkte</strong></td>
        </tr>
      </table>
    </div>
  )
}
```

---

## 11. Season-Management

### 11.1 Season-Definition

```typescript
model Season {
  id          String   @id @default(uuid())
  name        String   // z.B. "Summer 2025", "DLC: Shadows of Change"
  start_date  DateTime
  end_date    DateTime
  is_active   Boolean  @default(false)

  // Optional: DLC-Tag
  dlc_tag     String?  // z.B. "shadows_of_change"

  // Season Finals (großes Abschluss-Turnier)
  major_tournament_id String?
  major_tournament    Tournament? @relation(fields: [major_tournament_id], references: [id])

  // Relations
  leaderboard_entries LeaderboardEntry[]
  faction_stats       FactionStats[]

  created_at  DateTime @default(now())
}
```

### 11.2 Automatische Season-Erstellung

**Cron-Job (täglich):**
```typescript
async function checkSeasonRotation() {
  const currentSeason = await prisma.season.findFirst({
    where: { is_active: true }
  })

  if (!currentSeason) return

  const now = new Date()
  if (currentSeason.end_date < now) {
    // Aktuelle Season beenden
    await prisma.season.update({
      where: { id: currentSeason.id },
      data: { is_active: false }
    })

    // Neue Season erstellen
    const newSeasonStart = currentSeason.end_date
    const newSeasonEnd = addMonths(newSeasonStart, 3)  // 3 Monate

    await prisma.season.create({
      data: {
        name: `Season ${currentSeason.name.split(' ')[1] + 1}`,
        start_date: newSeasonStart,
        end_date: newSeasonEnd,
        is_active: true
      }
    })

    console.log('New season created automatically')
  }
}
```

### 11.3 Admin-Interface (Manual Override)

```typescript
function SeasonManagement() {
  const [seasons, setSeasons] = useState<Season[]>([])

  return (
    <div className="season-management">
      <h2>Season-Verwaltung</h2>

      <button onClick={createSeason}>Neue Season erstellen</button>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Start</th>
            <th>Ende</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {seasons.map(season => (
            <tr key={season.id}>
              <td>{season.name}</td>
              <td>{format(season.start_date, 'dd.MM.yyyy')}</td>
              <td>{format(season.end_date, 'dd.MM.yyyy')}</td>
              <td>{season.is_active ? '✅ Aktiv' : '⏸️ Inaktiv'}</td>
              <td>
                <button onClick={() => editSeason(season.id)}>Edit</button>
                {!season.is_active && (
                  <button onClick={() => activateSeason(season.id)}>Aktivieren</button>
                )}
                {season.is_active && (
                  <button onClick={() => endSeason(season.id)}>Beenden</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

---

**Ende Teil 2**

**Teil 3 folgt mit:**
- Faction-Statistiken (Winrates, Matchup-Matrix)
- Suche & Filter
- UI/UX Design (Warhammer-Theme)
- Alle UI-Pages (Tournament-Liste, Detail, Leaderboard, etc.)
- Scraper, Deployment, Testing, Zeitplanung
