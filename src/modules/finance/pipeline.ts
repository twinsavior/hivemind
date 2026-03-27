// ── Source-to-Sale Pipeline Tracker ──────────────────────────────────────────
// Tracks the full lifecycle of arbitrage inventory:
// Purchased → Shipped to Prep → Prepping → Shipped to FBA → Received → Live → Sold
//
// Lives in the finance module because it's tightly coupled to cost tracking.

import { getFinanceDB } from './db.js';

// ── Schema ──────────────────────────────────────────────────────────────────

export function initPipelineSchema(): void {
  const db = getFinanceDB();

  // Prep center profiles
  db.exec(`
    CREATE TABLE IF NOT EXISTS prep_centers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      email TEXT,
      phone TEXT,
      address TEXT,
      cost_per_unit REAL,
      cost_per_label REAL,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS pipeline_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      source TEXT,
      status TEXT NOT NULL DEFAULT 'purchased'
        CHECK (status IN ('purchased','shipped_to_prep','prepping','shipped_to_fba','received_at_fba','live','sold','cancelled')),
      total_cost REAL NOT NULL DEFAULT 0,
      total_units INTEGER NOT NULL DEFAULT 0,
      prep_center TEXT,
      prep_cost REAL,
      shipping_cost REAL,
      tracking_number TEXT,
      fba_shipment_id TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pipeline_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES pipeline_batches(id) ON DELETE CASCADE,
      sku TEXT,
      asin TEXT,
      title TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      cost_per_unit REAL NOT NULL DEFAULT 0,
      sale_price REAL,
      marketplace TEXT,
      marketplace_order_id TEXT,
      status TEXT NOT NULL DEFAULT 'in_pipeline'
        CHECK (status IN ('in_pipeline','listed','sold','returned','cancelled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pipeline_items_batch ON pipeline_items(batch_id);
    CREATE INDEX IF NOT EXISTS idx_pipeline_items_asin ON pipeline_items(asin);
    CREATE INDEX IF NOT EXISTS idx_pipeline_items_sku ON pipeline_items(sku);

    CREATE TABLE IF NOT EXISTS pipeline_status_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES pipeline_batches(id) ON DELETE CASCADE,
      from_status TEXT NOT NULL,
      to_status TEXT NOT NULL,
      changed_at TEXT NOT NULL DEFAULT (datetime('now')),
      notes TEXT
    );
  `);
}

// ── Valid Status Transitions ────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  purchased: ['shipped_to_prep', 'shipped_to_fba', 'cancelled'],
  shipped_to_prep: ['prepping', 'cancelled'],
  prepping: ['shipped_to_fba', 'cancelled'],
  shipped_to_fba: ['received_at_fba', 'cancelled'],
  received_at_fba: ['live'],
  live: ['sold'],
  sold: [],
  cancelled: [],
};

// ── Batch Operations ────────────────────────────────────────────────────────

export interface CreateBatchInput {
  name: string;
  source?: string;
  prepCenter?: string;
  notes?: string;
  items: Array<{
    title: string;
    sku?: string;
    asin?: string;
    quantity: number;
    costPerUnit: number;
  }>;
}

export function createBatch(input: CreateBatchInput): number {
  const db = getFinanceDB();
  const totalUnits = input.items.reduce((sum, i) => sum + i.quantity, 0);
  const totalCost = input.items.reduce((sum, i) => sum + i.quantity * i.costPerUnit, 0);

  const result = db.prepare(`
    INSERT INTO pipeline_batches (name, source, total_cost, total_units, prep_center, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(input.name, input.source || null, totalCost, totalUnits, input.prepCenter || null, input.notes || null);

  const batchId = Number(result.lastInsertRowid);
  const itemStmt = db.prepare(`
    INSERT INTO pipeline_items (batch_id, sku, asin, title, quantity, cost_per_unit)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertItems = db.transaction((items: CreateBatchInput['items']) => {
    for (const item of items) {
      itemStmt.run(batchId, item.sku || null, item.asin || null, item.title, item.quantity, item.costPerUnit);
    }
  });
  insertItems(input.items);

  // Log initial status
  db.prepare('INSERT INTO pipeline_status_log (batch_id, from_status, to_status) VALUES (?, ?, ?)')
    .run(batchId, '', 'purchased');

  return batchId;
}

export function getBatches(options?: { status?: string; limit?: number; offset?: number }): { rows: any[]; total: number } {
  const db = getFinanceDB();
  const conditions: string[] = [];
  const params: any[] = [];

  if (options?.status) { conditions.push('status = ?'); params.push(options.status); }
  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;

  const total = (db.prepare(`SELECT COUNT(*) as count FROM pipeline_batches ${where}`).get(...params) as any).count;
  const rows = db.prepare(`SELECT * FROM pipeline_batches ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

  return { rows, total };
}

export function getBatch(id: number): any {
  const db = getFinanceDB();
  const batch = db.prepare('SELECT * FROM pipeline_batches WHERE id = ?').get(id);
  if (!batch) return null;
  const items = db.prepare('SELECT * FROM pipeline_items WHERE batch_id = ? ORDER BY id').all(id);
  const history = db.prepare('SELECT * FROM pipeline_status_log WHERE batch_id = ? ORDER BY changed_at').all(id);
  return { ...(batch as any), items, history };
}

export function updateBatchStatus(id: number, newStatus: string, notes?: string): void {
  const db = getFinanceDB();
  const batch = db.prepare('SELECT status FROM pipeline_batches WHERE id = ?').get(id) as any;
  if (!batch) throw new Error(`Batch ${id} not found`);

  const allowed = VALID_TRANSITIONS[batch.status];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(`Cannot transition from '${batch.status}' to '${newStatus}'. Valid: ${(allowed || []).join(', ')}`);
  }

  db.prepare("UPDATE pipeline_batches SET status = ?, updated_at = datetime('now') WHERE id = ?").run(newStatus, id);
  db.prepare('INSERT INTO pipeline_status_log (batch_id, from_status, to_status, notes) VALUES (?, ?, ?, ?)')
    .run(id, batch.status, newStatus, notes || null);
}

export function updateBatch(id: number, fields: {
  name?: string;
  prepCenter?: string;
  prepCost?: number;
  shippingCost?: number;
  trackingNumber?: string;
  fbaShipmentId?: string;
  notes?: string;
}): void {
  const db = getFinanceDB();
  const sets: string[] = [];
  const params: any[] = [];

  if (fields.name !== undefined) { sets.push('name = ?'); params.push(fields.name); }
  if (fields.prepCenter !== undefined) { sets.push('prep_center = ?'); params.push(fields.prepCenter); }
  if (fields.prepCost !== undefined) { sets.push('prep_cost = ?'); params.push(fields.prepCost); }
  if (fields.shippingCost !== undefined) { sets.push('shipping_cost = ?'); params.push(fields.shippingCost); }
  if (fields.trackingNumber !== undefined) { sets.push('tracking_number = ?'); params.push(fields.trackingNumber); }
  if (fields.fbaShipmentId !== undefined) { sets.push('fba_shipment_id = ?'); params.push(fields.fbaShipmentId); }
  if (fields.notes !== undefined) { sets.push('notes = ?'); params.push(fields.notes); }

  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  params.push(id);
  db.prepare(`UPDATE pipeline_batches SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function deleteBatch(id: number): void {
  getFinanceDB().prepare('DELETE FROM pipeline_batches WHERE id = ?').run(id);
}

// ── Pipeline Summary ────────────────────────────────────────────────────────

export interface PipelineSummary {
  totalBatches: number;
  totalUnits: number;
  totalCostInPipeline: number;
  byStatus: Record<string, { count: number; units: number; cost: number }>;
}

export function getPipelineSummary(): PipelineSummary {
  const db = getFinanceDB();
  const rows = db.prepare(`
    SELECT status, COUNT(*) as count, COALESCE(SUM(total_units), 0) as units, COALESCE(SUM(total_cost), 0) as cost
    FROM pipeline_batches
    WHERE status NOT IN ('sold', 'cancelled')
    GROUP BY status
  `).all() as any[];

  const byStatus: Record<string, { count: number; units: number; cost: number }> = {};
  let totalBatches = 0;
  let totalUnits = 0;
  let totalCost = 0;

  for (const r of rows) {
    byStatus[r.status] = { count: r.count, units: r.units, cost: r.cost };
    totalBatches += r.count;
    totalUnits += r.units;
    totalCost += r.cost;
  }

  return { totalBatches, totalUnits, totalCostInPipeline: totalCost, byStatus };
}

// ── Prep Center Operations ──────────────────────────────────────────────────

export function createPrepCenter(data: {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  costPerUnit?: number;
  costPerLabel?: number;
  notes?: string;
}): number {
  const db = getFinanceDB();
  const result = db.prepare(`
    INSERT INTO prep_centers (name, contact_name, email, phone, address, cost_per_unit, cost_per_label, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(data.name, data.contactName || null, data.email || null, data.phone || null,
    data.address || null, data.costPerUnit || null, data.costPerLabel || null, data.notes || null);
  return Number(result.lastInsertRowid);
}

export function getPrepCenters(): any[] {
  return getFinanceDB().prepare('SELECT * FROM prep_centers WHERE is_active = 1 ORDER BY name').all();
}

export function getPrepCenter(id: number): any {
  return getFinanceDB().prepare('SELECT * FROM prep_centers WHERE id = ?').get(id);
}

export function updatePrepCenter(id: number, data: Record<string, unknown>): void {
  const db = getFinanceDB();
  const allowed = ['name', 'contact_name', 'email', 'phone', 'address', 'cost_per_unit', 'cost_per_label', 'notes', 'is_active'];
  const sets: string[] = [];
  const params: any[] = [];
  for (const [key, val] of Object.entries(data)) {
    if (allowed.includes(key)) { sets.push(`${key} = ?`); params.push(val); }
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  params.push(id);
  db.prepare(`UPDATE prep_centers SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function deletePrepCenter(id: number): void {
  getFinanceDB().prepare("UPDATE prep_centers SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
}
