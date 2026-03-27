// ── SimpleFIN Bridge Client ──────────────────────────────────────────────────
// Connects to beta-bridge.simplefin.org to fetch bank/credit card balances
// and transactions. Used for seller spending capacity tracking.
//
// Protocol: https://www.simplefin.org/protocol.html
// Rate limit: 24 requests/day, 90-day transaction window.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SimpleFINAccount {
  id: string;
  name: string;
  currency: string;
  balance: number;
  'available-balance'?: number;
  'balance-date': number; // Unix epoch
  transactions?: SimpleFINTransaction[];
  org?: { name?: string; url?: string };
}

export interface SimpleFINTransaction {
  id: string;
  posted: number; // Unix epoch (0 if pending)
  amount: number; // negative = withdrawal, positive = deposit
  description: string;
  transacted_at?: number;
  pending?: boolean;
}

export interface SimpleFINResponse {
  errors: string[];
  accounts: SimpleFINAccount[];
}

// ── Credential Storage ──────────────────────────────────────────────────────
// Uses the same encryption pattern as marketplace credentials.

const SIMPLEFIN_CREDS_FILE = path.join(os.homedir(), '.hivemind', 'simplefin-credentials.enc');
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function deriveKey(): Buffer {
  const machineId = [os.hostname(), os.userInfo().username, os.homedir(), os.platform(), os.arch()].join('::');
  return crypto.pbkdf2Sync(machineId, 'hivemind-simplefin-v1', 100_000, KEY_LENGTH, 'sha512');
}

function encrypt(data: string): Buffer {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

function decrypt(buffer: Buffer): string {
  const key = deriveKey();
  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buffer.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
}

interface StoredCreds {
  accessUrl: string;
  connectedAt: string;
  lastSyncAt?: string;
}

export function saveSimpleFINAccessUrl(accessUrl: string): void {
  const dir = path.dirname(SIMPLEFIN_CREDS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const data: StoredCreds = { accessUrl, connectedAt: new Date().toISOString() };
  fs.writeFileSync(SIMPLEFIN_CREDS_FILE, encrypt(JSON.stringify(data)));
}

export function loadSimpleFINAccessUrl(): StoredCreds | null {
  try {
    if (!fs.existsSync(SIMPLEFIN_CREDS_FILE)) return null;
    return JSON.parse(decrypt(fs.readFileSync(SIMPLEFIN_CREDS_FILE)));
  } catch {
    return null;
  }
}

export function removeSimpleFINCredentials(): void {
  try { if (fs.existsSync(SIMPLEFIN_CREDS_FILE)) fs.unlinkSync(SIMPLEFIN_CREDS_FILE); } catch {}
}

export function isSimpleFINConnected(): boolean {
  return loadSimpleFINAccessUrl() !== null;
}

// ── API Client ──────────────────────────────────────────────────────────────

/**
 * Exchange a Setup Token for an Access URL.
 * Setup Tokens are base64-encoded URLs. POST to them with Content-Length: 0
 * to receive the Access URL (which contains embedded Basic Auth credentials).
 */
export async function claimSetupToken(setupToken: string): Promise<string> {
  // Decode the setup token (base64 → URL)
  const claimUrl = Buffer.from(setupToken.trim(), 'base64').toString('utf-8');

  if (!claimUrl.startsWith('http')) {
    throw new Error('Invalid setup token: decoded value is not a URL');
  }

  const response = await fetch(claimUrl, {
    method: 'POST',
    headers: { 'Content-Length': '0' },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`SimpleFIN claim failed (${response.status}): ${body || response.statusText}`);
  }

  const accessUrl = await response.text();
  if (!accessUrl.includes('@')) {
    throw new Error('SimpleFIN claim returned an invalid access URL');
  }

  return accessUrl.trim();
}

/**
 * Fetch accounts and transactions from SimpleFIN Bridge.
 * @param accessUrl - The access URL with embedded Basic Auth credentials
 * @param options - Optional filters (balancesOnly, startDate, endDate)
 */
export async function fetchAccounts(
  accessUrl: string,
  options?: {
    balancesOnly?: boolean;
    startDate?: number; // Unix epoch
    endDate?: number;   // Unix epoch
    accountId?: string;
  },
): Promise<SimpleFINResponse> {
  // Build the request URL
  const url = new URL(accessUrl.replace(/\/$/, '') + '/accounts');
  url.searchParams.set('version', '2');

  if (options?.balancesOnly) url.searchParams.set('balances-only', '1');
  if (options?.startDate) url.searchParams.set('start-date', String(options.startDate));
  if (options?.endDate) url.searchParams.set('end-date', String(options.endDate));
  if (options?.accountId) url.searchParams.set('account', options.accountId);

  // Extract Basic Auth from the URL (format: scheme://user:pass@host/path)
  const parsedUrl = new URL(accessUrl);
  const username = parsedUrl.username;
  const password = parsedUrl.password;
  const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

  // Build a clean URL without credentials for the actual request
  const cleanUrl = new URL(url.toString());
  cleanUrl.username = '';
  cleanUrl.password = '';

  const response = await fetch(cleanUrl.toString(), {
    method: 'GET',
    headers: { Authorization: authHeader },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`SimpleFIN fetch failed (${response.status}): ${body || response.statusText}`);
  }

  const data = await response.json() as any;

  // Normalize the response
  const accounts: SimpleFINAccount[] = (data.accounts || []).map((a: any) => ({
    id: a.id,
    name: a.name || 'Unknown Account',
    currency: a.currency || 'USD',
    balance: parseFloat(a.balance) || 0,
    'available-balance': a['available-balance'] != null ? parseFloat(a['available-balance']) : undefined,
    'balance-date': a['balance-date'] || 0,
    transactions: (a.transactions || []).map((t: any) => ({
      id: t.id,
      posted: t.posted || 0,
      amount: parseFloat(t.amount) || 0,
      description: t.description || '',
      transacted_at: t.transacted_at,
      pending: t.pending || false,
    })),
    org: a.org,
  }));

  return {
    errors: data.errors || [],
    accounts,
  };
}

/**
 * High-level: sync accounts using stored credentials.
 * Returns null if not connected.
 */
export async function syncAccounts(options?: {
  balancesOnly?: boolean;
  startDate?: number;
  endDate?: number;
}): Promise<SimpleFINResponse | null> {
  const creds = loadSimpleFINAccessUrl();
  if (!creds) return null;

  const result = await fetchAccounts(creds.accessUrl, options);

  // Update last sync time
  const updated: StoredCreds = { ...creds, lastSyncAt: new Date().toISOString() };
  const dir = path.dirname(SIMPLEFIN_CREDS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SIMPLEFIN_CREDS_FILE, encrypt(JSON.stringify(updated)));

  return result;
}
