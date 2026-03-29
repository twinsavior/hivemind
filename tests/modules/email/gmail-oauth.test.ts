import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSettings: Record<string, string> = {};
const mockApiKeys: Record<string, string> = {};

vi.mock('../../../src/modules/email/db', () => ({
  getSetting: (key: string) => mockSettings[key] ?? null,
  setSetting: (key: string, value: string) => { mockSettings[key] = value; },
  getApiKey: (service: string) => mockApiKeys[service] ?? null,
  setApiKey: (service: string, key: string) => { mockApiKeys[service] = key; },
  getGmailAuth: () => null,
  setGmailAuth: () => {},
}));

vi.mock('../../../src/modules/email/crypto', () => ({
  encrypt: (val: string) => `ENC:${val}`,
  decrypt: (val: string) => val.startsWith('ENC:') ? val.slice(4) : val,
}));

// Mock google-auth-library to avoid real HTTP calls
vi.mock('google-auth-library', () => {
  class MockOAuth2Client {
    generateAuthUrl() { return 'https://mock-auth-url'; }
    setCredentials() {}
  }
  return { OAuth2Client: MockOAuth2Client };
});

import { hasGoogleCredentials, getAuthUrl } from '../../../src/modules/email/gmail-oauth.js';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Gmail OAuth credential resolution', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockSettings)) delete mockSettings[key];
    for (const key of Object.keys(mockApiKeys)) delete mockApiKeys[key];
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  describe('hasGoogleCredentials()', () => {
    it('returns false when nothing is configured', () => {
      expect(hasGoogleCredentials()).toBe(false);
    });

    it('returns true when client_id in settings and client_secret in api_keys', () => {
      mockSettings['google_client_id'] = 'my-client-id';
      mockApiKeys['google_client_secret'] = 'ENC:my-secret';

      expect(hasGoogleCredentials()).toBe(true);
    });

    it('returns true when client_id in settings and client_secret in legacy plain-text setting', () => {
      mockSettings['google_client_id'] = 'my-client-id';
      mockSettings['google_client_secret'] = 'plain-text-secret';

      expect(hasGoogleCredentials()).toBe(true);
    });

    it('ignores masked "****" value in legacy settings', () => {
      mockSettings['google_client_id'] = 'my-client-id';
      mockSettings['google_client_secret'] = '****';

      expect(hasGoogleCredentials()).toBe(false);
    });

    it('returns true with env vars', () => {
      process.env.GOOGLE_CLIENT_ID = 'env-id';
      process.env.GOOGLE_CLIENT_SECRET = 'env-secret';

      expect(hasGoogleCredentials()).toBe(true);
    });

    it('returns false when only client_id is set', () => {
      mockSettings['google_client_id'] = 'my-client-id';

      expect(hasGoogleCredentials()).toBe(false);
    });
  });

  describe('getAuthUrl()', () => {
    it('generates auth URL when credentials are configured', () => {
      mockSettings['google_client_id'] = 'my-client-id';
      mockApiKeys['google_client_secret'] = 'ENC:my-secret';

      const url = getAuthUrl();
      expect(url).toBe('https://mock-auth-url');
    });

    it('stores the state nonce in settings for CSRF verification', () => {
      mockSettings['google_client_id'] = 'my-client-id';
      mockApiKeys['google_client_secret'] = 'ENC:my-secret';

      getAuthUrl();

      const nonce = mockSettings['gmail_oauth_state_nonce'];
      expect(nonce).toBeDefined();
      expect(nonce.length).toBe(48); // 24 bytes hex = 48 chars
    });

    it('passes account_id through state', () => {
      mockSettings['google_client_id'] = 'my-client-id';
      mockApiKeys['google_client_secret'] = 'ENC:my-secret';

      const url = getAuthUrl('42');
      expect(url).toBeDefined();
    });
  });
});
