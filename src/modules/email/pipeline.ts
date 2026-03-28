import { getSetting, getAllRules, getAllDestinations, getExtractionConfig, isEmailProcessed, isEmailProcessedByContent, isBlockedSender, insertProcessedEmail, deleteProcessedEmail, deleteOrdersByEmail, upsertOrder, createPipelineRun, completePipelineRun, getUpsertHistory, setUpsertHistory, getOrderItemPrices, updateOrderDeliveryPhoto, getExistingOrderItemNames, updateOrderSharedFields, deleteUnknownOrderItems, enqueuePushRetry, getDuePushQueueItems, updatePushQueueItem, getDestination, isSellerAlertProcessed, insertSellerAlert, getAccountLastUid, setAccountLastUid } from './db.js';
import { searchRecentMessages, getMessageMetadata, getMessageBody, getMessageHtml, getAttachments, getEnabledAccounts, getClientForAccount, type EmailClient } from './email-client.js';
import { flagEmail } from './flag-engine.js';
import { processEmail, processEmailWithInstructions, screenSubjectLines, extractPdfText } from './llm-extractor.js';
import type { LLMUsage } from './llm-extractor.js';
import { pushToDestination, buildFields, coerceValue } from './db-pusher.js';
import { getTemplate } from './retailer-templates.js';
import { normalizeExtractedItems } from './item-normalizer.js';
import { extractDeliveryPhotoUrls, downloadDeliveryPhoto } from './delivery-photo.js';
import { extractTrackingInfo } from './tracking-extractor.js';

// ── Hivemind event bus integration ─────────────────────────────────────────
import { EventEmitter } from 'events';
let _emailBus: EventEmitter | null = null;
let _emailBusResolved = false;

async function resolveEmailBus(): Promise<void> {
  if (_emailBusResolved) return;
  _emailBusResolved = true;
  try {
    const mod = await import('./index.js');
    _emailBus = mod.emailBus ?? null;
  } catch {
    _emailBus = null;
  }
}
function emitEmailEvent(event: string, data: unknown): void {
  _emailBus?.emit(event, data);
}

// ── Amazon Seller Alert Detection ───────────────────────────────────────────

const AMAZON_ALERT_SENDERS = [
  'seller-notification@amazon.com',
  'no-reply@amazon.com',
  'noreply@amazon.com',
  'payments-messages@amazon.com',
  'fba-noreply@amazon.com',
  'shipment-tracking@amazon.com',
  'seller-performance@amazon.com',
];

// Domain-based patterns for broader Amazon alert detection
const AMAZON_ALERT_DOMAINS = [
  '@amazon.com',
  '@amazon.co.uk',
  '@amazon.de',
  '@amazon.ca',
  '@amazonsellerservices.com',
];

const WALMART_ALERT_DOMAINS = [
  '@walmart.com',
  '@walmartcommerce.com',
];

const EBAY_ALERT_DOMAINS = [
  '@ebay.com',
  '@reply.ebay.com',
];

const URGENCY_KEYWORDS: Record<string, string[]> = {
  critical: ['account health', 'suspended', 'deactivated', 'policy violation', 'immediate action'],
  high: ['a-to-z guarantee claim', 'a-to-z claim', 'return request', 'negative feedback', 'listing removed'],
  medium: ['inventory', 'restock', 'listing quality', 'stranded inventory'],
  low: ['fba fee', 'promotional', 'referral bonus', 'advertising'],
};

const ALERT_TYPE_KEYWORDS: Record<string, string[]> = {
  account_health: ['account health', 'account performance'],
  suspension: ['suspended', 'deactivated', 'account deactivat'],
  policy_violation: ['policy violation', 'policy warning'],
  a_to_z_claim: ['a-to-z guarantee', 'a-to-z claim'],
  return: ['return request', 'return initiated'],
  inventory: ['inventory', 'restock', 'stranded'],
  listing: ['listing removed', 'listing quality', 'listing deactivat'],
  fba_fee: ['fba fee', 'fee change', 'referral fee'],
};

function classifyAlertUrgency(subject: string): string {
  const lower = subject.toLowerCase();
  for (const [urgency, keywords] of Object.entries(URGENCY_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return urgency;
  }
  return 'medium'; // default for unrecognized Amazon seller notifications
}

function classifyAlertType(subject: string): string {
  const lower = subject.toLowerCase();
  for (const [type, keywords] of Object.entries(ALERT_TYPE_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return type;
  }
  return 'other';
}

function isMarketplaceAlertSender(fromEmail: string | undefined): { isAlert: boolean; marketplace?: 'amazon' | 'walmart' | 'ebay' } {
  if (!fromEmail) return { isAlert: false };
  const lower = fromEmail.toLowerCase();
  // Check exact Amazon senders first (most common)
  if (AMAZON_ALERT_SENDERS.some(s => lower === s || lower.includes(s))) {
    return { isAlert: true, marketplace: 'amazon' };
  }
  // Then check domain patterns for all marketplaces
  if (AMAZON_ALERT_DOMAINS.some(d => lower.endsWith(d))) {
    return { isAlert: true, marketplace: 'amazon' };
  }
  if (WALMART_ALERT_DOMAINS.some(d => lower.endsWith(d))) {
    return { isAlert: true, marketplace: 'walmart' };
  }
  if (EBAY_ALERT_DOMAINS.some(d => lower.endsWith(d))) {
    return { isAlert: true, marketplace: 'ebay' };
  }
  return { isAlert: false };
}

// Keep backwards-compatible wrapper
function isAmazonAlertSender(fromEmail: string | undefined): boolean {
  if (!fromEmail) return false;
  const lower = fromEmail.toLowerCase();
  return AMAZON_ALERT_SENDERS.some(sender => lower.includes(sender));
}

/** Parse an email date string into a comparable timestamp (ms since epoch). Returns 0 on failure. */
function parseEmailDate(dateStr: string | undefined): number {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

/** Extract __upsert_* keys from a field mapping and return clean mapping + config overrides */
function extractUpsertConfig(mapping: Record<string, string>, destConfig: Record<string, string>): {
  cleanMapping: Record<string, string>;
  config: Record<string, string>;
} {
  const cleanMapping: Record<string, string> = {};
  const upsertOverrides: Record<string, string> = {};

  for (const [key, value] of Object.entries(mapping)) {
    if (key === '__upsert_enabled') {
      upsertOverrides.upsert_enabled = value;
    } else if (key === '__upsert_field') {
      upsertOverrides.upsert_field = value;
    } else {
      cleanMapping[key] = value;
    }
  }

  return {
    cleanMapping,
    config: { ...destConfig, ...upsertOverrides },
  };
}

/** Insert/upsert order data when extraction came from a retailer template rule.
 *  Handles multi-item emails by normalizing items and inserting one row per item.
 *  Cross-references existing order rows for missing prices (e.g. shipment email
 *  lacks prices but order confirmation had them).
 *
 *  When extraction produces only "Unknown item" entries (e.g. a shipping email
 *  that Gemini couldn't parse item names from), the order-level data (status,
 *  date, tracking, total) is distributed to existing item rows for that order
 *  instead of creating phantom "Unknown item" rows. */
function maybeInsertOrders(
  extractedData: Record<string, unknown>,
  emailMeta: { message_id: string; date?: string },
  ruleId: number | undefined,
  templateId: string | undefined,
): void {
  if (!templateId) return;
  const template = getTemplate(templateId);
  if (!template || !template.is_order_template) return;

  const { items, shared } = normalizeExtractedItems(extractedData);
  if (items.length === 0) return;

  const orderNumber = String(shared.order_id ?? shared.order_number ?? '');
  if (!orderNumber) return;

  // For generic templates (no sender_patterns, e.g. Shopify), prefer the
  // Gemini-extracted retailer_name so orders show "Amazon" not "Shopify Store"
  const extractedRetailer = shared.retailer_name ? String(shared.retailer_name) : '';
  const retailer = (template.sender_patterns.length === 0 && extractedRetailer)
    ? extractedRetailer
    : template.name;

  const coerceNum = (v: unknown): number | undefined => {
    if (v === null || v === undefined || v === '') return undefined;
    const n = coerceValue(String(v), 'number');
    return typeof n === 'number' && !isNaN(n) ? n : undefined;
  };

  // Separate real items from "Unknown item" placeholders
  const knownItems = items.filter(i => i.item_name !== 'Unknown item');
  const unknownItems = items.filter(i => i.item_name === 'Unknown item');

  // If ALL items are unknown, try to distribute order-level data to existing items
  if (knownItems.length === 0 && unknownItems.length > 0) {
    const existingNames = getExistingOrderItemNames(retailer, orderNumber);
    const realExisting = existingNames.filter(n => n !== 'Unknown item');

    if (realExisting.length > 0) {
      // Existing real items found — update them with order-level data, skip "Unknown item" creation
      updateOrderSharedFields(retailer, orderNumber, {
        gmail_message_id: emailMeta.message_id,
        order_date: shared.order_date ? String(shared.order_date) : undefined,
        tracking_number: shared.tracking_number ? String(shared.tracking_number) : undefined,
        carrier: shared.carrier ? String(shared.carrier) : undefined,
        order_status: shared.order_status ? String(shared.order_status) : undefined,
        estimated_delivery: shared.estimated_delivery ? String(shared.estimated_delivery) : undefined,
        shipping_address: shared.shipping_address ? String(shared.shipping_address) : undefined,
        subtotal: coerceNum(shared.subtotal),
        tax: coerceNum(shared.tax),
        total: coerceNum(shared.total),
        raw_extracted_data: extractedData,
      });
      // Clean up any stale "Unknown item" rows from previous runs
      deleteUnknownOrderItems(retailer, orderNumber);
      return;
    }
    // No real existing items — fall through to insert "Unknown item" as fallback
  }

  // If we have real items, clean up any "Unknown item" placeholders for this order
  if (knownItems.length > 0) {
    deleteUnknownOrderItems(retailer, orderNumber);
  }

  // Cross-reference: look up existing prices for items missing them
  const itemsToInsert = knownItems.length > 0 ? knownItems : items;
  const missingPrices = itemsToInsert.some(item => item.item_price === null);
  let priceCache: Map<string, number> | null = null;
  if (missingPrices) {
    priceCache = getOrderItemPrices(retailer, orderNumber);
  }

  for (const item of itemsToInsert) {
    const itemPrice = item.item_price ?? priceCache?.get(item.item_name) ?? undefined;

    upsertOrder({
      gmail_message_id: emailMeta.message_id,
      rule_id: ruleId,
      retailer,
      order_number: orderNumber,
      item_name: item.item_name,
      order_date: shared.order_date ? String(shared.order_date) : undefined,
      item_quantity: item.item_quantity,
      item_price: coerceNum(itemPrice),
      subtotal: coerceNum(shared.subtotal),
      tax: coerceNum(shared.tax),
      total: coerceNum(shared.total),
      currency: shared.currency ? String(shared.currency) : 'USD',
      tracking_number: shared.tracking_number ? String(shared.tracking_number) : undefined,
      carrier: shared.carrier ? String(shared.carrier) : undefined,
      order_status: shared.order_status ? String(shared.order_status) : 'ordered',
      estimated_delivery: shared.estimated_delivery ? String(shared.estimated_delivery) : undefined,
      shipping_address: shared.shipping_address ? String(shared.shipping_address) : undefined,
      raw_extracted_data: extractedData,
    });
    emitEmailEvent('email:purchase', {
      retailer,
      order_number: orderNumber,
      item_name: item.item_name,
      item_quantity: item.item_quantity,
      item_price: coerceNum(itemPrice),
      order_status: shared.order_status ? String(shared.order_status) : 'ordered',
      tracking_number: shared.tracking_number ? String(shared.tracking_number) : undefined,
    });
  }
}

/**
 * Fetch email HTML once and use it for both:
 * 1. Tracking URL/number extraction (all order emails)
 * 2. Delivery photo extraction (delivered emails only)
 * Non-fatal: any error is logged and silently swallowed.
 */
async function maybeExtractTrackingAndPhoto(
  messageId: string,
  extractedData: Record<string, unknown>,
  retailer: string,
  orderNumber: string,
  client?: EmailClient,
): Promise<void> {
  try {
    const html = client ? await client.getMessageHtml(messageId) : await getMessageHtml(messageId);
    if (!html) return;

    // Extract tracking info from HTML (URLs, TBA numbers, carrier tracking numbers)
    const trackingInfo = extractTrackingInfo(html);
    if (trackingInfo.tracking_number || trackingInfo.tracking_url) {
      updateOrderSharedFields(retailer, orderNumber, {
        gmail_message_id: messageId,
        tracking_number: trackingInfo.tracking_number,
        carrier: trackingInfo.carrier,
        tracking_url: trackingInfo.tracking_url,
      });
      console.log(`Tracking info extracted for ${retailer} ${orderNumber}:`,
        trackingInfo.tracking_number ?? trackingInfo.tracking_url);
    }

    // Delivery photo extraction (only for delivered status)
    const status = String(extractedData.order_status ?? '').toLowerCase();
    if (status === 'delivered') {
      const candidates = extractDeliveryPhotoUrls(html);
      for (const candidate of candidates) {
        const photoPath = await downloadDeliveryPhoto(candidate.url, retailer, orderNumber);
        if (photoPath) {
          updateOrderDeliveryPhoto(retailer, orderNumber, photoPath);
          console.log(`Delivery photo saved for ${retailer} ${orderNumber}: ${photoPath}`);
          return;
        }
      }
    }
  } catch (e) {
    console.error('Tracking/photo extraction failed (non-fatal):', e);
  }
}

export interface PipelineResult {
  run_id: number;
  emails_scanned: number;
  emails_flagged: number;
  emails_extracted: number;
  emails_pushed: number;
  emails_skipped: number;
  emails_errored: number;
  error_message: string | null;
  duration_ms: number;
  diagnostics: string[];
}

export async function runPipeline(trigger: 'scheduled' | 'manual'): Promise<PipelineResult> {
  await resolveEmailBus();
  const startTime = Date.now();
  const runId = createPipelineRun(trigger);

  const lookbackMinutes = parseInt(getSetting('lookback_minutes') || '1440', 10);
  const maxEmails = parseInt(getSetting('max_emails_per_run') || '50', 10);
  const maxPdfsPerEmail = 3;
  const SCREENING_BATCH_SIZE = 50; // Screen up to 50 subjects per API call

  let emailsScanned = 0;
  let emailsFlagged = 0;
  let emailsExtracted = 0;
  let emailsPushed = 0;
  let emailsSkipped = 0;
  let emailsErrored = 0;
  const diagnostics: string[] = [];

  try {
    // 1. Load rules and destinations
    const rawRules = getAllRules().filter(r => r.enabled);
    const rules = rawRules.map(r => {
        const ruleKeywords = JSON.parse(r.keywords) as string[];
        const ruleSenderPatterns = JSON.parse(r.sender_patterns) as string[];
        const ruleExcludePhrases = JSON.parse(r.exclude_phrases) as string[];

        // For template-linked rules, merge template keywords/senders/excludes
        // so template updates propagate without requiring rule re-creation
        const tmpl = r.template_id ? getTemplate(r.template_id) : null;
        const mergedKeywords = tmpl
          ? [...new Set([...ruleKeywords, ...tmpl.keywords])]
          : ruleKeywords;
        const mergedSenders = tmpl
          ? [...new Set([...ruleSenderPatterns, ...tmpl.sender_patterns])]
          : ruleSenderPatterns;
        const mergedExcludes = tmpl
          ? [...new Set([...ruleExcludePhrases, ...tmpl.exclude_phrases])]
          : ruleExcludePhrases;
        // For template-linked rules, always use the template's instructions
        // so template instruction improvements propagate automatically
        const instructions = tmpl ? tmpl.instructions : (r.instructions || '');

        return {
          name: r.name,
          keywords: mergedKeywords,
          required_keywords: JSON.parse(r.required_keywords) as string[],
          sender_patterns: mergedSenders,
          exclude_phrases: mergedExcludes,
          check_subject: !!r.check_subject,
          check_body: !!r.check_body,
          check_snippet: !!r.check_snippet,
          require_attachment: !!r.require_attachment,
          priority: r.priority,
          enabled: true,
          instructions,
          scan_all: !!r.scan_all,
          destination_ids: JSON.parse(r.destination_ids || '[]') as number[],
          field_mappings: JSON.parse(r.field_mappings || '{}') as Record<string, Record<string, string>>,
          expected_fields: JSON.parse(r.expected_fields || '[]') as string[],
          template_id: r.template_id || null,
          rule_id: r.id,
          account_ids: JSON.parse((r as Record<string, unknown>).account_ids as string || '[]') as number[],
        };
      });

    const destinations = getAllDestinations()
      .filter(d => d.enabled)
      .map(d => ({
        id: d.id,
        type: d.type as 'airtable' | 'sheets' | 'notion' | 'slack' | 'discord' | 'webhook',
        config: JSON.parse(d.config) as Record<string, string>,
        field_mapping: JSON.parse(d.field_mapping) as Record<string, string>,
      }));

    const extractionConfig = getExtractionConfig();
    // Extraction requires the LLM extractor to be injected (uses existing Claude subscription)
    const { hasLLMExtractor } = await import('./llm-extractor.js');
    const extractionEnabled = extractionConfig?.enabled && hasLLMExtractor();

    // Diagnostics: rule count
    const enabledRuleCount = rawRules.length;
    diagnostics.push(`${enabledRuleCount} rule${enabledRuleCount !== 1 ? 's' : ''} enabled`);

    // Diagnostics: extraction status
    diagnostics.push(`LLM extraction: ${extractionEnabled ? 'active' : 'inactive'}`);

    // 2b. Load enabled accounts (multi-account support)
    const accounts = getEnabledAccounts();
    // If no accounts configured, use legacy single-client path
    const accountList = accounts.length > 0
      ? accounts.map(a => ({ account: a, client: getClientForAccount(a) }))
      : [{ account: null, client: null }]; // null = use legacy functions

    // Diagnostics: account connection status
    if (accounts.length === 0) {
      diagnostics.push('No email accounts configured (using legacy connection)');
    }

    // 3. Process each account
    for (const { account, client } of accountList) {
      const accountId = account?.id;
      const accountLabel = account ? `[${account.email}]` : '[default]';

      // Filter rules for this account (empty account_ids = matches all accounts)
      const accountRules = account
        ? rules.filter(r => r.account_ids.length === 0 || r.account_ids.includes(account.id))
        : rules;

      if (accountRules.length === 0) {
        console.log(`Pipeline ${accountLabel}: no rules match this account, skipping`);
        continue;
      }

      // Fetch recent emails for this account
      let emails: import('./types.js').EmailData[];
      const sinceUid = (account?.type === 'imap' && accountId) ? getAccountLastUid(accountId) : null;
      try {
        emails = client
          ? await client.searchRecentMessages(lookbackMinutes, maxEmails, sinceUid ?? undefined)
          : await searchRecentMessages(lookbackMinutes, maxEmails);
        if (account) {
          diagnostics.push(`Connected to ${account.email} (${account.type === 'imap' ? 'IMAP' : 'Gmail OAuth'})`);
        }
      } catch (e) {
        console.error(`Pipeline ${accountLabel}: failed to fetch emails:`, e);
        const errDetail = e instanceof Error ? e.message : String(e);
        if (account) {
          diagnostics.push(`FAILED to connect to ${account.email} (${account.type === 'imap' ? 'IMAP' : 'Gmail OAuth'}): ${errDetail}`);
        } else {
          diagnostics.push(`FAILED to connect to default account: ${errDetail}`);
        }
        continue;
      }

      // Track highest UID seen for incremental sync
      let highestUid = sinceUid ?? 0;
      for (const em of emails) {
        if (em.uid && em.uid > highestUid) highestUid = em.uid;
      }
      emailsScanned += emails.length;

      // Helper functions that use the correct client
      const fetchBody = client
        ? (id: string) => client.getMessageBody(id)
        : (id: string) => getMessageBody(id);
      const fetchAttachments = client
        ? (id: string, filter?: string) => client.getAttachments(id, filter)
        : (id: string, filter?: string) => getAttachments(id, filter);

      // Separate rules into sender-matched vs instruction-only (need screening)
      const senderRules = accountRules.filter(r => r.sender_patterns.length > 0 || r.keywords.length > 0);
      const instructionOnlyRules = accountRules.filter(r =>
        r.sender_patterns.length === 0 && r.keywords.length === 0 && r.instructions.trim().length > 0
      );

      // 4. First pass: categorize emails
      //    - sender/keyword matched → direct to extraction (bypass screening)
      //    - instruction-only rules → needs subject screening
      const directExtract: typeof emails = [];      // Sender/keyword matched — go straight to full extraction
      const needsScreening: typeof emails = [];     // No sender match — needs subject line screening

      for (const emailMeta of emails) {
        if (isEmailProcessed(emailMeta.message_id)) {
          emailsSkipped++;
          continue;
        }

        // Secondary dedup: check by from_email + subject + date (within 1 minute)
        // Catches duplicates when IMAP Message-ID headers are missing or unreliable
        if (isEmailProcessedByContent(emailMeta.from_email, emailMeta.subject, emailMeta.date)) {
          emailsSkipped++;
          continue;
        }

        // Check if sender is blocked (global or per-account)
        if (emailMeta.from_email && isBlockedSender(emailMeta.from_email, accountId)) {
          insertProcessedEmail({
            gmail_message_id: emailMeta.message_id,
            thread_id: emailMeta.thread_id,
            subject: emailMeta.subject,
            from_email: emailMeta.from_email,
            from_name: emailMeta.from_name,
            received_date: emailMeta.date,
            status: 'skipped',
            error_message: 'Sender is blocked',
            pipeline_run_id: runId,
            account_id: accountId,
          });
          emailsSkipped++;
          continue;
        }

        // Check sender/keyword rules first
        const senderMatches = flagEmail(emailMeta, senderRules);
        if (senderMatches.length > 0) {
          // Sender or keyword matched — bypass screening, go direct
          directExtract.push(emailMeta);
        } else if (instructionOnlyRules.length > 0) {
          // No sender match but we have instruction-only rules — needs AI screening
          needsScreening.push(emailMeta);
        } else {
          // No rules match at all — skip
          insertProcessedEmail({
            gmail_message_id: emailMeta.message_id,
            thread_id: emailMeta.thread_id,
            subject: emailMeta.subject,
            from_email: emailMeta.from_email,
            from_name: emailMeta.from_name,
            received_date: emailMeta.date,
            status: 'skipped',
            pipeline_run_id: runId,
            account_id: accountId,
          });
          emailsSkipped++;
        }
      }

    // 5. PHASE 1: Subject-line screening for instruction-only emails
    //    One batch API call per ~50 subjects — massively cheaper than reading full bodies
    const screenedPassIds = new Set<string>();
    let screeningTokensPrompt = 0;
    let screeningTokensCompletion = 0;

    if (needsScreening.length > 0 && extractionEnabled) {
      const ruleDescs = instructionOnlyRules.map(r => ({ name: r.name, instructions: r.instructions }));

      for (let i = 0; i < needsScreening.length; i += SCREENING_BATCH_SIZE) {
        const batch = needsScreening.slice(i, i + SCREENING_BATCH_SIZE);
        const emailsForScreening = batch.map(e => ({
          id: e.message_id,
          subject: e.subject || '(no subject)',
          from_email: e.from_email || '',
          snippet: e.snippet,
        }));

        try {
          const { passedIds, usage } = await screenSubjectLines(emailsForScreening, ruleDescs);
          screeningTokensPrompt += usage.promptTokens;
          screeningTokensCompletion += usage.completionTokens;
          passedIds.forEach(id => screenedPassIds.add(id));
          console.log(`Subject screening batch: ${batch.length} emails → ${passedIds.size} passed`);
        } catch (e) {
          // If screening fails, pass all through as safety fallback
          console.error('Subject screening failed, passing all through:', e);
          batch.forEach(em => screenedPassIds.add(em.message_id));
        }
      }

      // Record skipped emails from screening
      for (const emailMeta of needsScreening) {
        if (!screenedPassIds.has(emailMeta.message_id)) {
          const screenCost = 0; // Free — uses existing Claude subscription
          insertProcessedEmail({
            gmail_message_id: emailMeta.message_id,
            thread_id: emailMeta.thread_id,
            subject: emailMeta.subject,
            from_email: emailMeta.from_email,
            from_name: emailMeta.from_name,
            received_date: emailMeta.date,
            status: 'skipped',
            pipeline_run_id: runId,
            estimated_cost_usd: screenCost,
            account_id: accountId,
          });
          emailsSkipped++;
        }
      }
    }

    // Build the final list of emails to fully process
    const emailsToProcess = [
      ...directExtract,
      ...needsScreening.filter(e => screenedPassIds.has(e.message_id)),
    ];

    emailsFlagged += emailsToProcess.length;
    console.log(`Pipeline ${accountLabel}: ${emails.length} scanned → ${directExtract.length} sender-matched + ${screenedPassIds.size} passed screening = ${emailsToProcess.length} to extract`);

    // 6. PHASE 2: Full extraction for flagged emails
    for (const emailMeta of emailsToProcess) {
      try {
        // Determine which rules matched this email
        const allMatches = flagEmail(emailMeta, accountRules);
        const flagNames = allMatches.map(m => m.rule_name);

        // Fetch full body using the correct account's client
        const body = await fetchBody(emailMeta.message_id);
        const emailDataWithBody = { ...emailMeta, body };

        let extractedData: Record<string, unknown> | null = null;
        let totalPromptTokens = 0;
        let totalCompletionTokens = 0;

        if (extractionEnabled) {
          // Fetch PDF attachments
          const pdfTexts: string[] = [];
          try {
            const attachments = await fetchAttachments(emailMeta.message_id, 'application/pdf');
            for (const att of attachments.slice(0, maxPdfsPerEmail)) {
              const text = await extractPdfText(att.data_bytes);
              if (text && !text.startsWith('[PDF extraction failed')) {
                pdfTexts.push(text);
              }
            }
          } catch {
            // Attachment fetch failure is non-fatal
          }

          // Group matches by instructions (also collect expected_fields per group)
          const instructionGroups = new Map<string, { ruleNames: string[]; expectedFields: string[] }>();
          for (const match of allMatches) {
            const key = (match.instructions || '').trim();
            if (!instructionGroups.has(key)) {
              instructionGroups.set(key, { ruleNames: [], expectedFields: [] });
            }
            const group = instructionGroups.get(key)!;
            group.ruleNames.push(match.rule_name);
            for (const f of (match.expected_fields || [])) {
              if (!group.expectedFields.includes(f)) group.expectedFields.push(f);
            }
          }

          // Process each instruction group
          const mergedData: Record<string, unknown> = {};

          for (const [instructions, { ruleNames, expectedFields }] of instructionGroups) {
            let result: { data: Record<string, unknown>; usage: LLMUsage };

            if (instructions === '') {
              // Global schema extraction
              result = await processEmail(
                emailDataWithBody,
                ruleNames,
                pdfTexts.length > 0 ? pdfTexts : undefined,
              );
            } else {
              // Instruction-based extraction
              result = await processEmailWithInstructions(
                emailDataWithBody,
                instructions,
                pdfTexts.length > 0 ? pdfTexts : undefined,
                expectedFields.length > 0 ? expectedFields : undefined,
              );
            }

            totalPromptTokens += result.usage.promptTokens;
            totalCompletionTokens += result.usage.completionTokens;

            // Skip extraction if Gemini says this email isn't relevant to the rule
            const { _relevant, ...dataFields } = result.data;
            if (_relevant === false) continue;
            Object.assign(mergedData, dataFields);
          }

          // Only count as extracted if at least one field has a real value
          const hasData = Object.values(mergedData).some(v =>
            v !== null && v !== undefined && v !== '' && v !== false &&
            !(Array.isArray(v) && v.length === 0),
          );
          if (hasData) {
            extractedData = mergedData;
            emailsExtracted++;

            // Insert into orders table if this came from a retailer template
            const templateRule = allMatches.find(m => {
              const r = rules.find(ru => ru.name === m.rule_name);
              return r?.template_id;
            });
            if (templateRule) {
              const r = rules.find(ru => ru.name === templateRule.rule_name);
              try {
                maybeInsertOrders(extractedData, emailMeta, r?.rule_id, r?.template_id ?? undefined);
              } catch (e) {
                console.error('Failed to insert order:', e);
              }

              const tmpl = r?.template_id ? getTemplate(r.template_id) : null;
              if (tmpl?.is_order_template && extractedData) {
                const { shared } = normalizeExtractedItems(extractedData);
                const orderNum = String(shared.order_id ?? shared.order_number ?? '');
                const retailerName = String(shared.retailer_name ?? tmpl.name ?? '');

                if (orderNum && retailerName) {
                  // Fetch HTML once for both tracking extraction and delivery photos
                  maybeExtractTrackingAndPhoto(emailMeta.message_id, extractedData, retailerName, orderNum, client ?? undefined)
                    .catch(e => console.error('HTML extraction error (non-fatal):', e));
                }
              }
            }
          }
        }

        // Push to destinations
        const allowedDestIds = new Set<number>();
        let sendToAll = false;
        for (const match of allMatches) {
          if (match.destination_ids.length === 0) {
            sendToAll = true;
            break;
          }
          match.destination_ids.forEach(id => allowedDestIds.add(id));
        }

        // Build per-destination rule-level mappings (highest priority rule wins)
        const ruleFieldMappings = new Map<number, Record<string, string>>();
        for (const match of allMatches) {
          for (const [destIdStr, mapping] of Object.entries(match.field_mappings)) {
            const destId = Number(destIdStr);
            if (Object.keys(mapping).length > 0 && !ruleFieldMappings.has(destId)) {
              ruleFieldMappings.set(destId, mapping);
            }
          }
        }

        const filteredDests = sendToAll
          ? destinations
          : destinations.filter(d => allowedDestIds.has(d.id));

        const pushedDestinations: number[] = [];
        const pushErrors: string[] = [];
        const filledGapsDests: number[] = [];
        const failedPushes: { destId: number; payload: string }[] = [];
        const fallbackExtracted = extractedData || {
          summary: emailMeta.snippet,
          category: 'other',
          sender_company: null,
          action_required: false,
          action_description: null,
          due_date: null,
          amount: null,
          currency: null,
          reference_numbers: [],
          key_entities: [],
          sentiment: 'neutral',
          confidence: 0,
        };
        for (const dest of filteredDests) {
          try {
            const rawMapping = ruleFieldMappings.get(dest.id) ?? dest.field_mapping;
            const { cleanMapping, config } = extractUpsertConfig(rawMapping, dest.config);

            // Date guard: if we already pushed newer data for this merge key,
            // switch to fill-gaps mode (only update empty fields, don't overwrite)
            let fillGapsOnly = false;
            if (config.upsert_enabled === 'true' && config.upsert_field) {
              const testFields = buildFields(cleanMapping, emailDataWithBody, extractedData || {});
              const mergeValue = testFields[config.upsert_field];
              if (mergeValue !== null && mergeValue !== undefined && mergeValue !== '') {
                const existing = getUpsertHistory(dest.id, String(mergeValue));
                if (existing) {
                  const incomingTs = parseEmailDate(emailMeta.date);
                  const existingTs = parseEmailDate(existing.email_date);
                  if (incomingTs > 0 && existingTs > 0 && incomingTs < existingTs) {
                    config.fill_gaps_only = 'true';
                    fillGapsOnly = true;
                  }
                }
              }
            }

            await pushToDestination(
              { ...dest, config, field_mapping: cleanMapping },
              emailDataWithBody,
              fallbackExtracted,
            );
            pushedDestinations.push(dest.id);
            if (fillGapsOnly) filledGapsDests.push(dest.id);

            // Record upsert history after successful push (skip for fill-gaps — keep newer date)
            if (!fillGapsOnly && config.upsert_enabled === 'true' && config.upsert_field && emailMeta.date) {
              const pushFields = buildFields(cleanMapping, emailDataWithBody, extractedData || {});
              const mergeValue = pushFields[config.upsert_field];
              if (mergeValue !== null && mergeValue !== undefined && mergeValue !== '') {
                setUpsertHistory(dest.id, String(mergeValue), emailMeta.date, emailMeta.message_id);
              }
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`Failed to push to destination ${dest.id}:`, msg);
            pushErrors.push(`Dest ${dest.id}: ${msg}`);
            // Collect failed push data for retry queue
            failedPushes.push({
              destId: dest.id,
              payload: JSON.stringify({
                emailData: emailDataWithBody,
                extractedData: fallbackExtracted,
                destConfig: dest.config,
                fieldMapping: ruleFieldMappings.get(dest.id) ?? dest.field_mapping,
              }),
            });
          }
        }

        if (pushedDestinations.length > 0) emailsPushed++;

        // Cost is $0 — uses existing Claude subscription
        const estimatedCost = 0;

        // Record processed email
        const processedEmailId = insertProcessedEmail({
          gmail_message_id: emailMeta.message_id,
          thread_id: emailMeta.thread_id,
          subject: emailMeta.subject,
          from_email: emailMeta.from_email,
          from_name: emailMeta.from_name,
          received_date: emailMeta.date,
          matched_rules: flagNames,
          extracted_data: extractedData ?? undefined,
          destinations_pushed: pushedDestinations,
          status: pushedDestinations.length > 0 ? 'pushed' : (extractedData ? 'extracted' : 'flagged'),
          error_message: [
            ...pushErrors,
            ...filledGapsDests.map(id => `Dest ${id}: filled gaps only (older email)`),
          ].join('; ') || undefined,
          pipeline_run_id: runId,
          processing_time_ms: Date.now() - startTime,
          prompt_tokens: totalPromptTokens || undefined,
          completion_tokens: totalCompletionTokens || undefined,
          estimated_cost_usd: estimatedCost,
          account_id: accountId,
        });

        // Enqueue failed pushes for retry
        for (const fp of failedPushes) {
          const nextRetryAt = new Date(Date.now() + 60 * 1000).toISOString();
          enqueuePushRetry({
            processed_email_id: processedEmailId,
            destination_id: fp.destId,
            payload: fp.payload,
            next_retry_at: nextRetryAt,
          });
        }

      } catch (e) {
        emailsErrored++;
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`Error processing '${emailMeta.subject}':`, errMsg);

        insertProcessedEmail({
          gmail_message_id: emailMeta.message_id,
          thread_id: emailMeta.thread_id,
          subject: emailMeta.subject,
          from_email: emailMeta.from_email,
          from_name: emailMeta.from_name,
          received_date: emailMeta.date,
          status: 'error',
          error_message: errMsg,
          pipeline_run_id: runId,
          account_id: accountId,
        });
      }
    }

    // Update last_uid for incremental IMAP sync after processing this account's emails
    if (account?.type === 'imap' && accountId && highestUid > 0) {
      setAccountLastUid(accountId, highestUid);
    }

    } // end account loop

    // ── Amazon Seller Alert Detection ─────────────────────────────────────
    // Second pass: check ALL fetched emails for Amazon seller notifications
    // This runs per-account after rule matching completes
    for (const { account, client: _alertClient } of accountList) {
      const accountId = account?.id;
      if (!accountId) continue;

      // Re-fetch emails for this account (using the same list if we stored it)
      // We detect alerts from any emails we already have in processed_emails
      // but also check unprocessed ones that were skipped by rules
      try {
        const alertEmails = _alertClient
          ? await _alertClient.searchRecentMessages(lookbackMinutes, maxEmails)
          : await searchRecentMessages(lookbackMinutes, maxEmails);

        for (const emailMeta of alertEmails) {
          if (!isAmazonAlertSender(emailMeta.from_email)) continue;
          if (isSellerAlertProcessed(emailMeta.message_id)) continue;

          const subject = emailMeta.subject || '';
          const urgency = classifyAlertUrgency(subject);
          const alertType = classifyAlertType(subject);
          const summary = subject; // keyword-only fallback; Gemini override below

          // If Gemini is available, try AI extraction for better urgency + summary
          let finalUrgency = urgency;
          let finalSummary = summary;
          let finalAlertType = alertType;

          const extractionConfig = getExtractionConfig();
          if (extractionConfig?.enabled) {
            try {
              const body = _alertClient
                ? await _alertClient.getMessageBody(emailMeta.message_id)
                : await getMessageBody(emailMeta.message_id);

              const alertResult = await processEmailWithInstructions(
                { subject, body: body || '', from_email: emailMeta.from_email || '', date: emailMeta.date || '' },
                `Analyze this Amazon Seller Central notification email. Extract:
- alert_type: one of 'account_health', 'suspension', 'policy_violation', 'a_to_z_claim', 'return', 'inventory', 'listing', 'fba_fee', 'other'
- urgency: one of 'critical', 'high', 'medium', 'low'
- summary: one-line summary of what the alert is about and what action is needed

Guidelines:
- CRITICAL: account at risk of suspension, deactivation, or immediate action required
- HIGH: claims, negative feedback, listings removed — needs attention within 24h
- MEDIUM: inventory issues, listing quality — monitor within a week
- LOW: fee changes, promotional — informational only

Return ONLY valid JSON: {"alert_type": "...", "urgency": "...", "summary": "..."}`,
                undefined,
                ['alert_type', 'urgency', 'summary'],
              );

              if (alertResult?.data) {
                const d = alertResult.data as Record<string, unknown>;
                if (d.urgency && typeof d.urgency === 'string') finalUrgency = d.urgency;
                if (d.summary && typeof d.summary === 'string') finalSummary = d.summary;
                if (d.alert_type && typeof d.alert_type === 'string') finalAlertType = d.alert_type;
              }
            } catch (e) {
              console.error('Alert Gemini extraction failed (using keyword fallback):', e);
            }
          }

          insertSellerAlert({
            account_id: accountId,
            gmail_message_id: emailMeta.message_id,
            alert_type: finalAlertType,
            urgency: finalUrgency,
            summary: finalSummary,
            raw_subject: subject,
          });
          emitEmailEvent('email:seller-alert', {
            alert_type: finalAlertType,
            urgency: finalUrgency,
            summary: finalSummary,
            subject,
          });

          // Push critical and high urgency alerts to webhook destinations
          if (finalUrgency === 'critical' || finalUrgency === 'high') {
            const webhookDests = destinations.filter(
              d => d.type === 'slack' || d.type === 'discord' || d.type === 'webhook'
            );
            for (const dest of webhookDests) {
              try {
                await pushToDestination(
                  { ...dest, field_mapping: {} },
                  { subject, from_email: emailMeta.from_email, date: emailMeta.date },
                  {
                    alert_type: finalAlertType,
                    urgency: finalUrgency,
                    summary: finalSummary,
                    raw_subject: subject,
                  },
                );
              } catch (e) {
                console.error(`Failed to push seller alert to destination ${dest.id}:`, e);
              }
            }
          }
        }
      } catch (e) {
        console.error(`Alert detection failed for account ${accountId}:`, e);
      }
    }

    const durationMs = Date.now() - startTime;
    completePipelineRun(runId, {
      status: 'completed',
      emails_scanned: emailsScanned,
      emails_flagged: emailsFlagged,
      emails_extracted: emailsExtracted,
      emails_pushed: emailsPushed,
      emails_skipped: emailsSkipped,
      emails_errored: emailsErrored,
      duration_ms: durationMs,
    });

    const result: PipelineResult = {
      run_id: runId,
      emails_scanned: emailsScanned,
      emails_flagged: emailsFlagged,
      emails_extracted: emailsExtracted,
      emails_pushed: emailsPushed,
      emails_skipped: emailsSkipped,
      emails_errored: emailsErrored,
      error_message: null,
      duration_ms: durationMs,
      diagnostics,
    };
    emitEmailEvent('email:pipeline-complete', result);
    return result;

  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    const durationMs = Date.now() - startTime;

    completePipelineRun(runId, {
      status: 'error',
      emails_scanned: emailsScanned,
      emails_flagged: emailsFlagged,
      emails_extracted: emailsExtracted,
      emails_pushed: emailsPushed,
      emails_skipped: emailsSkipped,
      emails_errored: emailsErrored,
      error_message: errMsg,
      duration_ms: durationMs,
    });

    return {
      run_id: runId,
      emails_scanned: emailsScanned,
      emails_flagged: emailsFlagged,
      emails_extracted: emailsExtracted,
      emails_pushed: emailsPushed,
      emails_skipped: emailsSkipped,
      emails_errored: emailsErrored,
      error_message: errMsg,
      duration_ms: durationMs,
      diagnostics,
    };
  }
}

// ── Single Email Rescan ────────────────────────────────────────────────────

export interface RescanResult {
  status: string;
  matched_rules: string[];
  extracted_data: Record<string, unknown> | null;
  destinations_pushed: number[];
  prompt_tokens: number;
  completion_tokens: number;
  estimated_cost_usd: number | null;
  processing_time_ms: number;
  error_message: string | null;
}

export async function rescanSingleEmail(gmailMessageId: string): Promise<RescanResult> {
  const startTime = Date.now();

  // Delete old record and order data so we can reinsert
  deleteProcessedEmail(gmailMessageId);
  deleteOrdersByEmail(gmailMessageId);

  // Fetch fresh metadata from Gmail
  const emailMeta = await getMessageMetadata(gmailMessageId);

  // Load current rules and destinations (same mapping as runPipeline)
  const rules = getAllRules().filter(r => r.enabled).map(r => ({
    name: r.name,
    keywords: JSON.parse(r.keywords) as string[],
    required_keywords: JSON.parse(r.required_keywords) as string[],
    sender_patterns: JSON.parse(r.sender_patterns) as string[],
    exclude_phrases: JSON.parse(r.exclude_phrases) as string[],
    check_subject: !!r.check_subject,
    check_body: !!r.check_body,
    check_snippet: !!r.check_snippet,
    require_attachment: !!r.require_attachment,
    priority: r.priority,
    enabled: true,
    instructions: r.instructions || '',
    scan_all: !!r.scan_all,
    destination_ids: JSON.parse(r.destination_ids || '[]') as number[],
    field_mappings: JSON.parse(r.field_mappings || '{}') as Record<string, Record<string, string>>,
    expected_fields: JSON.parse(r.expected_fields || '[]') as string[],
    template_id: r.template_id || null,
    rule_id: r.id,
  }));

  const destinations = getAllDestinations()
    .filter(d => d.enabled)
    .map(d => ({
      id: d.id,
      type: d.type as 'airtable' | 'sheets' | 'notion' | 'slack' | 'discord' | 'webhook',
      config: JSON.parse(d.config) as Record<string, string>,
      field_mapping: JSON.parse(d.field_mapping) as Record<string, string>,
    }));

  const config = getExtractionConfig();
  const { hasLLMExtractor: checkLLM } = await import('./llm-extractor.js');
  const extractionEnabled = !!config?.enabled && checkLLM();
  const maxPdfsPerEmail = parseInt(getSetting('max_pdfs_per_email') ?? '3', 10);

  try {
    // Match rules against this email
    const allMatches = flagEmail(emailMeta, rules);
    const flagNames = allMatches.map(m => m.rule_name);

    if (allMatches.length === 0) {
      // No rules match — record as skipped
      insertProcessedEmail({
        gmail_message_id: emailMeta.message_id,
        thread_id: emailMeta.thread_id,
        subject: emailMeta.subject,
        from_email: emailMeta.from_email,
        from_name: emailMeta.from_name,
        received_date: emailMeta.date,
        status: 'skipped',
        error_message: 'No rules matched on rescan',
        processing_time_ms: Date.now() - startTime,
      });
      return {
        status: 'skipped',
        matched_rules: [],
        extracted_data: null,
        destinations_pushed: [],
        prompt_tokens: 0,
        completion_tokens: 0,
        estimated_cost_usd: null,
        processing_time_ms: Date.now() - startTime,
        error_message: 'No rules matched on rescan',
      };
    }

    // Fetch full body
    const body = await getMessageBody(emailMeta.message_id);
    const emailDataWithBody = { ...emailMeta, body };

    let extractedData: Record<string, unknown> | null = null;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    if (extractionEnabled) {
      // Fetch PDF attachments
      const pdfTexts: string[] = [];
      try {
        const attachments = await getAttachments(emailMeta.message_id, 'application/pdf');
        for (const att of attachments.slice(0, maxPdfsPerEmail)) {
          const text = await extractPdfText(att.data_bytes);
          if (text && !text.startsWith('[PDF extraction failed')) {
            pdfTexts.push(text);
          }
        }
      } catch {
        // non-fatal
      }

      // Group matches by instructions (also collect expected_fields per group)
      const instructionGroups = new Map<string, { ruleNames: string[]; expectedFields: string[] }>();
      for (const match of allMatches) {
        const key = (match.instructions || '').trim();
        if (!instructionGroups.has(key)) instructionGroups.set(key, { ruleNames: [], expectedFields: [] });
        const group = instructionGroups.get(key)!;
        group.ruleNames.push(match.rule_name);
        for (const f of (match.expected_fields || [])) {
          if (!group.expectedFields.includes(f)) group.expectedFields.push(f);
        }
      }

      const mergedData: Record<string, unknown> = {};
      for (const [instructions, { ruleNames, expectedFields }] of instructionGroups) {
        let result: { data: Record<string, unknown>; usage: LLMUsage };
        if (instructions === '') {
          result = await processEmail(emailDataWithBody, ruleNames, pdfTexts.length > 0 ? pdfTexts : undefined);
        } else {
          result = await processEmailWithInstructions(emailDataWithBody, instructions, pdfTexts.length > 0 ? pdfTexts : undefined, expectedFields.length > 0 ? expectedFields : undefined);
        }
        totalPromptTokens += result.usage.promptTokens;
        totalCompletionTokens += result.usage.completionTokens;
        const { _relevant, ...dataFields } = result.data;
        if (_relevant === false) continue;
        Object.assign(mergedData, dataFields);
      }

      const hasData = Object.values(mergedData).some(v =>
        v !== null && v !== undefined && v !== '' && v !== false &&
        !(Array.isArray(v) && v.length === 0),
      );
      if (hasData) {
        extractedData = mergedData;

        // Insert into orders table if this came from a retailer template
        const templateRule = allMatches.find(m => {
          const r = rules.find(ru => ru.name === m.rule_name);
          return r?.template_id;
        });
        if (templateRule) {
          const r = rules.find(ru => ru.name === templateRule.rule_name);
          try {
            maybeInsertOrders(extractedData, emailMeta, r?.rule_id, r?.template_id ?? undefined);
          } catch (e) {
            console.error('Rescan: failed to insert order:', e);
          }

          const tmpl = r?.template_id ? getTemplate(r.template_id) : null;
          if (tmpl?.is_order_template && extractedData) {
            const { shared } = normalizeExtractedItems(extractedData);
            const orderNum = String(shared.order_id ?? shared.order_number ?? '');
            const retailerName = String(shared.retailer_name ?? tmpl.name ?? '');
            if (orderNum && retailerName) {
              await maybeExtractTrackingAndPhoto(emailMeta.message_id, extractedData, retailerName, orderNum);
            }
          }
        }
      }
    }

    // Push to destinations
    const allowedDestIds = new Set<number>();
    let sendToAll = false;
    for (const match of allMatches) {
      if (match.destination_ids.length === 0) { sendToAll = true; break; }
      match.destination_ids.forEach(id => allowedDestIds.add(id));
    }

    // Build per-destination rule-level mappings (highest priority rule wins)
    const ruleFieldMappings = new Map<number, Record<string, string>>();
    for (const match of allMatches) {
      for (const [destIdStr, mapping] of Object.entries(match.field_mappings)) {
        const destId = Number(destIdStr);
        if (Object.keys(mapping).length > 0 && !ruleFieldMappings.has(destId)) {
          ruleFieldMappings.set(destId, mapping);
        }
      }
    }

    const filteredDests = sendToAll ? destinations : destinations.filter(d => allowedDestIds.has(d.id));

    const pushedDestinations: number[] = [];
    const pushErrors: string[] = [];
    const filledGapsDests: number[] = [];
    const failedPushes: { destId: number; payload: string }[] = [];
    const fallbackExtracted = extractedData || {
      summary: emailMeta.snippet, category: 'other', sender_company: null,
      action_required: false, action_description: null, due_date: null,
      amount: null, currency: null, reference_numbers: [], key_entities: [],
      sentiment: 'neutral', confidence: 0,
    };
    for (const dest of filteredDests) {
      try {
        const rawMapping = ruleFieldMappings.get(dest.id) ?? dest.field_mapping;
        const { cleanMapping, config } = extractUpsertConfig(rawMapping, dest.config);

        // Date guard: if we already pushed newer data for this merge key,
        // switch to fill-gaps mode (only update empty fields, don't overwrite)
        let fillGapsOnly = false;
        if (config.upsert_enabled === 'true' && config.upsert_field) {
          const testFields = buildFields(cleanMapping, emailDataWithBody, extractedData || {});
          const mergeValue = testFields[config.upsert_field];
          if (mergeValue !== null && mergeValue !== undefined && mergeValue !== '') {
            const existing = getUpsertHistory(dest.id, String(mergeValue));
            if (existing) {
              const incomingTs = parseEmailDate(emailMeta.date);
              const existingTs = parseEmailDate(existing.email_date);
              if (incomingTs > 0 && existingTs > 0 && incomingTs < existingTs) {
                config.fill_gaps_only = 'true';
                fillGapsOnly = true;
              }
            }
          }
        }

        await pushToDestination({ ...dest, config, field_mapping: cleanMapping }, emailDataWithBody, fallbackExtracted);
        pushedDestinations.push(dest.id);
        if (fillGapsOnly) filledGapsDests.push(dest.id);

        // Record upsert history after successful push (skip for fill-gaps — keep newer date)
        if (!fillGapsOnly && config.upsert_enabled === 'true' && config.upsert_field && emailMeta.date) {
          const pushFields = buildFields(cleanMapping, emailDataWithBody, extractedData || {});
          const mergeValue = pushFields[config.upsert_field];
          if (mergeValue !== null && mergeValue !== undefined && mergeValue !== '') {
            setUpsertHistory(dest.id, String(mergeValue), emailMeta.date, emailMeta.message_id);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`Rescan: failed to push to destination ${dest.id}:`, msg);
        pushErrors.push(`Dest ${dest.id}: ${msg}`);
        failedPushes.push({
          destId: dest.id,
          payload: JSON.stringify({
            emailData: emailDataWithBody,
            extractedData: fallbackExtracted,
            destConfig: dest.config,
            fieldMapping: ruleFieldMappings.get(dest.id) ?? dest.field_mapping,
          }),
        });
      }
    }

    const estimatedCost = 0; // Free — uses existing Claude subscription

    const status = pushedDestinations.length > 0 ? 'pushed' : (extractedData ? 'extracted' : 'flagged');
    const errorMessage = [
      ...pushErrors,
      ...filledGapsDests.map(id => `Dest ${id}: filled gaps only (older email)`),
    ].join('; ') || null;

    const processedEmailId = insertProcessedEmail({
      gmail_message_id: emailMeta.message_id,
      thread_id: emailMeta.thread_id,
      subject: emailMeta.subject,
      from_email: emailMeta.from_email,
      from_name: emailMeta.from_name,
      received_date: emailMeta.date,
      matched_rules: flagNames,
      extracted_data: extractedData ?? undefined,
      destinations_pushed: pushedDestinations,
      status,
      error_message: errorMessage ?? undefined,
      processing_time_ms: Date.now() - startTime,
      prompt_tokens: totalPromptTokens || undefined,
      completion_tokens: totalCompletionTokens || undefined,
      estimated_cost_usd: estimatedCost,
    });

    // Enqueue failed pushes for retry
    for (const fp of failedPushes) {
      const nextRetryAt = new Date(Date.now() + 60 * 1000).toISOString();
      enqueuePushRetry({
        processed_email_id: processedEmailId,
        destination_id: fp.destId,
        payload: fp.payload,
        next_retry_at: nextRetryAt,
      });
    }

    return {
      status,
      matched_rules: flagNames,
      extracted_data: extractedData,
      destinations_pushed: pushedDestinations,
      prompt_tokens: totalPromptTokens,
      completion_tokens: totalCompletionTokens,
      estimated_cost_usd: estimatedCost ?? null,
      processing_time_ms: Date.now() - startTime,
      error_message: errorMessage,
    };

  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    insertProcessedEmail({
      gmail_message_id: emailMeta.message_id,
      thread_id: emailMeta.thread_id,
      subject: emailMeta.subject,
      from_email: emailMeta.from_email,
      from_name: emailMeta.from_name,
      received_date: emailMeta.date,
      status: 'error',
      error_message: errMsg,
      processing_time_ms: Date.now() - startTime,
    });
    return {
      status: 'error',
      matched_rules: [],
      extracted_data: null,
      destinations_pushed: [],
      prompt_tokens: 0,
      completion_tokens: 0,
      estimated_cost_usd: null,
      processing_time_ms: Date.now() - startTime,
      error_message: errMsg,
    };
  }
}

// ── Retry Queue Processing ──────────────────────────────────────────────────

/** Backoff schedule in minutes: 1, 5, 15, 60, 240 */
const BACKOFF_MINUTES = [1, 5, 15, 60, 240];

export async function processRetryQueue(): Promise<{ attempted: number; succeeded: number; failed: number }> {
  const now = new Date().toISOString();
  const items = getDuePushQueueItems(now);

  let attempted = 0, succeeded = 0, failedCount = 0;

  for (const item of items) {
    attempted++;
    updatePushQueueItem(item.id, {
      status: 'retrying',
      attempt_count: item.attempt_count,
    });

    try {
      const { emailData, extractedData, destConfig, fieldMapping } =
        JSON.parse(item.payload) as {
          emailData: Record<string, unknown>;
          extractedData: Record<string, unknown>;
          destConfig: Record<string, string>;
          fieldMapping: Record<string, string>;
        };

      const dest = getDestination(item.destination_id);
      if (!dest || !dest.enabled) {
        updatePushQueueItem(item.id, {
          status: 'failed',
          attempt_count: item.attempt_count + 1,
          last_error: 'Destination no longer exists or is disabled',
        });
        failedCount++;
        continue;
      }

      const parsedConfig = JSON.parse(dest.config) as Record<string, string>;
      // Use the original field mapping from the failed push
      const { cleanMapping, config } = extractUpsertConfig(fieldMapping, parsedConfig);

      await pushToDestination(
        { type: dest.type as 'airtable' | 'sheets' | 'notion' | 'slack' | 'discord' | 'webhook', config, field_mapping: cleanMapping },
        emailData as Partial<import('./types.js').EmailData>,
        extractedData,
      );

      updatePushQueueItem(item.id, { status: 'succeeded', attempt_count: item.attempt_count + 1 });
      succeeded++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const newAttemptCount = item.attempt_count + 1;

      if (newAttemptCount >= item.max_attempts) {
        updatePushQueueItem(item.id, {
          status: 'failed',
          attempt_count: newAttemptCount,
          last_error: msg,
        });
        failedCount++;
      } else {
        const backoffMs = BACKOFF_MINUTES[Math.min(newAttemptCount, BACKOFF_MINUTES.length - 1)] * 60 * 1000;
        const nextRetryAt = new Date(Date.now() + backoffMs).toISOString();
        updatePushQueueItem(item.id, {
          status: 'pending',
          attempt_count: newAttemptCount,
          next_retry_at: nextRetryAt,
          last_error: msg,
        });
      }
    }
  }

  return { attempted, succeeded, failed: failedCount };
}
