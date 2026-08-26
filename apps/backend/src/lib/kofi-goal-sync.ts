// Auto-sync the on-site funding goal bar from the public Ko-Fi page.
//
// Ko-Fi renders the goal percentage and target as server-side HTML with stable ids
// (profileGoalTitle / profileGoalTotal), and the page is fetchable with a browser
// User-Agent. A cron (plugins/cron.ts) scrapes it every 30 min and mirrors goal +
// raised into the funding_goal AdminConfig, so the on-site bar tracks Ko-Fi (seeded
// head start included) with no manual updates. Fail-safe: any fetch/parse error
// leaves the existing value untouched. See plans/kofi-and-supporters.md.

import type { PrismaClient } from '@rizzotto/db';

/** AdminConfig key holding the funding goal ({ goal, raised, currency }). */
export const FUNDING_GOAL_CONFIG_KEY = 'funding_goal';

/** Defaults until a real value is scraped or set (a 135 seed on a 500 goal). */
export const DEFAULT_FUNDING_GOAL = { goal: 500, raised: 135, currency: 'EUR' } as const;

const KOFI_GOAL_URL = 'https://ko-fi.com/rizzottogaming';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

type LogLike = {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
};

/**
 * Parse the goal target + percentage from a Ko-Fi profile page's HTML, anchored on
 * the stable `profileGoalTotal` id. Returns { goal, raised } or null if not found.
 * `raised` is derived from the (integer) percentage Ko-Fi renders, so it tracks the
 * bar in ~1% steps. Currency-agnostic on purpose (avoids entity/encoding pitfalls).
 */
export function parseKofiGoal(html: string): { goal: number; raised: number } | null {
  // Skip any currency entity/symbol (e.g. `&#x20AC;`, `&euro;`, `€`) before the target
  // number, so we don't accidentally grab the digits inside the euro entity.
  const totalMatch = html.match(
    /id="profileGoalTotal">\s*of\s*(?:&#?[0-9a-z]+;|[€$£¥]|\s)*([\d.,]+)/i,
  );
  const pctMatch = html.match(/(\d+(?:\.\d+)?)\s*%\s*<\/span>\s*<span[^>]*id="profileGoalTotal"/i);
  const rawGoal = totalMatch?.[1];
  const rawPct = pctMatch?.[1];
  if (rawGoal == null || rawPct == null) return null;

  const goal = Math.round(Number(rawGoal.replace(/[.,]/g, '')));
  const pct = Number(rawPct);
  if (!Number.isFinite(goal) || goal <= 0 || !Number.isFinite(pct) || pct < 0) return null;

  const raised = Math.round((pct / 100) * goal);
  return { goal, raised };
}

/**
 * Fetch the Ko-Fi page and mirror its goal into AdminConfig, preserving the currency
 * already configured. Returns the written value, or null if it left things untouched.
 */
export async function syncKofiGoal(
  prisma: PrismaClient,
  log?: LogLike,
): Promise<{ goal: number; raised: number; currency: string } | null> {
  let html: string;
  try {
    const res = await fetch(KOFI_GOAL_URL, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
    });
    if (!res.ok) {
      log?.warn({ status: res.status }, 'Ko-Fi goal sync: non-OK response, keeping current value');
      return null;
    }
    html = await res.text();
  } catch (err) {
    log?.warn({ err }, 'Ko-Fi goal sync: fetch failed, keeping current value');
    return null;
  }

  const parsed = parseKofiGoal(html);
  if (!parsed) {
    log?.warn({}, 'Ko-Fi goal sync: could not parse goal from page, keeping current value');
    return null;
  }

  const existing = await prisma.adminConfig.findUnique({ where: { key: FUNDING_GOAL_CONFIG_KEY } });
  const currency =
    (existing?.value as { currency?: string } | null)?.currency ?? DEFAULT_FUNDING_GOAL.currency;
  const value = { goal: parsed.goal, raised: parsed.raised, currency };

  await prisma.adminConfig.upsert({
    where: { key: FUNDING_GOAL_CONFIG_KEY },
    create: { key: FUNDING_GOAL_CONFIG_KEY, value: value as never, updated_by: null },
    update: { value: value as never, updated_by: null },
  });
  log?.info(value, 'Ko-Fi goal synced');
  return value;
}
