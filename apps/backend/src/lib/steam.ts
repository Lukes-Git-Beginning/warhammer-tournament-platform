// Steam Web API helpers. The platform already authenticates via Steam OpenID and reads the
// persona name via GetPlayerSummaries (see routes/auth.ts); this centralises that call so the
// replay-verification name check can reuse it.

/** Fetch current Steam display (persona) names for the given steam64 ids.
 *  Returns a Map steamId → personaname. Missing key or API failure → empty map (fail-open). */
export async function fetchSteamPersonaNames(steamIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const key = process.env.STEAM_WEB_API_KEY;
  const ids = [...new Set(steamIds.filter(Boolean))];
  if (!key || ids.length === 0) return out;
  try {
    const resp = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${key}&steamids=${ids.join(',')}`,
    );
    if (!resp.ok) return out;
    const data = (await resp.json()) as {
      response?: { players?: Array<{ steamid?: string; personaname?: string }> };
    };
    for (const p of data.response?.players ?? []) {
      if (p.steamid && p.personaname) out.set(p.steamid, p.personaname);
    }
  } catch {
    // network/API error → fail-open (no names → name check skipped)
  }
  return out;
}
