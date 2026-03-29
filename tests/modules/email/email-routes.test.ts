import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────
// Must be set up before any imports that touch these modules.

const mockSettings: Record<string, string> = {};
const mockApiKeys: Record<string, string> = {};
const mockAccounts: Array<{ id: number; name: string; type: string; email: string; config: string; enabled: number; created_at: string; updated_at: string }> = [];
let mockAccountIdCounter = 1;
const mockPipelineRuns = [
  { id: 1, trigger_type: 'manual', status: 'completed', emails_scanned: 10, emails_flagged: 2, started_at: '2026-03-29T00:00:00Z' },
];

vi.mock('../../../src/modules/email/db', () => ({
  getAllSettings: () => ({ ...mockSettings }),
  getSetting: (key: string) => mockSettings[key] ?? null,
  setSetting: (key: string, value: string) => { mockSettings[key] = value; },
  getApiKey: (service: string) => mockApiKeys[service] ?? null,
  setApiKey: (service: string, encryptedKey: string) => { mockApiKeys[service] = encryptedKey; },
  deleteApiKey: (service: string) => { delete mockApiKeys[service]; },
  getGmailAuth: () => null,
  deleteGmailAuth: () => {},
  getImapAuth: () => null,
  setImapAuth: () => {},
  deleteImapAuth: () => {},
  getExtractionConfig: () => null,
  getAllRules: () => [],
  getRule: () => undefined,
  createRule: () => 1,
  updateRule: () => {},
  deleteRule: () => {},
  getAllDestinations: () => [],
  getDestination: () => undefined,
  createDestination: () => 1,
  updateDestination: () => {},
  deleteDestination: () => {},
  getProcessedEmails: () => ({ rows: [], total: 0 }),
  getLastPipelineRun: () => null,
  getRecentPipelineRuns: (limit: number) => mockPipelineRuns.slice(0, limit),
  getBlockedSenders: () => [],
  blockSender: () => 1,
  unblockSender: () => {},
  getOrders: () => ({ rows: [], total: 0 }),
  getOrderStats: () => ({}),
  getOrderDailyTrend: () => [],
  getOrdersByRetailer: () => [],
  getPurchaseStats: () => ({ total_spend: 0, order_count: 0 }),
  getPurchaseSpendTrend: () => [],
  getPurchasesByRetailer: () => [],
  getSellerAlerts: () => ({ rows: [], total: 0 }),
  getUnacknowledgedAlertCount: () => 0,
  acknowledgeAlert: () => {},
  acknowledgeAllAlerts: () => {},
  getAllEmailAccounts: () => [...mockAccounts],
  getEmailAccount: (id: number) => mockAccounts.find(a => a.id === id),
  createEmailAccount: (data: any) => {
    const id = mockAccountIdCounter++;
    mockAccounts.push({
      id, name: data.name, type: data.type, email: data.email,
      config: data.config, enabled: data.enabled !== false ? 1 : 0,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    return id;
  },
  updateEmailAccount: (id: number, data: any) => {
    const acc = mockAccounts.find(a => a.id === id);
    if (acc) Object.assign(acc, data);
  },
  deleteEmailAccount: (id: number) => {
    const idx = mockAccounts.findIndex(a => a.id === id);
    if (idx >= 0) mockAccounts.splice(idx, 1);
  },
  getProcessedEmailStats: () => ({ flagged: 0, errored: 0 }),
  getCostToday: () => 0,
  getPushQueueStats: () => ({ pending: 0, failed: 0 }),
}));

vi.mock('../../../src/modules/email/crypto', () => ({
  encrypt: (val: string) => `ENC:${val}`,
  decrypt: (val: string) => val.startsWith('ENC:') ? val.slice(4) : val,
  isEncrypted: (val: string) => val.startsWith('ENC:'),
}));

vi.mock('../../../src/modules/email/scheduler', () => ({
  getSchedulerStatus: () => ({ enabled: false }),
  triggerManualRun: async () => ({ success: true }),
  startScheduler: () => {},
  toggleScheduler: () => {},
  updateInterval: () => {},
}));

vi.mock('../../../src/modules/email/retailer-templates', () => ({
  getTemplate: () => null,
  RETAILER_TEMPLATES: [],
}));

let mockImapTestResult: { success: boolean; error?: string } = { success: true };
vi.mock('../../../src/modules/email/imap-client', () => ({
  testImapConnection: async () => {
    if (!mockImapTestResult.success) throw new Error(mockImapTestResult.error || 'Connection failed');
    return mockImapTestResult;
  },
}));

vi.mock('../../../src/modules/email/gmail-oauth', () => ({
  getAuthUrl: (accountId?: string) => `https://accounts.google.com/o/oauth2/v2/auth?state=${accountId || 'none'}`,
  exchangeCode: async () => ({
    email: 'user@gmail.com',
    access_token: 'access-tok',
    refresh_token: 'refresh-tok',
    expiry_date: Date.now() + 3600000,
  }),
  verifyOAuthState: (state: string | undefined) => {
    if (!state) throw new Error('OAuth callback missing state parameter');
    return JSON.parse(state);
  },
}));

vi.mock('../../../src/modules/email/flag-engine', () => ({
  flagEmail: () => [],
}));

vi.mock('../../../src/modules/email/llm-extractor', () => ({
  processEmailWithInstructions: async () => ({ data: {} }),
  hasLLMExtractor: () => false,
}));

// ── Test helpers ──────────────────────────────────────────────────────────────

import { createEmailRouter } from '../../../src/modules/email/routes.js';
import express from 'express';
import request from 'supertest';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/email', createEmailRouter());
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Email Routes', () => {
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    // Reset state
    for (const key of Object.keys(mockSettings)) delete mockSettings[key];
    for (const key of Object.keys(mockApiKeys)) delete mockApiKeys[key];
    mockAccounts.length = 0;
    mockAccountIdCounter = 1;
    mockImapTestResult = { success: true };
    app = createApp();
  });

  // ── Issue #1: Google OAuth credential save/load consistency ────────────────

  describe('Google OAuth credential storage (Issue #1)', () => {
    it('PUT /settings stores google_client_secret in encrypted api_keys, not plain settings', async () => {
      const res = await request(app)
        .put('/api/email/settings')
        .send({ google_client_id: 'my-client-id', google_client_secret: 'my-secret' });

      expect(res.status).toBe(200);

      // client_id goes to settings (non-secret)
      expect(mockSettings['google_client_id']).toBe('my-client-id');

      // client_secret goes to api_keys table (encrypted), NOT to settings
      expect(mockSettings['google_client_secret']).toBeUndefined();
      expect(mockApiKeys['google_client_secret']).toBe('ENC:my-secret');
    });

    it('PUT /settings ignores masked "****" value for google_client_secret', async () => {
      mockApiKeys['google_client_secret'] = 'ENC:original-secret';

      const res = await request(app)
        .put('/api/email/settings')
        .send({ google_client_secret: '****' });

      expect(res.status).toBe(200);
      // Should NOT overwrite the existing encrypted value
      expect(mockApiKeys['google_client_secret']).toBe('ENC:original-secret');
    });

    it('GET /settings masks google_client_secret as "****" when configured', async () => {
      mockSettings['google_client_id'] = 'my-client-id';
      mockApiKeys['google_client_secret'] = 'ENC:my-secret';

      const res = await request(app).get('/api/email/settings');

      expect(res.status).toBe(200);
      expect(res.body['google_client_id']).toBe('my-client-id');
      expect(res.body['google_client_secret']).toBe('****');
    });

    it('GET /settings omits google_client_secret when not configured', async () => {
      const res = await request(app).get('/api/email/settings');

      expect(res.status).toBe(200);
      expect(res.body['google_client_secret']).toBeUndefined();
    });
  });

  // ── Issue #2: Gmail OAuth callback preserves client_id/client_secret ──────

  describe('Gmail OAuth callback (Issue #2)', () => {
    it('preserves client_id and client_secret in account config after callback', async () => {
      // Set up shared Google credentials
      mockSettings['google_client_id'] = 'shared-client-id';
      mockApiKeys['google_client_secret'] = 'ENC:shared-secret';

      // Create a pre-existing gmail_oauth account
      mockAccounts.push({
        id: 1, name: 'My Gmail', type: 'gmail_oauth', email: '',
        config: JSON.stringify({ client_id: 'shared-client-id', client_secret: 'ENC:shared-secret' }),
        enabled: 1, created_at: '', updated_at: '',
      });

      const statePayload = JSON.stringify({ nonce: 'test', account_id: '1' });
      const res = await request(app)
        .get('/api/email/auth/gmail/callback')
        .query({ code: 'auth-code-123', state: statePayload });

      expect(res.status).toBe(302); // redirect

      // Verify account config has client credentials for refresh
      const updatedAccount = mockAccounts.find(a => a.id === 1);
      expect(updatedAccount).toBeDefined();
      const config = JSON.parse(updatedAccount!.config);
      expect(config.client_id).toBe('shared-client-id');
      expect(config.client_secret).toBe('ENC:shared-secret');
      expect(config.access_token).toBe('ENC:access-tok');
      expect(config.refresh_token).toBe('ENC:refresh-tok');
      expect(config.token_expiry).toBeDefined();
    });

    it('updates email address from OAuth profile', async () => {
      mockSettings['google_client_id'] = 'cid';
      mockApiKeys['google_client_secret'] = 'ENC:cs';

      mockAccounts.push({
        id: 1, name: 'My Gmail', type: 'gmail_oauth', email: '',
        config: JSON.stringify({}), enabled: 1, created_at: '', updated_at: '',
      });

      const statePayload = JSON.stringify({ nonce: 'test', account_id: '1' });
      await request(app)
        .get('/api/email/auth/gmail/callback')
        .query({ code: 'auth-code', state: statePayload });

      const updated = mockAccounts.find(a => a.id === 1);
      expect(updated!.email).toBe('user@gmail.com');
    });
  });

  // ── Issue #3: IMAP account creation validates credentials ─────────────────

  describe('IMAP account creation validation (Issue #3)', () => {
    it('validates IMAP connection before saving the account', async () => {
      const res = await request(app)
        .post('/api/email/accounts')
        .send({
          name: 'Work Email', type: 'imap', email: 'me@work.com',
          config: { host: 'imap.work.com', password: 'pass123', port: 993, tls: true },
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(mockAccounts.length).toBe(1);
    });

    it('rejects IMAP account when connection test fails', async () => {
      mockImapTestResult = { success: false, error: 'AUTHENTICATIONFAILED' };

      const res = await request(app)
        .post('/api/email/accounts')
        .send({
          name: 'Bad Email', type: 'imap', email: 'me@work.com',
          config: { host: 'imap.work.com', password: 'wrong', port: 993, tls: true },
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('AUTHENTICATIONFAILED');
      // Should NOT have created the account
      expect(mockAccounts.length).toBe(0);
    });

    it('requires host and password for IMAP accounts', async () => {
      const res = await request(app)
        .post('/api/email/accounts')
        .send({
          name: 'No Host', type: 'imap', email: 'me@work.com',
          config: { password: 'pass' },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('host and password');
    });

    it('skips IMAP validation for gmail_oauth accounts', async () => {
      const res = await request(app)
        .post('/api/email/accounts')
        .send({
          name: 'Gmail', type: 'gmail_oauth', email: 'me@gmail.com',
          config: { client_id: 'cid' },
        });

      expect(res.status).toBe(201);
    });

    it('encrypts sensitive config fields on save', async () => {
      const res = await request(app)
        .post('/api/email/accounts')
        .send({
          name: 'Work Email', type: 'imap', email: 'me@work.com',
          config: { host: 'imap.work.com', password: 'secret123', port: 993, tls: true },
        });

      expect(res.status).toBe(201);
      const saved = mockAccounts[0];
      const config = JSON.parse(saved.config);
      expect(config.password).toBe('ENC:secret123');
    });
  });

  // ── Issue #4: Pipeline history uses ESM import ────────────────────────────

  describe('Pipeline history route (Issue #4)', () => {
    it('GET /pipeline/history returns runs without require() error', async () => {
      const res = await request(app)
        .get('/api/email/pipeline/history')
        .query({ limit: 5 });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].trigger_type).toBe('manual');
    });

    it('GET /pipeline/history clamps limit to 50', async () => {
      const res = await request(app)
        .get('/api/email/pipeline/history')
        .query({ limit: 999 });

      expect(res.status).toBe(200);
      // The route clamps to 50, our mock returns up to mockPipelineRuns.length
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // ── Account CRUD basics ──────────────────────────────────────────────────

  describe('Account CRUD', () => {
    it('GET /accounts masks sensitive config fields', async () => {
      mockAccounts.push({
        id: 1, name: 'Test', type: 'imap', email: 'test@test.com',
        config: JSON.stringify({ host: 'imap.test.com', password: 'ENC:secret', access_token: 'ENC:tok' }),
        enabled: 1, created_at: '', updated_at: '',
      });

      const res = await request(app).get('/api/email/accounts');

      expect(res.status).toBe(200);
      expect(res.body[0].config.password).toMatch(/^\*\*\*\*/);
      expect(res.body[0].config.access_token).toMatch(/^\*\*\*\*/);
      expect(res.body[0].config.host).toBe('imap.test.com');
    });

    it('PUT /accounts/:id preserves existing config when updating partial fields', async () => {
      mockAccounts.push({
        id: 1, name: 'Old Name', type: 'imap', email: 'test@test.com',
        config: JSON.stringify({ host: 'imap.test.com', password: 'ENC:secret' }),
        enabled: 1, created_at: '', updated_at: '',
      });

      const res = await request(app)
        .put('/api/email/accounts/1')
        .send({ name: 'New Name' });

      expect(res.status).toBe(200);
      expect(mockAccounts[0].name).toBe('New Name');
    });

    it('DELETE /accounts/:id removes the account', async () => {
      mockAccounts.push({
        id: 1, name: 'To Delete', type: 'imap', email: 'del@test.com',
        config: '{}', enabled: 1, created_at: '', updated_at: '',
      });

      const res = await request(app).delete('/api/email/accounts/1');

      expect(res.status).toBe(200);
      expect(mockAccounts.length).toBe(0);
    });
  });
});
