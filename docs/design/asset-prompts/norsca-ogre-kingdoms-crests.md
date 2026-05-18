# Faction Crests — Norsca + Ogre Kingdoms

The AI crest pack delivered 2026-05-18 covers 18 of 24 races. Norsca and
Ogre Kingdoms have no Total War sub-faction crests because TOW does not
have published AoB books for them (yet). These two prompts fill the gap
so `FactionBadge` no longer falls back to the initials circle.

Style locked to **13-asset-generation.md § 4a** so the result blends with
the existing 18 PNGs in `apps/frontend/public/icons/factions/`. Do **not**
diverge from the shared preamble — consistency matters more than novelty.

---

## Shared preamble (paste before each prompt)

> *"In the visual style of FromSoftware promo material (Elden Ring, Bloodborne,
> Dark Souls): cinematic, restrained, photoreal. Color palette: anthracite,
> stone-grey, warm gold rim-light, deep shadows, deliberately desaturated.
> Lighting: golden hour or torchlight from below. Subtle film grain.
> Compositionally clean, rule-of-thirds, negative space respected.
> No bright fantasy, no cartoon, no CGI sheen, no anime, no glitter, no neon."*

---

## Norsca crest — `norsca.png`

**Subject phrase** (from `13-asset-generation.md:251`): wolf head over crossed great-axes.

**Prompt**:

> [shared preamble] **Heraldic faction crest, carved bas-relief sigil on a
> dark anthracite stone tablet, cold gold inlay highlights, single centered
> emblem, perfectly symmetric, vector-clean line work, no text, no banner,
> no border, 1:1 square. Transparent or solid dark background. The emblem
> subject is: a snarling Northern wolf head facing forward (jaws open, fangs
> visible, fur rendered as stylised engraved lines, weathered teeth), with
> two crossed great-axes behind the head — broad heavy axe-heads above the
> wolf's ears, long hafts wrapped in leather thong descending past the wolf's
> jaw. The axes are slightly nicked and notched as if battle-used.
> Composition perfectly symmetric across the vertical axis. 256×256 PNG,
> 8-bit RGBA, the wolf and axes engraved into the tablet as bas-relief with
> cold gold inlay tracing the wolf's fur lines and axe edges.**

**Save as**: `apps/frontend/public/icons/factions/norsca.png` (256×256, RGBA).

---

## Ogre Kingdoms crest — `ogre_kingdoms.png`

**Subject phrase** (from `13-asset-generation.md:252`): bull skull over crossed clubs.

**Prompt**:

> [shared preamble] **Heraldic faction crest, carved bas-relief sigil on a
> dark anthracite stone tablet, cold gold inlay highlights, single centered
> emblem, perfectly symmetric, vector-clean line work, no text, no banner,
> no border, 1:1 square. Transparent or solid dark background. The emblem
> subject is: a massive bull skull (frontal view, both horns curving outward
> and slightly upward, deep eye sockets, broad nasal cavity), with two
> crossed primitive war-clubs behind it — thick gnarled wooden hafts,
> studded with iron rivets and crude metal bands near the head. The clubs
> are scaled large relative to the skull, reading as 'crude' and 'massive'.
> Composition perfectly symmetric across the vertical axis. 256×256 PNG,
> 8-bit RGBA, the bull skull and clubs engraved into the tablet as
> bas-relief with cold gold inlay tracing the horns, eye sockets, and the
> iron bands on the clubs.**

**Save as**: `apps/frontend/public/icons/factions/ogre_kingdoms.png` (256×256, RGBA).

---

## After generation — wire-up checklist

1. Place both PNGs at the paths above.
2. Edit `packages/db/prisma/seed.ts` — change the two `icon_url: null`
   entries to the corresponding paths:
   ```ts
   { id: 'norsca',        ..., icon_url: '/icons/factions/norsca.png' },
   { id: 'ogre_kingdoms', ..., icon_url: '/icons/factions/ogre_kingdoms.png' },
   ```
3. Run `pnpm db:seed` — the sync loop will refresh `Faction.icon_url`
   on the existing rows.
4. Hard-reload the browser; `/factions` should show all 24 crests, no
   initials fallback.

## Acceptance

- Visually fits with the existing 18 PNGs (anthracite + gold bas-relief look).
- Centered, symmetric, no off-axis weight.
- Reads cleanly at 24px (sm), 32px (md), 48px (lg) — the three `FactionBadge` sizes.
- No GW trademarks, no character names, no recognisable miniatures.
