import { getClient } from './gemini-processor.js';
import { withRateLimit } from './rate-limiter.js';
import type { RuleSuggestion } from './types.js';

const RULE_SCHEMA = `Each rule object must have these fields:
- name (string): Short snake_case identifier, e.g. "shipping_updates"
- sender_patterns (string[]): Partial email address or domain matches, e.g. ["@amazon", "noreply@"]. Prioritize sender patterns as the primary matching method.
- instructions (string): Natural language instructions describing what data to extract from matching emails. E.g. "Extract the order number, item names, total amount, and delivery date."
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

const SYSTEM_PROMPT = `You are an email classification expert. You generate rules for an AI-powered email processing pipeline. Each rule defines WHO to watch (sender patterns), WHAT to extract (natural language instructions), and optional keyword filters.

Prioritize sender_patterns + instructions over keyword-heavy rules. The instructions field tells the AI what structured data to extract from matching emails.

Return a JSON array of rule objects. Return 1-5 rules depending on what makes sense.

${RULE_SCHEMA}`;

const PRIMARY_MODEL = 'gemini-3-flash-preview';
const FALLBACK_MODEL = 'gemini-2.5-flash';

function getModel(modelName: string = PRIMARY_MODEL) {
  const client = getClient();
  return client.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0.4,
      responseMimeType: 'application/json',
    },
  });
}

function parseResponse(text: string): RuleSuggestion[] {
  const parsed = JSON.parse(text);
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

export async function suggestRulesFromScreenshot(
  imageBase64: string,
  mimeType: string,
  refinementPrompt?: string,
): Promise<RuleSuggestion[]> {
  const model = getModel();
  const parts = [
    { inlineData: { mimeType, data: imageBase64 } },
    {
      text: `Analyze this email screenshot and suggest rules to capture and extract data from emails like this one. Focus on identifying sender patterns and writing clear extraction instructions.${
        refinementPrompt ? `\n\nAdditional guidance: ${refinementPrompt}` : ''
      }`,
    },
  ];
  const result = await withRateLimit(
    () => model.generateContent(parts as any),
    () => {
      console.warn(`Falling back to ${FALLBACK_MODEL} for screenshot rule suggestion`);
      return getModel(FALLBACK_MODEL).generateContent(parts as any);
    },
  );
  return parseResponse(result.response.text());
}

export async function suggestRulesFromPrompt(
  prompt: string,
): Promise<RuleSuggestion[]> {
  const model = getModel();
  const promptText = `Based on this description, suggest rules for an email processing pipeline. Focus on sender patterns and extraction instructions:\n\n${prompt}`;
  const result = await withRateLimit(
    () => model.generateContent(promptText),
    () => {
      console.warn(`Falling back to ${FALLBACK_MODEL} for prompt rule suggestion`);
      return getModel(FALLBACK_MODEL).generateContent(promptText);
    },
  );
  return parseResponse(result.response.text());
}
