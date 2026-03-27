/**
 * Email client abstraction layer.
 *
 * This is the ONLY file the pipeline should import for email operations.
 * It dispatches to either gmail-client (OAuth) or imap-client based on
 * the account type.
 *
 * Supports both:
 * - Legacy single-account mode (reads `connection_type` setting)
 * - Multi-account mode (iterates `email_accounts` table)
 */

import { getSetting, getAllEmailAccounts, type EmailAccountRow } from './db.js';
import * as gmailClient from './gmail-client.js';
import * as imapClient from './imap-client.js';
import { createImapClientForAccount } from './imap-client.js';
import { createGmailClientForAccount } from './gmail-client.js';
import type { EmailData, AttachmentData } from './types.js';

export type EmailClient = {
  searchRecentMessages: (sinceMinutes?: number, maxResults?: number, sinceUid?: number) => Promise<EmailData[]>;
  getMessageMetadata: (messageId: string) => Promise<EmailData>;
  getMessageBody: (messageId: string) => Promise<string>;
  getMessageHtml: (messageId: string) => Promise<string | null>;
  getAttachments: (messageId: string, mimeFilter?: string) => Promise<AttachmentData[]>;
};

/**
 * Get a bound email client for a specific account.
 * Used by the pipeline when iterating over multiple accounts.
 */
export function getClientForAccount(account: EmailAccountRow): EmailClient {
  const config = JSON.parse(account.config) as Record<string, unknown>;

  if (account.type === 'imap') {
    return createImapClientForAccount({
      email: account.email,
      password: config.password as string,
      host: config.host as string,
      port: (config.port as number) ?? 993,
      tls: config.tls !== false,
    });
  }

  if (account.type === 'gmail_oauth') {
    return createGmailClientForAccount({
      access_token: config.access_token as string,
      refresh_token: config.refresh_token as string,
      token_expiry: config.token_expiry as string,
      client_id: config.client_id as string,
      client_secret: config.client_secret as string,
      accountId: account.id,
    });
  }

  throw new Error(`Unknown account type: ${account.type}`);
}

/**
 * Get all enabled email accounts.
 */
export function getEnabledAccounts(): EmailAccountRow[] {
  return getAllEmailAccounts().filter(a => a.enabled);
}

// ── Legacy single-client dispatch (used by rescan and backwards compat) ──────

function getClient(): EmailClient {
  // First try multi-account
  const accounts = getEnabledAccounts();
  if (accounts.length > 0) {
    return getClientForAccount(accounts[0]);
  }

  // Fall back to legacy singleton
  const type = getSetting('connection_type');
  if (type === 'imap') return imapClient;
  if (type === 'gmail_oauth') return gmailClient;
  throw new Error('No email connection configured. Go to the Accounts page to set up an email account.');
}

export async function searchRecentMessages(
  sinceMinutes?: number,
  maxResults?: number,
): Promise<EmailData[]> {
  return getClient().searchRecentMessages(sinceMinutes, maxResults);
}

export async function getMessageMetadata(messageId: string): Promise<EmailData> {
  return getClient().getMessageMetadata(messageId);
}

export async function getMessageBody(messageId: string): Promise<string> {
  return getClient().getMessageBody(messageId);
}

export async function getMessageHtml(messageId: string): Promise<string | null> {
  return getClient().getMessageHtml(messageId);
}

export async function getAttachments(
  messageId: string,
  mimeFilter?: string,
): Promise<AttachmentData[]> {
  return getClient().getAttachments(messageId, mimeFilter);
}

/**
 * Returns the current connection type for display purposes.
 */
export function getConnectionType(): 'none' | 'imap' | 'gmail_oauth' {
  const accounts = getEnabledAccounts();
  if (accounts.length > 0) return accounts[0].type;
  const type = getSetting('connection_type');
  if (type === 'imap' || type === 'gmail_oauth') return type;
  return 'none';
}
