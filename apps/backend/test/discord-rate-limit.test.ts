/**
 * Discord outbound rate-limit handling in discordRequest() (DM 429 incident, 2026-09-30):
 * global request spacing + 429/transient retry with a bounded budget, at the single HTTP
 * choke-point. Fetch is mocked and timers are faked so the waits don't run for real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@rizzotto/db';
import { discordRequest, DISCORD_MAX_RETRIES } from '../src/lib/discord-notify.js';

const POST_PATH = '/channels/123456789012345678/messages';

function res429(retryAfterSec = 0.05, global = false): Response {
  return new Response(JSON.stringify({ retry_after: retryAfterSec, global }), {
    status: 429,
    headers: { 'content-type': 'application/json' },
  });
}
function resOk(status = 200): Response {
  return new Response('{"id":"1"}', { status, headers: { 'content-type': 'application/json' } });
}

let createSpy: ReturnType<typeof vi.spyOn>;
let originalToken: string | undefined;

beforeEach(() => {
  originalToken = process.env.DISCORD_BOT_TOKEN;
  process.env.DISCORD_BOT_TOKEN = 'test-token';
  vi.useFakeTimers();
  createSpy = vi.spyOn(prisma.botMessage, 'create').mockResolvedValue({} as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
  else process.env.DISCORD_BOT_TOKEN = originalToken;
});

function lastLog(): { status: string; detail?: string | null } | null {
  const calls = createSpy.mock.calls;
  if (!calls.length) return null;
  return (calls[calls.length - 1][0] as { data: { status: string; detail?: string | null } }).data;
}

describe('discordRequest — rate-limit compliance', () => {
  it('retries a 429 then succeeds, returns 200, logs SENT', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(res429(0.05)).mockResolvedValueOnce(resOk(200));
    vi.stubGlobal('fetch', fetchMock);

    const p = discordRequest('POST', POST_PATH, { content: 'hi' });
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lastLog()?.status).toBe('SENT');
  });

  it('gives up after the retry budget on a persistent 429, logs FAILED http_429', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => res429(0.02));
    vi.stubGlobal('fetch', fetchMock);

    const p = discordRequest('POST', POST_PATH, { content: 'x' });
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(DISCORD_MAX_RETRIES + 1); // initial + retries, bounded
    expect(lastLog()?.status).toBe('FAILED');
    expect(lastLog()?.detail).toBe('http_429');
  });

  it('does NOT retry a non-429 non-2xx (403)', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response('no', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);

    const p = discordRequest('POST', POST_PATH, { content: 'x' });
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastLog()?.status).toBe('FAILED');
    expect(lastLog()?.detail).toBe('http_403');
  });

  it('serialises a burst — never more than one request in flight', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return resOk(200);
    });
    vi.stubGlobal('fetch', fetchMock);

    const ps = Array.from({ length: 20 }, () => discordRequest('GET', '/users/@me'));
    await vi.runAllTimersAsync();
    await Promise.all(ps);

    expect(fetchMock).toHaveBeenCalledTimes(20);
    expect(maxInFlight).toBeLessThanOrEqual(1);
  });

  it('retries a transient 5xx then succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('busy', { status: 503 })).mockResolvedValueOnce(resOk(200));
    vi.stubGlobal('fetch', fetchMock);

    const p = discordRequest('POST', POST_PATH, { content: 'x' });
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lastLog()?.status).toBe('SENT');
  });
});
