# 13 — Asset Generation (AI Prompt Library)

Karaz Lists uses AI image generation (Gemini, ChatGPT-Image, optionally
Midjourney) for hero photography, sigils, textures, and decorative banners.
This file is the **prompt library** — paste-ready, style-locked, ratio-tagged.

Every asset generated for the site must use one of these prompts (or a
clearly-derived variant). Consistency comes from the prompt grammar, not
from luck.

## The shared style preamble

Every prompt prepends the same style preamble. Treat this like a system
prompt — it locks the aesthetic.

> *"In the visual style of FromSoftware promo material (Elden Ring, Bloodborne,
> Dark Souls): cinematic, restrained, photoreal. Color palette: anthracite,
> stone-grey, warm gold rim-light, deep shadows, deliberately desaturated.
> Lighting: golden hour or torchlight from below. Subtle film grain.
> Compositionally clean, rule-of-thirds, negative space respected.
> No bright fantasy, no cartoon, no CGI sheen, no anime, no glitter, no neon."*

Treat this as a `--preamble` for every prompt below. Paste it before each
request unless the tool supports persistent style memory.

---

## 1. Hero photography

### 1a. Hero photo — Cinematic Knight in Wildflowers (21:9)

**Use**: Landing-page hero section.

**Prompt**:
> [shared preamble] **Cinematic medieval portrait, full-plate engraved armor
> partially covered in soft wildflowers, golden hour rim light glinting off
> etched bronze details on the cuirass and pauldrons. Dark moody background
> blurred (shallow depth of field, 85mm anamorphic lens). Helmet visor down,
> no face visible. Subject occupies lower-right third of frame. Negative
> space upper-left. Warm desaturated grading, subtle film grain. 21:9
> ultrawide widescreen, photoreal, 4K.**

**Variants** (rotate seasonally):
- Replace "wildflowers" with "winter pine forest, light snowfall".
- Replace "wildflowers" with "low fog over moorland, dawn".
- Replace "engraved bronze" with "burnished steel with chainmail under" (less ornate).

### 1b. Hero photo — The Forge (3:4 portrait)

**Use**: Section 2 (The Forge) photo.

**Prompt**:
> [shared preamble] **Close-up of an iron anvil with a glowing forge in the
> background. Warm ember light from below illuminates the anvil surface.
> Hammer resting on anvil edge, slight smoke drift. Background is dark,
> blurred (shallow depth of field), with hints of stone wall and chains.
> Composition: anvil lower-left, ember glow upper-right. Photoreal, warm,
> deeply atmospheric. 3:4 portrait orientation.**

### 1c. Hero photo — Champion's Pose (16:9)

**Use**: Roll of Honour featured marshal page, tournament-winner card.

**Prompt**:
> [shared preamble] **Heroic medieval marshal silhouette atop a stone parapet
> at dawn. Banner pole behind, weathered fabric. Sword resting blade-down
> across thighs. No face visible (helmet or hood). Cool blue-grey distance,
> warm golden rim-light on figure. Restrained, contemplative — not aggressive.
> 16:9 widescreen.**

---

## 2. The Karaz Sigil

### 2a. Sigil mark (1:1, transparent)

**Use**: Brand mark, logo, favicon, every place the sigil appears.

**Prompt**:
> [shared preamble] **Heraldic emblem, single weathered Khazalid dwarf rune
> at center — abstract geometric shape with crossed strokes — carved into
> a rectangular stone tablet with rounded corners. Wreathed by iron filigree
> with subtle gothic engravings. Two crossed warhammers behind the tablet,
> visible above and below. Banner ribbon below the tablet inscribed
> 'KARAZ ANKOR' in Latin small-caps lettering. Monochrome anthracite tones
> with cold gold highlights only on the rune mark and inscription. Gothic
> engraving line-art style, vector-clean lines suitable for logo use,
> perfectly symmetric, transparent background. 1:1 square. No background.**

**Post-processing**:
- Raster the result → vector trace (Illustrator, Figma, or `svgo` + manual
  cleanup) → a clean SVG with strokes.
- Replace fills with `currentColor` so it inherits text color (see
  [06-iconography.md](./06-iconography.md)).
- Save at `apps/frontend/src/components/icons/KarazSigil.tsx` as inline JSX.

### 2b. Sigil wordmark (3:1, transparent)

**Use**: Header logo lockup, footer.

**Prompt**:
> [shared preamble] **Heraldic emblem on the left — small Khazalid rune
> carved into stone tablet wreathed in iron filigree — to the right of
> which appears the wordmark 'KARAZ LISTS' in Cinzel-style classical Roman
> serif caps, slightly distressed/weathered. Monochrome anthracite + cold
> gold. The wordmark sits horizontally aligned with the tablet. 3:1
> horizontal aspect ratio. Transparent background.**

### 2c. Sigil — etched ground variant

**Use**: Footer mini-sigil, faction-neutral decoration.

**Prompt**:
> [shared preamble] **The same Karaz Sigil, but rendered as if etched into
> aged bronze plate. Monochrome bronze tones, very subtle gold highlights,
> slight oxidation patina at edges. 1:1 square, transparent background.**

---

## 3. Textures (seamless 2K tiles)

All texture assets land in `apps/frontend/public/textures/` as 2048×2048
PNG (with seamless tiling verified in Photoshop using the Offset filter).

### 3a. Stone Wall

**Use**: Page background overlay at 4–6% opacity.

**Prompt**:
> [shared preamble] **Seamless tileable texture, hand-chiseled granite stone
> wall, weathered patina, subtle moss in cracks, warm umber and slate
> undertones, no recognizable subject. 2048×2048 px, edge-to-edge tileable,
> normal-map-ready flat lighting (no shadows that would break tiling),
> dark-fantasy material.**

### 3b. Burnished Bronze Plate

**Use**: Banner-card background at 12% opacity.

**Prompt**:
> [shared preamble] **Seamless tileable texture, polished bronze plate with
> hairline scratches and subtle etched gothic filigree lines, warm patina,
> slight oxidation at edges, 2048×2048 px tileable, no recognizable subject,
> flat lighting.**

### 3c. Aged Parchment

**Use**: Drop-cap backgrounds, ribbon details.

**Prompt**:
> [shared preamble] **Seamless tileable texture, aged parchment paper,
> slight creases and discoloration, warm cream-to-umber tones, no text,
> no markings, no border. 2048×2048 px tileable.**

### 3d. Forge Embers

**Use**: Forge CTA hover bg (animated via mask-position).

**Prompt**:
> [shared preamble] **Seamless tileable texture, glowing coal embers and
> blackened coke, warm orange and red glow against deep charred black,
> close-up macro view, 2048×2048 px tileable, no recognizable shape.**

### 3e. Worn Leather

**Use**: Premium / patron tier card background.

**Prompt**:
> [shared preamble] **Seamless tileable texture, dark worn leather, cracked
> with age, deep brown almost-black tones, slight oil sheen catching subtle
> highlights, 2048×2048 px tileable.**

### 3f. Fine Chainmail

**Use**: Stat-table underlay at 4% opacity.

**Prompt**:
> [shared preamble] **Seamless tileable texture, fine chainmail rings, dark
> steel with slight oil patina, viewed flat from above, 2048×2048 px
> tileable, even lighting, no shadows.**

---

## 4. Faction Banner Template (3:4)

A generic banner template that gets composited with each faction's icon to
produce per-faction decorative banners.

**Prompt**:
> [shared preamble] **Heraldic vertical banner, weathered fabric with frayed
> bottom edge, gothic engraving border, central oval cartouche reserved as
> empty space for emblem placement (transparent or solid color placeholder),
> hanging from a horizontal beam at top, lit from a low angle by torchlight,
> anthracite and gold thread color palette, photorealistic. 3:4 portrait
> aspect ratio. The cartouche must be perfectly centered and empty for
> overlay.**

The faction icon is then overlaid programmatically (`<img>` over the banner)
with `mix-blend-mode: multiply` and color-tinted to match faction colors at
~40% opacity to keep the banner's anthracite identity dominant.

---

## 5. Open Graph image (1200×630)

**Use**: `apps/frontend/public/og-image.png`. Shared link preview.

**Prompt**:
> [shared preamble] **OpenGraph social card composition, 1200×630 pixels.
> Background: tightly-cropped cinematic hero photo (knight in wildflowers,
> golden hour) at 40% brightness. Centered foreground: Karaz Sigil
> emblem (anthracite + gold filigree, ~280px tall). Below the sigil:
> wordmark 'KARAZ LISTS' in Cinzel-style Roman serif caps, gold (#D4A017),
> letter-spaced wide. Below the wordmark: small italic line
> 'Where Lists Are Forged' in stone-cream. Composition centered,
> well-padded. No URL, no decorative borders. 1200×630.**

---

## 6. Empty-state illustrations (optional)

Subtle, single-element illustrations for major empty states. **Optional** —
text-only empty states with a stone-grey Lucide icon are also fine.

### 6a. Empty Roll of Honour

**Prompt**:
> [shared preamble] **A blank stone tablet, oval, set into an iron frame,
> hanging on a chain. The surface is smooth and unmarked. Soft golden
> ambient light from one side. Negative space surrounding. 4:3 aspect.**

### 6b. Empty Active Musters

**Prompt**:
> [shared preamble] **A folded heraldic banner resting against a stone
> column, dim torchlight from above. The cartouche on the banner is empty.
> Negative space, contemplative. 4:3 aspect.**

---

## 7. Generation workflow

### Recommended order

1. Generate the **Sigil mark** (2a). Most important — everything else
   references it visually. Iterate until perfect.
2. Generate the **Hero photo** (1a). Pair it with the sigil in a mockup
   composition to verify the color story works.
3. Generate the **six textures** (3a–3f) in one batch.
4. Generate the **Forge photo** (1b).
5. Generate the **OG image** (5).
6. Optional: empty-state illustrations (6).

### Per-asset checklist before commit

- [ ] Asset matches the brand-style preamble (anthracite + gold, no neon,
      no cartoon, no faces).
- [ ] Aspect ratio matches the spec.
- [ ] File optimized: AVIF + WebP for photos, optimized SVG for sigil,
      PNG for textures.
- [ ] Filename matches site convention:
      `apps/frontend/public/img/hero-knight.{avif,webp}`,
      `apps/frontend/public/textures/stone-wall.png`, etc.
- [ ] Cinema-grain post-pass applied if AI output is too "plastic clean".
- [ ] Spot-checked at 100% and at thumbnail resolution.

### File layout (final)

```
apps/frontend/public/
├── favicon.svg
├── og-image.png
├── img/
│   ├── hero-knight.avif       (21:9)
│   ├── hero-knight.webp
│   ├── forge-anvil.avif       (3:4)
│   ├── forge-anvil.webp
│   ├── champion-silhouette.avif  (16:9)
│   └── champion-silhouette.webp
├── textures/
│   ├── stone-wall.png
│   ├── bronze-plate.png
│   ├── parchment-aged.png
│   ├── forge-embers.png
│   ├── leather-worn.png
│   └── chainmail-fine.png
└── icons/factions/   ← already exists, untouched
```

The Karaz Sigil lives in `apps/frontend/src/components/icons/KarazSigil.tsx`
as inline JSX, not in `public/`.

---

## Iteration discipline

AI image generation is iterative. Two rules to keep us from drift:

1. **One iterator commits the asset.** Multiple people regenerating leads to
   inconsistent aesthetic. Pick one person per asset.
2. **Pin the prompt.** When an asset lands, store the *exact* prompt that
   produced it as a comment in this file. Future regenerations start from
   that.

```md
<!-- Hero photo current generation prompt (last updated 2026-05-13):
[shared preamble] Cinematic medieval portrait, …
-->
```

## Related

- [01-brand.md](./01-brand.md) — what the assets are *for*
- [07-imagery.md](./07-imagery.md) — DNA checklist every asset must pass
- [12-hero-anatomy.md](./12-hero-anatomy.md) — where assets are used
- [06-iconography.md](./06-iconography.md) — the Karaz Sigil component contract
