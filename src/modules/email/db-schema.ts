import type Database from 'better-sqlite3';

const DEFAULT_SYSTEM_PROMPT = `You are an email analysis assistant. You extract structured data from emails and their attachments.

RULES:
- Only extract information that is explicitly stated in the email or attachments.
- Never fabricate or guess values. Use null for missing fields.
- Dates should be in YYYY-MM-DD format.
- Monetary amounts should be numbers (no currency symbols).
- Be concise in summaries (1-2 sentences max).`;

const DEFAULT_EXTRACTION_SCHEMA = `{
  "summary": "1-2 sentence summary of what this email is about",
  "category": "invoice | shipping | contract | request | notification | other",
  "sender_company": "Company name if identifiable",
  "action_required": true/false,
  "action_description": "What action is needed, if any",
  "due_date": "YYYY-MM-DD or null",
  "amount": number or null,
  "currency": "USD/EUR/etc or null",
  "reference_numbers": ["PO-123", "INV-456", etc],
  "key_entities": ["person names", "company names", "product names mentioned"],
  "sentiment": "positive | neutral | negative | urgent",
  "confidence": 0.0-1.0
}`;

export function initializeDatabase(db: Database.Database) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS gmail_auth (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      email TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      token_expiry TEXT NOT NULL,
      scopes TEXT NOT NULL,
      connected_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      service TEXT PRIMARY KEY,
      encrypted_key TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS extraction_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      model TEXT NOT NULL DEFAULT 'gemini-3-flash-preview',
      system_prompt TEXT NOT NULL,
      extraction_schema TEXT NOT NULL,
      temperature REAL NOT NULL DEFAULT 0.1,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS flag_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      keywords TEXT NOT NULL DEFAULT '[]',
      required_keywords TEXT NOT NULL DEFAULT '[]',
      sender_patterns TEXT NOT NULL DEFAULT '[]',
      exclude_phrases TEXT NOT NULL DEFAULT '[]',
      check_subject INTEGER NOT NULL DEFAULT 1,
      check_body INTEGER NOT NULL DEFAULT 1,
      check_snippet INTEGER NOT NULL DEFAULT 1,
      require_attachment INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS destinations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('airtable', 'sheets', 'notion', 'slack', 'discord')),
      config TEXT NOT NULL DEFAULT '{}',
      field_mapping TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS processed_emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gmail_message_id TEXT NOT NULL UNIQUE,
      thread_id TEXT,
      subject TEXT,
      from_email TEXT,
      from_name TEXT,
      received_date TEXT,
      matched_rules TEXT NOT NULL DEFAULT '[]',
      extracted_data TEXT,
      destinations_pushed TEXT DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'processed'
        CHECK (status IN ('processed', 'flagged', 'extracted', 'pushed', 'error', 'skipped')),
      error_message TEXT,
      processing_time_ms INTEGER,
      pipeline_run_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_processed_emails_gmail_id ON processed_emails(gmail_message_id);
    CREATE INDEX IF NOT EXISTS idx_processed_emails_status ON processed_emails(status);
    CREATE INDEX IF NOT EXISTS idx_processed_emails_created ON processed_emails(created_at);

    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger_type TEXT NOT NULL CHECK (trigger_type IN ('scheduled', 'manual')),
      status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'error')),
      emails_scanned INTEGER DEFAULT 0,
      emails_flagged INTEGER DEFAULT 0,
      emails_extracted INTEGER DEFAULT 0,
      emails_pushed INTEGER DEFAULT 0,
      emails_skipped INTEGER DEFAULT 0,
      emails_errored INTEGER DEFAULT 0,
      error_message TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      duration_ms INTEGER
    );
  `);

  // ── Migrations ─────────────────────────────────────────────────────────────
  // Add destination_ids column to flag_rules (links rules to specific destinations)
  const flagRuleCols = db.pragma('table_info(flag_rules)') as { name: string }[];
  if (!flagRuleCols.find(c => c.name === 'destination_ids')) {
    db.exec(`ALTER TABLE flag_rules ADD COLUMN destination_ids TEXT NOT NULL DEFAULT '[]'`);
  }

  // Add instructions + scan_all to flag_rules (AI-first rules)
  if (!flagRuleCols.find(c => c.name === 'instructions')) {
    db.exec(`ALTER TABLE flag_rules ADD COLUMN instructions TEXT NOT NULL DEFAULT ''`);
  }
  if (!flagRuleCols.find(c => c.name === 'scan_all')) {
    db.exec(`ALTER TABLE flag_rules ADD COLUMN scan_all INTEGER NOT NULL DEFAULT 0`);
  }

  // Add per-rule field mappings and expected output fields
  if (!flagRuleCols.find(c => c.name === 'field_mappings')) {
    db.exec(`ALTER TABLE flag_rules ADD COLUMN field_mappings TEXT NOT NULL DEFAULT '{}'`);
  }
  if (!flagRuleCols.find(c => c.name === 'expected_fields')) {
    db.exec(`ALTER TABLE flag_rules ADD COLUMN expected_fields TEXT NOT NULL DEFAULT '[]'`);
  }

  // Add token tracking to processed_emails
  const emailCols = db.pragma('table_info(processed_emails)') as { name: string }[];
  if (!emailCols.find(c => c.name === 'prompt_tokens')) {
    db.exec(`ALTER TABLE processed_emails ADD COLUMN prompt_tokens INTEGER`);
    db.exec(`ALTER TABLE processed_emails ADD COLUMN completion_tokens INTEGER`);
    db.exec(`ALTER TABLE processed_emails ADD COLUMN estimated_cost_usd REAL`);
  }

  // Create blocked_senders table (sender blacklist)
  db.exec(`
    CREATE TABLE IF NOT EXISTS blocked_senders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      reason TEXT,
      source_email_id INTEGER,
      account_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_blocked_senders_email ON blocked_senders(email);
  `);

  // Add account_id to blocked_senders (per-account blocking)
  const blockedCols = db.pragma('table_info(blocked_senders)') as { name: string }[];
  if (!blockedCols.find(c => c.name === 'account_id')) {
    db.exec(`ALTER TABLE blocked_senders ADD COLUMN account_id INTEGER`);
  }
  // Drop UNIQUE constraint on email alone (recreate table to allow per-account blocks)
  // The original table had UNIQUE(email) which prevents per-account blocks.
  // With account_id, the same email can be blocked globally (account_id IS NULL) or per-account.
  // We remove the UNIQUE constraint; the app logic handles dedup via INSERT OR IGNORE.

  // Upsert date guard: tracks the newest email date per merge-key per destination
  db.exec(`
    CREATE TABLE IF NOT EXISTS upsert_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      destination_id INTEGER NOT NULL,
      merge_field_value TEXT NOT NULL,
      email_date TEXT NOT NULL,
      gmail_message_id TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(destination_id, merge_field_value)
    );
  `);

  // Add template_id to flag_rules (links rules to retailer templates)
  if (!flagRuleCols.find(c => c.name === 'template_id')) {
    db.exec(`ALTER TABLE flag_rules ADD COLUMN template_id TEXT`);
  }

  // Orders table: structured order data extracted from emails via retailer templates
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gmail_message_id TEXT NOT NULL,
      rule_id INTEGER,
      retailer TEXT,
      order_number TEXT,
      order_date TEXT,
      item_name TEXT,
      item_quantity INTEGER DEFAULT 1,
      item_price REAL,
      subtotal REAL,
      tax REAL,
      total REAL,
      currency TEXT DEFAULT 'USD',
      tracking_number TEXT,
      carrier TEXT,
      order_status TEXT DEFAULT 'ordered',
      estimated_delivery TEXT,
      shipping_address TEXT,
      raw_extracted_data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(retailer, order_number, item_name)
    );
    CREATE INDEX IF NOT EXISTS idx_orders_gmail_id ON orders(gmail_message_id);
    CREATE INDEX IF NOT EXISTS idx_orders_retailer ON orders(retailer);
    CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(order_status);
    CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date);
  `);

  // IMAP auth table (alternative to Gmail OAuth)
  db.exec(`
    CREATE TABLE IF NOT EXISTS imap_auth (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      email TEXT NOT NULL,
      password TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 993,
      tls INTEGER NOT NULL DEFAULT 1,
      connected_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Auto-detect connection_type for existing Gmail OAuth users
  const existingConnectionType = db.prepare("SELECT value FROM settings WHERE key = 'connection_type'").get();
  if (!existingConnectionType) {
    const gmailRow = db.prepare('SELECT 1 FROM gmail_auth WHERE id = 1').get();
    if (gmailRow) {
      db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('connection_type', 'gmail_oauth')").run();
    }
  }

  // Add delivery_photo_path and tracking_url to orders table
  const orderCols = db.pragma('table_info(orders)') as { name: string }[];
  if (!orderCols.find(c => c.name === 'delivery_photo_path')) {
    db.exec(`ALTER TABLE orders ADD COLUMN delivery_photo_path TEXT`);
  }
  if (!orderCols.find(c => c.name === 'tracking_url')) {
    db.exec(`ALTER TABLE orders ADD COLUMN tracking_url TEXT`);
  }

  // Add 'webhook' to destinations type CHECK constraint
  // SQLite can't ALTER CHECK constraints, so we recreate the table if needed
  const destSchema = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='destinations'").get() as { sql: string } | undefined)?.sql ?? '';
  if (!destSchema.includes("'webhook'")) {
    db.exec(`
      CREATE TABLE destinations_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('airtable','sheets','notion','slack','discord','webhook')),
        config TEXT NOT NULL DEFAULT '{}',
        field_mapping TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO destinations_v2 SELECT * FROM destinations;
      DROP TABLE destinations;
      ALTER TABLE destinations_v2 RENAME TO destinations;
    `);
  }

  // Push retry queue: stores failed destination pushes for automatic retry
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      processed_email_id INTEGER NOT NULL,
      destination_id INTEGER NOT NULL,
      payload TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      next_retry_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','retrying','succeeded','failed')),
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_push_queue_status ON push_queue(status);
    CREATE INDEX IF NOT EXISTS idx_push_queue_next_retry ON push_queue(next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_push_queue_email_id ON push_queue(processed_email_id);
  `);

  // Multi-account: email_accounts table replaces singleton imap_auth/gmail_auth
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('imap', 'gmail_oauth')),
      email TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_email_accounts_enabled ON email_accounts(enabled);
  `);

  // Migrate existing singleton auth into email_accounts (one-time)
  const accountCount = (db.prepare('SELECT COUNT(*) as count FROM email_accounts').get() as { count: number }).count;
  if (accountCount === 0) {
    const imapRow = db.prepare('SELECT * FROM imap_auth WHERE id = 1').get() as { email: string; password: string; host: string; port: number; tls: number } | undefined;
    if (imapRow) {
      db.prepare(
        `INSERT INTO email_accounts (name, type, email, config, enabled) VALUES (?, 'imap', ?, ?, 1)`
      ).run('Primary IMAP', imapRow.email, JSON.stringify({
        password: imapRow.password,
        host: imapRow.host,
        port: imapRow.port,
        tls: !!imapRow.tls,
      }));
    }

    const gmailRow = db.prepare('SELECT * FROM gmail_auth WHERE id = 1').get() as { email: string; access_token: string; refresh_token: string; token_expiry: string; scopes: string } | undefined;
    if (gmailRow) {
      // Read client_id and client_secret from settings/api_keys
      const clientId = db.prepare("SELECT value FROM settings WHERE key = 'google_client_id'").get() as { value: string } | undefined;
      const clientSecret = db.prepare("SELECT encrypted_key FROM api_keys WHERE service = 'google_client_secret'").get() as { encrypted_key: string } | undefined;
      db.prepare(
        `INSERT INTO email_accounts (name, type, email, config, enabled) VALUES (?, 'gmail_oauth', ?, ?, 1)`
      ).run('Primary Gmail', gmailRow.email, JSON.stringify({
        access_token: gmailRow.access_token,
        refresh_token: gmailRow.refresh_token,
        token_expiry: gmailRow.token_expiry,
        scopes: gmailRow.scopes,
        client_id: clientId?.value ?? '',
        client_secret: clientSecret?.encrypted_key ?? '',
      }));
    }
  }

  // Add last_uid to email_accounts (incremental UID-based sync)
  const acctCols = db.pragma('table_info(email_accounts)') as { name: string }[];
  if (!acctCols.find(c => c.name === 'last_uid')) {
    db.exec(`ALTER TABLE email_accounts ADD COLUMN last_uid INTEGER`);
  }

  // Add account_id to processed_emails
  const emailCols2 = db.pragma('table_info(processed_emails)') as { name: string }[];
  if (!emailCols2.find(c => c.name === 'account_id')) {
    db.exec(`ALTER TABLE processed_emails ADD COLUMN account_id INTEGER`);
  }

  // Add account_ids to flag_rules (restrict rules to specific accounts; empty = all)
  if (!flagRuleCols.find(c => c.name === 'account_ids')) {
    db.exec(`ALTER TABLE flag_rules ADD COLUMN account_ids TEXT NOT NULL DEFAULT '[]'`);
  }

  // Add account_id to orders
  if (!orderCols.find(c => c.name === 'account_id')) {
    db.exec(`ALTER TABLE orders ADD COLUMN account_id INTEGER`);
  }

  // Seller alerts table: Amazon seller notifications with urgency levels
  db.exec(`
    CREATE TABLE IF NOT EXISTS seller_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      gmail_message_id TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      urgency TEXT NOT NULL,
      summary TEXT NOT NULL,
      raw_subject TEXT,
      acknowledged INTEGER DEFAULT 0,
      acknowledged_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(gmail_message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_seller_alerts_urgency ON seller_alerts(urgency);
    CREATE INDEX IF NOT EXISTS idx_seller_alerts_acknowledged ON seller_alerts(acknowledged);
    CREATE INDEX IF NOT EXISTS idx_seller_alerts_created ON seller_alerts(created_at);
  `);

  // Ensure extraction_config uses gemini-3-flash-preview
  db.exec(`UPDATE extraction_config SET model = 'gemini-3-flash-preview' WHERE model != 'gemini-3-flash-preview'`);

  // Seed default settings
  const insertSetting = db.prepare(
    `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`
  );
  insertSetting.run('pipeline_enabled', 'false');
  insertSetting.run('scan_interval_minutes', '15');
  insertSetting.run('lookback_minutes', '20');
  insertSetting.run('max_emails_per_run', '50');

  // Seed default extraction config
  db.prepare(
    `INSERT OR IGNORE INTO extraction_config (id, model, system_prompt, extraction_schema, temperature, enabled)
     VALUES (1, 'gemini-3-flash-preview', ?, ?, 0.1, 1)`
  ).run(DEFAULT_SYSTEM_PROMPT, DEFAULT_EXTRACTION_SCHEMA);
}
