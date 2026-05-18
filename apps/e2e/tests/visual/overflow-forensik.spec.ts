/**
 * overflow-forensik.spec.ts
 *
 * Diagnostic spec — finds the element(s) that cause horizontal overflow
 * on public routes across three viewports. Reports the first 10 offenders
 * (elements whose bounding-rect.right exceeds window.innerWidth) sorted by
 * how far they protrude.
 *
 * NOT a regression test — does not assert anything; just logs.
 * Run:
 *   pnpm -F @rizzotto/e2e test -- --grep "overflow forensik" --reporter=line
 *
 * Output is intentionally console-only so the developer can scan for the
 * root cause without parsing report XML.
 */
import { test, type Page } from '@playwright/test';

const ROUTES = ['/', '/leaderboard'] as const;
const VIEWPORTS = [
  { name: '1080p_100', width: 1920, height: 1080 },
  { name: '1080p_125', width: 1536, height: 864 },
  { name: '720p_150', width: 1280, height: 720 },
] as const;

async function scanForOffenders(page: Page, viewportW: number) {
  return page.evaluate((vw) => {
    const offenders: {
      tag: string;
      id: string;
      cls: string;
      right: number;
      width: number;
      offset: number;
    }[] = [];
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1) {
        const cls = (el as HTMLElement).className?.toString() ?? '';
        offenders.push({
          tag: el.tagName,
          id: (el as HTMLElement).id ?? '',
          cls: cls.slice(0, 140),
          right: Math.round(r.right),
          width: Math.round(r.width),
          offset: Math.round(r.right - vw),
        });
      }
    });
    offenders.sort((a, b) => b.offset - a.offset);
    return {
      docW: document.documentElement.scrollWidth,
      bodyW: document.body.scrollWidth,
      winW: window.innerWidth,
      top10: offenders.slice(0, 10),
    };
  }, viewportW);
}

for (const vp of VIEWPORTS) {
  for (const route of ROUTES) {
    test(`overflow forensik ${vp.name} ${route}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      // Let initial framer-motion staggered animations settle
      await page.waitForTimeout(800);

      const result = await scanForOffenders(page, vp.width);
      const overflow = result.docW - result.winW;

      // Always log header so the run output is grepable
      // eslint-disable-next-line no-console
      console.log(
        `[FORENSIK ${vp.name} ${route}] docW=${result.docW} bodyW=${result.bodyW} winW=${result.winW} → overflow=${overflow}`,
      );

      if (result.top10.length === 0) {
        // eslint-disable-next-line no-console
        console.log('  (no offenders found)');
      } else {
        for (const o of result.top10) {
          // eslint-disable-next-line no-console
          console.log(
            `  → +${o.offset}px <${o.tag.toLowerCase()}${o.id ? ` id="${o.id}"` : ''} class="${o.cls}"> right=${o.right} width=${o.width}`,
          );
        }
      }
    });
  }
}
