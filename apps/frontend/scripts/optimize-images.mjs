#!/usr/bin/env node
/**
 * optimize-images.mjs — Karaz Lists image-pipeline build step.
 *
 * Scans `public/img/*.png` and `public/textures/*.png`, emits AVIF + WebP
 * siblings with per-class quality settings, and fails the build if any
 * generated asset exceeds its hard size budget (see ASSET_CLASSES below).
 *
 * Idempotent: skips generation when the .avif/.webp output is newer than
 * its source .png. Delete the output to force re-encode.
 *
 * Spec source of truth: docs/design/07-imagery.md ("Performance budget").
 */

import { readdir, stat } from 'node:fs/promises';
import { join, dirname, basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(here, '..', 'public');
const SCAN_DIRS = ['img', 'textures'];

const KB = 1024;

const ASSET_CLASSES = [
  {
    name: 'hero',
    test: ({ stem }) => stem === 'hero-knight',
    avif: { quality: 55, effort: 6 },
    webp: { quality: 78, effort: 6 },
    limitKB: { avif: 250, webp: 400 },
  },
  {
    name: 'wordmark',
    test: ({ stem }) => stem.startsWith('rizzotto-wordmark'),
    // Wordmark renders max 640 CSS-px wide (hero) / 160 CSS-px wide (header,
    // footer). Source PNGs are 1024–1536 px wide — resize to 768 covers
    // 2× retina at the largest display use. Bronze variant has heavy
    // texture detail; lower quality keeps it inside budget.
    resize: 768,
    avif: { quality: 52, effort: 6 },
    webp: { quality: 76, effort: 6 },
    limitKB: { avif: 120, webp: 200 },
  },
  {
    name: 'texture',
    test: ({ subdir }) => subdir === 'textures',
    // Textures render at opacity 5–18%, tiled. Source PNGs are 1024–1254 px.
    // Resize to 1024 (the tile size most consumers request via bg-[length:1024px]).
    resize: 1024,
    avif: { quality: 42, effort: 6 },
    webp: { quality: 72, effort: 6 },
    limitKB: { avif: 150, webp: 250 },
  },
  {
    name: 'photo',
    test: () => true, // fallback for everything else in img/
    avif: { quality: 60, effort: 6 },
    webp: { quality: 78, effort: 6 },
    limitKB: { avif: 200, webp: 350 },
  },
];

function classify({ stem, subdir }) {
  return ASSET_CLASSES.find((c) => c.test({ stem, subdir }));
}

async function listPngs(subdir) {
  const dir = join(PUBLIC_DIR, subdir);
  let entries;
  try {
    entries = await readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((f) => extname(f).toLowerCase() === '.png')
    .map((f) => ({
      subdir,
      stem: basename(f, extname(f)),
      pngPath: join(dir, f),
    }));
}

async function fileSize(path) {
  try {
    const s = await stat(path);
    return s.size;
  } catch {
    return null;
  }
}

async function isStale(srcPath, outPath) {
  const [src, out] = await Promise.all([stat(srcPath), stat(outPath).catch(() => null)]);
  if (!out) return true;
  return src.mtimeMs > out.mtimeMs;
}

function pad(s, n) {
  return String(s).padEnd(n, ' ');
}

function fmtKB(bytes) {
  return (bytes / KB).toFixed(0).padStart(4, ' ') + ' KB';
}

function pct(out, src) {
  return `-${Math.round((1 - out / src) * 100)}%`.padStart(4, ' ');
}

async function encode(input, output, format, opts, resize) {
  let pipeline = sharp(input);
  if (resize) {
    pipeline = pipeline.resize({ width: resize, withoutEnlargement: true });
  }
  if (format === 'avif') await pipeline.avif(opts).toFile(output);
  else if (format === 'webp') await pipeline.webp(opts).toFile(output);
  else throw new Error(`Unknown format: ${format}`);
}

async function processAsset(asset) {
  const cls = classify(asset);
  const { stem, subdir, pngPath } = asset;
  const dir = join(PUBLIC_DIR, subdir);
  const avifPath = join(dir, `${stem}.avif`);
  const webpPath = join(dir, `${stem}.webp`);

  const pngBytes = await fileSize(pngPath);

  const tasks = [];
  if (await isStale(pngPath, avifPath)) {
    tasks.push(encode(pngPath, avifPath, 'avif', cls.avif, cls.resize));
  }
  if (await isStale(pngPath, webpPath)) {
    tasks.push(encode(pngPath, webpPath, 'webp', cls.webp, cls.resize));
  }
  if (tasks.length) await Promise.all(tasks);

  const [avifBytes, webpBytes] = await Promise.all([fileSize(avifPath), fileSize(webpPath)]);

  const skipped = tasks.length === 0;
  const avifKB = avifBytes / KB;
  const webpKB = webpBytes / KB;
  const overBudget = [];
  if (avifKB > cls.limitKB.avif) overBudget.push(`AVIF ${avifKB.toFixed(0)}KB > ${cls.limitKB.avif}KB`);
  if (webpKB > cls.limitKB.webp) overBudget.push(`WebP ${webpKB.toFixed(0)}KB > ${cls.limitKB.webp}KB`);

  return {
    label: `${subdir}/${stem}`,
    cls: cls.name,
    skipped,
    pngBytes,
    avifBytes,
    webpBytes,
    overBudget,
  };
}

async function main() {
  console.log('━ Karaz Lists image optimizer ─────────────────────────────────────────');

  const assets = (await Promise.all(SCAN_DIRS.map(listPngs))).flat();

  if (assets.length === 0) {
    console.log('No PNG source assets found. Nothing to do.');
    return;
  }

  const results = [];
  for (const a of assets) {
    try {
      const r = await processAsset(a);
      results.push(r);
      const flag = r.skipped ? '·' : '✓';
      const overflow = r.overBudget.length ? `  ⚠ ${r.overBudget.join(' / ')}` : '';
      console.log(
        `  ${flag} ${pad(r.label, 32)} ${pad('[' + r.cls + ']', 11)} ` +
          `PNG ${fmtKB(r.pngBytes)} → AVIF ${fmtKB(r.avifBytes)} (${pct(r.avifBytes, r.pngBytes)}) ` +
          `WebP ${fmtKB(r.webpBytes)} (${pct(r.webpBytes, r.pngBytes)})${overflow}`,
      );
    } catch (err) {
      console.error(`  ✗ ${a.subdir}/${a.stem}: ${err.message}`);
      results.push({ label: `${a.subdir}/${a.stem}`, error: err });
    }
  }

  const overBudget = results.filter((r) => r.overBudget?.length).length;
  const errored = results.filter((r) => r.error).length;
  const totalPng = results.reduce((s, r) => s + (r.pngBytes ?? 0), 0);
  const totalAvif = results.reduce((s, r) => s + (r.avifBytes ?? 0), 0);
  const totalWebp = results.reduce((s, r) => s + (r.webpBytes ?? 0), 0);
  const savedVsPng = totalPng - Math.max(totalAvif, totalWebp);

  console.log('━─────────────────────────────────────────────────────────────────────');
  console.log(
    `  ${results.length} assets · PNG ${fmtKB(totalPng)} · AVIF ${fmtKB(totalAvif)} · WebP ${fmtKB(totalWebp)} · saved ${fmtKB(savedVsPng)}`,
  );

  if (errored) {
    console.error(`  ✗ ${errored} asset(s) failed to encode.`);
    process.exit(1);
  }
  if (overBudget) {
    console.error(`  ✗ ${overBudget} asset(s) over budget — tune quality in ASSET_CLASSES or regenerate source.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
