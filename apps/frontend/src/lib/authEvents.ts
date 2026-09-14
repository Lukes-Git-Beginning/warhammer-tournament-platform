/**
 * Central "the server no longer accepts our session" signal.
 *
 * Every API call funnels its non-ok responses through `makeApiError` (api.ts); on a 401 that
 * factory calls `notifyUnauthorized()`. A single app-level listener (SessionExpiredBanner) drops
 * the cached `['me']` session so the whole UI flips to logged-out immediately — instead of leaving
 * it in a half-authenticated limbo (some views work, others 401) until a hard reload.
 */
type UnauthorizedHandler = () => void;

let handler: UnauthorizedHandler | null = null;

/** Register (or clear, with null) the single global 401 listener. */
export function setUnauthorizedHandler(h: UnauthorizedHandler | null): void {
  handler = h;
}

/** Fire the 401 signal. No-op if nothing is registered (e.g. during SSR/tests). */
export function notifyUnauthorized(): void {
  handler?.();
}
