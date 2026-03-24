// ── Item Normalizer ──────────────────────────────────────────────────────────
// Shared module for normalizing multi-item extracted data from Gemini.
// Handles three formats: items array (new), parallel arrays (old), single item.
// Imported by both pipeline.ts and db-pusher.ts (avoids circular deps).

export interface NormalizedItem {
  item_name: string;
  item_quantity: number;
  item_price: number | null;
}

const ITEM_KEYS = ['item_name', 'item_quantity', 'item_price', 'items'];

/**
 * Normalize extracted data into a structured { items, shared } form.
 * - items: per-item data (name, quantity, price)
 * - shared: order-level data (order_id, total, tracking, status, etc.)
 */
export function normalizeExtractedItems(
  extracted: Record<string, unknown>,
): { items: NormalizedItem[]; shared: Record<string, unknown> } {
  // Build shared data (everything except per-item fields)
  const shared: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extracted)) {
    if (!ITEM_KEYS.includes(k)) {
      shared[k] = v;
    }
  }

  // Case 1: items array of objects (new Gemini format)
  if (Array.isArray(extracted.items) && extracted.items.length > 0) {
    const items = (extracted.items as Record<string, unknown>[]).map(item => ({
      item_name: String(item.item_name ?? item.name ?? 'Unknown item'),
      item_quantity: Number(item.item_quantity ?? item.quantity) || 1,
      item_price: parseItemPrice(item.item_price ?? item.price),
    }));
    return { items, shared };
  }

  // Case 2: parallel arrays (old Gemini format)
  if (Array.isArray(extracted.item_name)) {
    const names = extracted.item_name as unknown[];
    const quantities = Array.isArray(extracted.item_quantity) ? (extracted.item_quantity as unknown[]) : [];
    const prices = Array.isArray(extracted.item_price) ? (extracted.item_price as unknown[]) : [];

    const items = names.map((name, i) => ({
      item_name: String(name ?? 'Unknown item'),
      item_quantity: Number(quantities[i]) || 1,
      item_price: parseItemPrice(prices[i]),
    }));
    return { items, shared };
  }

  // Case 3: single item (scalar or undefined)
  const items: NormalizedItem[] = [{
    item_name: extracted.item_name ? String(extracted.item_name) : 'Unknown item',
    item_quantity: Number(extracted.item_quantity) || 1,
    item_price: parseItemPrice(extracted.item_price),
  }];
  return { items, shared };
}

/**
 * Expand extracted data into N flat rows (one per item), suitable for
 * destination push. Each row has shared order-level fields + per-item fields.
 */
export function expandExtractedToItemRows(
  extracted: Record<string, unknown>,
): Record<string, unknown>[] {
  const { items, shared } = normalizeExtractedItems(extracted);

  if (items.length === 0) {
    // No items — return shared data with null item fields
    return [{ ...shared, item_name: null, item_quantity: 1, item_price: null }];
  }

  return items.map(item => ({
    ...shared,
    item_name: item.item_name,
    item_quantity: item.item_quantity,
    item_price: item.item_price,
  }));
}

/** Parse a price value, returning null if unparseable */
function parseItemPrice(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
