# 10 — Layout

Karaz Lists is composed in **deliberate vertical rhythm**, like a stone
cloister: each section is a chamber, each chamber breathes, each chamber's
proportions echo the others. Layout is structure as well as decoration —
it carries the brand's *gravity*.

## Grid & containers

### Container widths

| Token              | Max-width    | Use                                                |
|--------------------|--------------|----------------------------------------------------|
| `container-tight`  | `640px`      | Long-form prose (rules, about, settings forms).   |
| `container-narrow` | `960px`      | Most pages — tournament detail, profile.           |
| `container-wide`   | `1280px`     | Listing grids, leaderboards, brackets.             |
| `container-full`   | `1440px`     | Landing-page sections, hero compositions.          |

In Tailwind utilities: `max-w-[640px]`, `max-w-[960px]`, etc. — or define
`@theme` keys `--container-tight: 40rem`, etc. so they appear as
`max-w-tight`, `max-w-narrow`, `max-w-wide`, `max-w-full`.

### Horizontal padding

| Breakpoint     | `padding-x`     |
|----------------|-----------------|
| Mobile (<640)  | `1rem` (16px)   |
| Tablet (≥640)  | `1.5rem` (24px) |
| Desktop (≥1024)| `2rem` (32px)   |
| Wide (≥1280)   | `3rem` (48px)   |

Implemented as `px-4 sm:px-6 lg:px-8 xl:px-12`.

### Grid

We use CSS Grid for layout, Flex for inline. Tailwind utilities directly.
No grid framework wrapper.

For the landing-page card grids:

| Breakpoint     | Columns          | Gap          |
|----------------|------------------|--------------|
| <640           | 1                | `gap-4` (16px) |
| ≥640           | 2                | `gap-5` (20px) |
| ≥1024          | 3                | `gap-6` (24px) |
| ≥1280          | 3 or 4 depending on density | `gap-6` |

`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 lg:gap-6`.

---

## Vertical rhythm — section spacing

The landing page is composed of **sections**. Each section breathes the same
amount of vertical space, regardless of content density. This is the *cloister
columns lining up* feeling.

| Position             | Top padding       | Bottom padding    |
|----------------------|-------------------|-------------------|
| Hero (first section) | `0` (full-bleed)  | `py-24` desktop / `py-16` mobile (`pb-` only) |
| Inner section        | `py-24` desktop / `py-16` mobile          |
| Final section before footer | `py-32` desktop / `py-20` mobile (extra weight before sign-off) |
| Footer               | `py-12`                                   |

Within a section, content is stacked with `gap-12` (desktop) / `gap-8`
(mobile) between major blocks.

---

## Vertical rhythm — within a card

| Slot                | Spacing                           |
|---------------------|-----------------------------------|
| Card padding        | `p-6` default / `p-8` feature     |
| Between header and body | `mt-4`                          |
| Between body and footer | `mt-6`                          |
| Between footer items    | `gap-3`                         |

---

## Breakpoints

We use Tailwind's defaults — there is no reason to invent new ones.

| Token   | Min-width  | Approx device                        |
|---------|------------|--------------------------------------|
| `sm`    | 640px      | Large phone landscape, small tablet  |
| `md`    | 768px      | Tablet portrait                      |
| `lg`    | 1024px     | Laptop, tablet landscape             |
| `xl`    | 1280px     | Desktop                              |
| `2xl`   | 1536px     | Large desktop                        |

Mobile is `< sm`. We design **mobile-first**: every utility cascades up.

---

## Container queries

For component-level responsiveness — e.g. a card that should switch from
stacked to side-by-side layout when its parent column is wide enough — use
**CSS container queries**.

```tsx
<div className="@container">
  <article className="grid @md:grid-cols-[1fr_auto] gap-4">
    <header>…</header>
    <aside>…</aside>
  </article>
</div>
```

Use them when a component appears in multiple contexts (e.g. a tournament
card shown in a 1-col list *and* in a 3-col grid) and needs to adapt to its
**actual** width rather than the viewport width.

---

## Z-index layers (recap from tokens)

| Layer            | z-index | Role                              |
|------------------|---------|-----------------------------------|
| `z-0`            | 0       | Default flow                      |
| `z-10`           | 10      | Sticky elements within sections   |
| `z-20`           | 20      | Sticky header                     |
| `z-30`           | 30      | Floating buttons, FAB             |
| `z-40`           | 40      | Dropdowns, tooltips               |
| `z-50`           | 50      | Modals, sheets, dialogs, toasts   |

---

## Sticky header rules

- Height: `64px` desktop / `56px` mobile.
- `bg-karaz-iron-950/92 backdrop-blur-md` — translucent stone.
- `border-b border-karaz-iron-700`.
- Becomes "compact" on scroll past 80px — height shrinks to `48px`, top
  padding tightens, brand wordmark size drops from `text-h5` to `text-body`.

---

## The "cloister-arcade" landing rhythm

The 7 sections of the landing page are arranged with intentional pacing.
A visitor scrolling encounters them like walking through a cloister:

```
[Hero — chamber 1]          full viewport height, photo backdrop
   ↓
[The Forge — chamber 2]     pb-24, split-layout, photo + text
   ↓
[Active Musters — 3]        py-24, card grid, structured
   ↓
[Roll of Honour — 4]        py-24, vertical list, dense info
   ↓
[The Conclave — 5]          py-24, 3-column feature grid
   ↓
[Sigillum Karaz — 6]        py-32, full-width, sigil + CTA
   ↓
[Footer — 7]                py-12, stone-texture, mini-sigil
```

This is intentional — the eye lands on roughly the same horizontal axis
every viewport-height of scroll. It feels architecturally composed, not
randomly stacked.

---

## Aspect ratios reserved for image slots

| Slot                       | Aspect | Use                                       |
|----------------------------|--------|-------------------------------------------|
| Hero photo                 | 21:9   | Landing hero, tournament-detail header    |
| Card thumbnail (banner)    | 3:2    | Tournament cards                          |
| Faction icon               | 1:1    | Faction icon in cards / draft UI          |
| Sigil mark                 | 1:1    | Logo, footer, achievement medallion       |
| Faction banner             | 3:4    | Tall vertical banner inside detail view   |
| Avatar                     | 1:1    | User avatars (rendered in circle)         |

Use `aspect-[21/9]`, `aspect-[3/2]`, etc. utilities.

---

## Anti-patterns

- ❌ Don't introduce arbitrary container max-widths. Use the four defined.
- ❌ Don't use `min-h-screen` on every section. Sections breathe, they don't
  fill the viewport — that's a hero-only pattern.
- ❌ Don't mix `gap-*` values within a single grid; one rhythm per grid.
- ❌ Don't nest `<main>` inside `<main>`. The page has one `<main>`.
- ❌ Don't use absolute positioning for layout. Reserve `absolute` for
  decorative elements (faded background sigils, corner crests).
- ❌ Don't hard-code spacing as `style={{ marginTop: '32px' }}`. Always use
  Tailwind utilities.

## Related

- [03-tokens.md](./03-tokens.md) — spacing scale
- [12-hero-anatomy.md](./12-hero-anatomy.md) — landing-page section breakdown
- [11-accessibility.md](./11-accessibility.md) — minimum tap-target sizes
