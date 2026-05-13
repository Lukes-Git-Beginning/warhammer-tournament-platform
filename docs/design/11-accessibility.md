# 11 — Accessibility

Karaz Lists is dark, dense, and ceremonial — and **fully usable** by anyone
who shows up to it. Aesthetic is not an excuse. Accessibility is not a
checklist we satisfy; it is part of "feeling forged" — *Forged things work*.

We target **WCAG 2.1 AA** as a floor, AAA where reasonable. Every UI ships
through this audit.

---

## Contrast

### Body text (≥ 4.5 : 1)

| Pair                                 | Ratio    | Status |
|--------------------------------------|----------|--------|
| `stone-200` on `iron-950`            | 11.3:1   | ✅ AAA |
| `stone-200` on `iron-900`            | 9.8:1    | ✅ AAA |
| `stone-300` on `iron-950`            | 7.5:1    | ✅ AAA |
| `stone-300` on `iron-900`            | 6.5:1    | ✅ AA (large+) |
| `stone-400` on `iron-950`            | 4.9:1    | ✅ AA  |
| `stone-400` on `iron-900`            | 4.2:1    | ⚠️ AA-Large only — see below |

**Rule**: `karaz-stone-400` (muted text) is only used at **font-size ≥ 14px
font-weight 400+** on `iron-900` surfaces. On `iron-950` (page bg), it
passes AA freely.

### Large text (≥ 3 : 1)

Display headings (Cinzel ≥ 24px / ≥ 18px bold) are treated as "large" by
WCAG and need 3:1 minimum. All of our `karaz-gold-300` / `karaz-gold-400` /
`karaz-stone-100` headings pass with margin.

### Interactive elements (≥ 3 : 1 against adjacent colors)

- Default border `karaz-iron-600` against `iron-900` bg: 2.0:1 — fails 3:1.
  This is intentional for *resting* borders (subtle frame). On **hover** /
  **focus**, the border becomes `karaz-iron-500` or `karaz-gold-500`, both
  passing.
- Focus state always passes — `karaz-gold-500` ring on `iron-950` = 7.6:1.

---

## Focus

### The focus ring spec

```css
.focusable:focus-visible {
  outline: 2px solid var(--color-karaz-gold-500);
  outline-offset: 2px;
  /* and/or */
  box-shadow: 0 0 0 2px var(--color-karaz-iron-950), 0 0 0 4px var(--color-karaz-gold-500);
}
```

A **2px solid gold** ring with 2px offset is the universal focus indicator.
For elements over `iron-950`, use the box-shadow recipe (inner offset
matches background) to keep the ring crisp.

Never use `outline: none` without immediately providing a custom focus style.
The shadcn base components already do this — keep it.

### Focus order

Tab order follows DOM order. No `tabindex` overrides except `tabindex="-1"`
on programmatically-focused containers (e.g. modal content after open).

Skip-to-content link at the top of every page (visible on focus):

```tsx
<a
  href="#main-content"
  className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-karaz-gold-400 focus:text-karaz-iron-950 focus:font-semibold"
>
  Skip to content
</a>
```

---

## Tap targets

Minimum **44 × 44 px** for any pointer-clickable element on mobile. This is
WCAG 2.5.5 (Target Size, AAA — but we aim for it).

Our button `sm` size is 36px high *but* horizontally generous; on mobile
**use `md` (44px) or larger** for primary actions. `sm` buttons stay desktop-
only inside dense tables.

Icon-only buttons get explicit `min-w-11 min-h-11` even when the icon is
smaller.

---

## Keyboard navigation

| Component        | Keyboard behavior                                          |
|------------------|------------------------------------------------------------|
| Button           | `Enter` / `Space` activates.                              |
| Input            | Standard.                                                  |
| Checkbox / Switch| `Space` toggles.                                          |
| Radio group      | Arrow keys cycle, `Space` selects.                        |
| Dropdown menu    | `Enter` opens, arrows navigate, `Esc` closes.             |
| Modal            | `Esc` closes, focus trapped inside, focus returns on close.|
| Tabs             | Arrow keys cycle between tab triggers; auto-activates panel. |
| Tooltip          | Appears on `focus`, dismisses on `Esc` or blur.           |
| Sheet (drawer)   | `Esc` closes; focus traps similar to modal.               |

Radix primitives (under shadcn) handle all of this correctly by default —
don't break it with custom keyhandlers unless necessary.

---

## Screen readers

### Decorative vs functional

- Decorative icons (e.g. an inline checkmark next to a label that already says
  "Confirmed"): `aria-hidden="true"`.
- Functional icons (icon-only buttons): provide `aria-label`. Example:
  ```tsx
  <button aria-label="Dismiss notification">
    <X aria-hidden="true" className="size-4" />
  </button>
  ```
- The Karaz Sigil in the header should have `role="img" aria-label="Karaz
  Lists"`.

### Latin / Khazalid mottos

These are decorative and *should not* be announced. Wrap them or set
`aria-hidden`:

```tsx
<p aria-hidden="true" lang="la" className="font-display text-eyebrow">
  Karaz Ankor
</p>
```

If the motto serves any informational purpose (e.g. as a section label),
provide an English `title=""` attribute and let the motto remain audible:

```tsx
<h2 title="Roll of Honour — Sealed in stone" lang="la">In Lapide Sigillata</h2>
```

### Loading / Live regions

- Loading spinners on data fetches: `aria-busy="true"` on the container.
- Toasts (Sonner): the library handles `aria-live="polite"` automatically.
- Live tournament updates: `aria-live="polite"` on the bracket region;
  changes are announced.

### Headings

One `<h1>` per page. Section headings descend semantically (`<h2>` for
sections, `<h3>` for sub-sections). Visual scale and heading level are
**independent** — a large display number can be `<span class="text-display-2">`
without being a heading.

---

## Color independence

No information conveys via color alone.

- Status badges always include a text label *and* (optionally) an icon, in
  addition to color: `🟢 LIVE` becomes `[●] LIVE` where `[●]` is the dot and
  "LIVE" is the text.
- Form validation: red border + error icon + error text. Not just the red
  border.
- Tournament status: "Live", "Upcoming", "Completed" — text always present.

---

## Reduced motion

All animations respect `prefers-reduced-motion: reduce` — see
[09-motion.md](./09-motion.md). The base CSS rule:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Programmatic animations (motion library, View Transitions) check
`useReducedMotion()` or `matchMedia()` and degrade.

The hero sigil reveal: with reduced motion, the sigil is shown statically;
no draw animation.

---

## Forms

- Every `<input>` has a `<label>` (visible or `sr-only`).
- Required fields marked with `aria-required="true"` and a visible `*`
  in `gold-400`.
- Errors associated via `aria-describedby="<id>-error"`.
- Submit buttons disabled while submitting, with `aria-busy="true"` *and*
  visible spinner — never *only* disabled (looks broken).

---

## Language tags

The site is German-first for body copy and English for ceremonial labels.
Multi-language elements need `lang` attributes:

```tsx
<html lang="de">
  …
  <h1 lang="la">Karaz Ankor</h1>
  <p>Diese Plattform veranstaltet Turniere…</p>
</html>
```

Screen readers switch voices per language.

---

## Audit checklist (per PR touching UI)

- [ ] All text passes 4.5:1 against its background.
- [ ] All interactive elements have a visible focus-visible style.
- [ ] All icon-only buttons have `aria-label`.
- [ ] All decorative icons have `aria-hidden`.
- [ ] All inputs have associated labels.
- [ ] Keyboard nav works: Tab order is logical, focus is trapped in modals,
      Esc closes overlays.
- [ ] `prefers-reduced-motion` respected for any new animations.
- [ ] Color is not the sole indicator of state.
- [ ] One `<h1>` per page.
- [ ] Mobile tap targets ≥ 44×44px.

---

## Tooling

- **axe DevTools** (browser extension) — run on every page during development.
- **Lighthouse Accessibility audit** — target score ≥ 95 on every page.
- **Manual keyboard sweep** — Tab through the page; everything must be
  reachable.
- **Screen reader spot-check** — once per release, run NVDA (Windows) or
  VoiceOver (macOS) through the landing page and the tournament detail.

## Related

- [05-color-system.md](./05-color-system.md) — full contrast pairs
- [08-components.md](./08-components.md) — Radix primitives handle most a11y
- [09-motion.md](./09-motion.md) — reduced-motion strategy
