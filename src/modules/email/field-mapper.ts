import type { ColumnInfo } from './types.js';

// All possible source fields from email data + default extraction schema
const EMAIL_FIELDS = ['subject', 'from_email', 'from_name', 'date', 'message_id'] as const;

const DEFAULT_EXTRACTION_FIELDS = [
  'summary',
  'category',
  'sender_company',
  'action_required',
  'action_description',
  'due_date',
  'amount',
  'currency',
  'reference_numbers',
  'key_entities',
  'sentiment',
  'confidence',
] as const;

const METADATA_FIELDS = ['processed_at'] as const;

// Common synonyms for smart matching
const SYNONYMS: Record<string, string[]> = {
  summary: ['description', 'overview', 'brief', 'synopsis', 'notes'],
  category: ['type', 'kind', 'classification', 'label', 'tag'],
  sender_company: ['company', 'organization', 'org', 'sender', 'from_company'],
  action_required: ['action', 'needs_action', 'requires_action', 'todo'],
  action_description: ['action_detail', 'action_details', 'task', 'todo_description'],
  due_date: ['deadline', 'due', 'expiry', 'expiry_date', 'date_due'],
  amount: ['total', 'price', 'cost', 'value', 'sum'],
  currency: ['currency_code', 'money_type'],
  reference_numbers: ['references', 'ref', 'ref_numbers', 'ids', 'order_numbers', 'invoice_numbers'],
  key_entities: ['entities', 'people', 'names', 'contacts'],
  sentiment: ['tone', 'mood'],
  confidence: ['confidence_score', 'score', 'accuracy'],
  subject: ['email_subject', 'title', 'heading'],
  from_email: ['email', 'sender_email', 'from_address'],
  from_name: ['sender_name', 'from', 'sender'],
  date: ['received', 'received_date', 'email_date', 'sent_date'],
  processed_at: ['processed_date', 'processed_time', 'timestamp'],
};

function normalize(str: string): string {
  return str.toLowerCase().replace(/[_\-\s]+/g, '');
}

/**
 * Get the list of all available source fields.
 * If a custom extraction schema is provided, parse its keys instead of using defaults.
 */
export function getSourceFields(extractionSchema?: string): string[] {
  const fields: string[] = [...EMAIL_FIELDS];

  if (extractionSchema) {
    try {
      const schema = JSON.parse(extractionSchema);
      fields.push(...Object.keys(schema));
    } catch {
      fields.push(...DEFAULT_EXTRACTION_FIELDS);
    }
  } else {
    fields.push(...DEFAULT_EXTRACTION_FIELDS);
  }

  fields.push(...METADATA_FIELDS);
  return fields;
}

/**
 * Produce a human-readable display name from a snake_case field name.
 */
export function fieldDisplayName(field: string): string {
  return field
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Auto-map source fields to destination columns using smart matching.
 * Returns a mapping of sourceField -> destinationColumnName.
 * Unmapped fields get `null` as the value.
 */
export function autoMapFields(
  sourceFields: string[],
  destinationColumns: ColumnInfo[],
): Record<string, string | null> {
  const mapping: Record<string, string | null> = {};
  const usedColumns = new Set<string>();

  // Pass 1: exact match (case-insensitive)
  for (const source of sourceFields) {
    const match = destinationColumns.find(
      c => !usedColumns.has(c.name) && c.name.toLowerCase() === source.toLowerCase(),
    );
    if (match) {
      mapping[source] = match.name;
      usedColumns.add(match.name);
    }
  }

  // Pass 2: normalized match (strip underscores/spaces/hyphens)
  for (const source of sourceFields) {
    if (mapping[source] !== undefined) continue;
    const normalizedSource = normalize(source);
    const match = destinationColumns.find(
      c => !usedColumns.has(c.name) && normalize(c.name) === normalizedSource,
    );
    if (match) {
      mapping[source] = match.name;
      usedColumns.add(match.name);
    }
  }

  // Pass 3: synonym match
  for (const source of sourceFields) {
    if (mapping[source] !== undefined) continue;
    const synonyms = SYNONYMS[source] || [];
    for (const syn of synonyms) {
      const normalizedSyn = normalize(syn);
      const match = destinationColumns.find(
        c => !usedColumns.has(c.name) && normalize(c.name) === normalizedSyn,
      );
      if (match) {
        mapping[source] = match.name;
        usedColumns.add(match.name);
        break;
      }
    }
  }

  // Pass 4: remaining unmapped fields get null (suggest creating new column)
  for (const source of sourceFields) {
    if (mapping[source] === undefined) {
      mapping[source] = null;
    }
  }

  return mapping;
}
