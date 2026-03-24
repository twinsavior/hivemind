import { GoogleGenerativeAI } from '@google/generative-ai';
import { getApiKey, getExtractionConfig } from './db.js';
import { decrypt } from './crypto.js';
import { withRateLimit } from './rate-limiter.js';
import type { ExtractedData } from './types.js';

const PRIMARY_MODEL = 'gemini-3-flash-preview';
const FALLBACK_MODEL = 'gemini-2.5-flash';

export interface GeminiUsage {
  promptTokens: number;
  completionTokens: number;
}

export function getClient(): GoogleGenerativeAI {
  const encryptedKey = getApiKey('gemini');
  if (!encryptedKey) {
    throw new Error('Gemini API key not configured. Add it in the Extraction tab.');
  }
  const apiKey = decrypt(encryptedKey);
  return new GoogleGenerativeAI(apiKey);
}

export async function processEmail(
  emailData: {
    subject?: string;
    from_email?: string;
    from_name?: string;
    body?: string;
    date?: string;
  },
  flagRules: string[],
  pdfTexts?: string[],
): Promise<{ data: ExtractedData; usage: GeminiUsage }> {
  const config = getExtractionConfig();
  if (!config) {
    throw new Error('Extraction config not found');
  }

  const client = getClient();

  const getModel = (modelName: string) => client.getGenerativeModel({
    model: modelName,
    systemInstruction: config.system_prompt,
    generationConfig: {
      temperature: config.temperature,
      responseMimeType: 'application/json',
    },
  });

  // Build prompt
  const parts: string[] = [];
  parts.push(`Analyze this email and extract structured data.

**Matched Categories**: ${flagRules.join(', ')}

**From**: ${emailData.from_name || ''} <${emailData.from_email || ''}>
**Date**: ${emailData.date || ''}
**Subject**: ${emailData.subject || ''}

**Body**:
${emailData.body || '(no body)'}`);

  if (pdfTexts && pdfTexts.length > 0) {
    for (let i = 0; i < pdfTexts.length; i++) {
      parts.push(`\n\n**Attachment ${i + 1} (PDF text)**:\n${pdfTexts[i]}`);
    }
  }

  parts.push(`\n\nExtract the following as JSON. Use null for any field you cannot determine from the email/attachments:\n\n${config.extraction_schema}`);

  const prompt = parts.join('');

  const result = await withRateLimit(
    () => getModel(PRIMARY_MODEL).generateContent(prompt),
    () => {
      console.warn(`Falling back to ${FALLBACK_MODEL} for extraction`);
      return getModel(FALLBACK_MODEL).generateContent(prompt);
    },
  );
  const responseText = result.response.text();
  const usageMetadata = result.response.usageMetadata;

  const usage: GeminiUsage = {
    promptTokens: usageMetadata?.promptTokenCount ?? 0,
    completionTokens: usageMetadata?.candidatesTokenCount ?? 0,
  };

  try {
    return { data: JSON.parse(responseText) as ExtractedData, usage };
  } catch {
    return {
      data: {
        summary: 'Failed to parse Gemini response',
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
        raw_response: responseText,
      },
      usage,
    };
  }
}

export async function processEmailWithInstructions(
  emailData: {
    subject?: string;
    from_email?: string;
    from_name?: string;
    body?: string;
    date?: string;
  },
  instructions: string,
  pdfTexts?: string[],
  expectedFields?: string[],
): Promise<{ data: Record<string, unknown>; usage: GeminiUsage }> {
  const client = getClient();

  const systemInstruction = `You are an email analysis assistant. Extract structured data from emails based on the user's instructions.

This email has already been pre-screened and matched to this rule. ALWAYS extract every field mentioned in the instructions, even if the email doesn't perfectly match the described scenario (e.g. instructions mention "canceled orders" but the email is about a shipped order — still extract the order number, item, etc.).
Return a JSON object with the extracted fields. Use null for any field you genuinely cannot find in the email.`;

  const getModel = (modelName: string) => client.getGenerativeModel({
    model: modelName,
    systemInstruction,
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  });

  const parts: string[] = [];
  parts.push(`**Instructions**: ${instructions}

**From**: ${emailData.from_name || ''} <${emailData.from_email || ''}>
**Date**: ${emailData.date || ''}
**Subject**: ${emailData.subject || ''}

**Body**:
${emailData.body || '(no body)'}`);

  if (pdfTexts && pdfTexts.length > 0) {
    for (let i = 0; i < pdfTexts.length; i++) {
      parts.push(`\n\n**Attachment ${i + 1} (PDF text)**:\n${pdfTexts[i]}`);
    }
  }

  if (expectedFields && expectedFields.length > 0) {
    parts.push(`\n\nExtract the requested information as a JSON object. Use EXACTLY these field names as keys: ${expectedFields.join(', ')}. Use null for missing values.`);
  } else {
    parts.push(`\n\nExtract the requested information as a JSON object based on the instructions above. Use null for missing values.`);
  }

  const prompt = parts.join('');
  const result = await withRateLimit(
    () => getModel(PRIMARY_MODEL).generateContent(prompt),
    () => {
      console.warn(`Falling back to ${FALLBACK_MODEL} for instruction-based extraction`);
      return getModel(FALLBACK_MODEL).generateContent(prompt);
    },
  );
  const responseText = result.response.text();
  const usageMetadata = result.response.usageMetadata;

  const usage: GeminiUsage = {
    promptTokens: usageMetadata?.promptTokenCount ?? 0,
    completionTokens: usageMetadata?.candidatesTokenCount ?? 0,
  };

  try {
    return { data: JSON.parse(responseText) as Record<string, unknown>, usage };
  } catch {
    return { data: { raw_response: responseText, error: 'Failed to parse response' }, usage };
  }
}

/**
 * Batch screen email subject lines against rules.
 * Sends all subjects in one API call — Gemini returns which ones are relevant.
 * This is the first line of defense before reading full email bodies.
 *
 * @param emails - Array of { id, subject, from_email, snippet }
 * @param rules - Array of { name, instructions } describing what each rule looks for
 * @returns Set of email IDs that passed screening (should proceed to full extraction)
 */
export async function screenSubjectLines(
  emails: Array<{ id: string; subject: string; from_email: string; snippet?: string }>,
  rules: Array<{ name: string; instructions: string }>,
): Promise<{ passedIds: Set<string>; usage: GeminiUsage }> {
  if (emails.length === 0) return { passedIds: new Set(), usage: { promptTokens: 0, completionTokens: 0 } };

  const client = getClient();
  const getModel = (modelName: string) => client.getGenerativeModel({
    model: modelName,
    systemInstruction: `You are an email triage assistant. You review email subject lines and sender addresses to determine which emails are likely relevant to the user's rules. Be selective — only pass emails that have a reasonable chance of containing the data the rules are looking for. Newsletters, social media notifications, marketing emails, and unrelated content should NOT pass.

Return a JSON object: { "pass": ["id1", "id2", ...] } containing ONLY the IDs of emails that should be read in full. If none are relevant, return { "pass": [] }.`,
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
    },
  });

  const rulesDesc = rules.map(r => `• "${r.name}": ${r.instructions}`).join('\n');

  const emailList = emails.map(e =>
    `[${e.id}] From: ${e.from_email} | Subject: ${e.subject}${e.snippet ? ` | Preview: ${e.snippet.slice(0, 80)}` : ''}`
  ).join('\n');

  const prompt = `## Active Rules\n${rulesDesc}\n\n## Emails to Screen (${emails.length} total)\n${emailList}\n\nWhich email IDs should proceed to full extraction? Return { "pass": [...ids] }`;

  const result = await withRateLimit(
    () => getModel(PRIMARY_MODEL).generateContent(prompt),
    () => {
      console.warn(`Falling back to ${FALLBACK_MODEL} for subject screening`);
      return getModel(FALLBACK_MODEL).generateContent(prompt);
    },
  );

  const responseText = result.response.text();
  const usageMetadata = result.response.usageMetadata;
  const usage: GeminiUsage = {
    promptTokens: usageMetadata?.promptTokenCount ?? 0,
    completionTokens: usageMetadata?.candidatesTokenCount ?? 0,
  };

  try {
    const parsed = JSON.parse(responseText) as { pass: string[] };
    return { passedIds: new Set(parsed.pass || []), usage };
  } catch {
    // If parsing fails, pass everything through as a safety fallback
    console.warn('Subject screening parse failed, passing all emails through');
    return { passedIds: new Set(emails.map(e => e.id)), usage };
  }
}

export function extractPdfText(pdfBytes: Buffer, maxPages: number = 5, maxChars: number = 4000): Promise<string> {
  return new Promise(async (resolve) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(pdfBytes, { max: maxPages });
      resolve(data.text.slice(0, maxChars).trim());
    } catch (e) {
      resolve(`[PDF extraction failed: ${e}]`);
    }
  });
}
