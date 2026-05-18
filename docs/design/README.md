# Rizzotto — Design System

> *"Where Lists Are Forged."*

This is the **single source of truth** for everything that touches the visual,
verbal, and interactive layer of Rizzotto. Sub-agents, designers, and future
contributors read these files before designing or building anything.

The system is intentionally **dark, heraldic, and uncompromising** — modeled on
the visual language of FromSoftware (Elden Ring, Bloodborne, Dark Souls), late
medieval European heraldry, and the engraved-armor cinematic photography found
in `C:/Users/Luke/Pictures/TWW Inspo/`. It is not "fantasy gaming UI". It is a
weathered, deliberate, beautifully brutal artifact.

---

## Mantra

> **Anthracite, with a single warm spark.**
> Nothing is bright. Nothing is cute. Everything is forged.

If a design decision violates that line, it loses.

---

## Read Order

Files are numbered. Read them in order on a first pass. Later, treat them as a
hub — jump to the file you need.

| #  | File                                                | Purpose                                       |
|----|-----------------------------------------------------|-----------------------------------------------|
| —  | [README.md](./README.md)                            | This file. Navigation + vision.               |
| 01 | [Brand](./01-brand.md)                              | Name, etymology, mission, personality.        |
| 02 | [Voice](./02-voice.md)                              | Tonality, lexicon, Latin/Khazalid mottos.     |
| 03 | [Tokens](./03-tokens.md)                            | Source of truth: every design token.          |
| 04 | [Typography](./04-typography.md)                    | Type stack, scale, drop-caps.                 |
| 05 | [Color System](./05-color-system.md)                | Palette, semantics, contrast, gradients.      |
| 06 | [Iconography](./06-iconography.md)                  | Lucide base + custom Karaz icons.             |
| 07 | [Imagery](./07-imagery.md)                          | Photo treatment, composition, texture rules.  |
| 08 | [Components](./08-components.md)                    | shadcn/ui + Karaz variants. Component specs.  |
| 09 | [Motion](./09-motion.md)                            | Easings, durations, interaction recipes.      |
| 10 | [Layout](./10-layout.md)                            | Grid, spacing, gothic-arcade rhythm.          |
| 11 | [Accessibility](./11-accessibility.md)              | Contrast, focus, reduced motion.              |
| 12 | [Hero Anatomy](./12-hero-anatomy.md)                | Landing-page composition, 7 sections.         |
| 13 | [Asset Generation](./13-asset-generation.md)        | Gemini / ChatGPT prompt library.              |
| 14 | [Implementation](./14-implementation.md)            | Exact `@theme` code, migration steps.         |

---

## When to use this guide

- **Before** adding any new screen, component, or copy.
- **Before** picking a color, font size, radius, or animation curve.
- **Before** generating any AI asset (photo, sigil, texture, banner).
- **After** a change to tokens, voice, or components — update the relevant file
  here so the SSOT does not drift.

---

## Visual North Star

Two reference compositions describe the entire system:

**1. The Armor in the Wildflowers** — engraved plate-mail, gold rim-light, soft
out-of-focus meadow, no faces. Beautiful brutality. *This is our hero
photography.* All cinematic imagery aims for this temperature, this contrast,
this restraint.

**2. The Sigil in the Stone** — anthracite background, single carved emblem,
cold-gold highlights, Latin banner ribbon. Symmetric, vector-clean. *This is
our heraldic language.* Every brand mark, every faction insignia, every
"badge" component descends from this template.

If a screen does not visually descend from one of these two compositions, it is
off-brand.

---

## Brand-at-a-glance

| Field        | Value                                                           |
|--------------|-----------------------------------------------------------------|
| Name         | **Rizzotto**                                                    |
| Tagline      | *Where Lists Are Forged*                                        |
| Motto pool   | "Karaz Ankor" · "In Lapide Sigillata" · "Forgia Aeternitatis"   |
| Core colors  | `karaz-iron-950` (bg) · `karaz-gold-500` (accent) · `karaz-forge-500` (heat) |
| Display font | Cinzel Variable                                                 |
| Body font    | Inter Variable                                                  |
| Mood         | Souls-like · Grimdark · Heraldic · Cinematic                    |
| Mode         | Dark-only (no light theme; the inspo is unambiguous)            |

---

## Maintenance

This guide is version-tracked with the codebase. Any meaningful change to
tokens, voice, or components is a commit. Do not let this document rot — if you
shipped a UI change and the guide still says the old thing, the guide is wrong
and must be updated in the same PR.

The CLAUDE.md hub at the repository root links here. Sub-agents are briefed
with `Lies zuerst docs/design/<file>.md` for any visual or copy-related work.

---

## Out of scope (today)

- **Light mode.** Inspo is unambiguous; we go dark-only.
- **Sound.** Reserved as a premium add-on (forge-thunk, hover-clink, ambient).
- **Internationalization of motto strings.** Latin/Khazalid mottos are decorative
  and remain as-is across locales.
- **Workspace rename `@tww3/*` → `@rizzotto/*`.** ✅ Done in `feat/rizzotto-rebrand` (2026-05-18).
