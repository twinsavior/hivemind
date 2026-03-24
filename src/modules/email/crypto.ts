import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

let _dataDir: string | null = null;

/** Set the data directory for the encryption key file. */
export function setEmailDataDir(dir: string): void {
  _dataDir = dir;
}

function getKeyFilePath(): string {
  return path.join(_dataDir ?? path.join(process.cwd(), 'data'), '.encryption-key');
}

function getKey(): Buffer {
  // 1. Check env var first (for advanced users / production)
  const envSecret = process.env.ENCRYPTION_SECRET;
  if (envSecret) {
    return crypto.createHash('sha256').update(envSecret).digest();
  }

  // 2. Check for auto-generated key file
  if (fs.existsSync(getKeyFilePath())) {
    const secret = fs.readFileSync(getKeyFilePath(), 'utf8').trim();
    return crypto.createHash('sha256').update(secret).digest();
  }

  // 3. Auto-generate key on first run
  const dir = path.dirname(getKeyFilePath());
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const newSecret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(getKeyFilePath(), newSecret, { mode: 0o600 });
  return crypto.createHash('sha256').update(newSecret).digest();
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted (all base64)
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted value format');
  }

  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  try {
    Buffer.from(parts[0], 'base64');
    Buffer.from(parts[1], 'base64');
    return true;
  } catch {
    return false;
  }
}
