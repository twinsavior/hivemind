import { decrypt } from './crypto.js';
import type { EmailData } from './types.js';
import { expandExtractedToItemRows } from './item-normalizer.js';

interface DestinationConfig {
  type: 'airtable' | 'sheets' | 'notion' | 'slack' | 'discord' | 'webhook';
  config: Record<string, string>;
  field_mapping: Record<string, string>;
}

// ── Base Push Interface ──────────────────────────────────────────────────────

async function pushToDestination(
  dest: DestinationConfig,
  emailData: Partial<EmailData>,
  extracted: Record<string, unknown>,
): Promise<void> {
  // Table destinations: expand multi-item emails into one push per item row.
  // Webhook destinations (slack, discord): single message per email.
  const isTableDest = dest.type === 'airtable' || dest.type === 'sheets' || dest.type === 'notion';

  if (isTableDest) {
    const itemRows = expandExtractedToItemRows(extracted);
    for (const itemExtracted of itemRows) {
      switch (dest.type) {
        case 'airtable':
          await pushToAirtable(dest.config, dest.field_mapping, emailData, itemExtracted);
          break;
        case 'sheets':
          await pushToSheets(dest.config, dest.field_mapping, emailData, itemExtracted);
          break;
        case 'notion':
          await pushToNotion(dest.config, dest.field_mapping, emailData, itemExtracted);
          break;
      }
    }
    return;
  }

  switch (dest.type) {
    case 'slack':
      return pushToSlack(dest.config, dest.field_mapping, emailData, extracted);
    case 'discord':
      return pushToDiscord(dest.config, dest.field_mapping, emailData, extracted);
    case 'webhook':
      return pushToWebhook(dest.config, emailData, extracted);
    default:
      throw new Error(`Unknown destination type: ${dest.type}`);
  }
}

// ── Airtable ─────────────────────────────────────────────────────────────────

async function pushToAirtable(
  config: Record<string, string>,
  fieldMapping: Record<string, string>,
  emailData: Partial<EmailData>,
  extracted: Record<string, unknown>,
): Promise<void> {
  const apiKey = decrypt(config.api_key);
  const baseId = config.base_id;
  const tableName = config.table_name;
  const airtableUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  let fields = buildFields(fieldMapping, emailData, extracted);

  // Determine if we should upsert (update-or-insert) based on a unique field
  const upsertField = config.upsert_field; // Airtable column name to merge on
  const useUpsert =
    config.upsert_enabled === 'true' &&
    upsertField &&
    upsertField in fields &&
    fields[upsertField] !== null &&
    fields[upsertField] !== undefined &&
    fields[upsertField] !== '';

  // Fill-gaps mode: only push fields that are empty/null in the existing Airtable record.
  // Used when an older email arrives for a merge key that already has newer data.
  if (config.fill_gaps_only === 'true' && useUpsert) {
    try {
      const mergeVal = String(fields[upsertField]).replace(/"/g, '\\"');
      const filterFormula = `{${upsertField}}="${mergeVal}"`;
      const fetchUrl = `${airtableUrl}?filterByFormula=${encodeURIComponent(filterFormula)}&maxRecords=1`;
      const fetchResp = await fetch(fetchUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!fetchResp.ok) {
        console.warn(`Fill-gaps: failed to fetch existing record (${fetchResp.status}), skipping push`);
        return;
      }

      const fetchData = await fetchResp.json() as any;
      if (fetchData.records?.length > 0) {
        const existingFields = fetchData.records[0].fields || {};
        const gapFields: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(fields)) {
          // Always include the merge field (required for upsert)
          if (key === upsertField) {
            gapFields[key] = value;
            continue;
          }
          // Only include fields that are empty/missing in the existing record
          const existing = existingFields[key];
          if (existing === null || existing === undefined || existing === '') {
            gapFields[key] = value;
          }
        }

        // If only the merge field remains, nothing to fill
        if (Object.keys(gapFields).length <= 1) {
          console.log(`Fill-gaps: all fields already populated for "${fields[upsertField]}"`);
          return;
        }

        console.log(`Fill-gaps: updating ${Object.keys(gapFields).length - 1} empty field(s) for "${fields[upsertField]}"`);
        fields = gapFields;
      }
      // If no existing record found, do a full push (nothing to protect)
    } catch (e) {
      console.warn('Fill-gaps: error checking existing record, skipping push:', e);
      return;
    }
  }

  const buildBody = (f: Record<string, unknown>) =>
    useUpsert
      ? { performUpsert: { fieldsToMergeOn: [upsertField] }, records: [{ fields: f }] }
      : { fields: f };

  const method = useUpsert ? 'PATCH' : 'POST';

  const response = await fetch(airtableUrl, {
    method,
    headers,
    body: JSON.stringify(buildBody(fields)),
  });

  if (!response.ok) {
    const text = await response.text();

    // If Airtable rejects due to unknown fields, retry without them
    if (response.status === 422) {
      try {
        const err = JSON.parse(text);
        const msg = err?.error?.message || '';
        // Airtable error: "Unknown field names: FieldA, FieldB"
        const unknownMatch = msg.match(/Unknown field names?:\s*(.+)/i);
        if (unknownMatch) {
          const badFields = unknownMatch[1].split(',').map((f: string) => f.trim());
          const cleaned = Object.fromEntries(
            Object.entries(fields).filter(([k]) => !badFields.includes(k)),
          );
          if (Object.keys(cleaned).length > 0) {
            console.warn(`Airtable: retrying without unknown fields: ${badFields.join(', ')}`);
            const retry = await fetch(airtableUrl, {
              method,
              headers,
              body: JSON.stringify(buildBody(cleaned)),
            });
            if (retry.ok) return;
            const retryText = await retry.text();
            throw new Error(`Airtable retry failed (${retry.status}): ${retryText}`);
          }
        }
      } catch (parseErr) {
        if (parseErr instanceof Error && parseErr.message.startsWith('Airtable retry')) {
          throw parseErr;
        }
        // Fall through to original error
      }
    }

    throw new Error(`Airtable push failed (${response.status}): ${text}`);
  }
}

// ── Google Sheets ────────────────────────────────────────────────────────────

async function pushToSheets(
  config: Record<string, string>,
  fieldMapping: Record<string, string>,
  emailData: Partial<EmailData>,
  extracted: Record<string, unknown>,
): Promise<void> {
  // For Sheets, we use the googleapis package with stored credentials
  const { google } = await import('googleapis');
  const { OAuth2Client } = await import('google-auth-library');

  const spreadsheetId = config.spreadsheet_id;
  const sheetName = config.sheet_name || 'Sheet1';

  // Use the same OAuth token as Gmail (sheets scope would need to be added)
  const { getValidAccessToken } = await import('./gmail-oauth.js');
  const accessToken = await getValidAccessToken();
  const auth = new OAuth2Client();
  auth.setCredentials({ access_token: accessToken });

  const sheets = google.sheets({ version: 'v4', auth });

  const fields = buildFields(fieldMapping, emailData, extracted);
  const row = Object.values(fields).map(v =>
    v === null || v === undefined ? '' : String(v),
  );

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
}

// ── Notion ───────────────────────────────────────────────────────────────────

async function pushToNotion(
  config: Record<string, string>,
  fieldMapping: Record<string, string>,
  emailData: Partial<EmailData>,
  extracted: Record<string, unknown>,
): Promise<void> {
  const apiKey = decrypt(config.api_key);
  const databaseId = config.database_id;

  const fields = buildFields(fieldMapping, emailData, extracted);

  // Build Notion properties from field mapping
  const properties: Record<string, unknown> = {};
  for (const [destColumn, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;

    if (typeof value === 'boolean') {
      properties[destColumn] = { checkbox: value };
    } else if (typeof value === 'number') {
      properties[destColumn] = { number: value };
    } else {
      // Default to rich_text, except first property which is title
      if (Object.keys(properties).length === 0) {
        properties[destColumn] = { title: [{ text: { content: String(value).slice(0, 2000) } }] };
      } else {
        properties[destColumn] = { rich_text: [{ text: { content: String(value).slice(0, 2000) } }] };
      }
    }
  }

  const response = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Notion push failed (${response.status}): ${text}`);
  }
}

// ── Slack ───────────────────────────────────────────────────────────────────

async function pushToSlack(
  config: Record<string, string>,
  fieldMapping: Record<string, string>,
  emailData: Partial<EmailData>,
  extracted: Record<string, unknown>,
): Promise<void> {
  const webhookUrl = decrypt(config.webhook_url);
  const fields = buildFields(fieldMapping, emailData, extracted);

  const slackFields = Object.entries(fields)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([label, value]) => ({
      type: 'mrkdwn' as const,
      text: `*${label}*\n${String(value)}`,
    }));

  const subject = (fields['Subject'] || fields['subject'] || emailData.subject || 'New Email') as string;

  const payload = {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: subject.slice(0, 150) },
      },
      {
        type: 'section',
        fields: slackFields.slice(0, 10), // Slack max 10 fields per section
      },
      ...(slackFields.length > 10
        ? [{ type: 'section', fields: slackFields.slice(10, 20) }]
        : []),
    ],
    text: subject, // fallback for notifications
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Slack webhook failed (${response.status}): ${text}`);
  }
}

// ── Discord ─────────────────────────────────────────────────────────────────

async function pushToDiscord(
  config: Record<string, string>,
  fieldMapping: Record<string, string>,
  emailData: Partial<EmailData>,
  extracted: Record<string, unknown>,
): Promise<void> {
  const webhookUrl = decrypt(config.webhook_url);
  const fields = buildFields(fieldMapping, emailData, extracted);

  const embedFields = Object.entries(fields)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([name, value]) => ({
      name,
      value: String(value).slice(0, 1024),
      inline: String(value).length < 50,
    }));

  const subject = (fields['Subject'] || fields['subject'] || emailData.subject || 'New Email') as string;

  const payload = {
    embeds: [
      {
        title: subject.slice(0, 256),
        color: 0xf59e0b, // amber
        fields: embedFields.slice(0, 25), // Discord max 25 fields per embed
        timestamp: new Date().toISOString(),
        footer: { text: 'Email Parser' },
      },
    ],
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord webhook failed (${response.status}): ${text}`);
  }
}

// ── Webhook ──────────────────────────────────────────────────────────────────

async function pushToWebhook(
  config: Record<string, string>,
  emailData: Partial<EmailData>,
  extracted: Record<string, unknown>,
): Promise<void> {
  const url = decrypt(config.url);
  const method = (config.method || 'POST').toUpperCase();

  // Build custom headers from config
  const customHeaders: Record<string, string> = {};
  if (config.auth_header_name && config.auth_header_value) {
    try {
      customHeaders[config.auth_header_name] = decrypt(config.auth_header_value);
    } catch {
      customHeaders[config.auth_header_name] = config.auth_header_value;
    }
  }

  const payload = {
    event: 'email_extracted',
    data: { ...extracted },
    email: {
      subject: emailData.subject ?? null,
      from_email: emailData.from_email ?? null,
      from_name: emailData.from_name ?? null,
      date: emailData.date ?? null,
      message_id: emailData.message_id ?? null,
    },
    timestamp: new Date().toISOString(),
  };

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...customHeaders,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Webhook push failed (${response.status}): ${text.slice(0, 200)}`);
  }
}

// ── Field Mapping Helper ─────────────────────────────────────────────────────

function buildFields(
  fieldMapping: Record<string, string>,
  emailData: Partial<EmailData>,
  extracted: Record<string, unknown>,
): Record<string, unknown> {
  const sourceData: Record<string, unknown> = {
    // Email fields
    subject: emailData.subject,
    from_email: emailData.from_email,
    from_name: emailData.from_name,
    date: emailData.date,
    message_id: emailData.message_id,
    // Extracted fields
    ...extracted,
    // Stringify arrays for flat destinations
    reference_numbers: Array.isArray(extracted.reference_numbers) ? extracted.reference_numbers.join(', ') : '',
    key_entities: Array.isArray(extracted.key_entities) ? extracted.key_entities.join(', ') : '',
    // Metadata
    processed_at: new Date().toISOString(),
  };

  // If no field mapping, use source keys as destination columns
  if (!fieldMapping || Object.keys(fieldMapping).length === 0) {
    return sourceData;
  }

  // Map source fields to destination column names
  const result: Record<string, unknown> = {};
  for (const [sourceField, destColumn] of Object.entries(fieldMapping)) {
    if (destColumn && sourceField in sourceData) {
      result[destColumn] = coerceValue(sourceData[sourceField]);
    }
  }

  // Safety net: if any value is still an array (e.g. from old extraction format
  // or unmapped fields), join to a comma-separated string to prevent 422 errors
  for (const [key, value] of Object.entries(result)) {
    if (Array.isArray(value)) {
      result[key] = value.map(v => String(v ?? '')).join(', ');
    }
  }

  return result;
}

/**
 * Coerce extracted values for destination compatibility.
 * - "33.99 USD" → 33.99 (strip currency suffix)
 * - "Thu, 5 Mar 2026 ..." → "2026-03-05" (RFC 2822 → ISO date)
 * - "17" → 17
 */
export function coerceValue(value: unknown, hint?: 'number' | 'date' | 'string'): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  // Arrays → comma-separated string (prevents JSON arrays leaking to destinations)
  if (Array.isArray(value)) return value.map(v => String(v ?? '')).join(', ');
  if (typeof value !== 'string') return value;

  // Try to parse as date (RFC 2822 or other common formats)
  // Only convert strings that look like dates, not arbitrary text
  const dateAttempt = new Date(value);
  if (!isNaN(dateAttempt.getTime()) && /\d{4}|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(value)) {
    return dateAttempt.toISOString().split('T')[0]; // "2026-03-05"
  }

  // Strip common currency/unit suffixes and try to parse as number
  const stripped = value.replace(/\s*(USD|EUR|GBP|CAD|AUD|JPY|CNY|INR|BRL|MXN|CHF|KRW|SEK|NOK|DKK|NZD|SGD|HKD|TWD|ZAR|PLN|CZK|HUF|ILS|THB|PHP|IDR|MYR|VND)\s*$/i, '').trim();
  const num = Number(stripped);
  if (!isNaN(num) && stripped !== '') return num;

  return value;
}

// ── Test Connection ──────────────────────────────────────────────────────────

export async function testDestination(dest: DestinationConfig): Promise<{ ok: boolean; message: string }> {
  try {
    switch (dest.type) {
      case 'airtable': {
        const apiKey = decrypt(dest.config.api_key);
        const resp = await fetch(`https://api.airtable.com/v0/${dest.config.base_id}/${encodeURIComponent(dest.config.table_name)}?maxRecords=1`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!resp.ok) throw new Error(`Airtable responded ${resp.status}`);
        return { ok: true, message: 'Connected to Airtable successfully' };
      }
      case 'notion': {
        const apiKey = decrypt(dest.config.api_key);
        const resp = await fetch(`https://api.notion.com/v1/databases/${dest.config.database_id}`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Notion-Version': '2022-06-28',
          },
        });
        if (!resp.ok) throw new Error(`Notion responded ${resp.status}`);
        return { ok: true, message: 'Connected to Notion successfully' };
      }
      case 'sheets': {
        return { ok: true, message: 'Sheets connection uses Gmail OAuth. Ensure your Google account has access to the spreadsheet.' };
      }
      case 'slack': {
        // Send a test message to the Slack webhook
        const webhookUrl = decrypt(dest.config.webhook_url);
        const resp = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'Email Parser: test connection successful.' }),
        });
        if (!resp.ok) throw new Error(`Slack webhook responded ${resp.status}`);
        return { ok: true, message: 'Connected to Slack successfully. Check your channel for a test message.' };
      }
      case 'discord': {
        // Send a test embed to the Discord webhook
        const webhookUrl = decrypt(dest.config.webhook_url);
        const resp = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: 'Email Parser',
              description: 'Test connection successful.',
              color: 0x57f287,
            }],
          }),
        });
        if (!resp.ok) throw new Error(`Discord webhook responded ${resp.status}`);
        return { ok: true, message: 'Connected to Discord successfully. Check your channel for a test message.' };
      }
      case 'webhook': {
        const url = decrypt(dest.config.url);
        const method = (dest.config.method || 'POST').toUpperCase();
        const customHeaders: Record<string, string> = {};
        if (dest.config.auth_header_name && dest.config.auth_header_value) {
          try {
            customHeaders[dest.config.auth_header_name] = decrypt(dest.config.auth_header_value);
          } catch {
            customHeaders[dest.config.auth_header_name] = dest.config.auth_header_value;
          }
        }
        const resp = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json', ...customHeaders },
          body: JSON.stringify({
            event: 'test',
            data: { message: 'Email Parser: test connection successful.' },
            timestamp: new Date().toISOString(),
          }),
        });
        if (!resp.ok) throw new Error(`Webhook responded ${resp.status}`);
        return { ok: true, message: `Webhook responded ${resp.status}. Check your endpoint for the test payload.` };
      }
      default:
        return { ok: false, message: `Unknown type: ${dest.type}` };
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// ── Fetch Columns ────────────────────────────────────────────────────────────

export async function fetchColumns(
  type: 'airtable' | 'sheets' | 'notion' | 'slack' | 'discord' | 'webhook',
  config: Record<string, string>,
): Promise<{ name: string; type?: string }[]> {
  switch (type) {
    case 'airtable':
      return fetchAirtableColumns(config);
    case 'sheets':
      return fetchSheetsColumns(config);
    case 'notion':
      return fetchNotionColumns(config);
    case 'slack':
    case 'discord':
    case 'webhook':
      // Webhook/message destinations don't have columns — all mapped fields become message fields
      return [];
    default:
      throw new Error(`Unknown destination type: ${type}`);
  }
}

async function fetchAirtableColumns(config: Record<string, string>): Promise<{ name: string; type?: string }[]> {
  const apiKey = decrypt(config.api_key);
  const baseId = config.base_id;
  const tableName = config.table_name;

  // Use the Airtable metadata API to get table schema
  const resp = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!resp.ok) {
    throw new Error(`Airtable metadata API responded ${resp.status}`);
  }

  const data = await resp.json() as any;
  const table = data.tables?.find(
    (t: { name: string }) => t.name.toLowerCase() === tableName.toLowerCase(),
  );

  if (!table) {
    throw new Error(`Table "${tableName}" not found in base`);
  }

  return (table.fields || []).map((f: { name: string; type: string }) => ({
    name: f.name,
    type: f.type,
  }));
}

async function fetchSheetsColumns(config: Record<string, string>): Promise<{ name: string; type?: string }[]> {
  const { google } = await import('googleapis');
  const { OAuth2Client } = await import('google-auth-library');

  const spreadsheetId = config.spreadsheet_id;
  const sheetName = config.sheet_name || 'Sheet1';

  const { getValidAccessToken } = await import('./gmail-oauth.js');
  const accessToken = await getValidAccessToken();
  const auth = new OAuth2Client();
  auth.setCredentials({ access_token: accessToken });

  const sheets = google.sheets({ version: 'v4', auth });

  // Read the first row (header row)
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!1:1`,
  });

  const headerRow = result.data.values?.[0] || [];
  return headerRow
    .filter((h: unknown) => typeof h === 'string' && h.trim())
    .map((h: unknown) => ({ name: String(h).trim() }));
}

async function fetchNotionColumns(config: Record<string, string>): Promise<{ name: string; type?: string }[]> {
  const apiKey = decrypt(config.api_key);
  const databaseId = config.database_id;

  const resp = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28',
    },
  });

  if (!resp.ok) {
    throw new Error(`Notion API responded ${resp.status}`);
  }

  const data = await resp.json() as any;
  const properties = data.properties || {};

  return Object.entries(properties).map(([name, prop]) => ({
    name,
    type: (prop as { type: string }).type,
  }));
}

export { pushToDestination, buildFields };
