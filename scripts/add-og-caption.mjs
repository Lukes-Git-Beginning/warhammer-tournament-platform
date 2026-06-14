// One-time script: adds "Open Beta Tournament" caption to og-image-v3.png
// Run: node scripts/add-og-caption.mjs
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'apps', 'frontend', 'public');

const input = join(publicDir, 'og-image-v3.png');
const output = join(publicDir, 'og-image-v4.png');

const { width, height } = await sharp(input).metadata();
const W = width ?? 1200;
const H = height ?? 630;

// Caption positioned in the upper quarter, centered
const captionY = Math.round(H * 0.18);

const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <!-- subtle dark glow behind text for legibility -->
  <text
    x="${W / 2}" y="${captionY}"
    font-family="Georgia, 'Times New Roman', serif"
    font-size="28"
    font-weight="normal"
    letter-spacing="10"
    text-anchor="middle"
    fill="rgba(0,0,0,0.55)"
    filter="url(#blur)"
  >OPEN BETA TOURNAMENT</text>

  <defs>
    <filter id="blur"><feGaussianBlur stdDeviation="4"/></filter>
  </defs>

  <!-- decorative lines -->
  <line x1="${W/2 - 200}" y1="${captionY - 14}" x2="${W/2 - 20}" y2="${captionY - 14}"
        stroke="#c9a84c" stroke-width="0.8" opacity="0.6"/>
  <line x1="${W/2 + 20}"  y1="${captionY - 14}" x2="${W/2 + 200}" y2="${captionY - 14}"
        stroke="#c9a84c" stroke-width="0.8" opacity="0.6"/>

  <!-- main caption text -->
  <text
    x="${W / 2}" y="${captionY}"
    font-family="Georgia, 'Times New Roman', serif"
    font-size="28"
    font-weight="normal"
    letter-spacing="10"
    text-anchor="middle"
    fill="#d4a843"
    opacity="0.92"
  >OPEN BETA TOURNAMENT</text>
</svg>`;

await sharp(input)
  .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
  .png()
  .toFile(output);

console.log(`✓ Written: ${output} (${W}×${H})`);
