# 04 — Typography

Type carries half of the brand's weight. Photography carries the other half.
Everything else is supporting cast. Treat typography with the seriousness of a
stone mason setting an inscription.

## Type Stack

We use **variable fonts** wherever possible — they enable smooth weight
transitions on hover, reduce HTTP weight (one file, many weights), and feel
contemporary while still serving an ancient aesthetic.

| Token            | Family                          | Variable?  | Weight range | Role                                |
|------------------|---------------------------------|------------|--------------|-------------------------------------|
| `font-display`   | **Cinzel Variable**             | ✅         | 400 – 900    | Hero, h1, wordmark, ceremonial headings. |
| `font-headline`  | **Cinzel Decorative**           | (static)   | 400, 700, 900| Hero-only decorative variant with engraved swashes. |
| `font-body`      | **Inter Variable**              | ✅         | 100 – 900    | Default UI, paragraphs, form labels.|
| `font-mono`      | **JetBrains Mono Variable**     | ✅         | 100 – 800    | Stats, ELO, dates, codes, IDs.      |
| `font-script`    | **IM Fell English**             | (static)   | 400          | Drop-caps, illuminated initials. Used **sparingly**. |

### Why these choices

- **Cinzel** — Modeled on classical Roman inscriptions. All-caps by nature.
  Reads "carved into stone" without trying. Variable axis means we can animate
  weight on hover for a "press" feel.
- **Inter** — The most-tested neutral UI typeface of the last decade.
  Karaz Lists is grimdark but it is also a *functional product*; the body type
  must disappear into legibility.
- **JetBrains Mono** — Variable, ligatured, designed for data display. Stat
  tables in Roll of Honour need to align cleanly; this delivers.
- **IM Fell English** — A facsimile of 17th-century English type. Used **only
  for drop-caps and illuminated initials** (one character at a time).
  Overuse = LARP forum.

### Loading strategy

```html
<!-- in apps/frontend/index.html, in <head> -->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400..900&family=Cinzel+Decorative:wght@400;700;900&family=IM+Fell+English&display=swap" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&family=JetBrains+Mono:wght@100..800&display=swap" />
```

`font-display: swap` is critical — visitors see content in fallback
(`Georgia` / `system-ui`) immediately, then upgrade. No FOIT.

Alternatively, use `@fontsource/cinzel`, `@fontsource/inter`, etc. as npm
packages for self-hosted, no-network-roundtrip loading. Recommended for
production deploys outside of EU/US to avoid Google-Fonts-CDN latency hits.

---

## Type Scale

Fluid responsive scale using `clamp()`. One source of truth for all heading
sizes. Implemented in `app.css` as utility classes.

| Class             | Size (min / mid / max)      | Line-height | Weight | Family       | Use                          |
|-------------------|-----------------------------|-------------|--------|--------------|------------------------------|
| `text-hero-xl`    | `clamp(3rem, 8vw, 6.5rem)`  | `0.95`      | 700    | display      | Hero wordmark only.          |
| `text-hero`       | `clamp(2.5rem, 6vw, 5rem)`  | `1.0`       | 700    | display      | Section openers above-fold.  |
| `text-display-1`  | `clamp(2rem, 4.5vw, 3.5rem)`| `1.1`       | 700    | display      | Page-level h1.               |
| `text-display-2`  | `clamp(1.625rem, 3.5vw, 2.5rem)` | `1.15` | 600    | display      | Section h2.                  |
| `text-display-3`  | `clamp(1.375rem, 2.5vw, 1.875rem)`| `1.2`| 600    | display      | Sub-section h3.              |
| `text-h4`         | `1.25rem` (20px)            | `1.3`       | 600    | display      | h4 — card titles.            |
| `text-h5`         | `1.125rem` (18px)           | `1.35`      | 600    | display      | h5 — list group labels.      |
| `text-body-lg`    | `1.125rem` (18px)           | `1.6`       | 400    | body         | Lead paragraph, important body. |
| `text-body`       | `1rem` (16px)               | `1.6`       | 400    | body         | **Default body.**            |
| `text-body-sm`    | `0.875rem` (14px)           | `1.5`       | 400    | body         | Helper text, secondary copy. |
| `text-caption`    | `0.75rem` (12px)            | `1.4`       | 500    | body         | Labels, micro-copy.          |
| `text-mono-lg`    | `1.125rem` (18px)           | `1.4`       | 500    | mono         | Stat numbers (large).        |
| `text-mono`       | `0.875rem` (14px)           | `1.4`       | 500    | mono         | Standard stat / code.        |
| `text-mono-sm`    | `0.75rem` (12px)            | `1.3`       | 500    | mono         | Small stat / tag.            |
| `text-eyebrow`    | `0.75rem` (12px)            | `1.0`       | 600    | display      | UPPERCASE, +2px tracking, gold. |

---

## Letter-spacing rules

| Style                  | letter-spacing     | When                                         |
|------------------------|--------------------|----------------------------------------------|
| Hero wordmark          | `0.16em`           | "KARAZ LISTS" landing.                        |
| Display h1–h2          | `0.02em` ("tight") | Page titles.                                  |
| Eyebrow / overline     | `0.18em` ("wide")  | All-caps section labels.                      |
| Body                   | `0`                | Default. Inter is tuned for 0.                |
| Mono                   | `0`                | JetBrains Mono is tuned for 0.                |
| Buttons                | `0.03em`           | Slightly looser than body — improves clickability perception. |

---

## Drop-caps (illuminated initials)

Reserved for **one place per page maximum**, typically the opening paragraph
of a long-form section (About, Rules, Tournament-detail description).

```tsx
<p className="dropcap">
  Every list is forged in iron, recorded in stone, and tested at the toll of
  the first bell. The marshals of Karaz Ankor remember every triumph and
  every fall.
</p>
```

```css
/* in app.css */
.dropcap::first-letter {
  font-family: var(--font-script);
  font-size: 4.5em;
  float: left;
  line-height: 0.85;
  margin-right: 0.12em;
  margin-top: 0.05em;
  color: var(--color-karaz-gold-400);
  text-shadow: 0 0 12px rgba(212, 160, 23, 0.3);
}
```

A `.dropcap-stone` variant uses `var(--color-karaz-stone-100)` instead of gold,
for less-ceremonial passages.

---

## Ligatures & OpenType features

Enable in `body` once:

```css
body {
  font-feature-settings:
    "ss01",  /* alternate single-storey 'a' in Inter */
    "ss02",  /* alternate '6'/'9' in Inter */
    "cv11",  /* alternate 'l' in Inter */
    "calt",  /* contextual alternates — programming ligatures in JetBrains Mono */
    "liga"   /* standard ligatures */
  ;
  font-variant-numeric: tabular-nums; /* aligned stat columns by default */
}
```

For Cinzel, ligatures are baked into the font and need no extra activation.

---

## Tabular numbers

The Roll of Honour, ELO columns, dates, and any stat table **must** render in
tabular figures so columns align. Two approaches:

1. **Global default** (above): `font-variant-numeric: tabular-nums` on body.
2. **Per-element override** if you want proportional figures somewhere:
   `font-variant-numeric: proportional-nums`.

---

## Hierarchy in practice

A landing section composed of all type roles, in correct order:

```
[eyebrow]     UPPERCASE GOLD LABEL          <- text-eyebrow
[hero]        Section Title                 <- text-display-2 (or hero on landing)
[body-lg]     Lead paragraph for the hook   <- text-body-lg, stone-200
[body]        Supporting body copy          <- text-body, stone-300
[mono]        1,247 marshals enlisted        <- text-mono, stone-400
[button]      Take Up Arms                  <- button-text, button variant=forge
```

---

## Text color × type role × situation

| Type role        | Default color (Tailwind utility)  | Inverted on bg          |
|------------------|------------------------------------|-------------------------|
| Hero wordmark    | `text-karaz-gold-300/90`           | n/a                     |
| Display headings | `text-karaz-stone-100`             | `text-karaz-iron-950`   |
| Eyebrow          | `text-karaz-gold-500`              | n/a                     |
| Body (lead)      | `text-karaz-stone-200`             | `text-karaz-iron-800`   |
| Body (default)   | `text-karaz-stone-300`             | `text-karaz-iron-700`   |
| Body (muted)     | `text-karaz-stone-400`             | n/a                     |
| Mono (stat)      | `text-karaz-stone-100`             | n/a                     |
| Mono (label)     | `text-karaz-stone-400`             | n/a                     |
| Caption          | `text-karaz-stone-400`             | n/a                     |
| Drop-cap         | `text-karaz-gold-400`              | n/a                     |

---

## Anti-patterns

- ❌ Don't use Cinzel for body copy. It is all-caps in spirit and exhausting at
  paragraph length.
- ❌ Don't mix more than two type families on a single screen (display + body,
  mono if stats are present). Script (IM Fell English) is a third only via
  drop-cap.
- ❌ Don't use italic Cinzel. It does not exist gracefully.
- ❌ Don't apply `text-transform: uppercase` to Cinzel — it is already all-caps.
  Doubling up costs nothing but adds visual noise.
- ❌ Don't use weights below 400 anywhere on dark backgrounds. Inter Thin
  becomes invisible on `karaz-iron-950`.
- ❌ Don't justify text. Karaz Lists is left-aligned. Justification creates
  rivers on narrow columns and offends our deliberate aesthetic.
- ❌ Don't use Cinzel Decorative outside the hero section. It is dessert.

## Related

- [03-tokens.md](./03-tokens.md) — font tokens listed here
- [05-color-system.md](./05-color-system.md) — text color × bg contrast pairs
- [11-accessibility.md](./11-accessibility.md) — minimum body size 16px on mobile
- [14-implementation.md](./14-implementation.md) — exact `@theme` and font-loading code
