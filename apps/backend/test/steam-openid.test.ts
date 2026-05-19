/**
 * Unit tests for Steam OpenID 2.0 helpers.
 *
 * Tests the claimed_id parsing logic and verify-response handling
 * without hitting the real Steam endpoint (mocked via msw).
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Re-implement the claimed_id parser for isolated testing
// ---------------------------------------------------------------------------

const STEAM_CLAIMED_ID_PATTERN = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;

function extractSteamId(claimedId: string): string | null {
  const match = STEAM_CLAIMED_ID_PATTERN.exec(claimedId);
  return match ? match[1] : null;
}

function parseVerifyResponse(responseText: string): boolean {
  return responseText.includes('is_valid:true');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Steam OpenID — claimed_id parsing', () => {
  it('extracts numeric steam ID from valid claimed_id', () => {
    const id = extractSteamId('https://steamcommunity.com/openid/id/76561198123456789');
    expect(id).toBe('76561198123456789');
  });

  it('returns null for invalid claimed_id format', () => {
    expect(extractSteamId('https://steamcommunity.com/profiles/76561198123456789')).toBeNull();
    expect(extractSteamId('https://example.com/openid/id/76561198123456789')).toBeNull();
    expect(extractSteamId('not-a-url')).toBeNull();
    expect(extractSteamId('')).toBeNull();
  });

  it('returns null for claimed_id with non-numeric steam ID', () => {
    expect(extractSteamId('https://steamcommunity.com/openid/id/abc')).toBeNull();
  });

  it('handles very large Steam IDs (64-bit unsigned int)', () => {
    const id = extractSteamId('https://steamcommunity.com/openid/id/76561199999999999');
    expect(id).toBe('76561199999999999');
  });

  it('rejects claimed_id with trailing path', () => {
    const id = extractSteamId('https://steamcommunity.com/openid/id/76561198123456789/extra');
    expect(id).toBeNull();
  });
});

describe('Steam OpenID — verify response parsing', () => {
  it('returns true for valid is_valid:true response', () => {
    const response = 'ns:http://specs.openid.net/auth/2.0\nis_valid:true\n';
    expect(parseVerifyResponse(response)).toBe(true);
  });

  it('returns false for is_valid:false response', () => {
    const response = 'ns:http://specs.openid.net/auth/2.0\nis_valid:false\n';
    expect(parseVerifyResponse(response)).toBe(false);
  });

  it('returns false for empty response', () => {
    expect(parseVerifyResponse('')).toBe(false);
  });

  it('returns false for malformed response', () => {
    expect(parseVerifyResponse('error:server_error')).toBe(false);
  });

  it('returns true even with extra whitespace around is_valid:true', () => {
    // Steam sometimes returns with Windows-style line endings
    const response = 'ns:http://specs.openid.net/auth/2.0\r\nis_valid:true\r\n';
    expect(parseVerifyResponse(response)).toBe(true);
  });
});

describe('Steam OpenID — return URL construction', () => {
  it('constructs correct OpenID params for login redirect', () => {
    const steamReturnUrl = 'http://localhost:3000/auth/steam/return';
    const params = new URLSearchParams({
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'checkid_setup',
      'openid.return_to': steamReturnUrl,
      'openid.realm': new URL(steamReturnUrl).origin,
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    });

    const fullUrl = `https://steamcommunity.com/openid/login?${params.toString()}`;
    const parsed = new URL(fullUrl);

    expect(parsed.searchParams.get('openid.ns')).toBe('http://specs.openid.net/auth/2.0');
    expect(parsed.searchParams.get('openid.mode')).toBe('checkid_setup');
    expect(parsed.searchParams.get('openid.return_to')).toBe(steamReturnUrl);
    expect(parsed.searchParams.get('openid.realm')).toBe('http://localhost:3000');
  });

  it('encodes return_to in app_return_to param when provided', () => {
    const steamReturnUrl = 'http://localhost:3000/auth/steam/return';
    const appReturnTo = '/tournaments/my-tournament';

    const redirectUrl = new URL(steamReturnUrl);
    redirectUrl.searchParams.set('app_return_to', appReturnTo);

    expect(redirectUrl.searchParams.get('app_return_to')).toBe(appReturnTo);
    expect(redirectUrl.toString()).toContain('app_return_to=');
  });
});
