# Battle-type watermark symbols

Drop the **official** battle-type symbols here (e.g. from the Creative Assembly press kit).
The tournament tiles render them as a faint full-tile watermark behind the content
(`BattleTypeWatermark` → served from `/battle-types/<type>.png`).

Expected files (exact, lowercase names):

- `domination.png`
- `conquest.png`
- `siege.png`

Recommended: a transparent background, the gold symbol roughly square, ~256–512 px.
Until a file exists the watermark simply doesn't render (the image fails to load and is hidden),
so it's safe to add them one at a time.

If you have SVGs instead of PNGs, say so and the loader can be pointed at `.svg`.
