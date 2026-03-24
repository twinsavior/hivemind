import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { getValidAccessToken } from './gmail-oauth.js';
import { decrypt, encrypt } from './crypto.js';
import { updateEmailAccount, getEmailAccount } from './db.js';
import type { EmailData, AttachmentData } from './types.js';

async function getGmailService() {
  const accessToken = await getValidAccessToken();
  const auth = new OAuth2Client();
  auth.setCredentials({ access_token: accessToken });
  return google.gmail({ version: 'v1', auth });
}

export async function searchRecentMessages(
  sinceMinutes: number = 20,
  maxResults: number = 50,
): Promise<EmailData[]> {
  const gmail = await getGmailService();
  const cutoff = Math.floor((Date.now() - sinceMinutes * 60 * 1000) / 1000);
  const query = `after:${cutoff} in:inbox`;

  const response = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults,
  });

  const messages = response.data.messages || [];
  const output: EmailData[] = [];

  for (const msgStub of messages) {
    if (!msgStub.id) continue;

    const msg = await gmail.users.messages.get({
      userId: 'me',
      id: msgStub.id,
      format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'Date'],
    });

    const headers: Record<string, string> = {};
    for (const h of msg.data.payload?.headers || []) {
      if (h.name && h.value) headers[h.name] = h.value;
    }

    const fromRaw = headers['From'] || '';
    const { name: fromName, email: fromEmail } = parseEmailAddress(fromRaw);

    output.push({
      message_id: msg.data.id || '',
      thread_id: msg.data.threadId || '',
      subject: headers['Subject'] || '(no subject)',
      from_email: fromEmail,
      from_name: fromName,
      snippet: msg.data.snippet || '',
      date: headers['Date'] || '',
    });
  }

  return output;
}

export async function getMessageMetadata(messageId: string): Promise<EmailData> {
  const gmail = await getGmailService();
  const msg = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'metadata',
    metadataHeaders: ['Subject', 'From', 'Date'],
  });

  const headers: Record<string, string> = {};
  for (const h of msg.data.payload?.headers || []) {
    if (h.name && h.value) headers[h.name] = h.value;
  }

  const fromRaw = headers['From'] || '';
  const { name: fromName, email: fromEmail } = parseEmailAddress(fromRaw);

  return {
    message_id: msg.data.id || '',
    thread_id: msg.data.threadId || '',
    subject: headers['Subject'] || '(no subject)',
    from_email: fromEmail,
    from_name: fromName,
    snippet: msg.data.snippet || '',
    date: headers['Date'] || '',
  };
}

export async function getMessageBody(messageId: string): Promise<string> {
  const gmail = await getGmailService();
  const msg = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  return extractText((msg.data.payload || {}) as Record<string, unknown>);
}

export async function getMessageHtml(messageId: string): Promise<string | null> {
  const gmail = await getGmailService();
  const msg = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  return extractHtml((msg.data.payload || {}) as Record<string, unknown>);
}

export async function getAttachments(
  messageId: string,
  mimeFilter?: string,
): Promise<AttachmentData[]> {
  const gmail = await getGmailService();
  const msg = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const attachments: AttachmentData[] = [];
  await collectAttachments(gmail, messageId, (msg.data.payload || {}) as Record<string, unknown>, attachments, mimeFilter);
  return attachments;
}

// ── Factory: per-account Gmail client ────────────────────────────────────────

export interface GmailAccountConfig {
  access_token: string;  // encrypted
  refresh_token: string; // encrypted
  token_expiry: string;
  client_id: string;
  client_secret: string; // encrypted
  accountId: number;
}

export function createGmailClientForAccount(accountConfig: GmailAccountConfig) {
  // decrypt, encrypt, updateEmailAccount, getEmailAccount imported at top level

  async function getAccountGmailService() {
    let accessToken = decrypt(accountConfig.access_token);
    const refreshToken = decrypt(accountConfig.refresh_token);
    const expiryDate = new Date(accountConfig.token_expiry).getTime();

    // If token expired, refresh it
    if (Date.now() >= expiryDate - 5 * 60 * 1000) {
      const clientSecret = decrypt(accountConfig.client_secret);
      const oauth = new OAuth2Client(accountConfig.client_id, clientSecret);
      oauth.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
      const { credentials } = await oauth.refreshAccessToken();
      if (!credentials.access_token) throw new Error('Failed to refresh Gmail access token');

      accessToken = credentials.access_token;
      const newExpiry = new Date(credentials.expiry_date || Date.now() + 3600000).toISOString();

      // Update stored config
      const account = getEmailAccount(accountConfig.accountId);
      if (account) {
        const config = JSON.parse(account.config);
        config.access_token = encrypt(credentials.access_token);
        if (credentials.refresh_token) config.refresh_token = encrypt(credentials.refresh_token);
        config.token_expiry = newExpiry;
        updateEmailAccount(accountConfig.accountId, { config: JSON.stringify(config) });
      }

      // Update in-memory config for subsequent calls in same pipeline run
      accountConfig.access_token = encrypt(credentials.access_token);
      if (credentials.refresh_token) accountConfig.refresh_token = encrypt(credentials.refresh_token);
      accountConfig.token_expiry = newExpiry;
    }

    const auth = new OAuth2Client();
    auth.setCredentials({ access_token: accessToken });
    return google.gmail({ version: 'v1', auth });
  }

  return {
    searchRecentMessages: async (sinceMinutes?: number, maxResults?: number): Promise<EmailData[]> => {
      const gmail = await getAccountGmailService();
      const cutoff = Math.floor((Date.now() - (sinceMinutes ?? 20) * 60 * 1000) / 1000);
      const query = `after:${cutoff} in:inbox`;
      const response = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: maxResults ?? 50 });
      const messages = response.data.messages || [];
      const output: EmailData[] = [];
      for (const msgStub of messages) {
        if (!msgStub.id) continue;
        const msg = await gmail.users.messages.get({
          userId: 'me', id: msgStub.id, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'],
        });
        const headers: Record<string, string> = {};
        for (const h of msg.data.payload?.headers || []) { if (h.name && h.value) headers[h.name] = h.value; }
        const fromRaw = headers['From'] || '';
        const { name: fromName, email: fromEmail } = parseEmailAddress(fromRaw);
        output.push({
          message_id: msg.data.id || '', thread_id: msg.data.threadId || '',
          subject: headers['Subject'] || '(no subject)', from_email: fromEmail,
          from_name: fromName, snippet: msg.data.snippet || '', date: headers['Date'] || '',
        });
      }
      return output;
    },
    getMessageMetadata: async (messageId: string): Promise<EmailData> => {
      const gmail = await getAccountGmailService();
      const msg = await gmail.users.messages.get({
        userId: 'me', id: messageId, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'],
      });
      const headers: Record<string, string> = {};
      for (const h of msg.data.payload?.headers || []) { if (h.name && h.value) headers[h.name] = h.value; }
      const fromRaw = headers['From'] || '';
      const { name: fromName, email: fromEmail } = parseEmailAddress(fromRaw);
      return {
        message_id: msg.data.id || '', thread_id: msg.data.threadId || '',
        subject: headers['Subject'] || '(no subject)', from_email: fromEmail,
        from_name: fromName, snippet: msg.data.snippet || '', date: headers['Date'] || '',
      };
    },
    getMessageBody: async (messageId: string): Promise<string> => {
      const gmail = await getAccountGmailService();
      const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
      return extractText((msg.data.payload || {}) as Record<string, unknown>);
    },
    getMessageHtml: async (messageId: string): Promise<string | null> => {
      const gmail = await getAccountGmailService();
      const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
      return extractHtml((msg.data.payload || {}) as Record<string, unknown>);
    },
    getAttachments: async (messageId: string, mimeFilter?: string): Promise<AttachmentData[]> => {
      const gmail = await getAccountGmailService();
      const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
      const attachments: AttachmentData[] = [];
      await collectAttachments(gmail, messageId, (msg.data.payload || {}) as Record<string, unknown>, attachments, mimeFilter);
      return attachments;
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseEmailAddress(raw: string): { name: string; email: string } {
  const match = raw.match(/^(.+?)\s*<(.+?)>$/);
  if (match) {
    return { name: match[1].replace(/^["']|["']$/g, '').trim(), email: match[2] };
  }
  return { name: '', email: raw.trim() };
}

function extractText(payload: Record<string, unknown>): string {
  const mimeType = (payload.mimeType as string) || '';

  if (mimeType === 'text/plain') {
    const data = ((payload.body as Record<string, unknown>)?.data as string) || '';
    if (data) {
      return Buffer.from(data, 'base64url').toString('utf-8');
    }
  }

  if (mimeType === 'text/html' && !payload.parts) {
    const data = ((payload.body as Record<string, unknown>)?.data as string) || '';
    if (data) {
      const html = Buffer.from(data, 'base64url').toString('utf-8');
      return html.replace(/<[^>]+>/g, '');
    }
  }

  const parts = (payload.parts as Record<string, unknown>[]) || [];
  for (const part of parts) {
    const text = extractText(part);
    if (text) return text;
  }

  return '';
}

/** Extract raw HTML from the email payload (mirrors extractText but preserves tags) */
function extractHtml(payload: Record<string, unknown>): string | null {
  const mimeType = (payload.mimeType as string) || '';

  if (mimeType === 'text/html') {
    const data = ((payload.body as Record<string, unknown>)?.data as string) || '';
    if (data) {
      return Buffer.from(data, 'base64url').toString('utf-8');
    }
  }

  const parts = (payload.parts as Record<string, unknown>[]) || [];
  for (const part of parts) {
    const html = extractHtml(part);
    if (html) return html;
  }

  return null;
}

async function collectAttachments(
  gmail: ReturnType<typeof google.gmail>,
  messageId: string,
  payload: Record<string, unknown>,
  attachments: AttachmentData[],
  mimeFilter?: string,
) {
  const filename = (payload.filename as string) || '';
  const body = (payload.body as Record<string, unknown>) || {};
  const attachmentId = body.attachmentId as string | undefined;

  if (filename && attachmentId) {
    const mimeType = (payload.mimeType as string) || 'application/octet-stream';
    if (!mimeFilter || mimeType === mimeFilter) {
      const attData = await gmail.users.messages.attachments.get({
        userId: 'me',
        id: attachmentId,
        messageId,
      });
      const dataBytes = Buffer.from(attData.data.data || '', 'base64url');
      attachments.push({ filename, mime_type: mimeType, data_bytes: dataBytes });
    }
  }

  const parts = (payload.parts as Record<string, unknown>[]) || [];
  for (const part of parts) {
    await collectAttachments(gmail, messageId, part, attachments, mimeFilter);
  }
}
