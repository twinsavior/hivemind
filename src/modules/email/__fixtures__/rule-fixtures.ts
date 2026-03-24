import { RETAILER_TEMPLATES, type RetailerTemplate } from '../retailer-templates.js';
import type { RuleData } from '../flag-engine.js';

export function templateToRule(template: RetailerTemplate, overrides?: Partial<RuleData>): RuleData {
  return {
    name: template.name,
    keywords: template.keywords,
    required_keywords: template.required_keywords,
    sender_patterns: template.sender_patterns,
    exclude_phrases: template.exclude_phrases,
    check_subject: template.check_subject,
    check_body: template.check_body,
    check_snippet: template.check_snippet,
    require_attachment: false,
    priority: template.priority,
    enabled: true,
    instructions: template.instructions,
    scan_all: false,
    destination_ids: [],
    field_mappings: {},
    expected_fields: template.expected_fields,
    ...overrides,
  };
}

export function allTemplateRules(): RuleData[] {
  return RETAILER_TEMPLATES.map(t => templateToRule(t));
}

export function makeRule(overrides: Partial<RuleData> & { name: string }): RuleData {
  return {
    keywords: [],
    required_keywords: [],
    sender_patterns: [],
    exclude_phrases: [],
    check_subject: true,
    check_body: true,
    check_snippet: true,
    require_attachment: false,
    priority: 5,
    enabled: true,
    instructions: '',
    scan_all: false,
    destination_ids: [],
    field_mappings: {},
    expected_fields: [],
    ...overrides,
  };
}
