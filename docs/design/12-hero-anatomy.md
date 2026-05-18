# 12 — Hero Page Anatomy

The landing page is the brand's first sentence. It does most of the work
of making a visitor go "what is this place?" — in the good way. This file
breaks down the seven sections, the motion choreography, and the
performance/composition constraints for each.

## The seven chambers

| # | Name              | Purpose                                            | Above-fold? |
|---|-------------------|----------------------------------------------------|-------------|
| 1 | **Hero**          | First impression. Cinematic photo + sigil + CTA.   | ✅          |
| 2 | The Forge         | Mission statement, beautifully framed.             | —           |
| 3 | Active Musters    | Live and upcoming tournaments — the product.        | —           |
| 4 | Roll of Honour    | Top 10 marshals — social proof + ambition.          | —           |
| 5 | The Conclave      | Feature/format pillars (Swiss · Bracket · Draft).   | —           |
| 6 | Sigillum Karaz    | Community / final CTA. Discord, GitHub.             | —           |
| 7 | Footer            | Legal, navigation, mini-sigil.                      | —           |

Each section follows the layout rhythm in [10-layout.md](./10-layout.md):
`py-24` desktop, `py-16` mobile. Hero is full-bleed (no `py`).

---

## Section 1 — Hero

### Composition (desktop)

```
┌────────────────────────────────────────────────────────────────┐
│ [Hero Photo — 21:9 cinematic knight in wildflowers, full-bleed]│
│                                                                │
│       [overlay: vignette + bottom-to-top dark gradient]        │
│                                                                │
│                                                                │
│                       ╭─────────────────╮                      │
│                       │                 │                      │
│                       │  [Karaz Sigil]  │  ← 240×240 animated  │
│                       │                 │                      │
│                       ╰─────────────────╯                      │
│                                                                │
│             K A R A Z    L I S T S                             │  ← hero-xl, gold-300/90
│                                                                │
│             Where Lists Are Forged                             │  ← display-3, stone-200, italic
│                                                                │
│            [Take Up Arms]  [View the Roll of Honour]           │  ← forge + iron buttons, gap-4
│                                                                │
│                       ↓ scroll                                  │  ← scroll cue
└────────────────────────────────────────────────────────────────┘
```

### Composition (mobile)

Sigil shrinks to 120×120, wordmark wraps to two lines (`KARAZ` / `LISTS`),
CTAs stack vertically `flex-col gap-3`.

### Photo placement

- **Full bleed** — `absolute inset-0`, `object-cover`.
- **Subject offset** — knight in lower-right third; sigil + wordmark column
  occupies left/center.
- **Mobile center-crop** — `object-position: 75% 50%` to keep subject visible.

### Overlay stack (z-index order, bottom up)

1. Hero photo (`z-0`).
2. Warm-grade `::before` overlay — `linear-gradient(135deg, rgba(216,99,42,0.06) 0%, transparent 40%, rgba(8,7,10,0.20) 100%)`.
3. Bottom-fade `::after` — `linear-gradient(180deg, transparent 0%, transparent 45%, rgba(17,15,14,0.6) 80%, rgba(17,15,14,0.92) 100%)`.
4. Content column — sigil, wordmark, tagline, CTAs. `z-10`.

### Motion choreography (1.4s, plays once on page-load)

Full sequence in [09-motion.md](./09-motion.md). Recap:

| ms     | Event                                                          |
|--------|----------------------------------------------------------------|
| 0      | Photo at brightness 0.6, sigil invisible (stroke offset).      |
| 100    | Sigil outer frame begins stroke-draw (`ease-burn`, 400ms).     |
| 600    | Inner glyph (rune mark) draws.                                 |
| 900    | Crossed hammers draw.                                          |
| 1100   | Gold glow halo fades in around sigil container.                |
| 1100   | Photo brightens 0.6 → 1.0.                                     |
| 1300   | Wordmark fades in, translates from `y:+8`.                     |
| 1500   | Tagline fades in.                                              |
| 1580   | CTA "Take Up Arms" fades in.                                   |
| 1660   | CTA "View the Roll of Honour" fades in.                        |
| 1740   | Scroll cue (↓) fades in.                                       |

Reduced-motion: all elements cut directly to final state with a single
240ms opacity fade.

### Scroll cue

A small downward chevron with the eyebrow label "BEGIN THE MUSTER", at the
bottom of the viewport. Pulses subtly (`animate-karaz-pulse` slowed to 2s).
Disappears once the user scrolls past 80px.

### Performance

- Hero photo preloaded (`<link rel="preload" as="image" href="…" type="image/avif">`).
- LCP target: **< 1.8s** on mid-tier mobile (4G simulated).
- `<picture>` with AVIF primary, WebP fallback, JPEG legacy.
- Photo dimensions explicit — `width` and `height` attributes match the
  21:9 aspect — to prevent layout shift.
- Sigil SVG inline (no extra request).

---

## Section 2 — The Forge

### Composition

Split layout: photo left (40%), text right (60%) on desktop; stacked on
mobile.

```
┌──────────────────────────────────────────────────────────────┐
│ ┌──────────────────┐    EYEBROW: THE FORGE                   │
│ │                  │                                          │
│ │   [photo — anvil │    Every list is forged                  │  ← display-2
│ │   close-up,      │    in iron and resolve.                  │
│ │   warm light,    │                                          │
│ │   shallow DOF]   │    Body copy: explains the mission       │  ← body-lg
│ │                  │    in 2–3 sentences. Drop-cap on first   │
│ │                  │    letter (stone variant, not gold).     │
│ │                  │                                          │
│ │                  │    [Read the Manifesto] ← etched button │
│ │                  │                                          │
│ └──────────────────┘                                          │
└──────────────────────────────────────────────────────────────┘
```

### Motion

On viewport entry: photo subtle parallax (`translateY(-20%)` across full
scroll-range, via CSS scroll-driven). Text staggers in (`karaz-rise` with
80ms between paragraph blocks).

### Photo

Asset: AI-generated anvil / forge close-up (see
[13-asset-generation.md](./13-asset-generation.md)). Aspect 3:4 portrait.

---

## Section 3 — Active Musters

### Composition

Card grid of upcoming/live tournaments. 1 / 2 / 3 columns by breakpoint.

Section header:
```
EYEBROW: NOW MUSTERING
Active Musters                                    [View all → ]
```

Cards use the `BannerCard` composition (see [08-components.md](./08-components.md)).

### Card variants by state

- **Live** — `forge`-variant pulsing badge, top-right corner has subtle
  ember-glow gradient.
- **Upcoming** — `gold`-variant badge with countdown timer (mono).
- **Featured (admin-pinned)** — Sigil watermark in top-right corner at 40%
  opacity.

### Empty state

If no active tournaments:

```
[Centered, single card]
  [KarazAnvil icon, size-12, stone-400]
  The musters stand empty.
  When marshals call, they will be listed here.
  [Call the Muster] ← only for ORGANIZER+
```

### Motion

Cards stagger-fade in (motion lib `staggerChildren: 0.08`).

---

## Section 4 — Roll of Honour

### Composition

Vertical list, top 10 marshals by ELO (Standing). Each row:

```
┌──────────────────────────────────────────────────────────────┐
│  I    [avatar]  Brokk Stoneborn        [Dwarfs flag]  1834   │  ← Roman, avatar, name, faction, mono
│ ────────────────────────────────────────────────────────────  │
│  II   [avatar]  Sigmar Reiksguard      [Empire flag]  1822   │
│ ────────────────────────────────────────────────────────────  │
│  III  [avatar]  Thorvald the Cleaver   [Norsca flag]  1801   │
│ …                                                             │
│  [View the full Roll of Honour]                              │  ← etched button below
└──────────────────────────────────────────────────────────────┘
```

Rank in Cinzel Display (Roman numerals I–X), bronze color, mono-aligned width.

Separators: engraved-seam linear gradient (faded gold center).

### Hover state

Row bg fades from transparent to `karaz-iron-900`. Name color shifts from
`stone-100` to `gold-400`.

### Motion

On viewport entry: stagger-fade rows top-to-bottom, 60ms between rows.

---

## Section 5 — The Conclave

### Composition

3-column feature grid showcasing the formats Rizzotto supports.

```
┌──────────────────────────────────────────────────────────────┐
│  EYEBROW: HOW WE MUSTER                                       │
│  The Conclave                                                 │  ← display-2, centered
│                                                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │
│  │ [Karaz icon]│  │ [Karaz icon]│  │ [Karaz icon]│           │
│  │ Swiss Toll  │  │ Lineage     │  │ The Choosing│           │
│  │             │  │             │  │             │           │
│  │ Every       │  │ Bracket     │  │ Live draft  │           │
│  │ marshal     │  │ play —      │  │ — Captain's │           │
│  │ plays N     │  │ single or   │  │ Mode draft  │           │
│  │ rounds…     │  │ double      │  │ between two │           │
│  │             │  │ elim…       │  │ marshals…   │           │
│  └─────────────┘  └─────────────┘  └─────────────┘           │
└──────────────────────────────────────────────────────────────┘
```

Each column has a gothic-arch header — a SVG arch outline above the icon
that visually frames it like a cloister opening.

### Icons used

- Swiss Toll → `KarazRune` (rune of order)
- Lineage → `KarazCrossHammers`
- The Choosing → `KarazBanner`

### Motion

Columns stagger-fade left-to-right.

---

## Section 6 — Sigillum Karaz

### Composition

Final-CTA section. Single centered composition over a stone-textured bg.

```
┌──────────────────────────────────────────────────────────────┐
│                                                                │
│                       [Karaz Sigil — large, animated shimmer]  │
│                                                                │
│                       Join the Realm                          │  ← display-2, stone-100, centered
│                                                                │
│              Karaz Ankor                                       │  ← display-3, gold-500, italic, motto
│                                                                │
│              [Take Up Arms]                                    │  ← forge, lg
│                                                                │
│              [Discord] [GitHub] [Reddit]                       │  ← icon-only ghost buttons, gap-6
│                                                                │
└──────────────────────────────────────────────────────────────┘
```

Background: `stone-wall` texture at 8% opacity, layered with a forge-radial
glow centered on the sigil.

### Motion

Sigil has a slow `karaz-shimmer` animation (3s loop, very subtle).

---

## Section 7 — Footer

```
┌──────────────────────────────────────────────────────────────┐
│ [mini sigil 24px] RIZZOTTO                                   │  ← font-display, gold-500
│                                                                │
│ Karaz Ankor  ·  © 2026 Rizzotto  ·  Where Lists Are Forged   │  ← caption, stone-400
│                                                                │
│ [Discord] [GitHub] [Reddit]  ·  [Rules] [Privacy] [Imprint]   │  ← link list
│                                                                │
│ ──── engraved seam ────                                       │
│                                                                │
│ Not affiliated with Games Workshop. Warhammer / The Old World │  ← micro, stone-400
│ are trademarks of their respective owners.                     │
└──────────────────────────────────────────────────────────────┘
```

Background: `karaz-obsidian` (slightly darker than page) with `stone-wall`
texture at 6% opacity.

---

## Performance budgets (full landing page)

| Metric                              | Target (mobile, 4G simulated)             |
|--------------------------------------|-------------------------------------------|
| LCP                                  | < 1.8s                                    |
| CLS                                  | < 0.05                                    |
| TTI                                  | < 3.5s                                    |
| Total page weight (initial)          | < 600KB                                   |
| Lighthouse Performance               | ≥ 85                                      |
| Lighthouse Accessibility             | ≥ 95                                      |
| Lighthouse Best Practices            | ≥ 95                                      |
| Lighthouse SEO                       | ≥ 95                                      |

Strategies:
- Hero photo: AVIF + WebP, preloaded, fetchpriority high.
- All other photos: lazy-loaded (`loading="lazy"`, `decoding="async"`).
- Sigil SVG inline, gzipped on the wire.
- Sections 3–7 hydrate lazily — landing is mostly RSC-friendly even though
  TanStack Router is client-rendered today.

---

## SEO meta block (in `index.html` `<head>`)

```html
<title>Rizzotto — Where Lists Are Forged</title>
<meta name="description" content="Tournaments for Warhammer: The Old World. Forge your army list, answer the muster, and stand on the Roll of Honour." />
<meta name="theme-color" content="#110F0E" />

<meta property="og:title" content="Rizzotto — Where Lists Are Forged" />
<meta property="og:description" content="Tournaments for Warhammer: The Old World. Forge your army list, answer the muster, and stand on the Roll of Honour." />
<meta property="og:type" content="website" />
<meta property="og:image" content="/og-image.png" />
<meta property="og:url" content="%VITE_PUBLIC_URL%" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Rizzotto" />
<meta name="twitter:description" content="Where Lists Are Forged." />
<meta name="twitter:image" content="/og-image.png" />
```

Open Graph image (`og-image.png`): the Rizzotto sigil over a tightly-cropped
hero photo, with the wordmark "RIZZOTTO" bottom-aligned. 1200×630 px.

---

## Anti-patterns

- ❌ Don't add a "press play" video hero. Static cinematic photography is the
  brand.
- ❌ Don't auto-loop the sigil reveal animation — it plays *once*.
- ❌ Don't add a 4th section between The Forge and Active Musters. The rhythm
  is fixed.
- ❌ Don't put two `forge`-variant CTAs in the hero. Only one primary per
  viewport.
- ❌ Don't replace cinematic photography with rendered 3D mockups or
  miniature-paint photography.

## Related

- [07-imagery.md](./07-imagery.md) — hero photo specs
- [09-motion.md](./09-motion.md) — full sigil-reveal storyboard
- [13-asset-generation.md](./13-asset-generation.md) — generate photos/sigil/textures
- [10-layout.md](./10-layout.md) — section rhythm + spacing
