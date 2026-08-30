// Referral attribution — capture side (browser). Self-contained (no api.ts import) so
// api.ts can import storedRefLast() without a cycle. Records a ?ref= click, remembers the
// ref (first-touch + last-touch), and — once logged in — reports the first-touch source.

const REF_LAST = 'rz_ref_last';
const REF_FIRST = 'rz_ref_first';
const REF_SYNCED = 'rz_ref_synced';
const REF_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function set(key: string, val: string): void {
  try {
    localStorage.setItem(key, val);
  } catch {
    /* storage disabled — ignore */
  }
}
function del(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
function post(path: string, body: unknown): void {
  void fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});
}

/** The ref to attribute to a fresh registration (last-touch). */
export function storedRefLast(): string | undefined {
  return get(REF_LAST) ?? undefined;
}

/** On page load with `?ref=X`: record a click and remember the ref (first + last touch). */
export function captureRefFromUrl(): void {
  let ref: string | null;
  let slug: string | undefined;
  try {
    ref = new URLSearchParams(window.location.search).get('ref');
    const m = window.location.pathname.match(/\/tournaments\/([^/?#]+)/);
    if (m) slug = decodeURIComponent(m[1]!);
  } catch {
    return;
  }
  if (!ref || !REF_RE.test(ref)) return;

  set(REF_LAST, ref);
  if (!get(REF_FIRST)) set(REF_FIRST, ref);
  post('/api/ref/hit', { ref, slug, path: window.location.pathname });
}

/** Once logged in, report the first-touch source (server sets it only if still null). */
export function syncReferralSource(): void {
  if (get(REF_SYNCED)) return;
  const first = get(REF_FIRST);
  if (!first) return;
  set(REF_SYNCED, '1');
  // If the call fails (e.g. not actually authed yet), clear the flag so a later load retries.
  void fetch('/api/users/me/referral-source', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: first }),
  })
    .then((r) => {
      if (!r.ok) del(REF_SYNCED);
    })
    .catch(() => del(REF_SYNCED));
}
