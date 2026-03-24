import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { initializeDatabase } from './db-schema.js';

let _dbPath: string | null = null;
let _db: Database.Database | null = null;

/**
 * Configure the email module's database path.
 * Must be called before any DB access. If not called,
 * falls back to `<cwd>/data/email.db`.
 */
export function setEmailDbPath(dbPath: string): void {
  if (_db) {
    _db.close();
    _db = null;
  }
  _dbPath = dbPath;
}

function getDb(): Database.Database {
  if (!_db) {
    const resolvedPath = _dbPath ?? path.join(process.cwd(), 'data', 'email.db');
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    _db = new Database(resolvedPath);
    initializeDatabase(_db);
  }
  return _db;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb().prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

// ── Gmail Auth ───────────────────────────────────────────────────────────────

export function getGmailAuth() {
  return getDb().prepare('SELECT * FROM gmail_auth WHERE id = 1').get() as {
    id: number; email: string; access_token: string; refresh_token: string;
    token_expiry: string; scopes: string; connected_at: string; updated_at: string;
  } | undefined;
}

export function setGmailAuth(data: {
  email: string; access_token: string; refresh_token: string;
  token_expiry: string; scopes: string;
}): void {
  getDb().prepare(
    `INSERT INTO gmail_auth (id, email, access_token, refresh_token, token_expiry, scopes, connected_at, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email, access_token = excluded.access_token,
       refresh_token = excluded.refresh_token, token_expiry = excluded.token_expiry,
       scopes = excluded.scopes, updated_at = excluded.updated_at`
  ).run(data.email, data.access_token, data.refresh_token, data.token_expiry, data.scopes);
}

export function deleteGmailAuth(): void {
  getDb().prepare('DELETE FROM gmail_auth WHERE id = 1').run();
}

// ── IMAP Auth ────────────────────────────────────────────────────────────────

export function getImapAuth() {
  return getDb().prepare('SELECT * FROM imap_auth WHERE id = 1').get() as {
    id: number; email: string; password: string; host: string;
    port: number; tls: number; connected_at: string; updated_at: string;
  } | undefined;
}

export function setImapAuth(data: {
  email: string; password: string; host: string; port: number; tls: boolean;
}): void {
  getDb().prepare(
    `INSERT INTO imap_auth (id, email, password, host, port, tls, connected_at, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email, password = excluded.password,
       host = excluded.host, port = excluded.port, tls = excluded.tls,
       updated_at = excluded.updated_at`
  ).run(data.email, data.password, data.host, data.port, data.tls ? 1 : 0);
}

export function deleteImapAuth(): void {
  getDb().prepare('DELETE FROM imap_auth WHERE id = 1').run();
}

// ── API Keys ─────────────────────────────────────────────────────────────────

export function getApiKey(service: string): string | null {
  const row = getDb().prepare('SELECT encrypted_key FROM api_keys WHERE service = ?').get(service) as { encrypted_key: string } | undefined;
  return row?.encrypted_key ?? null;
}

export function setApiKey(service: string, encryptedKey: string): void {
  getDb().prepare(
    `INSERT INTO api_keys (service, encrypted_key, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(service) DO UPDATE SET encrypted_key = excluded.encrypted_key, updated_at = excluded.updated_at`
  ).run(service, encryptedKey);
}

export function deleteApiKey(service: string): void {
  getDb().prepare('DELETE FROM api_keys WHERE service = ?').run(service);
}

// ── Extraction Config ────────────────────────────────────────────────────────

export function getExtractionConfig() {
  return getDb().prepare('SELECT * FROM extraction_config WHERE id = 1').get() as {
    id: number; model: string; system_prompt: string; extraction_schema: string;
    temperature: number; enabled: number; updated_at: string;
  } | undefined;
}

export function updateExtractionConfig(data: Partial<{
  model: string; system_prompt: string; extraction_schema: string;
  temperature: number; enabled: boolean;
}>): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.model !== undefined) { fields.push('model = ?'); values.push(data.model); }
  if (data.system_prompt !== undefined) { fields.push('system_prompt = ?'); values.push(data.system_prompt); }
  if (data.extraction_schema !== undefined) { fields.push('extraction_schema = ?'); values.push(data.extraction_schema); }
  if (data.temperature !== undefined) { fields.push('temperature = ?'); values.push(data.temperature); }
  if (data.enabled !== undefined) { fields.push('enabled = ?'); values.push(data.enabled ? 1 : 0); }

  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");

  getDb().prepare(`UPDATE extraction_config SET ${fields.join(', ')} WHERE id = 1`).run(...values);
}

// ── Flag Rules ───────────────────────────────────────────────────────────────

export function getAllRules() {
  return getDb().prepare('SELECT * FROM flag_rules ORDER BY priority DESC, name ASC').all() as Array<{
    id: number; name: string; keywords: string; required_keywords: string;
    sender_patterns: string; exclude_phrases: string; check_subject: number;
    check_body: number; check_snippet: number; require_attachment: number;
    priority: number; enabled: number; destination_ids: string;
    instructions: string; field_mappings: string; expected_fields: string;
    scan_all: number; template_id: string | null; created_at: string; updated_at: string;
  }>;
}

export function getRule(id: number) {
  return getDb().prepare('SELECT * FROM flag_rules WHERE id = ?').get(id) as ReturnType<typeof getAllRules>[number] | undefined;
}

export function createRule(data: {
  name: string; keywords?: string[]; required_keywords?: string[];
  sender_patterns?: string[]; exclude_phrases?: string[]; check_subject?: boolean;
  check_body?: boolean; check_snippet?: boolean; require_attachment?: boolean;
  priority?: number; enabled?: boolean; destination_ids?: number[];
  instructions?: string; field_mappings?: Record<string, Record<string, string>>;
  expected_fields?: string[]; scan_all?: boolean; template_id?: string;
  account_ids?: number[];
}): number {
  const result = getDb().prepare(
    `INSERT INTO flag_rules (name, keywords, required_keywords, sender_patterns, exclude_phrases,
     check_subject, check_body, check_snippet, require_attachment, priority, enabled, destination_ids,
     instructions, field_mappings, expected_fields, scan_all, template_id, account_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.name,
    JSON.stringify(data.keywords ?? []),
    JSON.stringify(data.required_keywords ?? []),
    JSON.stringify(data.sender_patterns ?? []),
    JSON.stringify(data.exclude_phrases ?? []),
    data.check_subject !== false ? 1 : 0,
    data.check_body !== false ? 1 : 0,
    data.check_snippet !== false ? 1 : 0,
    data.require_attachment ? 1 : 0,
    data.priority ?? 0,
    data.enabled !== false ? 1 : 0,
    JSON.stringify(data.destination_ids ?? []),
    data.instructions ?? '',
    JSON.stringify(data.field_mappings ?? {}),
    JSON.stringify(data.expected_fields ?? []),
    data.scan_all ? 1 : 0,
    data.template_id ?? null,
    JSON.stringify(data.account_ids ?? []),
  );
  return result.lastInsertRowid as number;
}

export function updateRule(id: number, data: Partial<{
  name: string; keywords: string[]; required_keywords: string[];
  sender_patterns: string[]; exclude_phrases: string[]; check_subject: boolean;
  check_body: boolean; check_snippet: boolean; require_attachment: boolean;
  priority: number; enabled: boolean; destination_ids: number[];
  instructions: string; field_mappings: Record<string, Record<string, string>>;
  expected_fields: string[]; scan_all: boolean; template_id: string | null;
  account_ids: number[];
}>): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
  if (data.keywords !== undefined) { fields.push('keywords = ?'); values.push(JSON.stringify(data.keywords)); }
  if (data.required_keywords !== undefined) { fields.push('required_keywords = ?'); values.push(JSON.stringify(data.required_keywords)); }
  if (data.sender_patterns !== undefined) { fields.push('sender_patterns = ?'); values.push(JSON.stringify(data.sender_patterns)); }
  if (data.exclude_phrases !== undefined) { fields.push('exclude_phrases = ?'); values.push(JSON.stringify(data.exclude_phrases)); }
  if (data.check_subject !== undefined) { fields.push('check_subject = ?'); values.push(data.check_subject ? 1 : 0); }
  if (data.check_body !== undefined) { fields.push('check_body = ?'); values.push(data.check_body ? 1 : 0); }
  if (data.check_snippet !== undefined) { fields.push('check_snippet = ?'); values.push(data.check_snippet ? 1 : 0); }
  if (data.require_attachment !== undefined) { fields.push('require_attachment = ?'); values.push(data.require_attachment ? 1 : 0); }
  if (data.priority !== undefined) { fields.push('priority = ?'); values.push(data.priority); }
  if (data.enabled !== undefined) { fields.push('enabled = ?'); values.push(data.enabled ? 1 : 0); }
  if (data.destination_ids !== undefined) { fields.push('destination_ids = ?'); values.push(JSON.stringify(data.destination_ids)); }
  if (data.instructions !== undefined) { fields.push('instructions = ?'); values.push(data.instructions); }
  if (data.field_mappings !== undefined) { fields.push('field_mappings = ?'); values.push(JSON.stringify(data.field_mappings)); }
  if (data.expected_fields !== undefined) { fields.push('expected_fields = ?'); values.push(JSON.stringify(data.expected_fields)); }
  if (data.scan_all !== undefined) { fields.push('scan_all = ?'); values.push(data.scan_all ? 1 : 0); }
  if (data.template_id !== undefined) { fields.push('template_id = ?'); values.push(data.template_id); }
  if (data.account_ids !== undefined) { fields.push('account_ids = ?'); values.push(JSON.stringify(data.account_ids)); }

  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  values.push(id);

  getDb().prepare(`UPDATE flag_rules SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteRule(id: number): void {
  getDb().prepare('DELETE FROM flag_rules WHERE id = ?').run(id);
}

// ── Destinations ─────────────────────────────────────────────────────────────

export function getAllDestinations() {
  return getDb().prepare('SELECT * FROM destinations ORDER BY name ASC').all() as Array<{
    id: number; name: string; type: string; config: string;
    field_mapping: string; enabled: number; created_at: string; updated_at: string;
  }>;
}

export function getDestination(id: number) {
  return getDb().prepare('SELECT * FROM destinations WHERE id = ?').get(id) as ReturnType<typeof getAllDestinations>[number] | undefined;
}

export function createDestination(data: {
  name: string; type: string; config: string;
  field_mapping?: string; enabled?: boolean;
}): number {
  const result = getDb().prepare(
    `INSERT INTO destinations (name, type, config, field_mapping, enabled) VALUES (?, ?, ?, ?, ?)`
  ).run(data.name, data.type, data.config, data.field_mapping ?? '{}', data.enabled !== false ? 1 : 0);
  return result.lastInsertRowid as number;
}

export function updateDestination(id: number, data: Partial<{
  name: string; type: string; config: string;
  field_mapping: string; enabled: boolean;
}>): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
  if (data.type !== undefined) { fields.push('type = ?'); values.push(data.type); }
  if (data.config !== undefined) { fields.push('config = ?'); values.push(data.config); }
  if (data.field_mapping !== undefined) { fields.push('field_mapping = ?'); values.push(data.field_mapping); }
  if (data.enabled !== undefined) { fields.push('enabled = ?'); values.push(data.enabled ? 1 : 0); }

  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  values.push(id);

  getDb().prepare(`UPDATE destinations SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteDestination(id: number): void {
  getDb().prepare('DELETE FROM destinations WHERE id = ?').run(id);
}

// ── Processed Emails ─────────────────────────────────────────────────────────

export function isEmailProcessed(gmailMessageId: string): boolean {
  const row = getDb().prepare('SELECT 1 FROM processed_emails WHERE gmail_message_id = ?').get(gmailMessageId);
  return !!row;
}

export function deleteProcessedEmail(gmailMessageId: string): void {
  getDb().prepare('DELETE FROM processed_emails WHERE gmail_message_id = ?').run(gmailMessageId);
}

export function clearProcessedEmails(onlySkipped: boolean = false): number {
  if (onlySkipped) {
    const result = getDb().prepare("DELETE FROM processed_emails WHERE status = 'skipped'").run();
    return result.changes;
  }
  const result = getDb().prepare('DELETE FROM processed_emails').run();
  return result.changes;
}

export function insertProcessedEmail(data: {
  gmail_message_id: string; thread_id?: string; subject?: string;
  from_email?: string; from_name?: string; received_date?: string;
  matched_rules?: string[]; extracted_data?: Record<string, unknown>;
  destinations_pushed?: number[]; status: string;
  error_message?: string; processing_time_ms?: number; pipeline_run_id?: number;
  prompt_tokens?: number; completion_tokens?: number; estimated_cost_usd?: number;
  account_id?: number;
}): number {
  const result = getDb().prepare(
    `INSERT INTO processed_emails (gmail_message_id, thread_id, subject, from_email, from_name,
     received_date, matched_rules, extracted_data, destinations_pushed, status,
     error_message, processing_time_ms, pipeline_run_id,
     prompt_tokens, completion_tokens, estimated_cost_usd, account_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.gmail_message_id, data.thread_id ?? null, data.subject ?? null,
    data.from_email ?? null, data.from_name ?? null, data.received_date ?? null,
    JSON.stringify(data.matched_rules ?? []),
    data.extracted_data ? JSON.stringify(data.extracted_data) : null,
    JSON.stringify(data.destinations_pushed ?? []),
    data.status, data.error_message ?? null,
    data.processing_time_ms ?? null, data.pipeline_run_id ?? null,
    data.prompt_tokens ?? null, data.completion_tokens ?? null, data.estimated_cost_usd ?? null,
    data.account_id ?? null,
  );
  return result.lastInsertRowid as number;
}

export function getProcessedEmails(options: {
  limit?: number; offset?: number; status?: string;
  rule?: string; search?: string;
} = {}) {
  const { limit = 50, offset = 0, status, rule, search } = options;
  let sql = 'SELECT * FROM processed_emails WHERE 1=1';
  const params: unknown[] = [];

  if (status === 'matched') {
    // "Matched" = all emails that matched rules (everything except skipped)
    sql += " AND status != 'skipped'";
  } else if (status) {
    sql += ' AND status = ?'; params.push(status);
  }
  if (rule) { sql += ' AND matched_rules LIKE ?'; params.push(`%"${rule}"%`); }
  if (search) { sql += ' AND (subject LIKE ? OR from_email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = getDb().prepare(sql).all(...params);

  const countSql = sql.replace(/SELECT \*/, 'SELECT COUNT(*) as count').replace(/ ORDER BY.*$/, '');
  const countParams = params.slice(0, -2);
  const countRow = getDb().prepare(countSql).get(...countParams) as { count: number };

  return { rows, total: countRow.count };
}

// ── Pipeline Runs ────────────────────────────────────────────────────────────

export function createPipelineRun(trigger: 'scheduled' | 'manual'): number {
  const result = getDb().prepare(
    `INSERT INTO pipeline_runs (trigger_type, status) VALUES (?, 'running')`
  ).run(trigger);
  return result.lastInsertRowid as number;
}

export function completePipelineRun(id: number, data: {
  status: 'completed' | 'error';
  emails_scanned?: number; emails_flagged?: number;
  emails_extracted?: number; emails_pushed?: number;
  emails_skipped?: number; emails_errored?: number;
  error_message?: string; duration_ms?: number;
}): void {
  getDb().prepare(
    `UPDATE pipeline_runs SET status = ?, emails_scanned = ?, emails_flagged = ?,
     emails_extracted = ?, emails_pushed = ?, emails_skipped = ?, emails_errored = ?,
     error_message = ?, completed_at = datetime('now'), duration_ms = ?
     WHERE id = ?`
  ).run(
    data.status, data.emails_scanned ?? 0, data.emails_flagged ?? 0,
    data.emails_extracted ?? 0, data.emails_pushed ?? 0,
    data.emails_skipped ?? 0, data.emails_errored ?? 0,
    data.error_message ?? null, data.duration_ms ?? null, id,
  );
}

export function getLastPipelineRun() {
  return getDb().prepare(
    'SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT 1'
  ).get() as {
    id: number; trigger_type: string; status: string;
    emails_scanned: number; emails_flagged: number; emails_extracted: number;
    emails_pushed: number; emails_skipped: number; emails_errored: number;
    error_message: string | null; started_at: string; completed_at: string | null;
    duration_ms: number | null;
  } | undefined;
}

export function getProcessedEmailStats() {
  const today = new Date().toISOString().split('T')[0];
  const totalRow = getDb().prepare('SELECT COUNT(*) as count FROM processed_emails').get() as { count: number };
  const todayFlaggedRow = getDb().prepare(
    `SELECT COUNT(*) as count FROM processed_emails WHERE created_at >= ? AND status != 'skipped'`
  ).get(today) as { count: number };
  const todayErrorRow = getDb().prepare(
    `SELECT COUNT(*) as count FROM processed_emails WHERE created_at >= ? AND status = 'error'`
  ).get(today) as { count: number };

  return {
    total_processed: totalRow.count,
    flagged_today: todayFlaggedRow.count,
    errors_today: todayErrorRow.count,
  };
}

export function getCostToday(): number {
  const today = new Date().toISOString().split('T')[0];
  const row = getDb().prepare(
    `SELECT COALESCE(SUM(estimated_cost_usd), 0) as total FROM processed_emails WHERE created_at >= ?`
  ).get(today) as { total: number };

  // Add any cost offset saved from resets earlier today
  const offsetDate = getSetting('cost_offset_date');
  const offsetUsd = parseFloat(getSetting('cost_offset_usd') || '0');
  if (offsetDate === today && offsetUsd > 0) {
    return row.total + offsetUsd;
  }
  return row.total;
}

export function getWeeklyStats(): Array<{ date: string; scanned: number; flagged: number; pushed: number }> {
  const days: Array<{ date: string; scanned: number; flagged: number; pushed: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const nextD = new Date(d);
    nextD.setDate(nextD.getDate() + 1);
    const nextStr = nextD.toISOString().split('T')[0];

    const row = getDb().prepare(`
      SELECT
        COUNT(*) as scanned,
        SUM(CASE WHEN status IN ('flagged','extracted','pushed') THEN 1 ELSE 0 END) as flagged,
        SUM(CASE WHEN status = 'pushed' THEN 1 ELSE 0 END) as pushed
      FROM processed_emails
      WHERE created_at >= ? AND created_at < ? AND status != 'skipped'
    `).get(dateStr, nextStr) as { scanned: number; flagged: number; pushed: number };

    days.push({ date: dateStr, scanned: row.scanned, flagged: row.flagged, pushed: row.pushed });
  }
  return days;
}

// ── Blocked Senders ─────────────────────────────────────────────────────────

export function getBlockedSenders(): Array<{
  id: number; email: string; reason: string | null;
  source_email_id: number | null; created_at: string;
}> {
  return getDb().prepare('SELECT * FROM blocked_senders ORDER BY created_at DESC').all() as Array<{
    id: number; email: string; reason: string | null;
    source_email_id: number | null; created_at: string;
  }>;
}

export function isBlockedSender(email: string): boolean {
  const row = getDb().prepare(
    'SELECT 1 FROM blocked_senders WHERE email = ?'
  ).get(email.toLowerCase());
  return !!row;
}

export function blockSender(data: {
  email: string; reason?: string; source_email_id?: number;
}): number {
  const result = getDb().prepare(
    'INSERT OR IGNORE INTO blocked_senders (email, reason, source_email_id) VALUES (?, ?, ?)'
  ).run(data.email.toLowerCase(), data.reason ?? null, data.source_email_id ?? null);
  return result.lastInsertRowid as number;
}

export function unblockSender(id: number): void {
  getDb().prepare('DELETE FROM blocked_senders WHERE id = ?').run(id);
}

// ── Upsert History (date guard) ─────────────────────────────────────────────

export function getUpsertHistory(destinationId: number, mergeFieldValue: string): {
  email_date: string; gmail_message_id: string;
} | undefined {
  return getDb().prepare(
    'SELECT email_date, gmail_message_id FROM upsert_history WHERE destination_id = ? AND merge_field_value = ?'
  ).get(destinationId, mergeFieldValue) as { email_date: string; gmail_message_id: string } | undefined;
}

export function setUpsertHistory(destinationId: number, mergeFieldValue: string, emailDate: string, gmailMessageId: string): void {
  getDb().prepare(
    `INSERT INTO upsert_history (destination_id, merge_field_value, email_date, gmail_message_id, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(destination_id, merge_field_value) DO UPDATE SET
       email_date = excluded.email_date, gmail_message_id = excluded.gmail_message_id, updated_at = excluded.updated_at`
  ).run(destinationId, mergeFieldValue, emailDate, gmailMessageId);
}

export function deleteUpsertHistoryByEmail(gmailMessageId: string): void {
  getDb().prepare('DELETE FROM upsert_history WHERE gmail_message_id = ?').run(gmailMessageId);
}

export function clearUpsertHistory(): void {
  getDb().prepare('DELETE FROM upsert_history').run();
}

// ── Orders ──────────────────────────────────────────────────────────────────

export function upsertOrder(data: {
  gmail_message_id: string;
  rule_id?: number;
  retailer: string;
  order_number: string;
  item_name: string;
  order_date?: string;
  item_quantity?: number;
  item_price?: number;
  subtotal?: number;
  tax?: number;
  total?: number;
  currency?: string;
  tracking_number?: string;
  carrier?: string;
  order_status?: string;
  estimated_delivery?: string;
  shipping_address?: string;
  delivery_photo_path?: string;
  tracking_url?: string;
  raw_extracted_data?: Record<string, unknown>;
}): number {
  const result = getDb().prepare(`
    INSERT INTO orders (gmail_message_id, rule_id, retailer, order_number,
      item_name, order_date, item_quantity, item_price, subtotal, tax, total, currency,
      tracking_number, carrier, order_status, estimated_delivery, shipping_address,
      delivery_photo_path, tracking_url, raw_extracted_data, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(retailer, order_number, item_name) DO UPDATE SET
      gmail_message_id = excluded.gmail_message_id,
      order_date = COALESCE(orders.order_date, excluded.order_date),
      tracking_number = COALESCE(excluded.tracking_number, orders.tracking_number),
      carrier = COALESCE(excluded.carrier, orders.carrier),
      order_status = CASE
        WHEN excluded.order_status IS NULL THEN orders.order_status
        WHEN excluded.order_status IN ('cancelled', 'returned') THEN excluded.order_status
        WHEN orders.order_status IN ('cancelled', 'returned') THEN orders.order_status
        WHEN (CASE excluded.order_status
                WHEN 'ordered' THEN 0 WHEN 'processing' THEN 1 WHEN 'shipped' THEN 2
                WHEN 'out_for_delivery' THEN 3 WHEN 'delivered' THEN 4 ELSE -1 END)
           > (CASE orders.order_status
                WHEN 'ordered' THEN 0 WHEN 'processing' THEN 1 WHEN 'shipped' THEN 2
                WHEN 'out_for_delivery' THEN 3 WHEN 'delivered' THEN 4 ELSE -1 END)
        THEN excluded.order_status
        ELSE orders.order_status
      END,
      estimated_delivery = COALESCE(excluded.estimated_delivery, orders.estimated_delivery),
      item_price = COALESCE(excluded.item_price, orders.item_price),
      item_quantity = COALESCE(excluded.item_quantity, orders.item_quantity),
      subtotal = COALESCE(excluded.subtotal, orders.subtotal),
      tax = COALESCE(excluded.tax, orders.tax),
      total = COALESCE(excluded.total, orders.total),
      shipping_address = COALESCE(excluded.shipping_address, orders.shipping_address),
      delivery_photo_path = COALESCE(excluded.delivery_photo_path, orders.delivery_photo_path),
      tracking_url = COALESCE(excluded.tracking_url, orders.tracking_url),
      raw_extracted_data = excluded.raw_extracted_data,
      updated_at = datetime('now')
  `).run(
    data.gmail_message_id, data.rule_id ?? null, data.retailer,
    data.order_number, data.item_name, data.order_date ?? null,
    data.item_quantity ?? 1,
    data.item_price ?? null, data.subtotal ?? null, data.tax ?? null,
    data.total ?? null, data.currency ?? 'USD',
    data.tracking_number ?? null, data.carrier ?? null,
    data.order_status ?? 'ordered', data.estimated_delivery ?? null,
    data.shipping_address ?? null,
    data.delivery_photo_path ?? null,
    data.tracking_url ?? null,
    data.raw_extracted_data ? JSON.stringify(data.raw_extracted_data) : null,
  );
  return result.lastInsertRowid as number;
}

/** Update delivery_photo_path for all item rows of an order (photo is per-order, shared across items) */
export function updateOrderDeliveryPhoto(
  retailer: string,
  orderNumber: string,
  photoPath: string,
): number {
  const result = getDb().prepare(`
    UPDATE orders SET delivery_photo_path = ?, updated_at = datetime('now')
    WHERE retailer = ? AND order_number = ? AND delivery_photo_path IS NULL
  `).run(photoPath, retailer, orderNumber);
  return result.changes;
}

export function getOrders(options: {
  limit?: number; offset?: number; retailer?: string;
  status?: string; search?: string; date_from?: string; date_to?: string;
} = {}) {
  const { limit = 50, offset = 0, retailer, status, search, date_from, date_to } = options;
  let sql = 'SELECT * FROM orders WHERE 1=1';
  const params: unknown[] = [];

  if (retailer) { sql += ' AND retailer = ?'; params.push(retailer); }
  if (status) { sql += ' AND order_status = ?'; params.push(status); }
  if (search) {
    sql += ' AND (item_name LIKE ? OR order_number LIKE ? OR retailer LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (date_from) { sql += ' AND order_date >= ?'; params.push(date_from); }
  if (date_to) { sql += ' AND order_date <= ?'; params.push(date_to); }

  const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as count');
  const countRow = getDb().prepare(countSql).get(...params) as { count: number };

  sql += ' ORDER BY COALESCE(order_date, created_at) DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const rows = getDb().prepare(sql).all(...params);

  return { rows, total: countRow.count };
}

export function getOrderStats() {
  const totalRow = getDb().prepare(
    'SELECT COUNT(DISTINCT retailer || order_number) as count FROM orders'
  ).get() as { count: number };

  const spendRow = getDb().prepare(
    `SELECT COALESCE(SUM(total), 0) as total FROM orders
     WHERE id IN (SELECT MIN(id) FROM orders GROUP BY retailer, order_number)`
  ).get() as { total: number };

  const statusRows = getDb().prepare(
    'SELECT order_status, COUNT(DISTINCT retailer || order_number) as count FROM orders GROUP BY order_status'
  ).all() as Array<{ order_status: string; count: number }>;

  const retailerRows = getDb().prepare(
    'SELECT DISTINCT retailer FROM orders ORDER BY retailer'
  ).all() as Array<{ retailer: string }>;

  return {
    total_orders: totalRow.count,
    total_spend: spendRow.total,
    by_status: Object.fromEntries(statusRows.map(r => [r.order_status, r.count])),
    retailers: retailerRows.map(r => r.retailer),
  };
}

export function getOrderDailyTrend(days = 14): Array<{ date: string; orders: number; spend: number }> {
  const result: Array<{ date: string; orders: number; spend: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const row = getDb().prepare(`
      SELECT
        COUNT(DISTINCT retailer || order_number) as orders,
        COALESCE(SUM(CASE WHEN id IN (SELECT MIN(id) FROM orders WHERE order_date = ? GROUP BY retailer, order_number) THEN total ELSE 0 END), 0) as spend
      FROM orders WHERE order_date = ?
    `).get(dateStr, dateStr) as { orders: number; spend: number };
    result.push({ date: dateStr, orders: row.orders, spend: row.spend });
  }
  return result;
}

export function getOrdersByRetailer(): Array<{ retailer: string; orders: number; spend: number }> {
  return getDb().prepare(`
    SELECT retailer,
      COUNT(DISTINCT retailer || order_number) as orders,
      COALESCE(SUM(CASE WHEN id IN (SELECT MIN(id) FROM orders GROUP BY retailer, order_number) THEN total ELSE 0 END), 0) as spend
    FROM orders GROUP BY retailer ORDER BY orders DESC
  `).all() as Array<{ retailer: string; orders: number; spend: number }>;
}

export function getTopOrderItems(limit = 10): Array<{ item_name: string; retailer: string; total_qty: number; total_spend: number }> {
  return getDb().prepare(`
    SELECT item_name, retailer,
      SUM(item_quantity) as total_qty,
      COALESCE(SUM(item_price * item_quantity), 0) as total_spend
    FROM orders GROUP BY item_name, retailer ORDER BY total_qty DESC LIMIT ?
  `).all(limit) as Array<{ item_name: string; retailer: string; total_qty: number; total_spend: number }>;
}

export function getOrderAvgValue(): number {
  const row = getDb().prepare(`
    SELECT COALESCE(AVG(total), 0) as avg_val FROM (
      SELECT total FROM orders WHERE total IS NOT NULL
      GROUP BY retailer, order_number
    )
  `).get() as { avg_val: number };
  return row.avg_val;
}

/** Look up existing per-item prices for a given order (used to cross-reference shipment emails with earlier order confirmations). */
export function getOrderItemPrices(retailer: string, orderNumber: string): Map<string, number> {
  const rows = getDb().prepare(
    'SELECT item_name, item_price FROM orders WHERE retailer = ? AND order_number = ? AND item_price IS NOT NULL',
  ).all(retailer, orderNumber) as Array<{ item_name: string; item_price: number }>;
  return new Map(rows.map(r => [r.item_name, r.item_price]));
}

/** Get existing item names for an order (used to detect whether "Unknown item" rows should be skipped). */
export function getExistingOrderItemNames(retailer: string, orderNumber: string): string[] {
  const rows = getDb().prepare(
    'SELECT item_name FROM orders WHERE retailer = ? AND order_number = ?',
  ).all(retailer, orderNumber) as Array<{ item_name: string }>;
  return rows.map(r => r.item_name);
}

/** Update order-level (shared) fields across all items in an order.
 *  Used when a shipping/delivery email doesn't identify specific items but
 *  carries order-level data that should be applied to existing item rows. */
export function updateOrderSharedFields(retailer: string, orderNumber: string, data: {
  gmail_message_id: string;
  order_date?: string;
  tracking_number?: string;
  carrier?: string;
  order_status?: string;
  estimated_delivery?: string;
  shipping_address?: string;
  tracking_url?: string;
  subtotal?: number;
  tax?: number;
  total?: number;
  raw_extracted_data?: Record<string, unknown>;
}): number {
  const result = getDb().prepare(`
    UPDATE orders SET
      gmail_message_id = ?,
      order_date = COALESCE(order_date, ?),
      tracking_number = COALESCE(?, tracking_number),
      carrier = COALESCE(?, carrier),
      order_status = CASE
        WHEN ? IS NULL THEN order_status
        WHEN ? IN ('cancelled', 'returned') THEN ?
        WHEN order_status IN ('cancelled', 'returned') THEN order_status
        WHEN (CASE ?
                WHEN 'ordered' THEN 0 WHEN 'processing' THEN 1 WHEN 'shipped' THEN 2
                WHEN 'out_for_delivery' THEN 3 WHEN 'delivered' THEN 4 ELSE -1 END)
           > (CASE order_status
                WHEN 'ordered' THEN 0 WHEN 'processing' THEN 1 WHEN 'shipped' THEN 2
                WHEN 'out_for_delivery' THEN 3 WHEN 'delivered' THEN 4 ELSE -1 END)
        THEN ?
        ELSE order_status
      END,
      estimated_delivery = COALESCE(?, estimated_delivery),
      shipping_address = COALESCE(?, shipping_address),
      tracking_url = COALESCE(?, tracking_url),
      subtotal = COALESCE(?, subtotal),
      tax = COALESCE(?, tax),
      total = COALESCE(?, total),
      raw_extracted_data = COALESCE(?, raw_extracted_data),
      updated_at = datetime('now')
    WHERE retailer = ? AND order_number = ?
  `).run(
    data.gmail_message_id,
    data.order_date ?? null,
    data.tracking_number ?? null,
    data.carrier ?? null,
    // status referenced 5 times in CASE expression
    data.order_status ?? null, data.order_status ?? null, data.order_status ?? null,
    data.order_status ?? null, data.order_status ?? null,
    data.estimated_delivery ?? null,
    data.shipping_address ?? null,
    data.tracking_url ?? null,
    data.subtotal ?? null,
    data.tax ?? null,
    data.total ?? null,
    data.raw_extracted_data ? JSON.stringify(data.raw_extracted_data) : null,
    retailer,
    orderNumber,
  );
  return result.changes;
}

/** Delete "Unknown item" placeholder rows for an order (cleanup when real items are available). */
export function deleteUnknownOrderItems(retailer: string, orderNumber: string): number {
  const result = getDb().prepare(
    "DELETE FROM orders WHERE retailer = ? AND order_number = ? AND item_name = 'Unknown item'",
  ).run(retailer, orderNumber);
  return result.changes;
}

export function deleteOrdersByEmail(gmailMessageId: string): void {
  getDb().prepare('DELETE FROM orders WHERE gmail_message_id = ?').run(gmailMessageId);
}

export function clearOrders(): number {
  const result = getDb().prepare('DELETE FROM orders').run();
  return result.changes;
}

// ── Push Queue (Retry) ───────────────────────────────────────────────────────

export interface PushQueueRow {
  id: number;
  processed_email_id: number;
  destination_id: number;
  payload: string;
  attempt_count: number;
  max_attempts: number;
  next_retry_at: string;
  status: 'pending' | 'retrying' | 'succeeded' | 'failed';
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export function enqueuePushRetry(data: {
  processed_email_id: number;
  destination_id: number;
  payload: string;
  next_retry_at: string;
  max_attempts?: number;
}): number {
  const result = getDb().prepare(`
    INSERT INTO push_queue
      (processed_email_id, destination_id, payload, attempt_count, max_attempts, next_retry_at, status)
    VALUES (?, ?, ?, 0, ?, ?, 'pending')
  `).run(
    data.processed_email_id, data.destination_id, data.payload,
    data.max_attempts ?? 5, data.next_retry_at,
  );
  return result.lastInsertRowid as number;
}

export function getDuePushQueueItems(now: string): PushQueueRow[] {
  return getDb().prepare(`
    SELECT * FROM push_queue
    WHERE status IN ('pending','retrying') AND next_retry_at <= ?
    ORDER BY next_retry_at ASC
    LIMIT 50
  `).all(now) as PushQueueRow[];
}

export function updatePushQueueItem(id: number, data: {
  status: 'pending' | 'retrying' | 'succeeded' | 'failed';
  attempt_count: number;
  next_retry_at?: string;
  last_error?: string;
}): void {
  getDb().prepare(`
    UPDATE push_queue SET
      status = ?, attempt_count = ?,
      next_retry_at = COALESCE(?, next_retry_at),
      last_error = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(data.status, data.attempt_count, data.next_retry_at ?? null, data.last_error ?? null, id);
}

export function getPushQueueStats(): { pending: number; failed: number } {
  const row = getDb().prepare(`
    SELECT
      SUM(CASE WHEN status IN ('pending','retrying') THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM push_queue
  `).get() as { pending: number; failed: number };
  return { pending: row?.pending ?? 0, failed: row?.failed ?? 0 };
}

export function getPushQueueItems(options: {
  status?: string; limit?: number; offset?: number;
} = {}): { rows: PushQueueRow[]; total: number } {
  const { status, limit = 50, offset = 0 } = options;
  const params: unknown[] = [];
  let where = 'WHERE 1=1';
  if (status) { where += ' AND status = ?'; params.push(status); }
  const countRow = getDb().prepare(`SELECT COUNT(*) as count FROM push_queue ${where}`).get(...params) as { count: number };
  const rows = getDb().prepare(`SELECT * FROM push_queue ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as PushQueueRow[];
  return { rows, total: countRow.count };
}

export function deletePushQueueItem(id: number): void {
  getDb().prepare('DELETE FROM push_queue WHERE id = ?').run(id);
}

export function retryPushQueueItem(id: number): void {
  getDb().prepare(`
    UPDATE push_queue SET status = 'pending', next_retry_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(id);
}

// ── Email Accounts ──────────────────────────────────────────────────────────

export interface EmailAccountRow {
  id: number;
  name: string;
  type: 'imap' | 'gmail_oauth';
  email: string;
  config: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export function getAllEmailAccounts(): EmailAccountRow[] {
  return getDb().prepare('SELECT * FROM email_accounts ORDER BY created_at ASC').all() as EmailAccountRow[];
}

export function getEmailAccount(id: number): EmailAccountRow | undefined {
  return getDb().prepare('SELECT * FROM email_accounts WHERE id = ?').get(id) as EmailAccountRow | undefined;
}

export function createEmailAccount(data: {
  name: string; type: 'imap' | 'gmail_oauth'; email: string; config: string; enabled?: boolean;
}): number {
  const result = getDb().prepare(
    `INSERT INTO email_accounts (name, type, email, config, enabled) VALUES (?, ?, ?, ?, ?)`
  ).run(data.name, data.type, data.email, data.config, data.enabled !== false ? 1 : 0);
  return result.lastInsertRowid as number;
}

export function updateEmailAccount(id: number, data: Partial<{
  name: string; email: string; config: string; enabled: boolean;
}>): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
  if (data.email !== undefined) { fields.push('email = ?'); values.push(data.email); }
  if (data.config !== undefined) { fields.push('config = ?'); values.push(data.config); }
  if (data.enabled !== undefined) { fields.push('enabled = ?'); values.push(data.enabled ? 1 : 0); }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  values.push(id);
  getDb().prepare(`UPDATE email_accounts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteEmailAccount(id: number): void {
  getDb().prepare('DELETE FROM email_accounts WHERE id = ?').run(id);
}

// ── Purchases (aggregation layer on orders) ─────────────────────────────────

export function getPurchaseStats(period: 'week' | 'month' | 'all' = 'month') {
  let dateFilter = '';
  if (period === 'week') {
    dateFilter = "AND order_date >= date('now', '-7 days')";
  } else if (period === 'month') {
    dateFilter = "AND order_date >= date('now', '-30 days')";
  }

  // Use CTE to deduplicate multi-item orders for spend totals
  const totalSpend = getDb().prepare(`
    SELECT COALESCE(SUM(total), 0) as spend FROM (
      SELECT total FROM orders WHERE total IS NOT NULL ${dateFilter}
      GROUP BY retailer, order_number
    )
  `).get() as { spend: number };

  const orderCount = getDb().prepare(`
    SELECT COUNT(DISTINCT retailer || '::' || order_number) as count FROM orders WHERE 1=1 ${dateFilter}
  `).get() as { count: number };

  const topRetailer = getDb().prepare(`
    SELECT retailer, COALESCE(SUM(total), 0) as spend FROM (
      SELECT retailer, total FROM orders WHERE total IS NOT NULL ${dateFilter}
      GROUP BY retailer, order_number
    ) GROUP BY retailer ORDER BY spend DESC LIMIT 1
  `).get() as { retailer: string; spend: number } | undefined;

  return {
    total_spend: totalSpend.spend,
    order_count: orderCount.count,
    top_retailer: topRetailer?.retailer ?? null,
    top_retailer_spend: topRetailer?.spend ?? 0,
  };
}

export function getPurchaseSpendTrend(granularity: 'day' | 'week' | 'month' = 'day', days = 30): Array<{ date: string; spend: number; orders: number }> {
  const result: Array<{ date: string; spend: number; orders: number }> = [];

  if (granularity === 'day') {
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const row = getDb().prepare(`
        SELECT
          COALESCE(SUM(total), 0) as spend,
          COUNT(DISTINCT retailer || '::' || order_number) as orders
        FROM (
          SELECT retailer, order_number, total FROM orders
          WHERE order_date = ? AND total IS NOT NULL
          GROUP BY retailer, order_number
        )
      `).get(dateStr) as { spend: number; orders: number };
      result.push({ date: dateStr, spend: row.spend, orders: row.orders });
    }
  } else if (granularity === 'week') {
    // Group by ISO week
    const weeks = getDb().prepare(`
      SELECT
        strftime('%Y-W%W', order_date) as week_label,
        MIN(order_date) as date,
        COALESCE(SUM(total), 0) as spend,
        COUNT(DISTINCT retailer || '::' || order_number) as orders
      FROM (
        SELECT retailer, order_number, order_date, total FROM orders
        WHERE order_date >= date('now', '-' || ? || ' days') AND total IS NOT NULL
        GROUP BY retailer, order_number
      )
      GROUP BY week_label ORDER BY week_label
    `).all(days) as Array<{ week_label: string; date: string; spend: number; orders: number }>;
    for (const w of weeks) {
      result.push({ date: w.date, spend: w.spend, orders: w.orders });
    }
  } else {
    // Group by month
    const months = getDb().prepare(`
      SELECT
        strftime('%Y-%m', order_date) as month_label,
        MIN(order_date) as date,
        COALESCE(SUM(total), 0) as spend,
        COUNT(DISTINCT retailer || '::' || order_number) as orders
      FROM (
        SELECT retailer, order_number, order_date, total FROM orders
        WHERE order_date >= date('now', '-' || ? || ' days') AND total IS NOT NULL
        GROUP BY retailer, order_number
      )
      GROUP BY month_label ORDER BY month_label
    `).all(days) as Array<{ month_label: string; date: string; spend: number; orders: number }>;
    for (const m of months) {
      result.push({ date: m.date, spend: m.spend, orders: m.orders });
    }
  }

  return result;
}

export function getPurchasesByRetailer(): Array<{ retailer: string; count: number; spend: number }> {
  return getDb().prepare(`
    SELECT retailer,
      COUNT(DISTINCT retailer || '::' || order_number) as count,
      COALESCE(SUM(total), 0) as spend
    FROM (
      SELECT retailer, order_number, total FROM orders
      WHERE order_date >= date('now', '-30 days') AND total IS NOT NULL
      GROUP BY retailer, order_number
    )
    GROUP BY retailer ORDER BY spend DESC
  `).all() as Array<{ retailer: string; count: number; spend: number }>;
}

// ── Seller Alerts ────────────────────────────────────────────────────────────

export interface SellerAlertRow {
  id: number;
  account_id: number;
  gmail_message_id: string;
  alert_type: string;
  urgency: string;
  summary: string;
  raw_subject: string | null;
  acknowledged: number;
  acknowledged_at: string | null;
  created_at: string;
}

export function insertSellerAlert(data: {
  account_id: number;
  gmail_message_id: string;
  alert_type: string;
  urgency: string;
  summary: string;
  raw_subject?: string;
}): number {
  const result = getDb().prepare(`
    INSERT OR IGNORE INTO seller_alerts (account_id, gmail_message_id, alert_type, urgency, summary, raw_subject)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(data.account_id, data.gmail_message_id, data.alert_type, data.urgency, data.summary, data.raw_subject ?? null);
  return result.lastInsertRowid as number;
}

export function getSellerAlerts(options: {
  acknowledged?: boolean;
  urgency?: string;
  limit?: number;
  offset?: number;
} = {}): { rows: SellerAlertRow[]; total: number } {
  const { acknowledged, urgency, limit = 100, offset = 0 } = options;
  let sql = 'SELECT * FROM seller_alerts WHERE 1=1';
  const params: unknown[] = [];

  if (acknowledged !== undefined) {
    sql += ' AND acknowledged = ?';
    params.push(acknowledged ? 1 : 0);
  }
  if (urgency) {
    sql += ' AND urgency = ?';
    params.push(urgency);
  }

  const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as count');
  const countRow = getDb().prepare(countSql).get(...params) as { count: number };

  sql += ' ORDER BY CASE urgency WHEN \'critical\' THEN 0 WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 WHEN \'low\' THEN 3 END, created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const rows = getDb().prepare(sql).all(...params) as SellerAlertRow[];

  return { rows, total: countRow.count };
}

export function getUnacknowledgedAlertCount(): number {
  const row = getDb().prepare(
    "SELECT COUNT(*) as count FROM seller_alerts WHERE acknowledged = 0 AND urgency IN ('critical', 'high')"
  ).get() as { count: number };
  return row.count;
}

export function acknowledgeAlert(id: number): void {
  getDb().prepare(
    "UPDATE seller_alerts SET acknowledged = 1, acknowledged_at = datetime('now') WHERE id = ?"
  ).run(id);
}

export function acknowledgeAllAlerts(): void {
  getDb().prepare(
    "UPDATE seller_alerts SET acknowledged = 1, acknowledged_at = datetime('now') WHERE acknowledged = 0"
  ).run();
}

export function isSellerAlertProcessed(gmailMessageId: string): boolean {
  const row = getDb().prepare(
    'SELECT 1 FROM seller_alerts WHERE gmail_message_id = ?'
  ).get(gmailMessageId);
  return !!row;
}

export { getDb };
