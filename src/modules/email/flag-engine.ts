import type { FlagMatch } from './types.js';
import { getAllRules } from './db.js';

/**
 * Domain-boundary-aware sender pattern matching.
 * Pattern "@amazon" matches "user@amazon.com" and "user@mail.amazon.com"
 * but NOT "user@notamazon.com".
 *
 * Patterns starting with "@" are treated as domain patterns:
 *   "@amazon" → matches if email domain ends with "amazon" before the TLD,
 *               or contains ".amazon." in the domain
 * Other patterns use substring matching (e.g., "noreply" matches "noreply@example.com").
 */
function matchesSenderPattern(fromEmail: string, pattern: string): boolean {
  const p = pattern.toLowerCase().trim();
  const email = fromEmail.toLowerCase();

  if (p.startsWith('@')) {
    // Domain pattern: extract the domain part of the email
    const atIdx = email.indexOf('@');
    if (atIdx === -1) return false;
    const domain = email.slice(atIdx); // includes the @

    // Exact domain match: "@amazon.com" matches "@amazon.com"
    if (domain === p) return true;

    // Subdomain match: "@amazon" matches "@amazon.com", "@mail.amazon.com"
    // But NOT "@notamazon.com"
    // Check if pattern appears at a domain boundary (after @ or after .)
    if (domain.startsWith(p + '.') || domain.includes('.' + p.slice(1) + '.') || domain.endsWith('.' + p.slice(1))) {
      return true;
    }

    return false;
  }

  // Non-@ patterns: substring match (e.g., "noreply" matches "noreply@example.com")
  return email.includes(p);
}

export interface EmailInput {
  subject?: string;
  snippet?: string;
  body?: string;
  from_email?: string;
  has_attachments?: boolean;
}

export interface RuleData {
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
  instructions: string;
  scan_all: boolean;
  destination_ids: number[];
  field_mappings: Record<string, Record<string, string>>;
  expected_fields: string[];
}

function parseRule(row: ReturnType<typeof getAllRules>[number]): RuleData {
  return {
    name: row.name,
    keywords: JSON.parse(row.keywords),
    required_keywords: JSON.parse(row.required_keywords),
    sender_patterns: JSON.parse(row.sender_patterns),
    exclude_phrases: JSON.parse(row.exclude_phrases),
    check_subject: !!row.check_subject,
    check_body: !!row.check_body,
    check_snippet: !!row.check_snippet,
    require_attachment: !!row.require_attachment,
    priority: row.priority,
    enabled: !!row.enabled,
    instructions: row.instructions || '',
    scan_all: !!row.scan_all,
    destination_ids: JSON.parse(row.destination_ids || '[]'),
    field_mappings: JSON.parse(row.field_mappings || '{}'),
    expected_fields: JSON.parse(row.expected_fields || '[]'),
  };
}

export function flagEmail(emailData: EmailInput, rules?: RuleData[]): FlagMatch[] {
  if (!rules) {
    const dbRules = getAllRules();
    rules = dbRules.map(parseRule);
  }

  const subject = (emailData.subject || '').toLowerCase();
  const snippet = (emailData.snippet || '').toLowerCase();
  const body = (emailData.body || '').toLowerCase();
  const fromEmail = (emailData.from_email || '').toLowerCase();
  const hasAttachments = emailData.has_attachments ?? false;

  const matches: FlagMatch[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;

    const hasKeywords = rule.keywords.length > 0;
    const hasSenders = rule.sender_patterns.length > 0;
    const hasInstructions = rule.instructions.trim().length > 0;

    // Determine if this rule is an implicit scan_all:
    // scan_all=true OR (has instructions, no keywords, no senders)
    const implicitScanAll = rule.scan_all || (hasInstructions && !hasKeywords && !hasSenders);

    // Build searchable text based on rule config
    const searchParts: string[] = [];
    if (rule.check_subject) searchParts.push(subject);
    if (rule.check_body && body) searchParts.push(body);
    if (rule.check_snippet) searchParts.push(snippet);
    const searchText = searchParts.join(' ');

    // Check exclude phrases first (false positive filter)
    if (rule.exclude_phrases.some(phrase => searchText.includes(phrase.toLowerCase()))) {
      continue;
    }

    // Check attachment requirement
    if (rule.require_attachment && !hasAttachments) {
      continue;
    }

    if (implicitScanAll) {
      // Matches every email
      matches.push({
        rule_name: rule.name,
        priority: rule.priority,
        instructions: rule.instructions,
        destination_ids: rule.destination_ids,
        field_mappings: rule.field_mappings,
        expected_fields: rule.expected_fields,
      });
      continue;
    }

    // Sender-only mode: sender_patterns present, no keywords
    if (hasSenders && !hasKeywords) {
      if (rule.sender_patterns.some(pattern => matchesSenderPattern(fromEmail, pattern))) {
        matches.push({
          rule_name: rule.name,
          priority: rule.priority,
          instructions: rule.instructions,
          destination_ids: rule.destination_ids,
          field_mappings: rule.field_mappings,
          expected_fields: rule.expected_fields,
        });
      }
      continue;
    }

    // Keyword mode (existing behavior)
    // Check sender pattern
    if (hasSenders) {
      if (!rule.sender_patterns.some(pattern => matchesSenderPattern(fromEmail, pattern))) {
        continue;
      }
    }

    // Check required_keywords (ALL must be present)
    if (rule.required_keywords.length > 0) {
      if (!rule.required_keywords.every(kw => searchText.includes(kw.toLowerCase()))) {
        continue;
      }
    }

    // Check keywords (ANY must be present)
    if (hasKeywords) {
      if (!rule.keywords.some(kw => searchText.includes(kw.toLowerCase()))) {
        continue;
      }
    }

    matches.push({
      rule_name: rule.name,
      priority: rule.priority,
      instructions: rule.instructions,
      destination_ids: rule.destination_ids,
      field_mappings: rule.field_mappings,
      expected_fields: rule.expected_fields,
    });
  }

  // Sort by priority descending
  matches.sort((a, b) => b.priority - a.priority);
  return matches;
}
