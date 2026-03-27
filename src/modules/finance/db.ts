// ── Finance Module Database ──────────────────────────────────────────────────
// SQLite storage for financial accounts, transactions, and spending capacity.
// Follows the same pattern as the email module (separate DB, own schema).

import Database from 'better-sqlite3';
import * as path from 'path';
import type { SimpleFINAccount, SimpleFINTransaction } from './simplefin-client.js';

let _db: Database.Database | null = null;

export function initFinanceDB(dataDir: string): Database.Database {
  if (_db) return _db;
  const dbPath = path.join(dataDir, 'finance.db');
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  initializeSchema(_db);
  return _db;
}

export function getFinanceDB(): Database.Database {
  if (!_db) throw new Error('Finance DB not initialized. Call initFinanceDB(dataDir) first.');
  return _db;
}

function initializeSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      institution TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      balance REAL NOT NULL DEFAULT 0,
      available_balance REAL,
      balance_date TEXT,
      account_type TEXT NOT NULL DEFAULT 'other',
      credit_limit REAL,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      last_synced TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      posted TEXT,
      amount REAL NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      pending INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'other',
      linked_batch_id INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id, account_id)
    );
    CREATE INDEX IF NOT EXISTS idx_txn_account ON transactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_txn_posted ON transactions(posted);
    CREATE INDEX IF NOT EXISTS idx_txn_category ON transactions(category);

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      accounts_synced INTEGER NOT NULL DEFAULT 0,
      transactions_synced INTEGER NOT NULL DEFAULT 0,
      errors TEXT,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT,
      email TEXT,
      phone TEXT,
      spending_limit REAL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migration: add assigned_employee_id to accounts
  const accountCols = db.pragma('table_info(accounts)') as { name: string }[];
  if (!accountCols.find(c => c.name === 'assigned_employee_id')) {
    db.exec('ALTER TABLE accounts ADD COLUMN assigned_employee_id INTEGER REFERENCES employees(id)');
  }
}

// ── Account Operations ──────────────────────────────────────────────────────

export function upsertAccount(account: SimpleFINAccount): void {
  const db = getFinanceDB();
  const institution = account.org?.name || null;
  const balanceDate = account['balance-date']
    ? new Date(account['balance-date'] * 1000).toISOString()
    : null;
  const availBalance = account['available-balance'] ?? null;

  db.prepare(`
    INSERT INTO accounts (id, name, institution, currency, balance, available_balance, balance_date, last_synced, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      institution = COALESCE(excluded.institution, accounts.institution),
      currency = excluded.currency,
      balance = excluded.balance,
      available_balance = excluded.available_balance,
      balance_date = excluded.balance_date,
      last_synced = datetime('now'),
      updated_at = datetime('now')
  `).run(account.id, account.name, institution, account.currency, account.balance, availBalance, balanceDate);
}

export function getAccounts(): any[] {
  return getFinanceDB().prepare('SELECT * FROM accounts WHERE is_hidden = 0 ORDER BY name').all();
}

export function getAccount(id: string): any {
  return getFinanceDB().prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

export function updateAccountType(id: string, accountType: string, creditLimit?: number): void {
  getFinanceDB().prepare(`
    UPDATE accounts SET account_type = ?, credit_limit = ?, updated_at = datetime('now') WHERE id = ?
  `).run(accountType, creditLimit ?? null, id);
}

export function hideAccount(id: string, hidden: boolean): void {
  getFinanceDB().prepare('UPDATE accounts SET is_hidden = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(hidden ? 1 : 0, id);
}

// ── Transaction Operations ──────────────────────────────────────────────────

export function upsertTransactions(accountId: string, transactions: SimpleFINTransaction[]): number {
  const db = getFinanceDB();
  const stmt = db.prepare(`
    INSERT INTO transactions (id, account_id, posted, amount, description, pending)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id, account_id) DO UPDATE SET
      posted = excluded.posted,
      amount = excluded.amount,
      description = excluded.description,
      pending = excluded.pending
  `);

  let count = 0;
  const upsertMany = db.transaction((txns: SimpleFINTransaction[]) => {
    for (const t of txns) {
      const posted = t.posted ? new Date(t.posted * 1000).toISOString() : null;
      stmt.run(t.id, accountId, posted, t.amount, t.description, t.pending ? 1 : 0);
      count++;
    }
  });
  upsertMany(transactions);
  return count;
}

export function getTransactions(options?: {
  accountId?: string;
  category?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}): { rows: any[]; total: number } {
  const db = getFinanceDB();
  const conditions: string[] = [];
  const params: any[] = [];

  if (options?.accountId) { conditions.push('t.account_id = ?'); params.push(options.accountId); }
  if (options?.category) { conditions.push('t.category = ?'); params.push(options.category); }
  if (options?.startDate) { conditions.push('t.posted >= ?'); params.push(options.startDate); }
  if (options?.endDate) { conditions.push('t.posted <= ?'); params.push(options.endDate); }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const limit = options?.limit || 100;
  const offset = options?.offset || 0;

  const total = (db.prepare(`SELECT COUNT(*) as count FROM transactions t ${where}`).get(...params) as any).count;
  const rows = db.prepare(`
    SELECT t.*, a.name as account_name, a.institution
    FROM transactions t
    LEFT JOIN accounts a ON a.id = t.account_id
    ${where}
    ORDER BY t.posted DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return { rows, total };
}

export function categorizeTransaction(txnId: string, accountId: string, category: string, notes?: string): void {
  const db = getFinanceDB();
  const sets = ['category = ?'];
  const params: any[] = [category];
  if (notes !== undefined) { sets.push('notes = ?'); params.push(notes); }
  params.push(txnId, accountId);
  db.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ? AND account_id = ?`).run(...params);
}

// ── Spending Capacity ───────────────────────────────────────────────────────

export interface SpendingCapacity {
  totalAvailableCredit: number;
  totalCreditLimit: number;
  totalBalance: number;
  accounts: Array<{
    id: string;
    name: string;
    institution: string | null;
    accountType: string;
    balance: number;
    availableBalance: number | null;
    creditLimit: number | null;
    availableCredit: number | null;
  }>;
  spentThisWeek: number;
  spentToday: number;
}

export function getSpendingCapacity(): SpendingCapacity {
  const db = getFinanceDB();
  const accounts = db.prepare('SELECT * FROM accounts WHERE is_hidden = 0 ORDER BY name').all() as any[];

  let totalAvailableCredit = 0;
  let totalCreditLimit = 0;
  let totalBalance = 0;

  const accountSummaries = accounts.map(a => {
    let availableCredit: number | null = null;
    if (a.account_type === 'credit_card') {
      if (a.available_balance != null) {
        availableCredit = a.available_balance;
      } else if (a.credit_limit != null) {
        // For credit cards, balance is typically negative (amount owed).
        // Available credit = limit - abs(balance)
        availableCredit = a.credit_limit - Math.abs(a.balance);
      }
      if (availableCredit != null) totalAvailableCredit += Math.max(0, availableCredit);
      if (a.credit_limit != null) totalCreditLimit += a.credit_limit;
    }
    totalBalance += a.balance;

    return {
      id: a.id,
      name: a.name,
      institution: a.institution,
      accountType: a.account_type,
      balance: a.balance,
      availableBalance: a.available_balance,
      creditLimit: a.credit_limit,
      availableCredit,
    };
  });

  // Spending this week (negative transactions = spending)
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const spentThisWeek = Math.abs(
    (db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM transactions
      WHERE amount < 0 AND posted >= ? AND pending = 0
    `).get(weekAgo.toISOString()) as any).total,
  );

  // Spending today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const spentToday = Math.abs(
    (db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM transactions
      WHERE amount < 0 AND posted >= ? AND pending = 0
    `).get(todayStart.toISOString()) as any).total,
  );

  return {
    totalAvailableCredit,
    totalCreditLimit,
    totalBalance,
    accounts: accountSummaries,
    spentThisWeek,
    spentToday,
  };
}

// ── Employee Management ─────────────────────────────────────────────────────

export function createEmployee(data: { name: string; role?: string; email?: string; phone?: string; spendingLimit?: number }): number {
  const db = getFinanceDB();
  const result = db.prepare(
    'INSERT INTO employees (name, role, email, phone, spending_limit) VALUES (?, ?, ?, ?, ?)',
  ).run(data.name, data.role || null, data.email || null, data.phone || null, data.spendingLimit || null);
  return Number(result.lastInsertRowid);
}

export function getEmployees(): any[] {
  return getFinanceDB().prepare('SELECT * FROM employees WHERE is_active = 1 ORDER BY name').all();
}

export function getEmployee(id: number): any {
  return getFinanceDB().prepare('SELECT * FROM employees WHERE id = ?').get(id);
}

export function updateEmployee(id: number, data: Record<string, unknown>): void {
  const db = getFinanceDB();
  const allowed = ['name', 'role', 'email', 'phone', 'spending_limit', 'is_active'];
  const sets: string[] = [];
  const params: any[] = [];
  for (const [key, val] of Object.entries(data)) {
    if (allowed.includes(key)) { sets.push(`${key} = ?`); params.push(val); }
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  params.push(id);
  db.prepare(`UPDATE employees SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function deleteEmployee(id: number): void {
  const db = getFinanceDB();
  // Unassign any accounts assigned to this employee
  db.prepare('UPDATE accounts SET assigned_employee_id = NULL WHERE assigned_employee_id = ?').run(id);
  db.prepare("UPDATE employees SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
}

export function assignAccountToEmployee(accountId: string, employeeId: number | null): void {
  getFinanceDB().prepare("UPDATE accounts SET assigned_employee_id = ?, updated_at = datetime('now') WHERE id = ?")
    .run(employeeId, accountId);
}

export interface EmployeeSpending {
  employeeId: number;
  employeeName: string;
  spendingLimit: number | null;
  accountCount: number;
  spentThisWeek: number;
  spentToday: number;
  remainingBudget: number | null;
  accounts: Array<{ id: string; name: string; balance: number }>;
}

export function getEmployeeSpending(): EmployeeSpending[] {
  const db = getFinanceDB();
  const employees = db.prepare('SELECT * FROM employees WHERE is_active = 1').all() as any[];
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

  return employees.map(emp => {
    const accounts = db.prepare('SELECT id, name, balance FROM accounts WHERE assigned_employee_id = ? AND is_hidden = 0').all(emp.id) as any[];
    const accountIds = accounts.map(a => a.id);

    let spentThisWeek = 0;
    let spentToday = 0;
    if (accountIds.length > 0) {
      const placeholders = accountIds.map(() => '?').join(',');
      spentThisWeek = Math.abs(
        (db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE amount < 0 AND account_id IN (${placeholders}) AND posted >= ? AND pending = 0`).get(...accountIds, weekAgo.toISOString()) as any).total,
      );
      spentToday = Math.abs(
        (db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE amount < 0 AND account_id IN (${placeholders}) AND posted >= ? AND pending = 0`).get(...accountIds, todayStart.toISOString()) as any).total,
      );
    }

    return {
      employeeId: emp.id,
      employeeName: emp.name,
      spendingLimit: emp.spending_limit,
      accountCount: accounts.length,
      spentThisWeek,
      spentToday,
      remainingBudget: emp.spending_limit != null ? Math.max(0, emp.spending_limit - spentThisWeek) : null,
      accounts,
    };
  });
}

// ── Sync Log ────────────────────────────────────────────────────────────────

export function logSync(accountsSynced: number, transactionsSynced: number, errors?: string): void {
  getFinanceDB().prepare(
    'INSERT INTO sync_log (accounts_synced, transactions_synced, errors) VALUES (?, ?, ?)',
  ).run(accountsSynced, transactionsSynced, errors || null);
}

export function getLastSync(): any {
  return getFinanceDB().prepare('SELECT * FROM sync_log ORDER BY synced_at DESC LIMIT 1').get();
}

// ── Auto-Categorization ─────────────────────────────────────────────────────
// Simple keyword-based categorization for common seller transactions.

const CATEGORY_RULES: Array<{ pattern: RegExp; category: string }> = [
  // Marketplace payouts
  { pattern: /amazon.*(?:payment|deposit|settlement|payout)/i, category: 'marketplace_payout' },
  { pattern: /walmart.*(?:payment|deposit|settlement)/i, category: 'marketplace_payout' },
  { pattern: /ebay.*(?:payment|deposit|managed)/i, category: 'marketplace_payout' },
  { pattern: /paypal.*(?:transfer|ebay)/i, category: 'marketplace_payout' },
  // Marketplace fees
  { pattern: /amazon.*(?:fee|charge|storage|fba|referral)/i, category: 'marketplace_fees' },
  { pattern: /walmart.*(?:fee|charge)/i, category: 'marketplace_fees' },
  { pattern: /ebay.*(?:fee|charge|final\s*value)/i, category: 'marketplace_fees' },
  // Shipping
  { pattern: /(?:ups|fedex|usps|dhl|stamps\.com|pirate\s*ship|shipstation)/i, category: 'shipping' },
  // Prep centers (common names)
  { pattern: /(?:prep.*center|fulfillment|myprep|theprepcompany|prepitpack)/i, category: 'prep' },
  // Common sourcing retailers
  { pattern: /(?:walmart(?!.*(?:fee|marketplace))|target|costco|best\s*buy|home\s*depot|lowes|staples|office\s*depot|cvs|walgreens|rite\s*aid|dollar\s*tree|big\s*lots|kohls|nordstrom|macys|tj\s*maxx|marshalls|ross|burlington|bjs|sams\s*club)/i, category: 'sourcing' },
  // Online sourcing
  { pattern: /(?:amazon\.com.*(?:purchase|order)|amzn\.com)/i, category: 'sourcing' },
];

export function autoCategorizeTransaction(description: string): string {
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(description)) return rule.category;
  }
  return 'other';
}

/**
 * Run auto-categorization on all uncategorized transactions.
 */
export function autoCategorizeAll(): number {
  const db = getFinanceDB();
  const uncategorized = db.prepare("SELECT id, account_id, description FROM transactions WHERE category = 'other'").all() as any[];
  const updateStmt = db.prepare('UPDATE transactions SET category = ? WHERE id = ? AND account_id = ?');

  let categorized = 0;
  const batch = db.transaction((rows: any[]) => {
    for (const row of rows) {
      const cat = autoCategorizeTransaction(row.description);
      if (cat !== 'other') {
        updateStmt.run(cat, row.id, row.account_id);
        categorized++;
      }
    }
  });
  batch(uncategorized);
  return categorized;
}
