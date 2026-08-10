# Open Items — living backlog (keep in view)

Consolidated open + deferred items. Started 2026-08-10. Prod = main `914ca53` (v1.32.1).
Legend: ◻️ open · 🔨 built/undeployed · 📐 designed · 💬 needs Alex decision/input · 🔎 clarify (see questions).

---

## Status after 3 clarification rounds (2026-08-10)

**Fully specified → ready to build (on your go):**
- **NI-1** lobby-password auto-fill `123` on lobby-code paste (editable)
- **NI-3** 3rd-place-match toggle in BaLi (default ON, per-tournament opt-out)
- **NI-4** landing order (ONGOING pinned, then upcoming ascending)
- **NI-5** gated formats (min–max band, all formats, unclassified → questionnaire)
- **NI-7** 2D3 faction latch on nodes at draw time
- **NI-8a** Swiss preview effective-format fallback (live)
- **NI-9** faction-tab 3 charts + Model-Strength tile number

**Needs a design note before building (bigger):**
- **NI-6** 50%-matchup finder (build first) — CtW = Faction Proficiency × Matchup-Favourability, 47.5–52.5% band, Bo3/5 rotation. I'll write the design note next.
- **NI-8b** render playoff preview INSIDE the bracket (layout change, after 8a)

**Still needs a small input from you:**
- **NI-2** queue ticker — which Discord channel + button-vs-link
- **NI-10** DE losers-bracket rematches — I reproduce first, then show you
- **NI-11** custom challenges — share your ideas → I fold into a design
- **NI-9** (minor) tile number format (raw / % / 0–100)

---

## A) New items (Alex, 2026-08-09) — with analysis + open questions

### NI-1 — Lobby password "123" by default 🔎
- **Now:** `MatchGame.lobby_password` (v1.20.0) defaults empty; host sets it in the game tile.
- **Want:** default it to `123`.
- **Q:** Hard default (auto-set `123` on every match so a lobby is always joinable) vs. just a prefill the host can change? All formats + Open Play, or tournament only?
- **DECIDED (r2):** NOT a blanket default — the password field is **populated with `123` as soon as a lobby CODE is pasted** (into the lobby-code field), and is editable. So: on lobby-code entry, auto-fill the password `123` (changeable).

### NI-2 — Queue ticker on Discord 💬🔎
- **Now:** Open Play queue is on-site; the availability DM notifies eligible players. No live-queue presence in a Discord channel.
- **Want:** a Discord-channel message (same content as the availability DM) showing the live queue, so verified-account users can grab a match from Discord.
- **Q:** Which channel? One persistent message that's edited in place vs. a new post per event? "Grab a match" = a Discord button/interaction that queues you / pairs you with a waiting player, or a link to the site? Update trigger (on every queue change vs. periodic)?
- **DECIDED (r2):** A NEW message per event (not one edited-in-place message). Still open: which channel; whether "grab" is a Discord button vs. a site link.

### NI-3 — Enable/disable 3rd-place match in BaLi 🔎
- **Now (verified):** BaLi division brackets ALWAYS add a 3rd-place match (hardcoded in `buildDivisionBracket`). No host option.
- **Want:** a host toggle.
- **Q:** Default on (current) with opt-out? Applies to all divisions of the tournament? Reuse the existing `has_third_place_match` flag, or a BaLi-specific one?
- **DECIDED (r2):** Default ON, host can turn it off per tournament (applies to all divisions); reuse the existing `has_third_place_match` logic where possible.

### NI-4 — Landing "Live tournaments" ordering 🔎
- **Now:** reverse-chronological (soonest last).
- **Want:** soonest-first (ascending by start date).
- **Q:** Which statuses count as "Live tournaments" (upcoming = OPEN_REGISTRATION/REGISTRATION_CLOSED, and/or ONGOING)? Where do already-started (ONGOING) ones sit — before upcoming or interleaved? (Otherwise a clear fix.)
- **DECIDED (r3):** **ONGOING pinned at the top**, then upcoming (OPEN_REGISTRATION + REGISTRATION_CLOSED) **ascending by start date** (next-to-start first). Clear to build.

### NI-5 — Gated formats (skill-level gating) 💬🔎
- **Now:** anyone can register for any tournament.
- **Want:** a host sets which skill levels the tournament is open to.
- **Q:** Which skill system — the BaLi 1–5 matchmaking bands? A min–max range vs. a checklist of allowed bands? Which formats can be gated (all, or specific)? Hard block at registration vs. soft warning? Unclassified players (no band yet) — allowed or blocked? Does it also gate late-join / host-add?
- **DECIDED (r1):** Min–Max band range, HARD block (outside the range can't register).
- **DECIDED (r3):** Applies to **all formats** (incl. BaLi — a host may want only lower bands). **Unclassified registrants** (no questionnaire + not enough games) get the **BaLi-style questionnaire** on registration to determine their band, then the gate applies. (Same as BaLi's classification flow.)

### NI-6 — Close-skill challenges (automatic, maybe blind) 💬🔎
- **Now:** Open Play challenges target a specific chosen player.
- **Want:** a challenge that pairs you with a close-skill opponent, automatically, possibly blind.
- **Q:** "Close in skill" = within N band levels vs. within N rating points (which metric)? "Automatic" = the system finds + issues it vs. suggests candidates you confirm? "Blind" = opponent hidden until both accept vs. fully anonymous? A new queue type (like ranked) vs. an option in the challenge UI?
- **DECIDED (r1) — this is now a bigger feature, two layers:**
  1. **Booking flow (the "optimal" model):** the challenge creator sets a time frame = marks their availability in the calendar; invited players then BOOK a concrete slot within that availability where the match happens.
  2. **Opponent/matchup finder** — two tiers:
     - simple: find players with similar **General Skill**.
     - **most interesting: 50%-matchup finder** — concrete match setups where Chance-to-Win lands **47.5–52.5%** via **Faction Proficiency + Matchup Favourability**. If several balanced matchups exist between two players, **rotate the matchups** across a Bo3/Bo5.
  Still open: build order/priority of the two layers; exact CtW model source; how invites/eligibility are scoped. → round 2.
- **DECIDED (r2):** Build the **50%-matchup finder FIRST** (the novel part), booking flow after. → Design note written: **`plans/matchup-finder-design.md`** (CtW = Faction Proficiency × Matchup-Favourability via logistic-over-log-odds; 47.5–52.5% band; Bo3/5 rotation with faction diversity; fail-soft when no coin-flip). **Round-4 opens:** CtW combiner/weights + `muTilt` source (matchup matrix vs Model-Strength delta); does general skill factor in; opponent-fixed vs pool-wide search; default series length.

### NI-7 — 2D3 faction not shown on nodes until reported 🔎
- **Now:** in 2D3 the drawn faction appears on the bracket node only after the result is reported (should show when drawn, like SFT/2FT).
- **Q:** 2D3 draws a faction per game — show which on the node before reporting (game 1's, or a combined view)? Latch at game creation (draw time)? (Low ambiguity — a display latch.)
- **DECIDED (r3):** Show **all drawn factions (one per game)** on the node as soon as they're drawn (latch at draw time), like SFT/2FT. Note: a 2D3 **Bo3** will be rare, so most of the time it's a single faction — but handle the multi-game case cleanly.

### NI-8 — Swiss playoff preview stuck at Top 8 🔎
- **Now (bug):** the projected playoff plan showed Top 8 with only 15 players; corrected only after generation. Expected: <16 → Top 4 (auto-fallback), live in the preview.
- **Q:** Confirm the preview should show the EFFECTIVE format after the head-count fallback (TOP8→TOP4 <16, TOP4→TOP2 <8), tracking the live field. (Clear bug.)
- **DECIDED (r3):** Yes — show the effective (fallback-applied) format, **live with every join/drop**, exactly like BaLi's projection already does. Root cause: the Swiss branch of `projectBracketPlan` uses the *configured* format without the head-count fallback → stuck at TOP8. Fix = apply the same fallback in the projection.
- **NEW (r3, Alex's idea):** render the playoff preview as **placeholder nodes INSIDE the bracket** (not a separate block above it), so you don't scroll — esp. BaLi TOP2 with 4–5 divisions. **Feasible:** yes — the projected divisions become TBD/placeholder bracket blocks in the same layout; they get replaced by real matches on generation. Bigger layout change than the fallback fix, so treat as a 2nd sub-task (fallback fix first, inline-render second).

### NI-9 — Faction tab: Win-rate + Model-Strength charts + tile number 🔎
- **Now (verified):** rating model exists (`rating-model.ts`) = the faction "Model Strength". Factions tab has a popularity chart + 24 tiles showing games + win-rate.
- **Want:** duplicate the popularity chart for (a) Win rate and (b) Model Strength; add Model Strength as a 3rd number per tile (no bigger tiles).
- **Q:** Confirm "Model Strength" = the rating-model faction value. Two new charts = the same bar-chart form, per faction, for win-rate and model-strength? Tile 3rd number formatted how (raw, %, 0–100 score)? Re-order tiles by model strength, or keep current order?
- **DECIDED (r1):** Yes — Model Strength = the rating-model value. Three charts, SAME look, all **descending** (highest first), **order: Model Strength (top) → Win rate → Popularity**. Tiles get Model Strength as a 3rd number (no bigger tiles). Still open (minor): exact number format.

### NI-10 — Avoid rematches in the Double Elim losers bracket 💬🔎
- **Now:** DE bracket is fixed-structure (deterministic drops); the standard cross-seed minimizes but can't always avoid LB rematches.
- **Q:** Are you seeing actual LB rematches now (a concrete case)? A true "never rematch in LB" guarantee needs dynamic re-seeding of LB drops (departs from the fixed bracket) — acceptable, or do you want just "avoid the immediate WB opponent in the next LB round"? Avoid ALL prior opponents, or only the most recent?
- **DECIDED (r1):** FIRST reproduce + show where LB rematches currently occur (the standard cross-seed already minimises them), THEN decide the fix. No blind restructuring.

### NI-11 — Custom challenges — DISCUSS 💬
- Alex has ideas; this is a design discussion, not a spec yet. Share the ideas → I fold them into a design.

---

## B) Built / near-ready

- **Pick/Ban-Analytik** 🔨 — `feat/pickban-stats`, built + tested, but LOCAL-ONLY (not on origin). Secure → rebase onto main → deploy.
- **Replay audit run + evaluate** ◻️ — `/api/admin/replay-audit` is live; running it over all replays + sifting outliers still pending.

## C) Needs Alex decision / input

- **Ko-Fi crowdfunding** 💬 (Conquest + Land Battle) — modi scope? target sum? Ko-Fi Gold?
- **3 new maps + host maps locally** 💬 — needs image files (Otsuchi Castle / Excavation Site) from Alex.
- **#38** save tournament setup as a personal default · **#33** 2v2 mode (designed).

## D) Ops / Luke

- **Off-site prod backup** ◻️ — currently server-local only, no off-site despite the docs.

## E) Deferred backlog tail (no pressure)

- N6 skill-band → Discord-role sync · N7 availability-based invite DM · Z71 durable append-only pick/ban event log · N2 / MMR matchmaking (post-v1) · misc small UX.
