import sharp from 'sharp';

const W = 1200, H = 630;
const hero = 'public/img/rizzotto-arena-v2.png';
const wordmark = 'public/img/rizzotto-wordmark.png'; // transparent site wordmark
const out = 'public/og-image-v5.png';

// Logo placement like the current embed: lower half, slightly left of centre.
const WM_W = 470;
const WM_H = Math.round(WM_W / 2.63);
const WM_CX = Math.round(0.46 * W); // horizontal centre ~46%
const WM_CY = Math.round(0.70 * H); // vertical centre ~70%
const wmLeft = Math.round(WM_CX - WM_W / 2);
const wmTop = Math.round(WM_CY - WM_H / 2);

// Vignette: gentle edge darkening only (no dark halo behind the logo).
const vignette = Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="v" cx="50%" cy="50%" r="80%">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.14"/>
      <stop offset="60%" stop-color="#000000" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.56"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#v)"/>
</svg>`);

const base = await sharp(hero).resize(W, H, { fit: 'cover', position: 'centre' }).toBuffer();
const wm = await sharp(wordmark).resize({ width: WM_W }).toBuffer();

// Soft "fog" glow keyed to the wordmark shape (mirrors the landing-page drop-shadow):
// take the logo's alpha silhouette, blur it wide, and fill it with a warm cream.
// The logo itself covers its own footprint, so only the feathered halo bleeds out,
// smoothing the busy background behind the lettering.
const PAD = 130;
const padW = WM_W + 2 * PAD;
const padH = WM_H + 2 * PAD;
const glowMask = await sharp(wm)
  .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .extractChannel(3) // alpha silhouette
  .blur(28) // soft spread
  .linear(1.05, 0) // dial the halo strength
  .toBuffer();
const glow = await sharp({
  create: { width: padW, height: padH, channels: 3, background: { r: 14, g: 12, b: 10 } },
})
  .joinChannel(glowMask)
  .png()
  .toBuffer();

await sharp(base)
  .composite([
    { input: vignette, top: 0, left: 0 },
    { input: glow, top: WM_CY - Math.round(padH / 2), left: WM_CX - Math.round(padW / 2) },
    { input: wm, top: wmTop, left: wmLeft },
  ])
  .png()
  .toFile(out);

const meta = await sharp(out).metadata();
console.log('wrote', out, meta.width + 'x' + meta.height);
