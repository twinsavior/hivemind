/**
 * LLM-powered email extraction — replaces Gemini with the user's existing LLM.
 *
 * Uses whatever provider HIVEMIND is already running on (Claude Code, OpenAI, etc.)
 * so the user doesn't need a separate API key. With Claude Max/Pro subscriptions,
 * extraction is effectively free — no per-token cost.
 *
 * Injected at init time via setLLMExtractor().
 */

import { getExtractionConfig } from './db.js';
import type { ExtractedData } from './types.js';

// ── Injected LLM function ──────────────────────────────────────────────────
// Signature: (systemPrompt, userPrompt) => Promise<string>
// Returns raw text (expected to be JSON for extraction calls)
type LLMCompleteFn = (systemPrompt: string, userPrompt: string) => Promise<string>;

let llmComplete: LLMCompleteFn | null = null;

export function setLLMExtractor(fn: LLMCompleteFn): void {
  llmComplete = fn;
  console.log('[Email] LLM extractor configured (using existing provider)');
}

export function hasLLMExtractor(): boolean {
  return llmComplete !== null;
}

function getLLM(): LLMCompleteFn {
  if (!llmComplete) {
    throw new Error('LLM extractor not configured. Call setLLMExtractor() during init.');
  }
  return llmComplete;
}

// ── Usage tracking (kept for stats, but cost is $0 with subscription) ───────
export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
}

const ZERO_USAGE: LLMUsage = { promptTokens: 0, completionTokens: 0 };

// ── Main extraction: structured schema-based ────────────────────────────────
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
): Promise<{ data: ExtractedData; usage: LLMUsage }> {
  const config = getExtractionConfig();
  if (!config) {
    throw new Error('Extraction config not found');
  }

  const complete = getLLM();

  // Build the user prompt (identical to previous Gemini prompts — they work well)
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

  const systemPrompt = config.system_prompt + '\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no code fences, no explanation.';
  const responseText = await complete(systemPrompt, parts.join(''));

  try {
    // Strip markdown code fences if the LLM wraps the JSON
    const cleaned = responseText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    return { data: JSON.parse(cleaned) as ExtractedData, usage: ZERO_USAGE };
  } catch {
    return {
      data: {
        summary: 'Failed to parse LLM response',
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
      usage: ZERO_USAGE,
    };
  }
}

// ── Instruction-based extraction (custom rules) ─────────────────────────────
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
): Promise<{ data: Record<string, unknown>; usage: LLMUsage }> {
  const complete = getLLM();

  const systemPrompt = `You are an email analysis assistant. Extract structured data from emails based on the user's instructions.

This email has already been pre-screened and matched to this rule. ALWAYS extract every field mentioned in the instructions, even if the email doesn't perfectly match the described scenario (e.g. instructions mention "canceled orders" but the email is about a shipped order — still extract the order number, item, etc.).
Return a JSON object with the extracted fields. Use null for any field you genuinely cannot find in the email.

IMPORTANT: Respond ONLY with valid JSON. No markdown, no code fences, no explanation.`;

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

  const responseText = await complete(systemPrompt, parts.join(''));

  try {
    const cleaned = responseText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    return { data: JSON.parse(cleaned) as Record<string, unknown>, usage: ZERO_USAGE };
  } catch {
    return { data: { raw_response: responseText, error: 'Failed to parse response' }, usage: ZERO_USAGE };
  }
}

// ── Batch subject screening ─────────────────────────────────────────────────
export async function screenSubjectLines(
  emails: Array<{ id: string; subject: string; from_email: string; snippet?: string }>,
  rules: Array<{ name: string; instructions: string }>,
): Promise<{ passedIds: Set<string>; usage: LLMUsage }> {
  if (emails.length === 0) return { passedIds: new Set(), usage: ZERO_USAGE };

  const complete = getLLM();

  const systemPrompt = `You are an email triage assistant. You review email subject lines and sender addresses to determine which emails are likely relevant to the user's rules. Be selective — only pass emails that have a reasonable chance of containing the data the rules are looking for. Newsletters, social media notifications, marketing emails, and unrelated content should NOT pass.

Return a JSON object: { "pass": ["id1", "id2", ...] } containing ONLY the IDs of emails that should be read in full. If none are relevant, return { "pass": [] }.

IMPORTANT: Respond ONLY with valid JSON. No markdown, no code fences, no explanation.`;

  const rulesDesc = rules.map(r => `• "${r.name}": ${r.instructions}`).join('\n');

  const emailList = emails.map(e =>
    `[${e.id}] From: ${e.from_email} | Subject: ${e.subject}${e.snippet ? ` | Preview: ${e.snippet.slice(0, 80)}` : ''}`
  ).join('\n');

  const prompt = `## Active Rules\n${rulesDesc}\n\n## Emails to Screen (${emails.length} total)\n${emailList}\n\nWhich email IDs should proceed to full extraction? Return { "pass": [...ids] }`;

  const responseText = await complete(systemPrompt, prompt);

  try {
    const cleaned = responseText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned) as { pass: string[] };
    return { passedIds: new Set(parsed.pass || []), usage: ZERO_USAGE };
  } catch {
    // If parsing fails, pass everything through as a safety fallback
    console.warn('[Email] Subject screening parse failed, passing all emails through');
    return { passedIds: new Set(emails.map(e => e.id)), usage: ZERO_USAGE };
  }
}

// ── Rule suggestion from prompt ─────────────────────────────────────────────
import type { RuleSuggestion } from './types.js';

const RULE_SCHEMA = `Each rule object must have these fields:
- name (string): Short snake_case identifier, e.g. "shipping_updates"
- sender_patterns (string[]): Partial email address or domain matches, e.g. ["@amazon", "noreply@"]. Prioritize sender patterns as the primary matching method.
- instructions (string): Natural language instructions describing what data to extract from matching emails.
- keywords (string[]): Optional. Words where matching ANY indicates relevance. Only use if sender patterns alone aren't sufficient.
- required_keywords (string[]): Optional. Words where ALL must be present. Use sparingly.
- exclude_phrases (string[]): If any of these are found, skip this email
- check_subject (boolean): Whether to search the subject line
- check_body (boolean): Whether to search the body
- check_snippet (boolean): Whether to search the snippet/preview
- require_attachment (boolean): Only match emails with attachments
- priority (number): 0 is default, higher = matched first
- enabled (boolean): Always true for suggestions
- reasoning (string): One-sentence explanation of why this rule is useful`;

function parseRuleSuggestions(text: string): RuleSuggestion[] {
  const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  const parsed = JSON.parse(cleaned);
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr.map((item: Record<string, unknown>) => ({
    name: String(item.name || 'unnamed_rule'),
    keywords: Array.isArray(item.keywords) ? item.keywords.map(String) : [],
    required_keywords: Array.isArray(item.required_keywords) ? item.required_keywords.map(String) : [],
    sender_patterns: Array.isArray(item.sender_patterns) ? item.sender_patterns.map(String) : [],
    exclude_phrases: Array.isArray(item.exclude_phrases) ? item.exclude_phrases.map(String) : [],
    check_subject: item.check_subject !== false,
    check_body: item.check_body !== false,
    check_snippet: item.check_snippet !== false,
    require_attachment: !!item.require_attachment,
    priority: typeof item.priority === 'number' ? item.priority : 0,
    enabled: true,
    destination_ids: [],
    instructions: typeof item.instructions === 'string' ? item.instructions : '',
    field_mappings: {},
    expected_fields: [],
    scan_all: false,
    reasoning: typeof item.reasoning === 'string' ? item.reasoning : undefined,
  }));
}

export async function suggestRulesFromPrompt(prompt: string): Promise<RuleSuggestion[]> {
  const complete = getLLM();
  const systemPrompt = `You are an email classification expert. You generate rules for an AI-powered email processing pipeline. Each rule defines WHO to watch (sender patterns), WHAT to extract (natural language instructions), and optional keyword filters.

Prioritize sender_patterns + instructions over keyword-heavy rules.

Return a JSON array of rule objects. Return 1-5 rules depending on what makes sense.

${RULE_SCHEMA}

IMPORTANT: Respond ONLY with valid JSON array. No markdown, no code fences, no explanation.`;

  const responseText = await complete(systemPrompt, `Based on this description, suggest rules for an email processing pipeline. Focus on sender patterns and extraction instructions:\n\n${prompt}`);
  return parseRuleSuggestions(responseText);
}

// ── PDF text extraction (no LLM needed) ─────────────────────────────────────
export function extractPdfText(pdfBytes: Buffer, maxPages: number = 5, maxChars: number = 4000): Promise<string> {
  return new Promise(async (resolve) => {
    try {
      const pdfMod = await import('pdf-parse');
      const pdfParse = (pdfMod as any).default || pdfMod;
      const data = await pdfParse(pdfBytes, { max: maxPages });
      resolve(data.text.slice(0, maxChars).trim());
    } catch (e) {
      resolve(`[PDF extraction failed: ${e}]`);
    }
  });
}
