import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { getImapAuth } from './db.js';
import { decrypt } from './crypto.js';
import type { EmailData, AttachmentData } from './types.js';

// ── Connection helper ─────────────────────────────────────────────────────────

async function withImapConnection<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const auth = getImapAuth();
  if (!auth) {
    throw new Error('No IMAP connection configured. Go to the Email page to set up IMAP.');
  }

  const password = decrypt(auth.password);

  const client = new ImapFlow({
    host: auth.host,
    port: auth.port,
    secure: !!auth.tls,
    auth: {
      user: auth.email,
      pass: password,
    },
    logger: false,
    // 30 second timeouts
    greetingTimeout: 30000,
    socketTimeout: 30000,
  } as ConstructorParameters<typeof ImapFlow>[0]);

  try {
    await client.connect();
    return await fn(client);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('AUTHENTICATIONFAILED') || message.includes('Invalid credentials')) {
      throw new Error('IMAP authentication failed. Check your email and app password.');
    }
    if (message.includes('ECONNREFUSED')) {
      throw new Error(`Could not connect to ${auth.host}:${auth.port}. Check host and port.`);
    }
    if (message.includes('ETIMEDOUT') || message.includes('timeout')) {
      throw new Error(`Connection to ${auth.host}:${auth.port} timed out.`);
    }
    throw err;
  } finally {
    try { await client.logout(); } catch { /* ignore logout errors */ }
  }
}

/**
 * Search for a message by its RFC 2822 Message-ID header.
 * Returns the IMAP sequence number (uid) or null if not found.
 */
async function findByMessageId(client: ImapFlow, messageId: string): Promise<number | null> {
  // Strip angle brackets if present for the header search value
  const cleanId = messageId.replace(/^<|>$/g, '');

  const result = await client.search({
    header: { 'Message-ID': `<${cleanId}>` },
  }, { uid: true });
  const uids = Array.isArray(result) ? result : [];

  if (uids.length === 0) {
    // Try without angle brackets in case the stored ID format differs
    const result2 = await client.search({
      header: { 'Message-ID': cleanId },
    }, { uid: true });
    const uids2 = Array.isArray(result2) ? result2 : [];
    return uids2.length > 0 ? uids2[0] : null;
  }
  return uids[0];
}

/**
 * Parse a raw email source buffer into a ParsedMail object.
 */
async function parseRawMessage(source: Buffer): Promise<ParsedMail> {
  return simpleParser(source);
}

/**
 * Extract the Message-ID from an envelope, cleaning angle brackets.
 */
function extractMessageId(envelope: { messageId?: string }): string {
  const raw = envelope.messageId || '';
  return raw.replace(/^<|>$/g, '');
}

// ── Exported functions (matching gmail-client.ts interface) ──────────────────

export async function searchRecentMessages(
  sinceMinutes: number = 20,
  maxResults: number = 50,
): Promise<EmailData[]> {
  return withImapConnection(async (client) => {
    const lock = await client.getMailboxLock('INBOX');
    try {
      // IMAP SINCE uses date-only precision, so go back an extra day to be safe
      const cutoffDate = new Date(Date.now() - sinceMinutes * 60 * 1000);
      const searchDate = new Date(cutoffDate);
      searchDate.setDate(searchDate.getDate() - 1);

      // Format as IMAP date: DD-Mon-YYYY
      const searchResult = await client.search({
        since: searchDate,
      }, { uid: true });
      const uids = Array.isArray(searchResult) ? searchResult : [];

      if (uids.length === 0) return [];

      const output: EmailData[] = [];

      // Fetch envelopes for all matched messages
      for await (const msg of client.fetch(uids, {
        envelope: true,
        uid: true,
        bodyStructure: true,
      }, { uid: true })) {
        const env = msg.envelope;
        if (!env) continue;

        // Client-side minute-precision filter
        const msgDate = env.date ? new Date(env.date) : new Date();
        if (msgDate < cutoffDate) continue;

        const from = env.from?.[0];
        const fromEmail = from?.address || '';
        const fromName = from?.name || '';
        const messageId = extractMessageId(env);

        output.push({
          message_id: messageId,
          thread_id: messageId, // IMAP has no threading concept
          subject: env.subject || '(no subject)',
          from_email: fromEmail,
          from_name: fromName,
          snippet: '', // Will be populated below if needed
          date: env.date ? new Date(env.date).toUTCString() : '',
        });
      }

      // Sort by date descending
      output.sort((a, b) => {
        const da = a.date ? new Date(a.date).getTime() : 0;
        const db = b.date ? new Date(b.date).getTime() : 0;
        return db - da;
      });

      // Limit results
      return output.slice(0, maxResults);
    } finally {
      lock.release();
    }
  });
}

export async function getMessageMetadata(messageId: string): Promise<EmailData> {
  return withImapConnection(async (client) => {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uid = await findByMessageId(client, messageId);
      if (!uid) {
        throw new Error(`Message not found: ${messageId}`);
      }

      const fetchResult = await client.fetchOne(uid, {
        envelope: true,
      }, { uid: true });
      if (!fetchResult) {
        throw new Error(`Failed to fetch message: ${messageId}`);
      }

      const env = fetchResult.envelope;
      if (!env) {
        throw new Error(`No envelope data for message: ${messageId}`);
      }
      const from = env.from?.[0];

      return {
        message_id: extractMessageId(env),
        thread_id: extractMessageId(env),
        subject: env.subject || '(no subject)',
        from_email: from?.address || '',
        from_name: from?.name || '',
        snippet: '',
        date: env.date ? new Date(env.date).toUTCString() : '',
      };
    } finally {
      lock.release();
    }
  });
}

export async function getMessageBody(messageId: string): Promise<string> {
  return withImapConnection(async (client) => {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uid = await findByMessageId(client, messageId);
      if (!uid) {
        throw new Error(`Message not found: ${messageId}`);
      }

      // Download full message source
      const fetchResult = await client.fetchOne(uid, {
        source: true,
      }, { uid: true });
      if (!fetchResult) {
        throw new Error(`Failed to fetch message: ${messageId}`);
      }

      if (!fetchResult.source) {
        throw new Error(`No message source for: ${messageId}`);
      }
      const parsed = await parseRawMessage(fetchResult.source);

      // Prefer plain text, fallback to stripped HTML (same as gmail-client)
      if (parsed.text) {
        return parsed.text;
      }
      if (parsed.html) {
        // Strip HTML tags
        return (typeof parsed.html === 'string' ? parsed.html : '').replace(/<[^>]+>/g, '');
      }
      return '';
    } finally {
      lock.release();
    }
  });
}

export async function getMessageHtml(messageId: string): Promise<string | null> {
  return withImapConnection(async (client) => {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uid = await findByMessageId(client, messageId);
      if (!uid) throw new Error(`Message not found: ${messageId}`);
      const fetchResult = await client.fetchOne(uid, { source: true }, { uid: true });
      if (!fetchResult) throw new Error(`Failed to fetch message: ${messageId}`);
      if (!fetchResult.source) throw new Error(`No message source for: ${messageId}`);
      const parsed = await parseRawMessage(fetchResult.source);
      if (parsed.html && typeof parsed.html === 'string') return parsed.html;
      return null;
    } finally {
      lock.release();
    }
  });
}

export async function getAttachments(
  messageId: string,
  mimeFilter?: string,
): Promise<AttachmentData[]> {
  return withImapConnection(async (client) => {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uid = await findByMessageId(client, messageId);
      if (!uid) {
        throw new Error(`Message not found: ${messageId}`);
      }

      const fetchResult = await client.fetchOne(uid, {
        source: true,
      }, { uid: true });
      if (!fetchResult) {
        throw new Error(`Failed to fetch message: ${messageId}`);
      }

      if (!fetchResult.source) {
        throw new Error(`No message source for: ${messageId}`);
      }
      const parsed = await parseRawMessage(fetchResult.source);
      const attachments: AttachmentData[] = [];

      for (const att of parsed.attachments || []) {
        const mimeType = att.contentType || 'application/octet-stream';
        if (mimeFilter && mimeType !== mimeFilter) continue;

        attachments.push({
          filename: att.filename || 'attachment',
          mime_type: mimeType,
          data_bytes: att.content,
        });
      }

      return attachments;
    } finally {
      lock.release();
    }
  });
}

// ── Factory: per-account IMAP client ─────────────────────────────────────────

export interface ImapAccountConfig {
  email: string;
  password: string; // encrypted inner password
  host: string;
  port: number;
  tls: boolean;
}

export function createImapClientForAccount(accountConfig: ImapAccountConfig) {
  async function withConn<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const password = decrypt(accountConfig.password);
    const client = new ImapFlow({
      host: accountConfig.host,
      port: accountConfig.port,
      secure: accountConfig.tls,
      auth: { user: accountConfig.email, pass: password },
      logger: false,
      greetingTimeout: 30000,
      socketTimeout: 30000,
    } as ConstructorParameters<typeof ImapFlow>[0]);

    try {
      await client.connect();
      return await fn(client);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('AUTHENTICATIONFAILED') || message.includes('Invalid credentials')) {
        throw new Error(`IMAP auth failed for ${accountConfig.email}.`);
      }
      if (message.includes('ECONNREFUSED')) {
        throw new Error(`Could not connect to ${accountConfig.host}:${accountConfig.port}.`);
      }
      if (message.includes('ETIMEDOUT') || message.includes('timeout')) {
        throw new Error(`Connection to ${accountConfig.host}:${accountConfig.port} timed out.`);
      }
      throw err;
    } finally {
      try { await client.logout(); } catch { /* ignore */ }
    }
  }

  return {
    searchRecentMessages: (sinceMinutes?: number, maxResults?: number): Promise<EmailData[]> =>
      withConn(async (client) => {
        const lock = await client.getMailboxLock('INBOX');
        try {
          const cutoffDate = new Date(Date.now() - (sinceMinutes ?? 20) * 60 * 1000);
          const searchDate = new Date(cutoffDate);
          searchDate.setDate(searchDate.getDate() - 1);
          const searchResult = await client.search({ since: searchDate }, { uid: true });
          const uids = Array.isArray(searchResult) ? searchResult : [];
          if (uids.length === 0) return [];
          const output: EmailData[] = [];
          for await (const msg of client.fetch(uids, { envelope: true, uid: true, bodyStructure: true }, { uid: true })) {
            const env = msg.envelope;
            if (!env) continue;
            const msgDate = env.date ? new Date(env.date) : new Date();
            if (msgDate < cutoffDate) continue;
            const from = env.from?.[0];
            output.push({
              message_id: extractMessageId(env),
              thread_id: extractMessageId(env),
              subject: env.subject || '(no subject)',
              from_email: from?.address || '',
              from_name: from?.name || '',
              snippet: '',
              date: env.date ? new Date(env.date).toUTCString() : '',
            });
          }
          output.sort((a, b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0));
          return output.slice(0, maxResults ?? 50);
        } finally {
          lock.release();
        }
      }),
    getMessageMetadata: (messageId: string): Promise<EmailData> =>
      withConn(async (client) => {
        const lock = await client.getMailboxLock('INBOX');
        try {
          const uid = await findByMessageId(client, messageId);
          if (!uid) throw new Error(`Message not found: ${messageId}`);
          const fetchResult = await client.fetchOne(uid, { envelope: true }, { uid: true }) as { envelope?: { subject?: string; from?: { address?: string; name?: string }[]; date?: string; messageId?: string } } | false;
          if (!fetchResult || !fetchResult.envelope) throw new Error(`No envelope for: ${messageId}`);
          const env = fetchResult.envelope;
          const from = env.from?.[0];
          return {
            message_id: extractMessageId(env), thread_id: extractMessageId(env),
            subject: env.subject || '(no subject)', from_email: from?.address || '',
            from_name: from?.name || '', snippet: '',
            date: env.date ? new Date(env.date).toUTCString() : '',
          };
        } finally { lock.release(); }
      }),
    getMessageBody: (messageId: string): Promise<string> =>
      withConn(async (client) => {
        const lock = await client.getMailboxLock('INBOX');
        try {
          const uid = await findByMessageId(client, messageId);
          if (!uid) throw new Error(`Message not found: ${messageId}`);
          const fetchResult = await client.fetchOne(uid, { source: true }, { uid: true }) as { source?: Buffer } | false;
          if (!fetchResult || !fetchResult.source) throw new Error(`No source for: ${messageId}`);
          const parsed = await parseRawMessage(fetchResult.source);
          if (parsed.text) return parsed.text;
          if (parsed.html) return (typeof parsed.html === 'string' ? parsed.html : '').replace(/<[^>]+>/g, '');
          return '';
        } finally { lock.release(); }
      }),
    getMessageHtml: (messageId: string): Promise<string | null> =>
      withConn(async (client) => {
        const lock = await client.getMailboxLock('INBOX');
        try {
          const uid = await findByMessageId(client, messageId);
          if (!uid) throw new Error(`Message not found: ${messageId}`);
          const fetchResult = await client.fetchOne(uid, { source: true }, { uid: true }) as { source?: Buffer } | false;
          if (!fetchResult || !fetchResult.source) throw new Error(`No source for: ${messageId}`);
          const parsed = await parseRawMessage(fetchResult.source);
          return (parsed.html && typeof parsed.html === 'string') ? parsed.html : null;
        } finally { lock.release(); }
      }),
    getAttachments: (messageId: string, mimeFilter?: string): Promise<AttachmentData[]> =>
      withConn(async (client) => {
        const lock = await client.getMailboxLock('INBOX');
        try {
          const uid = await findByMessageId(client, messageId);
          if (!uid) throw new Error(`Message not found: ${messageId}`);
          const fetchResult = await client.fetchOne(uid, { source: true }, { uid: true }) as { source?: Buffer } | false;
          if (!fetchResult || !fetchResult.source) throw new Error(`No source for: ${messageId}`);
          const parsed = await parseRawMessage(fetchResult.source);
          const attachments: AttachmentData[] = [];
          for (const att of parsed.attachments || []) {
            const mimeType = att.contentType || 'application/octet-stream';
            if (mimeFilter && mimeType !== mimeFilter) continue;
            attachments.push({ filename: att.filename || 'attachment', mime_type: mimeType, data_bytes: att.content });
          }
          return attachments;
        } finally { lock.release(); }
      }),
  };
}

// ── Test connection (used by API route) ──────────────────────────────────────

export async function testImapConnection(config: {
  email: string;
  password: string;
  host: string;
  port: number;
  tls: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.tls,
    auth: {
      user: config.email,
      pass: config.password,
    },
    logger: false,
    greetingTimeout: 15000,
    socketTimeout: 15000,
  } as ConstructorParameters<typeof ImapFlow>[0]);

  try {
    await client.connect();
    // Verify we can open INBOX
    const lock = await client.getMailboxLock('INBOX');
    lock.release();
    await client.logout();
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('AUTHENTICATIONFAILED') || message.includes('Invalid credentials')) {
      return { success: false, error: 'Authentication failed. Check your email and app password.' };
    }
    if (message.includes('ECONNREFUSED')) {
      return { success: false, error: `Could not connect to ${config.host}:${config.port}. Check host and port.` };
    }
    if (message.includes('ETIMEDOUT') || message.includes('timeout')) {
      return { success: false, error: `Connection to ${config.host}:${config.port} timed out.` };
    }
    return { success: false, error: message };
  }
}
