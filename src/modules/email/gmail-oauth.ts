import { OAuth2Client } from 'google-auth-library';
import { randomBytes } from 'node:crypto';
import { getGmailAuth, setGmailAuth, getSetting, setSetting, getApiKey, setApiKey } from './db.js';
import { encrypt, decrypt } from './crypto.js';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/spreadsheets', // Required for Google Sheets destination push
];

function getGoogleCredentials(): { clientId: string; clientSecret: string } {
  const clientId = getSetting('google_client_id') || process.env.GOOGLE_CLIENT_ID;

  // Primary: encrypted secret in api_keys table
  const encryptedSecret = getApiKey('google_client_secret');
  let clientSecret: string | undefined;
  if (encryptedSecret) {
    clientSecret = decrypt(encryptedSecret);
  }

  // Migration fallback: older installs may have stored the secret as plain text in settings
  if (!clientSecret) {
    const legacySecret = getSetting('google_client_secret');
    if (legacySecret && legacySecret !== '****') {
      clientSecret = legacySecret;
      // Migrate to encrypted storage and clean up the plain-text setting
      setApiKey('google_client_secret', encrypt(legacySecret));
      setSetting('google_client_secret', '');
    }
  }

  if (!clientSecret) {
    clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  }

  if (!clientId || !clientSecret) {
    throw new Error(
      'Google OAuth credentials not configured. Go to the Gmail tab to enter your Client ID and Client Secret.'
    );
  }

  return { clientId, clientSecret };
}

/**
 * Build the OAuth redirect URI from trusted configuration only.
 * SECURITY: Never derive from request Host headers — they can be spoofed.
 */
function getRedirectUri(): string {
  const storedUrl = getSetting('app_url');
  const baseUrl = storedUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4000';
  return `${baseUrl}/api/email/auth/gmail/callback`;
}

function getOAuth2Client(): OAuth2Client {
  const { clientId, clientSecret } = getGoogleCredentials();
  return new OAuth2Client(clientId, clientSecret, getRedirectUri());
}

/**
 * Generate a cryptographic state nonce, persist it, and return the auth URL.
 * The nonce MUST be verified in the callback via verifyOAuthState().
 */
export function getAuthUrl(accountId?: string): string {
  const nonce = randomBytes(24).toString('hex');
  const statePayload: Record<string, string> = { nonce };
  if (accountId) statePayload['account_id'] = accountId;

  // Persist nonce for verification on callback
  setSetting('gmail_oauth_state_nonce', nonce);

  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state: JSON.stringify(statePayload),
  });
}

/**
 * Verify the state parameter from an OAuth callback.
 * Returns the parsed state payload if valid, throws if invalid/missing.
 */
export function verifyOAuthState(stateParam: string | undefined): Record<string, string> {
  if (!stateParam) {
    throw new Error('OAuth callback missing state parameter — possible CSRF attack');
  }

  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(stateParam);
  } catch {
    throw new Error('OAuth callback has malformed state parameter');
  }

  const expectedNonce = getSetting('gmail_oauth_state_nonce');
  if (!expectedNonce || !parsed['nonce'] || parsed['nonce'] !== expectedNonce) {
    throw new Error('OAuth state nonce mismatch — possible CSRF attack');
  }

  // Clear the nonce after successful verification (one-time use)
  setSetting('gmail_oauth_state_nonce', '');

  return parsed;
}

export function getRedirectUriForDisplay(): string {
  return getRedirectUri();
}

export function hasGoogleCredentials(): boolean {
  const clientId = getSetting('google_client_id') || process.env.GOOGLE_CLIENT_ID;
  const encryptedSecret = getApiKey('google_client_secret');
  // Also check legacy plain-text setting for migration compat
  const legacySecret = getSetting('google_client_secret');
  const hasSecret = !!(encryptedSecret || (legacySecret && legacySecret !== '****') || process.env.GOOGLE_CLIENT_SECRET);
  return !!(clientId && hasSecret);
}

export async function exchangeCode(code: string): Promise<{
  email: string;
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}> {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Failed to obtain tokens from Google');
  }

  // Get user email from Gmail profile (works with gmail.readonly scope)
  let email = 'unknown';
  try {
    const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (profileRes.ok) {
      const profile = await profileRes.json() as any;
      email = profile.emailAddress || 'unknown';
    }
  } catch {
    // Fall back to unknown if profile fetch fails
  }

  // Encrypt and store
  const encryptedAccess = encrypt(tokens.access_token);
  const encryptedRefresh = encrypt(tokens.refresh_token);
  const expiry = new Date(tokens.expiry_date || Date.now() + 3600000).toISOString();

  setGmailAuth({
    email,
    access_token: encryptedAccess,
    refresh_token: encryptedRefresh,
    token_expiry: expiry,
    scopes: SCOPES.join(','),
  });

  return {
    email,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date || Date.now() + 3600000,
  };
}

export async function repairUnknownEmail(): Promise<string | null> {
  const auth = getGmailAuth();
  if (!auth || auth.email !== 'unknown') return auth?.email || null;

  try {
    const accessToken = await getValidAccessToken();
    const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (profileRes.ok) {
      const profile = await profileRes.json() as any;
      if (profile.emailAddress) {
        setGmailAuth({
          email: profile.emailAddress,
          access_token: auth.access_token,
          refresh_token: auth.refresh_token,
          token_expiry: auth.token_expiry,
          scopes: auth.scopes,
        });
        return profile.emailAddress;
      }
    }
  } catch {
    // If repair fails, leave as-is
  }
  return null;
}

export async function getValidAccessToken(): Promise<string> {
  const auth = getGmailAuth();
  if (!auth) {
    throw new Error('Gmail not connected. Please connect your Gmail account first.');
  }

  let accessToken: string;
  let refreshToken: string;
  try {
    accessToken = decrypt(auth.access_token);
    refreshToken = decrypt(auth.refresh_token);
  } catch {
    throw new Error('Gmail credentials are corrupted. Please reconnect your Gmail account in Settings.');
  }
  const expiryDate = new Date(auth.token_expiry).getTime();

  // If token is still valid (with 5-minute buffer), return it
  if (Date.now() < expiryDate - 5 * 60 * 1000) {
    return accessToken;
  }

  // Refresh the token
  const client = getOAuth2Client();
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  const { credentials } = await client.refreshAccessToken();
  if (!credentials.access_token) {
    throw new Error('Failed to refresh Gmail access token. Please reconnect your account.');
  }

  const newExpiry = new Date(credentials.expiry_date || Date.now() + 3600000).toISOString();

  setGmailAuth({
    email: auth.email,
    access_token: encrypt(credentials.access_token),
    refresh_token: encrypt(credentials.refresh_token || refreshToken),
    token_expiry: newExpiry,
    scopes: auth.scopes,
  });

  return credentials.access_token;
}

export function getAuthenticatedClient(): OAuth2Client {
  const auth = getGmailAuth();
  if (!auth) {
    throw new Error('Gmail not connected');
  }

  const client = getOAuth2Client();
  try {
    client.setCredentials({
      access_token: decrypt(auth.access_token),
      refresh_token: decrypt(auth.refresh_token),
    });
  } catch {
    throw new Error('Gmail credentials are corrupted. Please reconnect your Gmail account in Settings.');
  }
  return client;
}
