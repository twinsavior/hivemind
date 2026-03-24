// ── Flag Rules ───────────────────────────────────────────────────────────────

export interface FlagRule {
  id: number;
  name: string;
  keywords: string[];
  required_keywords: string[];
  sender_patterns: string[];
  exclude_phrases: string[];
  check_subject: boolean;
  check_body: boolean;
  check_snippet: boolean;
  require_attachment: boolean;
  priority: number;
  enabled: boolean;
  destination_ids: number[];
  instructions: string;
  field_mappings: Record<string, Record<string, string>>;
  expected_fields: string[];
  scan_all: boolean;
  created_at: string;
  updated_at: string;
}

export type FlagRuleInput = Omit<FlagRule, 'id' | 'created_at' | 'updated_at'>;


export interface FlagMatch {
  rule_name: string;
  priority: number;
  instructions: string;
  destination_ids: number[];
  field_mappings: Record<string, Record<string, string>>;
  expected_fields: string[];
}

export type RuleSuggestion = Omit<FlagRule, 'id' | 'created_at' | 'updated_at'> & {
  reasoning?: string;
};

// ── Extraction Config ────────────────────────────────────────────────────────

export interface ExtractionConfig {
  id: number;
  model: string;
  system_prompt: string;
  extraction_schema: string;
  temperature: number;
  enabled: boolean;
  updated_at: string;
}

// ── Destinations ─────────────────────────────────────────────────────────────

export type DestinationType = 'airtable' | 'sheets' | 'notion' | 'slack' | 'discord';

export interface Destination {
  id: number;
  name: string;
  type: DestinationType;
  config: Record<string, string>;
  field_mapping: Record<string, string>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export type DestinationInput = Omit<Destination, 'id' | 'created_at' | 'updated_at'>;

export interface ColumnInfo {
  name: string;
  type?: string;
}

// ── Gmail Auth ───────────────────────────────────────────────────────────────

export interface GmailAuth {
  id: number;
  email: string;
  access_token: string;
  refresh_token: string;
  token_expiry: string;
  scopes: string;
  connected_at: string;
  updated_at: string;
}

// ── Processed Emails ─────────────────────────────────────────────────────────

export interface ProcessedEmail {
  id: number;
  gmail_message_id: string;
  thread_id: string | null;
  subject: string | null;
  from_email: string | null;
  from_name: string | null;
  received_date: string | null;
  matched_rules: string[];
  extracted_data: Record<string, unknown> | null;
  destinations_pushed: number[];
  status: 'processed' | 'flagged' | 'extracted' | 'pushed' | 'error' | 'skipped';
  error_message: string | null;
  processing_time_ms: number | null;
  pipeline_run_id: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  estimated_cost_usd: number | null;
  created_at: string;
}

// ── Pipeline Runs ────────────────────────────────────────────────────────────

export interface PipelineRun {
  id: number;
  trigger: 'scheduled' | 'manual';
  status: 'running' | 'completed' | 'error';
  emails_scanned: number;
  emails_flagged: number;
  emails_extracted: number;
  emails_pushed: number;
  emails_skipped: number;
  emails_errored: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface PipelineStatus {
  enabled: boolean;
  is_running: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  scan_interval_minutes: number;
  last_run_stats: {
    emails_scanned: number;
    emails_flagged: number;
    emails_pushed: number;
    emails_errored: number;
  } | null;
  gmail_connected: boolean;
  rules_count: number;
  destinations_count: number;
}

// ── Email Data (internal pipeline types) ─────────────────────────────────────

export interface EmailData {
  message_id: string;
  thread_id: string;
  subject: string;
  from_email: string;
  from_name: string;
  snippet: string;
  date: string;
  body?: string;
  has_attachments?: boolean;
}

export interface ExtractedData {
  summary: string;
  category: string;
  sender_company: string | null;
  action_required: boolean;
  action_description: string | null;
  due_date: string | null;
  amount: number | null;
  currency: string | null;
  reference_numbers: string[];
  key_entities: string[];
  sentiment: string;
  confidence: number;
  [key: string]: unknown;
}

export interface AttachmentData {
  filename: string;
  mime_type: string;
  data_bytes: Buffer;
}

// ── Orders ──────────────────────────────────────────────────────────────────

export interface Order {
  id: number;
  gmail_message_id: string;
  rule_id: number | null;
  retailer: string;
  order_number: string;
  order_date: string | null;
  item_name: string;
  item_quantity: number;
  item_price: number | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  currency: string;
  tracking_number: string | null;
  carrier: string | null;
  order_status: string;
  estimated_delivery: string | null;
  shipping_address: string | null;
  delivery_photo_path: string | null;
  tracking_url: string | null;
  raw_extracted_data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface OrderStats {
  total_orders: number;
  total_spend: number;
  by_status: Record<string, number>;
  retailers: string[];
}
