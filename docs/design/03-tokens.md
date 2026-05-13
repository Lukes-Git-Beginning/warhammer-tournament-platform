# 03 — Design Tokens (SSOT)

Every visual constant in Karaz Lists lives here. Tokens are defined once, in a
single Tailwind v4 `@theme` block in `apps/frontend/src/app.css`, and consumed
everywhere as either Tailwind utilities (`bg-karaz-iron-950`,
`text-karaz-gold-500`) or raw CSS custom properties (`var(--color-karaz-iron-950)`).

If a value is not in this document, it should not exist in production code.
If a designer or sub-agent asks "what is the right gold for X?", the answer
is somewhere in this file.

The full, copy-pasteable `@theme` block for `app.css` lives in
[14-implementation.md](./14-implementation.md). This file is the *index* of
what each token *is* and *means*.

---

## Token Namespaces

| Namespace        | Prefix             | Purpose                                                                |
|------------------|--------------------|------------------------------------------------------------------------|
| Color — base     | `karaz-iron-*`     | Page / card / surface backgrounds, borders.                            |
| Color — base     | `karaz-stone-*`    | Text colors (muted → heading).                                         |
| Color — accent   | `karaz-gold-*`     | Primary accent (CTAs, focus, highlight).                               |
| Color — accent   | `karaz-forge-*`    | Heat / urgent CTAs / glow.                                             |
| Color — accent   | `karaz-blood-*`    | Danger / Warhammer-red.                                                |
| Color — accent   | `karaz-bronze`     | Secondary metal (badges, dividers).                                    |
| Color — accent   | `karaz-parchment`  | Rare highlight (drop-cap backgrounds, ribbons).                        |
| Color — semantic | `karaz-success` etc. | Map functional intents to base/accent tokens.                        |
| Typography       | `font-*`           | Display / headline / body / mono / script.                             |
| Spacing          | Tailwind 4 default | 4-pixel grid. We do not override.                                      |
| Radius           | `radius-*`         | 5 steps, intentionally sharp (Souls-like).                             |
| Shadow           | `shadow-karaz-*`   | Engrave, emboss, forge-glow, banner, stone-vignette.                  |
| Motion           | `ease-*`, `duration-*` | 3 easings + 6 durations.                                           |
| Z-Index          | `z-*`              | Tailwind default scale. We do not override.                            |

---

## Color tokens (full table)

All values in HEX (canonical). HSL and OKLCH equivalents in
[05-color-system.md](./05-color-system.md) for color-mix() math and a11y
checks.

### Base — Iron & Stone

| Token                    | HEX        | Role                                            |
|--------------------------|------------|-------------------------------------------------|
| `karaz-obsidian`         | `#08070A`  | Modal overlay, void.                            |
| `karaz-iron-950`         | `#110F0E`  | **Page background.** Default `body` color.      |
| `karaz-iron-900`         | `#181513`  | Card background, default surface.               |
| `karaz-iron-800`         | `#221E1B`  | Elevated surface (modal, hovered card).         |
| `karaz-iron-700`         | `#2D2823`  | Border — subtle (dividers between sections).    |
| `karaz-iron-600`         | `#3D3631`  | Border — default (card borders, inputs).        |
| `karaz-iron-500`         | `#5C5249`  | Border — strong (focus rings on dark fields).   |
| `karaz-stone-400`        | `#837A6F`  | Text — muted (timestamps, helper text).         |
| `karaz-stone-300`        | `#A89E92`  | Text — secondary (labels, captions).            |
| `karaz-stone-200`        | `#CCC2B6`  | Text — body (default paragraph color).          |
| `karaz-stone-100`        | `#E8DFD0`  | Text — heading (h1–h6 default color).           |
| `karaz-parchment`        | `#F4E8C4`  | Rare highlight — drop-cap bg, banner inscriptions. |

### Accent — Gold, Forge, Blood, Bronze

| Token                    | HEX        | Role                                            |
|--------------------------|------------|-------------------------------------------------|
| `karaz-gold-300`         | `#F4D479`  | Glow / hover highlight on gold elements.        |
| `karaz-gold-400`         | `#E4B432`  | **Primary CTA fill.**                           |
| `karaz-gold-500`         | `#D4A017`  | Primary CTA hover; default brand accent.        |
| `karaz-gold-600`         | `#A87A0E`  | Primary CTA active / pressed.                   |
| `karaz-bronze`           | `#B08D57`  | Secondary metal — badges, decorative dividers.  |
| `karaz-forge-400`        | `#E87B3D`  | Heat highlight (urgent badges).                 |
| `karaz-forge-500`        | `#D8632A`  | **Urgent CTA / heat / live-state.**             |
| `karaz-forge-600`        | `#B04D18`  | Heat active / pressed.                          |
| `karaz-blood-500`        | `#8B0000`  | Warhammer red — danger fill.                    |
| `karaz-blood-600`        | `#5E0000`  | Danger active / pressed.                        |

### Semantic — mapped to base/accent

| Token              | Resolves to          | Role                              |
|--------------------|----------------------|-----------------------------------|
| `karaz-success`    | `#6B8E5B`            | Confirmation, completion.         |
| `karaz-warning`    | `karaz-gold-500`     | Caution, attention required.      |
| `karaz-danger`    | `karaz-blood-500`    | Destructive, error.               |
| `karaz-info`       | `#5D7B8F`            | Neutral information.              |

---

## Typography tokens

Full scale in [04-typography.md](./04-typography.md).

| Token            | Value                                                              | Role                          |
|------------------|--------------------------------------------------------------------|-------------------------------|
| `font-display`   | `"Cinzel Variable", "Trajan Pro", Georgia, serif`                  | Hero, h1, brand wordmark.     |
| `font-headline`  | `"Cinzel Decorative", "Cinzel Variable", serif`                    | Hero-only decorative variant. |
| `font-body`      | `"Inter Variable", system-ui, -apple-system, sans-serif`           | Default body, UI.             |
| `font-mono`      | `"JetBrains Mono Variable", "Fira Code", ui-monospace, monospace`  | Stats, ELO, dates, codes.     |
| `font-script`    | `"IM Fell English", "EB Garamond", Georgia, serif`                 | Drop-caps, illuminated initials. |

---

## Spacing tokens

We use Tailwind v4's default 4-pixel grid. **Do not override.** The spacing
scale (`p-0` through `p-96`) covers everything we need.

Reserved patterns for the design system:

| Pattern        | Spacing                | Use                                       |
|----------------|------------------------|-------------------------------------------|
| Section margin | `py-24` (96px) desktop / `py-16` (64px) mobile | Vertical rhythm between landing sections. |
| Card padding   | `p-6` (24px) default / `p-8` (32px) on feature cards | Internal card padding.                    |
| Inline gap     | `gap-3` (12px)         | Default inline element gap.               |
| Stack gap      | `gap-6` (24px)         | Default vertical stack gap.               |

See [10-layout.md](./10-layout.md) for full layout specs.

---

## Radius tokens

Intentionally **sharp**. Souls-like UI does not have soft corners; weapons and
inscribed plates have crisp edges. We only deviate for very large
surfaces where 0px would feel like a hard cut.

| Token            | Value | Use                                              |
|------------------|-------|--------------------------------------------------|
| `radius-none`    | `0`   | Banners, hero photo overlays.                    |
| `radius-sm`      | `2px` | Inputs, small badges.                            |
| `radius-md`      | `4px` | **Default** for buttons, dropdowns.              |
| `radius-lg`      | `6px` | Cards.                                           |
| `radius-xl`      | `10px`| Modals, large featured cards.                    |

We deliberately skip the larger pill-shape radii (16px+).

---

## Shadow tokens

Three families: **engrave** (inset, recessed feel), **emboss** (outset, raised),
**glow** (forge/gold colored aura). Plus `banner` for heavy floating elements
and `stone-vignette` for the page-edge darkening.

| Token                     | Value                                                                                            | Use                                          |
|---------------------------|--------------------------------------------------------------------------------------------------|----------------------------------------------|
| `shadow-karaz-engrave`    | `inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(0,0,0,0.6)`                          | Recessed elements: inputs, etched labels.   |
| `shadow-karaz-emboss`     | `0 1px 0 rgba(255,255,255,0.06), 0 -1px 0 rgba(0,0,0,0.4)`                                       | Raised elements: default buttons.            |
| `shadow-karaz-forge-glow` | `0 0 32px rgba(216,99,42,0.35), 0 0 8px rgba(244,212,121,0.25), inset 0 0 0 1px rgba(244,212,121,0.4)` | Primary CTA hover, urgent live-states.   |
| `shadow-karaz-gold-glow`  | `0 0 24px rgba(212,160,23,0.3), inset 0 0 0 1px rgba(212,160,23,0.4)`                            | Focus ring, gold hover.                      |
| `shadow-karaz-banner`     | `0 10px 30px rgba(0,0,0,0.7), 0 4px 8px rgba(0,0,0,0.5)`                                         | Heraldic banner cards, hero overlay panels.  |
| `shadow-karaz-stone-vignette` | `inset 0 0 120px rgba(0,0,0,0.7)`                                                            | Page-level edge darkening on hero sections.  |

---

## Motion tokens

| Token                  | Value                                | Use                                              |
|------------------------|--------------------------------------|--------------------------------------------------|
| `ease-forge`           | `cubic-bezier(0.2, 0.8, 0.2, 1.4)`   | Overshoot + impact (button press, sigil reveal). |
| `ease-burn`            | `cubic-bezier(0.4, 0, 0.2, 1)`       | **Default.** Deliberate, smooth.                 |
| `ease-quick`           | `cubic-bezier(0.4, 0, 1, 1)`         | Fast exits (dropdown close, dismiss).            |
| `duration-instant`     | `80ms`                               | Cursor feedback, focus ring.                     |
| `duration-fast`        | `160ms`                              | Hover, color transitions.                        |
| `duration-base`        | `240ms`                              | **Default.** Most interactions.                  |
| `duration-medium`      | `320ms`                              | Modal open, sheet slide.                         |
| `duration-slow`        | `560ms`                              | Page entrance, section reveal.                   |
| `duration-epic`        | `1000ms`                             | Hero sigil draw, landing-page first-paint dance. |

Full recipes in [09-motion.md](./09-motion.md).

---

## Z-index layers

Tailwind defaults, named per role for code clarity:

| Layer            | z-index | Role                              |
|------------------|---------|-----------------------------------|
| `z-0`            | 0       | Default flow.                     |
| `z-10`           | 10      | Sticky elements within scroll.    |
| `z-20`           | 20      | Sticky header.                    |
| `z-30`           | 30      | Floating buttons, FAB.            |
| `z-40`           | 40      | Dropdowns, tooltips.              |
| `z-50`           | 50      | Modals, sheets, dialogs.          |

Toasts (Sonner) sit at z-50 with internal stacking.

---

## Token consumption

### In Tailwind utilities (preferred)

```tsx
<div className="bg-karaz-iron-900 border border-karaz-iron-600 text-karaz-stone-200 rounded-md shadow-karaz-emboss">
```

### In CSS via custom properties

```css
.custom-element {
  background: var(--color-karaz-iron-900);
  border: 1px solid var(--color-karaz-iron-600);
  box-shadow: var(--shadow-karaz-emboss);
  transition: background var(--duration-fast) var(--ease-burn);
}
```

### In inline styles (last resort, only for dynamic values)

```tsx
<div style={{ background: `oklch(from var(--color-karaz-gold-500) l c h / 0.4)` }}>
```

---

## What is **not** a token

- One-off pixel values used inside a single component (e.g. an SVG inner radius).
- Photo-specific gradient stops baked into a hero image.
- Faction-specific colors — those live in `apps/frontend/public/icons/factions/`
  and the faction-color map (separate from the design token system).

## Related

- [05-color-system.md](./05-color-system.md) — full color palette with contrast pairs
- [04-typography.md](./04-typography.md) — type scale
- [09-motion.md](./09-motion.md) — motion recipes
- [14-implementation.md](./14-implementation.md) — exact `@theme` block to paste
