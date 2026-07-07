// One-off poster compositor: Vaduz castle + logos + stacked epic title.
// Text = opentype vector paths (sharp/SVG can't load @font-face); outline = offset
// stamp; each line is trimmed so it stacks tightly. Logos/title lifted with a soft
// WARM-LIGHT glow (backlight) — bright/happy, no vignette. Logos brightened to match
// the launch poster.
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('C:/dev/warhammer-tournament-platform/apps/frontend/package.json');
const sharp = require('sharp');
const opentype = require('C:/dev/warhammer-tournament-platform/node_modules/.pnpm/opentype.js@2.0.0/node_modules/opentype.js');

const DIR = "E:/Dropbox/TWW3/RizzOtto's Arena";
const PHOTO = `${DIR}/Liechtenstein-Header-Photo.jpg.optimal.jpg`;
const WH3 = `${DIR}/TWWH3_Logo_Final_Merged-251022601422f7dcfc17.61395016.png`;
const WORDMARK = 'C:/dev/warhammer-tournament-platform/apps/frontend/public/img/rizzotto-wordmark.png';
const FONT_EPIC = 'C:/Windows/Fonts/OLDENGL.TTF';   // Old English Text MT (blackletter)
const OUT_PNG = `${DIR}/return-to-liechtenstein-v3.png`;
const OUT_JPG = `${DIR}/return-to-liechtenstein-v3.jpg`;

const WH3_BRIGHT = 1.16;
const WM_BRIGHT = 1.34;
const W = 2000, H = 1053, M = 44;

function loadFont(p) {
  const b = fs.readFileSync(p);
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

// Full-canvas warm-light glow behind an element (backlight).
async function glowLayer(elementBuf, top, left, { blur, opacity }) {
  const { data, info } = await sharp(elementBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255; data[i + 1] = 247; data[i + 2] = 232;
    data[i + 3] = Math.round(data[i + 3] * opacity);
  }
  const sil = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: sil, top: Math.round(top), left: Math.round(left) }]).blur(blur).png().toBuffer();
}

// Render one line of text -> trimmed transparent PNG (gold gradient + dark outline).
async function renderText(text, font, { targetW, maxSize, track = 0.012 }) {
  const upm = font.unitsPerEm;
  const glyphs = font.stringToGlyphs(text);
  const k = glyphs.reduce((s, g) => s + g.advanceWidth / upm, 0) + track * (glyphs.length - 1);
  const fontSize = Math.min(maxSize, Math.round(targetW / k));
  const tracking = fontSize * track;
  const ascent = (font.ascender / upm) * fontSize;
  const descent = (Math.abs(font.descender) / upm) * fontSize;
  const r = Math.max(3, fontSize * 0.03);
  const pad = Math.ceil(r + fontSize * 0.18);
  const baseX = pad, baseY = pad + ascent;

  let x = baseX;
  const full = new opentype.Path();
  for (const g of glyphs) {
    full.extend(g.getPath(x, baseY, fontSize));
    x += (g.advanceWidth / upm) * fontSize + tracking;
  }
  const d = full.toPathData(1);
  const svgW = Math.ceil(x - baseX - tracking) + pad * 2;
  const svgH = Math.ceil(ascent + descent) + pad * 2;

  let stamps = '';
  const N = 18;
  for (let i = 0; i < N; i++) {
    const a = (2 * Math.PI * i) / N;
    stamps += `<path d="${d}" fill="#1b1006" transform="translate(${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)})"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff4d2"/>
      <stop offset="0.46" stop-color="#ecca82"/>
      <stop offset="1" stop-color="#c69a48"/>
    </linearGradient></defs>
    ${stamps}
    <path d="${d}" fill="url(#g)"/>
  </svg>`;
  const { data, info } = await sharp(Buffer.from(svg)).trim().png().toBuffer({ resolveWithObject: true });
  return { buf: data, w: info.width, h: info.height };
}

async function main() {
  const font = loadFont(FONT_EPIC);

  // Logos, brightened to match the launch poster.
  const arenaH = 188;
  const arena = await sharp(WORDMARK).resize({ height: arenaH }).modulate({ brightness: WM_BRIGHT }).png().toBuffer();
  const arenaW = (await sharp(arena).metadata()).width;
  const wh3H = 214;
  const wh3 = await sharp(WH3).resize({ height: wh3H }).modulate({ brightness: WH3_BRIGHT }).png().toBuffer();
  const wh3W = (await sharp(wh3).metadata()).width;

  const bottom = H - 40;
  const arenaX = M, arenaY = bottom - arenaH;                 // bottom-left
  const wh3X = W - M - wh3W, wh3Y = bottom - wh3H;             // bottom-right
  const logosTop = Math.min(arenaY, wh3Y);

  // Stacked epic title: Return (big, top) / to / Liechtenstein (above logos).
  const ret = await renderText('Return', font, { targetW: 900, maxSize: 340 });
  const to = await renderText('to', font, { targetW: 230, maxSize: 190 });
  const lie = await renderText('Liechtenstein', font, { targetW: 1520, maxSize: 230 });

  const retX = (W - ret.w) / 2, retY = 20;
  const toX = (W - to.w) / 2, toY = retY + ret.h - 6;
  const lieX = (W - lie.w) / 2, lieY = logosTop - lie.h - 16;

  // Warm-light glows (backlight) behind every element.
  const glows = [
    await glowLayer(arena, arenaY, arenaX, { blur: 24, opacity: 0.6 }),
    await glowLayer(wh3, wh3Y, wh3X, { blur: 24, opacity: 0.6 }),
    await glowLayer(ret.buf, retY, retX, { blur: 30, opacity: 0.34 }),
    await glowLayer(to.buf, toY, toX, { blur: 22, opacity: 0.34 }),
    await glowLayer(lie.buf, lieY, lieX, { blur: 30, opacity: 0.34 }),
  ];

  const layers = [
    ...glows.map((g) => ({ input: g, top: 0, left: 0 })),
    { input: arena, top: Math.round(arenaY), left: Math.round(arenaX) },
    { input: wh3, top: Math.round(wh3Y), left: Math.round(wh3X) },
    { input: ret.buf, top: Math.round(retY), left: Math.round(retX) },
    { input: to.buf, top: Math.round(toY), left: Math.round(toX) },
    { input: lie.buf, top: Math.round(lieY), left: Math.round(lieX) },
  ];

  const base = sharp(PHOTO).resize(W, H, { fit: 'cover' });
  const composed = await base.composite(layers).png().toBuffer();
  await sharp(composed).png().toFile(OUT_PNG);
  await sharp(composed).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toFile(OUT_JPG);
  console.log('wrote', OUT_PNG, 'and .jpg');
  console.log('Return', ret.w + 'x' + ret.h, 'at', Math.round(retX) + ',' + retY);
  console.log('to', to.w + 'x' + to.h, 'at', Math.round(toX) + ',' + Math.round(toY));
  console.log('Liechtenstein', lie.w + 'x' + lie.h, 'at', Math.round(lieX) + ',' + Math.round(lieY));
  console.log('arena', arenaW + 'x' + arenaH, 'at', arenaX + ',' + arenaY, '| wh3', wh3W + 'x' + wh3H, 'at', wh3X + ',' + wh3Y);
}

main().catch((e) => { console.error(e); process.exit(1); });
