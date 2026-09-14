import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiFetch } from './api';
import { setUnauthorizedHandler } from './authEvents';

function mockFetchOnce(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

afterEach(() => {
  setUnauthorizedHandler(null);
  vi.restoreAllMocks();
});

describe('apiFetch → global unauthorized signal', () => {
  it('fires the unauthorized handler on a 401 and still throws (auth flips to logged-out)', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    mockFetchOnce(401, { error: 'Unauthorized', message: 'Missing or invalid auth token', statusCode: 401 });

    await expect(apiFetch('/api/users/me')).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire on a 403 (STEAM_REQUIRED / role-forbidden must not log the user out)', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    mockFetchOnce(403, { error: 'Forbidden', code: 'STEAM_REQUIRED', message: 'Connect Steam', statusCode: 403 });

    await expect(apiFetch('/api/tournaments/x/register', { method: 'POST', body: '{}' })).rejects.toMatchObject({ status: 403 });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('does NOT fire on a successful response', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    mockFetchOnce(200, { id: 'u1', username: 'tester' });

    await expect(apiFetch('/api/users/me')).resolves.toMatchObject({ id: 'u1' });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
