# 08 — Components

Karaz Lists builds its UI on **shadcn/ui** — Radix-UI primitives wrapped in
copy-into-your-project React components, styled with Tailwind. We layer a
**Karaz theme** on top: a small set of CVA variants that translate the
component into our visual language.

This file documents:
1. Which shadcn primitives we install,
2. What Karaz variants each component gets,
3. State recipes (rest / hover / focus / disabled / loading),
4. Composition patterns (the "banner card", the "engraved input", etc.).

The exact migration / install steps are in
[14-implementation.md](./14-implementation.md). This file is the **spec**.

---

## Installed primitives (initial)

| shadcn name      | Karaz role                              | Source                          |
|------------------|-----------------------------------------|---------------------------------|
| `button`         | All button affordances                  | `pnpm dlx shadcn add button`    |
| `card`           | Content containers, banner cards        | `pnpm dlx shadcn add card`      |
| `input`          | Text, email, number inputs              | `pnpm dlx shadcn add input`     |
| `label`          | Form labels                             | `pnpm dlx shadcn add label`     |
| `textarea`       | Multi-line input                        | `pnpm dlx shadcn add textarea`  |
| `select`         | Native-feel select with Radix           | `pnpm dlx shadcn add select`    |
| `checkbox`       | Confirmation toggle                     | `pnpm dlx shadcn add checkbox`  |
| `switch`         | Settings on/off                         | `pnpm dlx shadcn add switch`    |
| `radio-group`    | Mutually exclusive choice               | `pnpm dlx shadcn add radio-group` |
| `dialog`         | Modal                                   | `pnpm dlx shadcn add dialog`    |
| `sheet`          | Side drawer (mobile nav, filters)       | `pnpm dlx shadcn add sheet`     |
| `dropdown-menu`  | Action menus, user menu                 | `pnpm dlx shadcn add dropdown-menu` |
| `tooltip`        | Hover helper                            | `pnpm dlx shadcn add tooltip`   |
| `tabs`           | Tabbed sections                         | `pnpm dlx shadcn add tabs`      |
| `badge`          | Status pills, ranks                     | `pnpm dlx shadcn add badge`     |
| `separator`      | Engraved-seam divider                   | `pnpm dlx shadcn add separator` |
| `sonner`         | Toast notifications                     | `pnpm dlx shadcn add sonner`    |
| `skeleton`       | Loading placeholder                     | `pnpm dlx shadcn add skeleton`  |
| `scroll-area`    | Custom-scrollbar regions                | `pnpm dlx shadcn add scroll-area` |
| `avatar`         | User avatars with gold rim              | `pnpm dlx shadcn add avatar`    |

---

## Button — the most important component

### Variants

Four Karaz variants. The shadcn `button.tsx` is rewritten to use these.

```tsx
// apps/frontend/src/components/ui/button.tsx
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  // base
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-display font-semibold tracking-wider uppercase ring-offset-karaz-iron-950 transition-[transform,background,box-shadow,color] duration-base ease-burn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-karaz-gold-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        forge:
          'bg-karaz-gold-400 text-karaz-iron-950 shadow-karaz-emboss hover:bg-karaz-gold-500 hover:shadow-karaz-forge-glow hover:-translate-y-px active:translate-y-0 active:bg-karaz-gold-600',
        iron:
          'bg-karaz-iron-800 text-karaz-stone-100 border border-karaz-iron-600 shadow-karaz-emboss hover:bg-karaz-iron-700 hover:border-karaz-iron-500 hover:text-karaz-gold-300 active:bg-karaz-iron-800',
        etched:
          'bg-transparent text-karaz-stone-300 border border-karaz-iron-700 hover:border-karaz-gold-500 hover:text-karaz-gold-400 active:bg-karaz-iron-900',
        banner:
          'bg-karaz-forge-500 text-karaz-iron-950 shadow-karaz-banner hover:bg-karaz-forge-400 active:bg-karaz-forge-600',
        ghost:
          'bg-transparent text-karaz-stone-300 hover:bg-karaz-iron-800 hover:text-karaz-stone-100',
        danger:
          'bg-karaz-blood-500 text-karaz-stone-100 hover:bg-karaz-blood-600',
      },
      size: {
        sm: 'h-9 px-4 text-[12px] rounded-sm',
        md: 'h-11 px-6 text-[13px] rounded-md',
        lg: 'h-14 px-10 text-[14px] rounded-md',
      },
    },
    defaultVariants: { variant: 'iron', size: 'md' },
  },
);
```

### Variant guide

| Variant    | Visual                                                              | Use                                                          |
|------------|---------------------------------------------------------------------|--------------------------------------------------------------|
| `forge`    | Gold fill, dark text, gold glow on hover.                           | **Primary CTA per viewport.** "Take Up Arms", "Forge the List". |
| `iron`     | Iron fill, light text, border lift on hover.                        | **Default.** Secondary actions, navigation buttons.          |
| `etched`   | Transparent, ghost border, gold tint on hover.                      | Tertiary, low-emphasis. "Cancel", "Step back".               |
| `banner`   | Forge-orange fill, heavy shadow.                                    | Heat / live-state CTAs. "Join Live Draft", "Spectate Now".   |
| `ghost`    | No bg, no border. Pure label.                                        | Inline links inside dense rows.                              |
| `danger`   | Blood-red fill.                                                      | Destructive confirms. "Yield", "Disband".                    |

### Sizes

| Size | Height | Use                                |
|------|--------|------------------------------------|
| `sm` | 36px   | Inline-row actions, table buttons. |
| `md` | 44px   | **Default.** Forms, modals, nav.  |
| `lg` | 56px   | Hero CTA, landing-page primary.    |

### Hover-press translate

All non-ghost variants lift 1px on hover (`-translate-y-px`) and return on
active. This is the "engraved plate getting pressed" micro-feel — small,
satisfying, and disabled when the user has `prefers-reduced-motion: reduce`.

---

## Card

### Variants

| Variant      | Visual                                                                 | Use                                                  |
|--------------|------------------------------------------------------------------------|------------------------------------------------------|
| `stone`      | `karaz-iron-900` bg, `karaz-iron-600` border, `radius-lg`.            | **Default.** Tournament cards, content panels.       |
| `banner`     | Bronze-plate texture bg at 12% opacity over `iron-900`, banner shadow. | Heraldic featured cards (active musters, champions). |
| `parchment`  | `parchment-aged` texture bg at 18% opacity. Drop-shadow.               | Drop-cap intros, rules pages, archive entries.       |
| `forge`      | Radial forge-embers gradient bg. Glowing edge.                         | Live-state callouts (used sparingly).                |

### Anatomy

```
┌─ Card[variant=banner] ──────────────────────────┐
│  [Crest 32×32]   EYEBROW LABEL                  │  ← gap-3
│                                                  │
│  Card Title (display-3)                         │
│                                                  │
│  Supporting copy (body-sm, stone-300)           │
│                                                  │
│  ────── engraved separator ──────               │
│                                                  │
│  Footer: [stat-mono] · [action-link]            │
└──────────────────────────────────────────────────┘
```

### State

- **Hover**: `iron-900` → `iron-800`, border `iron-600` → `iron-500`, gentle
  lift `-translate-y-0.5`, shadow strengthens to `shadow-karaz-banner`.
- **Active/pressed** (clickable cards): no lift, no shadow. Returns to rest.
- **Loading**: replace inner content with `Skeleton` blocks; keep card frame.

---

## Input / Textarea (engraved style)

### Visual

Inputs feel **recessed**, like text carved into bronze. Inset shadow, sharp
2px radius, dark fill.

```tsx
className={cn(
  'flex h-11 w-full rounded-sm border border-karaz-iron-700 bg-karaz-iron-900 px-3 py-2 text-sm text-karaz-stone-100 placeholder:text-karaz-stone-400',
  'shadow-karaz-engrave',
  'focus-visible:outline-none focus-visible:border-karaz-gold-500 focus-visible:shadow-karaz-gold-glow',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'transition-[border-color,box-shadow] duration-fast ease-burn',
)}
```

### Label / helper / error

```
LABEL (text-eyebrow, gold-500)
[ INPUT FIELD                              ]
Helper text in stone-400, text-caption.       (error state: blood-500)
```

Always pair an `<input>` with a `<label>`. Required indicator is `*` in
`gold-400`, not a red asterisk.

---

## Badge

Used for rank pills, faction chips, live-state pills.

| Variant     | Visual                                            | Use                                  |
|-------------|---------------------------------------------------|--------------------------------------|
| `default`   | `iron-800` bg, `stone-200` text, `iron-600` border.| Neutral tag.                         |
| `gold`      | `gold-500/15` bg, `gold-400` text, `gold-500/30` border. | Champion, achievement.        |
| `forge`     | `forge-500/20` bg, `forge-400` text.              | **Live state.** Animated pulse.       |
| `blood`     | `blood-500/15` bg, `blood-500` text.              | Fallen, eliminated.                  |
| `bronze`    | `bronze/15` bg, `bronze` text.                    | Rank — runner up, third place.       |

`forge` badges may include a 4px pulsing dot:

```tsx
<Badge variant="forge">
  <span className="size-1.5 rounded-full bg-karaz-forge-400 animate-karaz-pulse" />
  LIVE
</Badge>
```

`animate-karaz-pulse` is defined in [09-motion.md](./09-motion.md).

---

## Avatar (gold-rim)

```tsx
<Avatar className="size-10 ring-2 ring-karaz-gold-500/40 ring-offset-2 ring-offset-karaz-iron-950">
  <AvatarImage src={user.avatar_url} alt={user.username} />
  <AvatarFallback className="bg-karaz-iron-800 text-karaz-gold-400">
    {user.username[0]}
  </AvatarFallback>
</Avatar>
```

Sizes: `size-8` (header), `size-10` (default), `size-14` (profile), `size-20` (hero profile).

---

## Dialog (modal)

- Overlay: `bg-karaz-obsidian/80 backdrop-blur-sm`.
- Content: `bg-karaz-iron-900 border border-karaz-iron-600 rounded-xl shadow-karaz-banner`.
- Header eyebrow + display-3 title.
- Footer right-aligns actions (etched, then forge).
- Close button (top-right) is `ghost`-variant icon-button with `X` icon.

---

## Sheet (drawer)

- Used for mobile nav, filter panels, draft pick details.
- Side: `right` for filters, `left` for nav, `bottom` for action sheets on
  mobile.
- Same color treatment as dialog. Slide duration `duration-medium` with `ease-burn`.

---

## Dropdown Menu

- Trigger: any button variant.
- Content: `bg-karaz-iron-900 border-karaz-iron-600 rounded-md shadow-karaz-banner`.
- Items: padded `px-3 py-2`, `text-stone-200`, hover `bg-karaz-iron-800 text-karaz-gold-400`.
- Separators: 1px `iron-700`.

---

## Sonner (toast)

- Default position: bottom-right desktop, top-center mobile.
- Toast background: `iron-900`, border-left 3px in semantic color (success
  green, warning gold, danger blood, info slate).
- Icon: Lucide `check-circle-2`, `triangle-alert`, `info`, `x-circle` —
  `size-5`, semantic color.
- Title: `text-body font-semibold`, `text-stone-100`.
- Description: `text-body-sm text-stone-300`.
- Duration: 4s default. 8s for errors.

---

## Separator (engraved seam)

```tsx
<Separator className="bg-transparent h-px" style={{
  backgroundImage:
    'linear-gradient(to right, transparent 0%, var(--color-karaz-iron-600) 10%, var(--color-karaz-bronze) 50%, var(--color-karaz-iron-600) 90%, transparent 100%)',
}} />
```

Use sparingly inside cards as section dividers. Default Tailwind border lines
are fine elsewhere.

---

## Tabs

- Tab list: `border-b border-karaz-iron-700`.
- Active tab: `text-karaz-gold-400 border-b-2 border-karaz-gold-500 -mb-px`.
- Inactive: `text-karaz-stone-400 hover:text-karaz-stone-200`.
- Padding: `px-4 py-3`.

---

## Composition patterns

### The Heraldic Banner Card

A featured tournament card. Used in "Active Musters" section.

```tsx
<Card variant="banner" className="group relative overflow-hidden">
  {/* hovering crest in top-right */}
  <KarazCrossHammers className="absolute -top-2 -right-2 size-20 text-karaz-iron-700 opacity-40 transition-opacity group-hover:opacity-60" />

  <CardHeader>
    <Badge variant="forge">
      <span className="size-1.5 rounded-full bg-karaz-forge-400 animate-karaz-pulse" /> LIVE
    </Badge>
    <CardTitle className="text-display-3 font-display">
      Karak Eight Peaks Open
    </CardTitle>
    <CardDescription className="text-body-sm text-karaz-stone-400">
      24 marshals · Swiss × 6 tolls
    </CardDescription>
  </CardHeader>

  <Separator className="my-4 h-px bg-transparent" style={{ /* engraved seam */ }} />

  <CardFooter className="flex items-center justify-between">
    <time className="font-mono text-mono-sm text-karaz-stone-400">
      Begins 2026-05-20 18:00 UTC
    </time>
    <Button variant="etched" size="sm">
      Answer the Call
    </Button>
  </CardFooter>
</Card>
```

### The Engraved Stat Row

A roll-of-honour row. Used in "Roll of Honour" section.

```tsx
<li className="grid grid-cols-[2rem_2.5rem_1fr_auto] items-center gap-4 px-4 py-3 hover:bg-karaz-iron-900 transition-colors">
  <span className="text-display-3 font-display text-karaz-bronze tabular-nums">
    III
  </span>
  <Avatar className="size-10 ring-2 ring-karaz-gold-500/40">…</Avatar>
  <span className="text-body font-medium text-karaz-stone-100">
    Brokk Stoneborn
  </span>
  <span className="font-mono text-mono text-karaz-gold-400 tabular-nums">
    1834
  </span>
</li>
```

---

## State matrix (for every component)

Every interactive component declares behavior for:

| State          | Visual cue                                          |
|----------------|-----------------------------------------------------|
| `rest`         | Default look.                                       |
| `hover`        | Color shift + 1px lift (where applicable).          |
| `focus-visible`| Gold glow ring (`shadow-karaz-gold-glow`).          |
| `active`       | Returns to baseline position, slight bg darken.     |
| `disabled`     | `opacity-50`, `cursor-not-allowed`, no hover.       |
| `loading`      | Skeleton swap-in, or inline spinner icon.           |
| `invalid` (form) | Border `blood-500`, helper text `blood-500`.      |

---

## Anti-patterns

- ❌ Don't introduce a new button variant inline. Add it to `buttonVariants`
  or use composition.
- ❌ Don't override `font-family` per component. Inherit from `body` / `display`
  utility classes.
- ❌ Don't use the default shadcn radius (`rounded-md` → 0.375rem). Karaz radii
  are sharper — defined in tokens.
- ❌ Don't apply `transition-all`. Be explicit
  (`transition-[transform,bg,color]`) for performance and intent.
- ❌ Don't use multiple primary (`forge`) buttons in the same viewport.

## Related

- [03-tokens.md](./03-tokens.md) — all referenced color/shadow tokens
- [02-voice.md](./02-voice.md) — button labels are scripted there
- [09-motion.md](./09-motion.md) — `animate-karaz-pulse` and other named animations
- [14-implementation.md](./14-implementation.md) — `cn()` helper, components.json, dependency install commands
