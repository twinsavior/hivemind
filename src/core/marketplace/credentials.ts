// ── Marketplace Credentials Storage ──────────────────────────────────────────
// Encrypted at rest using AES-256-GCM with a machine-derived key.
// All credentials stay local — never sent to any external server.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { MarketplaceCredentials, MarketplaceType } from './types.js';

const CREDENTIALS_FILE = path.join(os.homedir(), '.hivemind', 'marketplace-credentials.enc');
const CREDENTIALS_META = path.join(os.homedir(), '.hivemind', 'marketplace-credentials.meta');
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

// ── Key Derivation ───────────────────────────────────────────────────────────
// Derive encryption key from machine-specific entropy (hostname + username + mac).
// This means credentials are tied to this specific machine.

function deriveKey(): Buffer {
  const machineId = [
    os.hostname(),
    os.userInfo().username,
    os.homedir(),
    os.platform(),
    os.arch(),
  ].join('::');

  return crypto.pbkdf2Sync(machineId, 'hivemind-marketplace-v1', 100_000, KEY_LENGTH, 'sha512');
}

// ── Encrypt / Decrypt ────────────────────────────────────────────────────────

function encrypt(data: string): Buffer {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: [iv (16)] [tag (16)] [encrypted data]
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

// ── Storage ──────────────────────────────────────────────────────────────────

export interface CredentialStore {
  version: number;
  credentials: Record<MarketplaceType, MarketplaceCredentials | null>;
}

function ensureDir(): void {
  const dir = path.dirname(CREDENTIALS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function defaultStore(): CredentialStore {
  return {
    version: 1,
    credentials: {
      amazon: null,
      walmart: null,
      ebay: null,
    },
  };
}

/** Load all marketplace credentials (decrypted). */
export function loadCredentials(): CredentialStore {
  try {
    if (!fs.existsSync(CREDENTIALS_FILE)) return defaultStore();
    const raw = fs.readFileSync(CREDENTIALS_FILE);
    const json = decrypt(raw);
    return JSON.parse(json) as CredentialStore;
  } catch {
    console.warn('[Credentials] Failed to decrypt credentials, returning empty store');
    return defaultStore();
  }
}

/** Save all marketplace credentials (encrypted). */
export function saveCredentials(store: CredentialStore): void {
  ensureDir();
  const json = JSON.stringify(store, null, 2);
  const encrypted = encrypt(json);
  fs.writeFileSync(CREDENTIALS_FILE, encrypted);
  // Write unencrypted metadata (just which marketplaces are connected, no secrets)
  const meta = {
    version: store.version,
    connected: Object.entries(store.credentials)
      .filter(([, v]) => v?.connected)
      .map(([k]) => k),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(CREDENTIALS_META, JSON.stringify(meta, null, 2));
}

/** Get credentials for a specific marketplace. */
export function getMarketplaceCredentials(marketplace: MarketplaceType): MarketplaceCredentials | null {
  const store = loadCredentials();
  return store.credentials[marketplace] ?? null;
}

/** Save credentials for a specific marketplace. */
export function saveMarketplaceCredentials(
  marketplace: MarketplaceType,
  creds: MarketplaceCredentials,
): void {
  const store = loadCredentials();
  store.credentials[marketplace] = creds;
  saveCredentials(store);
}

/** Remove credentials for a specific marketplace. */
export function removeMarketplaceCredentials(marketplace: MarketplaceType): void {
  const store = loadCredentials();
  store.credentials[marketplace] = null;
  saveCredentials(store);
}

/** Check which marketplaces are connected (fast — reads metadata, no decryption). */
export function getConnectedMarketplaces(): MarketplaceType[] {
  try {
    if (!fs.existsSync(CREDENTIALS_META)) return [];
    const meta = JSON.parse(fs.readFileSync(CREDENTIALS_META, 'utf8'));
    return (meta.connected ?? []) as MarketplaceType[];
  } catch {
    return [];
  }
}

/** Update cached access token for a marketplace (avoids re-auth). */
export function updateAccessToken(
  marketplace: MarketplaceType,
  accessToken: string,
  expiresAt: number,
): void {
  const store = loadCredentials();
  const creds = store.credentials[marketplace];
  if (!creds) return;

  if (marketplace === 'amazon' && creds.amazon) {
    creds.amazon.accessToken = accessToken;
    creds.amazon.accessTokenExpiresAt = expiresAt;
  } else if (marketplace === 'walmart' && creds.walmart) {
    creds.walmart.accessToken = accessToken;
    creds.walmart.accessTokenExpiresAt = expiresAt;
  } else if (marketplace === 'ebay' && creds.ebay) {
    creds.ebay.accessToken = accessToken;
    creds.ebay.accessTokenExpiresAt = expiresAt;
  }

  saveCredentials(store);
}
