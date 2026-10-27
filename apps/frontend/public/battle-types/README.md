# Battle-type watermark symbols

Drop the **official** battle-type symbols here (e.g. from the Creative Assembly press kit).
The tournament tiles render them as a faint full-tile watermark behind the content
(`BattleTypeWatermark` → served from `/battle-types/<type>.png`).

Expected files (exact, lowercase base names) — `.png`, `.svg` or `.webp` all work
(the loader tries them in that order):

- `domination.(png|svg|webp)`
- `conquest.(png|svg|webp)`
- `domquest.(png|svg|webp)`
- `land_battle.(png|svg|webp)`
- `siege.(png|svg|webp)`

Recommended: a transparent background, the gold symbol roughly square, ~256–512 px.
Until a matching file exists the watermark simply doesn't render (the image fails to load and is
hidden), so it's safe to add them one at a time.

The current `conquest.png` / `domination.png` / `land_battle.png` / `siege.png` were cropped from the in-game
Map-Setup UI screenshot: each is a tight crop of the gold symbol (centred, with a thin maroon
tile margin) so it renders large behind the tile content. Replace them with the higher-resolution
press-kit assets when available (same names, any of the extensions above).

`domquest.png` is the Domquest button icon of RizzOtto's Arena Mod (the aubergine behind the symbol),
cropped to its visible area from `domquest/assets/fe_mp_battle_type_icon_domquest.png` in the mod repo.
