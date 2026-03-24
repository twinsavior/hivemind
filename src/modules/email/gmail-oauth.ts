import { OAuth2Client } from 'google-auth-library';
import { getGmailAuth, setGmailAuth, getSetting, getApiKey } from './db.js';
import { encrypt, decrypt } from './crypto.js';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

function getGoogleCredentials(): { clientId: string; clientSecret: string } {
  const clientId = getSetting('google_client_id') || process.env.GOOGLE_CLIENT_ID;
  const encryptedSecret = getApiKey('google_client_secret');
  const clientSecret = encryptedSecret ? decrypt(encryptedSecret) : process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Google OAuth credentials not configured. Go to the Gmail tab to enter your Client ID and Client Secret.'
    );
  }

  return { clientId, clientSecret };
}

function getRedirectUri(requestUrl?: string): string {
  if (requestUrl) {
    try {
      const url = new URL(requestUrl);
      return `${url.protocol}//${url.host}/api/email/auth/gmail/callback`;
    } catch {}
  }
  const storedUrl = getSetting('app_url');
  const baseUrl = storedUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4000';
  return `${baseUrl}/api/email/auth/gmail/callback`;
}

function getOAuth2Client(requestUrl?: string): OAuth2Client {
  const { clientId, clientSecret } = getGoogleCredentials();
  return new OAuth2Client(clientId, clientSecret, getRedirectUri(requestUrl));
}

export function getAuthUrl(requestUrl?: string, accountId?: string): string {
  const client = getOAuth2Client(requestUrl);
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state: accountId ? JSON.stringify({ account_id: accountId }) : undefined,
  });
}

export function getRedirectUriForDisplay(requestUrl?: string): string {
  return getRedirectUri(requestUrl);
}

export function hasGoogleCredentials(): boolean {
  const clientId = getSetting('google_client_id') || process.env.GOOGLE_CLIENT_ID;
  const encryptedSecret = getApiKey('google_client_secret');
  const clientSecret = encryptedSecret || process.env.GOOGLE_CLIENT_SECRET;
  return !!(clientId && clientSecret);
}

export async function exchangeCode(code: string, requestUrl?: string): Promise<{
  email: string;
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}> {
  const client = getOAuth2Client(requestUrl);
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

  const accessToken = decrypt(auth.access_token);
  const refreshToken = decrypt(auth.refresh_token);
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
  client.setCredentials({
    access_token: decrypt(auth.access_token),
    refresh_token: decrypt(auth.refresh_token),
  });
  return client;
}
