# 07 — Imagery & Photography

The visual identity of Karaz Lists is carried as much by photography as by
type and color. The 5 inspiration images in
`C:/Users/Luke/Pictures/TWW Inspo/` define a single, repeatable look. Every
photo and texture in the product must descend from that look.

## The Visual North Star (recap)

Two reference compositions describe everything we shoot or generate:

1. **The Armor in the Wildflowers** — engraved plate-mail with golden-hour
   rim-light, soft out-of-focus meadow, no face visible, brutal beauty
   compressed into one frame.
2. **The Sigil in the Stone** — anthracite stone tablet, single carved emblem,
   cold-gold highlights, Latin banner ribbon, perfect symmetry.

If a candidate image does not visually descend from one of these, it does not
ship.

---

## Photo DNA — the recipe

Every cinematic photo on the site, whether AI-generated or photographer-shot,
should pass this test. Eight checkpoints:

| #  | Trait                       | Spec                                                                            |
|----|-----------------------------|---------------------------------------------------------------------------------|
| 1  | **Light direction**         | Low angle, warm — golden hour (15° before sunset) or torchlight rim.            |
| 2  | **Color temperature**       | Warm, ~3200–4000K. Cool shadows allowed but never blue-cast.                    |
| 3  | **Saturation**              | Desaturated. Color exists where the light *catches*, not as a base coat.        |
| 4  | **Contrast**                | High — deep shadows that swallow detail. Mid-tones suppressed.                  |
| 5  | **Depth of field**          | Shallow. Subject sharp, foreground/background bokeh-soft.                       |
| 6  | **Subject framing**         | Off-center if possible (rule of thirds). Faces avoided or obscured (helmet/hood).|
| 7  | **Grain**                   | Subtle film grain present (5–10% intensity). Never plastic-clean.               |
| 8  | **Aspect ratio**            | Hero photos 21:9 or 16:9. Cards 3:2. Sigil 1:1. Banner template 3:4.            |

A photo failing 2+ checkpoints is rejected and reshoot/regenerated.

---

## Composition rules

### Hero sections

- **Full-bleed**, edge to edge. Photo is the canvas; text overlays it.
- **Dark gradient overlay** at the bottom (vignette + 0–60% black ramp) so
  text is legible without darkening the whole image.
- **Subject occupies one of the rule-of-thirds intersection points** — leaves
  the diagonal opposite for headline text.
- **Negative space is non-negotiable** — never crop the subject into a busy
  full-frame composition. Karaz Lists breathes.

### Card thumbnails (tournament cards, faction cards)

- **Crop tight on a single subject** — one banner, one helm, one symbol.
- **No people** unless faceless (helm-down).
- **Single dominant warm spot** of light. The rest of the card breathes anthracite.

### Section dividers / decorative bg

- **Texture-only**, no recognizable subjects.
- **Tileable seamless** for repeating bg patterns (see Texture Library below).
- **Always at <40% opacity** when used behind text. Texture is wallpaper, not
  feature.

---

## Texture Library

Six textures form the material vocabulary. They appear behind cards, behind
sections, behind decorative panels — never as the dominant subject.

| ID                | What                                       | Source         | Where used                                    |
|-------------------|--------------------------------------------|----------------|-----------------------------------------------|
| `stone-wall`      | Hand-chiseled granite, weathered.          | AI-gen (Gemini)| Page bg overlay (4–6% opacity).               |
| `bronze-plate`    | Burnished bronze with etched filigree.     | AI-gen         | Banner-card bg (12% opacity).                 |
| `parchment-aged`  | Aged paper, slight creasing, warm tone.    | AI-gen         | Drop-cap bg, rare highlight panels.           |
| `forge-embers`    | Glowing coal/ember texture.                | AI-gen         | Forge-CTA hover bg (20% opacity, animated).   |
| `leather-worn`    | Dark cracked leather.                      | AI-gen         | Premium / patron tier card bg.                |
| `chainmail-fine`  | Fine chainmail rings.                      | AI-gen         | Subtle pattern under stat tables.             |

All textures are generated 2048×2048 seamlessly tileable PNG (no transparency
unless explicitly needed) and saved under
`apps/frontend/public/textures/`.

Generation prompts for each are in
[13-asset-generation.md](./13-asset-generation.md).

---

## Photo treatment in CSS (overlay recipe)

For an AI-generated photo that needs to be slotted into the site, apply this
overlay stack to lock it into the look:

```css
.karaz-photo-frame {
  position: relative;
  overflow: hidden;
}

.karaz-photo-frame::before {
  /* warm grading + slight desat */
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    135deg,
    rgba(216, 99, 42, 0.06) 0%,
    transparent 40%,
    rgba(8, 7, 10, 0.20) 100%
  );
  mix-blend-mode: multiply;
  pointer-events: none;
}

.karaz-photo-frame::after {
  /* bottom-up gradient for text legibility */
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    transparent 0%,
    transparent 45%,
    rgba(17, 15, 14, 0.6) 80%,
    rgba(17, 15, 14, 0.92) 100%
  );
  pointer-events: none;
}

.karaz-photo-frame img {
  filter: saturate(0.85) contrast(1.05);
  width: 100%;
  height: 100%;
  object-fit: cover;
}
```

---

## Hero-photo asset checklist

Before a hero photo ships:

- [ ] Aspect 21:9 (or 16:9 if 21:9 not available).
- [ ] Resolution minimum 3000px wide for hero use (retina + scale).
- [ ] Two formats delivered: AVIF (primary) + WebP (fallback). No raw JPG/PNG
      for hero use.
- [ ] LCP-optimized: preloaded in `<head>`, served with
      `loading="eager"` and `fetchpriority="high"`.
- [ ] Subject crop survives mobile center-crop (subject is near horizontal center).
- [ ] DNA-checklist passes 8/8.
- [ ] Alt text written (functional, not poetic — describes what is in the
      frame for screen readers).
- [ ] Photo overlay applied per the recipe above.

---

## Performance budget for imagery

- Hero photo (above-fold): ≤200KB AVIF, ≤350KB WebP fallback.
- Card thumbnail: ≤40KB AVIF.
- Texture (full-resolution): ≤120KB AVIF for 2048×2048. Use tiled-small at
  512×512 for non-hero contexts.
- All photos served via `<picture>` with explicit `width` and `height` to
  prevent layout shift.

---

## Sourcing

| Type            | How                                                                              |
|-----------------|----------------------------------------------------------------------------------|
| Hero photos     | AI-generated via Gemini / ChatGPT with the prompt library in 13-asset-generation.md, then run through the photo overlay recipe above. |
| Sigil / logo    | AI-generated raster from Gemini, then traced to clean SVG in Illustrator/Figma.  |
| Textures        | AI-generated, seamless-tile post-process (Photoshop "Offset" filter to verify).  |
| Faction icons   | Already in `public/icons/factions/` — leave alone.                               |
| User uploads (avatars) | Sanitize, square-crop, gold-rim circle frame, no other treatment.       |

---

## Anti-patterns

- ❌ Stock photography of generic gaming/esports settings (RGB-lit desks,
  headphones, blurry monitors). Reject on sight.
- ❌ Bright daylight photography. Always low-light, warm-light.
- ❌ Modern miniatures photography with table-top context (rulers, dice, etc.).
  Karaz Lists is *about* miniatures but its visual brand is the world inside the lore,
  not the table where they are played.
- ❌ Faces. The single exception is user-uploaded avatars, which are framed
  small (32px) and inside a gold-rim circle.
- ❌ Cropping that destroys the rule-of-thirds for the sake of fitting a
  container. If the frame doesn't fit, regenerate the photo.
- ❌ Saturation boost. We never make photos pop. They are restrained.

## Related

- [05-color-system.md](./05-color-system.md) — gradient stops used in overlay
- [12-hero-anatomy.md](./12-hero-anatomy.md) — hero photo placement
- [13-asset-generation.md](./13-asset-generation.md) — AI prompts for every asset above
