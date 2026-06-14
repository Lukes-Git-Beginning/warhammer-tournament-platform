// One-time script: adds "Open Beta Tournament" caption to og-image-v3.png
// Run from repo root: pnpm -F @rizzotto/frontend exec node scripts/add-og-caption.mjs
import sharp from 'sharp';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

const input = join(publicDir, 'og-image-v3.png');
const output = join(publicDir, 'og-image-v4.png');

const { width, height } = await sharp(input).metadata();
const W = width ?? 1200;
const H = height ?? 630;

const captionY = Math.round(H * 0.22);

const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="glow">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="shadow">
      <feGaussianBlur stdDeviation="4"/>
    </filter>
  </defs>

  <!-- dark halo for legibility -->
  <text x="${W/2}" y="${captionY}" font-family="Georgia,serif" font-size="72"
        letter-spacing="5" text-anchor="middle"
        fill="rgba(0,0,0,0.7)" filter="url(#shadow)">OPEN BETA TOURNAMENT</text>

  <!-- caption -->
  <text x="${W/2}" y="${captionY}" font-family="Georgia,serif" font-size="72"
        letter-spacing="5" text-anchor="middle"
        fill="#d4a843" opacity="0.95">OPEN BETA TOURNAMENT</text>
</svg>`;

await sharp(input)
  .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
  .png()
  .toFile(output);

console.log(`✓ ${output} (${W}×${H})`);
