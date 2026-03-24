import { describe, it, expect, vi } from 'vitest';

// Mock DB before importing flag-engine — prevents better-sqlite3 from loading
vi.mock('../../../src/modules/email/db', () => ({
  getAllRules: () => { throw new Error('DB should not be called in unit tests'); },
}));

import { flagEmail } from '../../../src/modules/email/flag-engine.js';
import { templateToRule, allTemplateRules, makeRule } from '../../../src/modules/email/__fixtures__/rule-fixtures.js';
import {
  makeEmail,
  amazonEmail, walmartEmail, bestbuyEmail, targetEmail,
  nikeEmail, appleEmail, ebayEmail, costcoEmail,
  samsclubEmail, dtlrEmail, toppsEmail, pokemoncenterEmail,
  shopifyEmail, homedepotEmail, staplesEmail,
} from '../../../src/modules/email/__fixtures__/email-fixtures.js';
import { RETAILER_TEMPLATES } from '../../../src/modules/email/retailer-templates.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function getRule(templateId: string) {
  const tmpl = RETAILER_TEMPLATES.find(t => t.id === templateId);
  if (!tmpl) throw new Error(`Template not found: ${templateId}`);
  return templateToRule(tmpl);
}

function expectMatch(email: ReturnType<typeof makeEmail>, rules: ReturnType<typeof makeRule>[], expectedName: string) {
  const matches = flagEmail(email, rules);
  expect(matches.length).toBeGreaterThanOrEqual(1);
  expect(matches.some(m => m.rule_name === expectedName)).toBe(true);
}

function expectNoMatch(email: ReturnType<typeof makeEmail>, rules: ReturnType<typeof makeRule>[]) {
  expect(flagEmail(email, rules)).toHaveLength(0);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. CORE MATCHING MECHANICS
// ═══════════════════════════════════════════════════════════════════════════

describe('Core matching mechanics', () => {

  describe('searchText assembly', () => {
    it('includes subject when check_subject=true', () => {
      const rule = makeRule({ name: 'Test', keywords: ['magic'], check_subject: true, check_body: false, check_snippet: false });
      expectMatch(makeEmail({ subject: 'Magic keyword here' }), [rule], 'Test');
    });

    it('excludes subject when check_subject=false', () => {
      const rule = makeRule({ name: 'Test', keywords: ['magic'], check_subject: false, check_body: false, check_snippet: false });
      expectNoMatch(makeEmail({ subject: 'Magic keyword here' }), [rule]);
    });

    it('includes body when check_body=true', () => {
      const rule = makeRule({ name: 'Test', keywords: ['secret'], check_subject: false, check_body: true, check_snippet: false });
      expectMatch(makeEmail({ body: 'This has a secret inside' }), [rule], 'Test');
    });

    it('excludes body when check_body=false', () => {
      const rule = makeRule({ name: 'Test', keywords: ['secret'], check_subject: false, check_body: false, check_snippet: false });
      expectNoMatch(makeEmail({ body: 'This has a secret inside' }), [rule]);
    });

    it('includes snippet when check_snippet=true', () => {
      const rule = makeRule({ name: 'Test', keywords: ['preview'], check_subject: false, check_body: false, check_snippet: true });
      expectMatch(makeEmail({ snippet: 'A preview of the email' }), [rule], 'Test');
    });

    it('excludes snippet when check_snippet=false', () => {
      const rule = makeRule({ name: 'Test', keywords: ['preview'], check_subject: false, check_body: false, check_snippet: false });
      expectNoMatch(makeEmail({ snippet: 'A preview of the email' }), [rule]);
    });
  });

  describe('case insensitivity', () => {
    it('matches keywords regardless of case', () => {
      const rule = makeRule({ name: 'Test', keywords: ['order confirmation'], sender_patterns: ['store.com'] });
      expectMatch(makeEmail({ from_email: 'info@STORE.COM', subject: 'ORDER CONFIRMATION' }), [rule], 'Test');
    });

    it('matches sender pattern regardless of case', () => {
      const rule = makeRule({ name: 'Test', keywords: ['hello'], sender_patterns: ['amazon.com'] });
      expectMatch(makeEmail({ from_email: 'no-reply@AMAZON.COM', subject: 'Hello there' }), [rule], 'Test');
    });

    it('matches exclude phrases case-insensitively', () => {
      const rule = makeRule({ name: 'Test', keywords: ['order'], sender_patterns: ['store.com'], exclude_phrases: ['weekly ad'] });
      expectNoMatch(makeEmail({ from_email: 'info@store.com', subject: 'Order update WEEKLY AD inside' }), [rule]);
    });
  });

  describe('exclude phrase filtering', () => {
    it('skips when exclude phrase appears in subject', () => {
      const rule = makeRule({ name: 'Test', keywords: ['order'], sender_patterns: ['store.com'], exclude_phrases: ['save on'] });
      expectNoMatch(makeEmail({ from_email: 'x@store.com', subject: 'Save on your next order' }), [rule]);
    });

    it('skips when exclude phrase appears in body', () => {
      const rule = makeRule({ name: 'Test', keywords: ['order'], sender_patterns: ['store.com'], exclude_phrases: ['weekly ad'] });
      expectNoMatch(makeEmail({ from_email: 'x@store.com', subject: 'Your order', body: 'Check our weekly ad for deals' }), [rule]);
    });

    it('skips when exclude phrase appears in snippet', () => {
      const rule = makeRule({ name: 'Test', keywords: ['order'], sender_patterns: ['store.com'], exclude_phrases: ['just for you'] });
      expectNoMatch(makeEmail({ from_email: 'x@store.com', subject: 'Your order', snippet: 'Deals just for you' }), [rule]);
    });

    it('does NOT skip when exclude phrase is absent', () => {
      const rule = makeRule({ name: 'Test', keywords: ['order'], sender_patterns: ['store.com'], exclude_phrases: ['weekly ad'] });
      expectMatch(makeEmail({ from_email: 'x@store.com', subject: 'Your order has shipped' }), [rule], 'Test');
    });

    it('any single exclude match is sufficient to skip', () => {
      const rule = makeRule({ name: 'Test', keywords: ['order'], sender_patterns: ['store.com'], exclude_phrases: ['promo', 'ad', 'sale'] });
      expectNoMatch(makeEmail({ from_email: 'x@store.com', subject: 'Order sale event' }), [rule]);
    });
  });

  describe('required keywords (ALL must match)', () => {
    it('matches when all required keywords are present', () => {
      const rule = makeRule({ name: 'Test', keywords: ['order'], required_keywords: ['urgent', 'confirm'], sender_patterns: ['store.com'] });
      expectMatch(makeEmail({ from_email: 'x@store.com', subject: 'Urgent: confirm your order' }), [rule], 'Test');
    });

    it('rejects when only some required keywords are present', () => {
      const rule = makeRule({ name: 'Test', keywords: ['order'], required_keywords: ['urgent', 'confirm'], sender_patterns: ['store.com'] });
      expectNoMatch(makeEmail({ from_email: 'x@store.com', subject: 'Confirm your order' }), [rule]);
    });
  });

  describe('attachment requirement', () => {
    it('skips when rule requires attachment but email has none', () => {
      const rule = makeRule({ name: 'Test', keywords: ['invoice'], require_attachment: true });
      expectNoMatch(makeEmail({ subject: 'Your invoice', has_attachments: false }), [rule]);
    });

    it('matches when rule requires attachment and email has one', () => {
      const rule = makeRule({ name: 'Test', keywords: ['invoice'], require_attachment: true });
      expectMatch(makeEmail({ subject: 'Your invoice', has_attachments: true }), [rule], 'Test');
    });
  });

  describe('disabled rules', () => {
    it('skips disabled rules', () => {
      const rule = makeRule({ name: 'Test', keywords: ['order'], enabled: false });
      expectNoMatch(makeEmail({ subject: 'Your order' }), [rule]);
    });
  });

  describe('matching modes', () => {
    it('implicit scan_all: instructions + no keywords + no senders matches everything', () => {
      const rule = makeRule({ name: 'ScanAll', instructions: 'Extract data', keywords: [], sender_patterns: [] });
      expectMatch(makeEmail({ from_email: 'anyone@anywhere.com', subject: 'Anything' }), [rule], 'ScanAll');
    });

    it('explicit scan_all=true matches everything', () => {
      const rule = makeRule({ name: 'ScanAll', scan_all: true, keywords: ['order'] });
      expectMatch(makeEmail({ from_email: 'anyone@anywhere.com', subject: 'No keywords here' }), [rule], 'ScanAll');
    });

    it('implicit scan_all respects exclude phrases', () => {
      const rule = makeRule({ name: 'ScanAll', instructions: 'Extract', keywords: [], sender_patterns: [], exclude_phrases: ['unsubscribe'] });
      expectNoMatch(makeEmail({ subject: 'Click to unsubscribe' }), [rule]);
    });

    it('explicit scan_all respects exclude phrases', () => {
      const rule = makeRule({ name: 'ScanAll', scan_all: true, exclude_phrases: ['spam'] });
      expectNoMatch(makeEmail({ subject: 'This is spam' }), [rule]);
    });

    it('sender-only mode: senders + no keywords matches on sender alone', () => {
      const rule = makeRule({ name: 'SenderOnly', sender_patterns: ['important.com'], keywords: [] });
      expectMatch(makeEmail({ from_email: 'ceo@important.com', subject: 'Random subject' }), [rule], 'SenderOnly');
    });

    it('sender-only mode: wrong sender does not match', () => {
      const rule = makeRule({ name: 'SenderOnly', sender_patterns: ['important.com'], keywords: [] });
      expectNoMatch(makeEmail({ from_email: 'ceo@other.com', subject: 'Random subject' }), [rule]);
    });

    it('sender+keyword mode: both must match', () => {
      const rule = makeRule({ name: 'Both', sender_patterns: ['store.com'], keywords: ['order'] });
      expectMatch(makeEmail({ from_email: 'x@store.com', subject: 'Your order' }), [rule], 'Both');
    });

    it('sender+keyword mode: sender match + keyword miss = no match', () => {
      const rule = makeRule({ name: 'Both', sender_patterns: ['store.com'], keywords: ['order'] });
      expectNoMatch(makeEmail({ from_email: 'x@store.com', subject: 'Newsletter' }), [rule]);
    });

    it('sender+keyword mode: keyword match + sender miss = no match', () => {
      const rule = makeRule({ name: 'Both', sender_patterns: ['store.com'], keywords: ['order'] });
      expectNoMatch(makeEmail({ from_email: 'x@other.com', subject: 'Your order' }), [rule]);
    });

    it('keyword-only mode: matches when keyword present', () => {
      const rule = makeRule({ name: 'KWOnly', keywords: ['invoice'], sender_patterns: [] });
      expectMatch(makeEmail({ from_email: 'anyone@anywhere.com', subject: 'Your invoice' }), [rule], 'KWOnly');
    });

    it('keyword-only mode: no match when keyword absent', () => {
      const rule = makeRule({ name: 'KWOnly', keywords: ['invoice'], sender_patterns: [] });
      expectNoMatch(makeEmail({ from_email: 'anyone@anywhere.com', subject: 'Newsletter' }), [rule]);
    });
  });

  describe('priority sorting', () => {
    it('returns matches sorted by priority descending', () => {
      const rules = [
        makeRule({ name: 'Low', keywords: ['test'], priority: 1 }),
        makeRule({ name: 'High', keywords: ['test'], priority: 10 }),
        makeRule({ name: 'Mid', keywords: ['test'], priority: 5 }),
      ];
      const matches = flagEmail(makeEmail({ subject: 'test' }), rules);
      expect(matches.map(m => m.rule_name)).toEqual(['High', 'Mid', 'Low']);
    });
  });

  describe('empty / missing fields', () => {
    it('handles email with all undefined fields', () => {
      const rule = makeRule({ name: 'ScanAll', scan_all: true });
      expect(flagEmail({}, [rule])).toHaveLength(1);
    });

    it('handles empty rules array', () => {
      expect(flagEmail(makeEmail({ subject: 'anything' }), [])).toHaveLength(0);
    });

    it('handles email with empty strings', () => {
      const rule = makeRule({ name: 'Test', keywords: ['test'] });
      expectNoMatch(makeEmail({ subject: '', snippet: '', body: '', from_email: '' }), [rule]);
    });
  });

  describe('substring matching behavior', () => {
    it('"order" matches "ordering" (substring)', () => {
      const rule = makeRule({ name: 'Test', keywords: ['order'], sender_patterns: ['store.com'] });
      expectMatch(makeEmail({ from_email: 'x@store.com', subject: 'Thanks for ordering' }), [rule], 'Test');
    });

    it('"your order" does NOT match "your Amazon order"', () => {
      // This documents the exact behavior that caused Bug #1
      const rule = makeRule({ name: 'Test', keywords: ['your order'], sender_patterns: ['amazon.com'] });
      expectNoMatch(makeEmail({ from_email: 'no-reply@amazon.com', subject: 'Update for your Amazon order' }), [rule]);
    });

    it('"your amazon order" DOES match "your Amazon order"', () => {
      const rule = makeRule({ name: 'Test', keywords: ['your amazon order'], sender_patterns: ['amazon.com'] });
      expectMatch(makeEmail({ from_email: 'no-reply@amazon.com', subject: 'Update for your Amazon order' }), [rule], 'Test');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. PER-TEMPLATE MATCHING TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Template: Amazon', () => {
  const rules = [getRule('amazon')];

  it('matches order confirmation', () => expectMatch(amazonEmail('order'), rules, 'Amazon'));
  it('matches shipped notification', () => expectMatch(amazonEmail('shipped'), rules, 'Amazon'));
  it('matches delivered notification', () => expectMatch(amazonEmail('delivered'), rules, 'Amazon'));
  it('matches delivery estimate update', () => expectMatch(amazonEmail('delivery_estimate'), rules, 'Amazon'));
  it('matches out for delivery', () => expectMatch(amazonEmail('out_for_delivery'), rules, 'Amazon'));
  it('matches order update', () => expectMatch(amazonEmail('order_update'), rules, 'Amazon'));
  it('matches "your package" notification', () => expectMatch(amazonEmail('your_package'), rules, 'Amazon'));
  it('matches order with # in subject', () => expectMatch(amazonEmail('order_hash'), rules, 'Amazon'));
  it('matches amazon.co.uk sender', () => expectMatch(amazonEmail('amazon_co_uk'), rules, 'Amazon'));
  it('matches amazon.ca sender', () => expectMatch(amazonEmail('amazon_ca'), rules, 'Amazon'));
  it('rejects "your review" marketing', () => expectNoMatch(amazonEmail('marketing_review'), rules));
  it('rejects "recommended for you" marketing', () => expectNoMatch(amazonEmail('marketing_recommended'), rules));
  it('rejects non-amazon sender', () => {
    expectNoMatch(makeEmail({ from_email: 'x@other.com', subject: 'Your order has shipped' }), rules);
  });
});

describe('Template: Walmart', () => {
  const rules = [getRule('walmart')];

  it('matches order confirmation', () => expectMatch(walmartEmail('order'), rules, 'Walmart'));
  it('matches shipped notification', () => expectMatch(walmartEmail('shipped'), rules, 'Walmart'));
  it('matches delivered notification', () => expectMatch(walmartEmail('delivered'), rules, 'Walmart'));
  it('matches pickup notification', () => expectMatch(walmartEmail('pickup'), rules, 'Walmart'));
  it('rejects "save on" marketing', () => expectNoMatch(walmartEmail('marketing_save'), rules));
  it('rejects "rollback" marketing', () => expectNoMatch(walmartEmail('marketing_rollback'), rules));
  it('rejects "weekly ad" marketing', () => expectNoMatch(walmartEmail('marketing_weekly'), rules));
  it('rejects non-walmart sender', () => {
    expectNoMatch(makeEmail({ from_email: 'x@other.com', subject: 'Your order has shipped' }), rules);
  });
});

describe('Template: Best Buy', () => {
  const rules = [getRule('bestbuy')];

  it('matches order confirmation', () => expectMatch(bestbuyEmail('order'), rules, 'Best Buy'));
  it('matches shipped notification', () => expectMatch(bestbuyEmail('shipped'), rules, 'Best Buy'));
  it('matches delivered notification', () => expectMatch(bestbuyEmail('delivered'), rules, 'Best Buy'));
  it('matches pickup notification', () => expectMatch(bestbuyEmail('pickup'), rules, 'Best Buy'));
  it('rejects "deal of the day" marketing', () => expectNoMatch(bestbuyEmail('marketing_deal'), rules));
  it('rejects "top deals" marketing', () => expectNoMatch(bestbuyEmail('marketing_top'), rules));
  it('rejects "just for you" marketing', () => expectNoMatch(bestbuyEmail('marketing_just'), rules));
  it('rejects non-bestbuy sender', () => {
    expectNoMatch(makeEmail({ from_email: 'x@other.com', subject: 'Your order has shipped' }), rules);
  });
});

describe('Template: Target', () => {
  const rules = [getRule('target')];

  it('matches order confirmation', () => expectMatch(targetEmail('order'), rules, 'Target'));
  it('matches shipped notification', () => expectMatch(targetEmail('shipped'), rules, 'Target'));
  it('matches delivered notification', () => expectMatch(targetEmail('delivered'), rules, 'Target'));
  it('matches drive up notification', () => expectMatch(targetEmail('drive_up'), rules, 'Target'));
  it('rejects "circle offer" marketing', () => expectNoMatch(targetEmail('marketing_circle'), rules));
  it('rejects "weekly ad" marketing', () => expectNoMatch(targetEmail('marketing_weekly'), rules));
  it('rejects "just for you" marketing', () => expectNoMatch(targetEmail('marketing_just'), rules));
  it('rejects non-target sender', () => {
    expectNoMatch(makeEmail({ from_email: 'x@other.com', subject: 'Your order has shipped' }), rules);
  });
});

describe('Template: Nike', () => {
  const rules = [getRule('nike')];

  it('matches order confirmation', () => expectMatch(nikeEmail('order'), rules, 'Nike'));
  it('matches shipped (on its way)', () => expectMatch(nikeEmail('shipped'), rules, 'Nike'));
  it('matches delivered notification', () => expectMatch(nikeEmail('delivered'), rules, 'Nike'));
  it('rejects "just dropped" marketing', () => expectNoMatch(nikeEmail('marketing_dropped'), rules));
  it('rejects "new release" marketing', () => expectNoMatch(nikeEmail('marketing_release'), rules));
  it('rejects "member exclusive" marketing', () => expectNoMatch(nikeEmail('marketing_member'), rules));
  it('rejects non-nike sender', () => {
    expectNoMatch(makeEmail({ from_email: 'x@other.com', subject: 'Your order has shipped' }), rules);
  });
});

describe('Template: Apple', () => {
  const rules = [getRule('apple')];

  it('matches order confirmation', () => expectMatch(appleEmail('order'), rules, 'Apple'));
  it('matches shipped notification', () => expectMatch(appleEmail('shipped'), rules, 'Apple'));
  it('matches delivered notification', () => expectMatch(appleEmail('delivered'), rules, 'Apple'));
  it('matches receipt', () => expectMatch(appleEmail('receipt'), rules, 'Apple'));
  it('rejects "apple news" marketing', () => expectNoMatch(appleEmail('marketing_news'), rules));
  it('rejects "apple music" marketing', () => expectNoMatch(appleEmail('marketing_music'), rules));
  it('rejects "app store receipt"', () => expectNoMatch(appleEmail('marketing_appstore'), rules));
  it('rejects non-apple sender', () => {
    expectNoMatch(makeEmail({ from_email: 'x@other.com', subject: 'Your order has shipped' }), rules);
  });
});

describe('Template: eBay', () => {
  const rules = [getRule('ebay')];

  it('matches order confirmed', () => expectMatch(ebayEmail('order'), rules, 'eBay'));
  it('matches shipped notification', () => expectMatch(ebayEmail('shipped'), rules, 'eBay'));
  it('matches delivered notification', () => expectMatch(ebayEmail('delivered'), rules, 'eBay'));
  it('matches "you bought"', () => expectMatch(ebayEmail('bought'), rules, 'eBay'));
  it('matches "payment received"', () => expectMatch(ebayEmail('payment'), rules, 'eBay'));
  it('rejects "items you may like" marketing', () => expectNoMatch(ebayEmail('marketing_like'), rules));
  it('rejects "price drop" marketing', () => expectNoMatch(ebayEmail('marketing_price'), rules));
  it('rejects "selling tips" marketing', () => expectNoMatch(ebayEmail('marketing_selling'), rules));
  it('rejects non-ebay sender', () => {
    expectNoMatch(makeEmail({ from_email: 'x@other.com', subject: 'Your order confirmed' }), rules);
  });
});

describe('Template: Costco', () => {
  const rules = [getRule('costco')];

  it('matches order confirmation', () => expectMatch(costcoEmail('order'), rules, 'Costco'));
  it('matches shipped notification', () => expectMatch(costcoEmail('shipped'), rules, 'Costco'));
  it('matches delivered notification', () => expectMatch(costcoEmail('delivered'), rules, 'Costco'));
  it('rejects "warehouse coupon" marketing', () => expectNoMatch(costcoEmail('marketing_coupon'), rules));
  it('rejects "member savings" marketing', () => expectNoMatch(costcoEmail('marketing_savings'), rules));
  it('rejects non-costco sender', () => {
    expectNoMatch(makeEmail({ from_email: 'x@other.com', subject: 'Your order has shipped' }), rules);
  });
});

describe("Template: Sam's Club", () => {
  const rules = [getRule('samsclub')];

  it('matches order confirmation', () => expectMatch(samsclubEmail('order'), rules, "Sam's Club"));
  it('matches shipped notification', () => expectMatch(samsclubEmail('shipped'), rules, "Sam's Club"));
  it('matches delivered notification', () => expectMatch(samsclubEmail('delivered'), rules, "Sam's Club"));
  it('rejects "instant savings" marketing', () => expectNoMatch(samsclubEmail('marketing_savings'), rules));
  it('rejects "club picks" marketing', () => expectNoMatch(samsclubEmail('marketing_picks'), rules));
  it('rejects non-samsclub sender', () => {
    expectNoMatch(makeEmail({ from_email: 'x@other.com', subject: 'Your order has shipped' }), rules);
  });
});

describe('Template: DTLR', () => {
  const rules = [getRule('dtlr')];

  it('matches order confirmation', () => expectMatch(dtlrEmail('order'), rules, 'DTLR'));
  it('matches shipped notification', () => expectMatch(dtlrEmail('shipped'), rules, 'DTLR'));
  it('matches delivered notification', () => expectMatch(dtlrEmail('delivered'), rules, 'DTLR'));
  it('rejects "new arrivals" marketing', () => expectNoMatch(dtlrEmail('marketing_arrivals'), rules));
  it('rejects "just dropped" marketing', () => expectNoMatch(dtlrEmail('marketing_dropped'), rules));
  it('rejects non-dtlr sender', () => {
    expectNoMatch(makeEmail({ from_email: 'x@other.com', subject: 'Your order has shipped' }), rules);
  });
});

describe('Template: Topps', () => {
  const rules = [getRule('topps')];

  it('matches order confirmation', () => expectMatch(toppsEmail('order'), rules, 'Topps'));
  it('matches shipped notification', () => expectMatch(toppsEmail('shipped'), rules, 'Topps'));
  it('matches delivered notification', () => expectMatch(toppsEmail('delivered'), rules, 'Topps'));
  it('rejects "new release" marketing', () => expectNoMatch(toppsEmail('marketing_release'), rules));
  it('rejects "pre-order now" marketing', () => expectNoMatch(toppsEmail('marketing_preorder'), rules));
  it('rejects non-topps sender', () => {
    expectNoMatch(makeEmail({ from_email: 'x@other.com', subject: 'Your order has shipped' }), rules);
  });
});

describe('Template: Pokemon Center', () => {
  const rules = [getRule('pokemoncenter')];

  it('matches order confirmation', () => expectMatch(pokemoncenterEmail('order'), rules, 'Pokemon Center'));
  it('matches shipped notification', () => expectMatch(pokemoncenterEmail('shipped'), rules, 'Pokemon Center'));
  it('matches delivered notification', () => expectMatch(pokemoncenterEmail('delivered'), rules, 'Pokemon Center'));
  it('rejects "new arrivals" marketing', () => expectNoMatch(pokemoncenterEmail('marketing_arrivals'), rules));
  it('rejects "just announced" marketing', () => expectNoMatch(pokemoncenterEmail('marketing_announced'), rules));
  it('rejects non-pokemoncenter sender', () => {
    expectNoMatch(makeEmail({ from_email: 'x@other.com', subject: 'Your order has shipped' }), rules);
  });
});

describe('Template: Shopify Store (generic catch-all)', () => {
  const rules = [getRule('shopify')];

  it('matches "order confirmed" from unknown store', () => expectMatch(shopifyEmail('order_confirmed'), rules, 'Shopify Store'));
  it('matches "shipping confirmation" from unknown store', () => expectMatch(shopifyEmail('shipping'), rules, 'Shopify Store'));
  it('matches "your order" from unknown store', () => expectMatch(shopifyEmail('your_order'), rules, 'Shopify Store'));
  it('matches "order #" from unknown store', () => expectMatch(shopifyEmail('order_hash'), rules, 'Shopify Store'));
  it('does NOT match generic newsletter', () => expectNoMatch(shopifyEmail('no_match'), rules));
});

describe('Template: Home Depot', () => {
  const rules = [getRule('homedepot')];

  it('matches order confirmation', () => expectMatch(homedepotEmail('order'), rules, 'Home Depot'));
  it('matches shipped notification', () => expectMatch(homedepotEmail('shipped'), rules, 'Home Depot'));
  it('matches delivered notification', () => expectMatch(homedepotEmail('delivered'), rules, 'Home Depot'));
  it('matches pickup notification', () => expectMatch(homedepotEmail('pickup'), rules, 'Home Depot'));
  it('rejects "pro xtra" marketing', () => expectNoMatch(homedepotEmail('marketing_pro'), rules));
  it('rejects "special buy" marketing', () => expectNoMatch(homedepotEmail('marketing_special'), rules));
  it('rejects "savings center" marketing', () => expectNoMatch(homedepotEmail('marketing_savings'), rules));
  it('rejects non-homedepot sender', () => {
    expectNoMatch(makeEmail({ from_email: 'x@other.com', subject: 'Your order has shipped' }), rules);
  });
});

describe('Template: Staples', () => {
  const rules = [getRule('staples')];

  it('matches order confirmation', () => expectMatch(staplesEmail('order'), rules, 'Staples'));
  it('matches shipped notification', () => expectMatch(staplesEmail('shipped'), rules, 'Staples'));
  it('matches delivered notification', () => expectMatch(staplesEmail('delivered'), rules, 'Staples'));
  it('rejects "weekly deals" marketing', () => expectNoMatch(staplesEmail('marketing_deals'), rules));
  it('rejects "clearance" marketing', () => expectNoMatch(staplesEmail('marketing_clearance'), rules));
  it('rejects "easy rebates" marketing', () => expectNoMatch(staplesEmail('marketing_rebates'), rules));
  it('rejects non-staples sender', () => {
    expectNoMatch(makeEmail({ from_email: 'x@other.com', subject: 'Your order has shipped' }), rules);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. CROSS-TEMPLATE PRIORITY & INTERFERENCE
// ═══════════════════════════════════════════════════════════════════════════

describe('Cross-template priority ordering', () => {
  const allRules = allTemplateRules();

  it.each([
    ['Amazon', 'shipment-tracking@amazon.com', 'Your Amazon.com order confirmation', 'Order #112-3456789-0123456'],
    ['Walmart', 'orders@walmart.com', 'Your Walmart order confirmation', 'Order #200123456'],
    ['Best Buy', 'orders@bestbuy.com', 'Your Best Buy order confirmation', 'Order #BBY01-123'],
    ['Target', 'orders@target.com', 'Your Target order is confirmed', 'Order details'],
    ['Nike', 'orders@nike.com', 'Nike order confirmation', 'Your order #C012345'],
    ['Apple', 'noreply@apple.com', 'Your Apple order confirmation', 'Order #W123456'],
    ['eBay', 'ebay@ebay.com', 'Your order confirmed on eBay', 'You bought item'],
    ['Costco', 'orders@costco.com', 'Costco order confirmation', 'Your order placed'],
    ["Sam's Club", 'orders@samsclub.com', "Sam's Club order confirmation", 'Your order placed'],
    ['DTLR', 'orders@dtlr.com', 'DTLR order confirmation', 'Your order placed'],
    ['Topps', 'orders@topps.com', 'Topps order confirmation', 'Your order placed'],
    ['Pokemon Center', 'orders@pokemoncenter.com', 'Pokemon Center order confirmation', 'Your order placed'],
    ['Home Depot', 'orders@homedepot.com', 'Home Depot order confirmation', 'Your order placed'],
    ['Staples', 'orders@staples.com', 'Staples order confirmation', 'Your order placed'],
  ])('%s (priority 10) beats Shopify (priority 5) when both match', (retailerName, sender, subject, snippet) => {
    const email = makeEmail({ from_email: sender, subject, snippet });
    const matches = flagEmail(email, allRules);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].rule_name).toBe(retailerName);
    expect(matches[0].priority).toBe(10);
  });

  it('Shopify catches unknown store that no specific template matches', () => {
    const matches = flagEmail(shopifyEmail('order_confirmed'), allRules);
    expect(matches).toHaveLength(1);
    expect(matches[0].rule_name).toBe('Shopify Store');
  });

  it('completely unrelated email matches nothing', () => {
    const email = makeEmail({
      from_email: 'friend@gmail.com',
      subject: 'Hey want to grab lunch?',
      snippet: 'Let me know if you are free today',
    });
    expect(flagEmail(email, allRules)).toHaveLength(0);
  });

  it('all matches are always sorted by priority descending', () => {
    const email = makeEmail({
      from_email: 'auto-confirm@amazon.com',
      subject: 'Your order confirmed - order #12345',
      snippet: 'Your Amazon order has been placed',
    });
    const matches = flagEmail(email, allRules);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i].priority).toBeLessThanOrEqual(matches[i - 1].priority);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. REGRESSION TESTS — KNOWN BUGS
// ═══════════════════════════════════════════════════════════════════════════

describe('Regression: known bugs', () => {
  const allRules = allTemplateRules();

  describe('Bug #1: Amazon "Delivery Estimate Update" matched Shopify instead of Amazon', () => {
    it('matches Amazon template (not Shopify) for delivery estimate emails', () => {
      const email = amazonEmail('delivery_estimate');
      const matches = flagEmail(email, allRules);
      expect(matches[0].rule_name).toBe('Amazon');
    });

    it('matches via "delivery estimate" keyword in subject alone', () => {
      const email = makeEmail({
        from_email: 'no-reply@amazon.com',
        subject: 'Delivery Estimate Update',
      });
      const matches = flagEmail(email, allRules);
      expect(matches[0].rule_name).toBe('Amazon');
    });

    it('matches via "your amazon order" keyword in snippet', () => {
      const email = makeEmail({
        from_email: 'no-reply@amazon.com',
        subject: 'Important update',
        snippet: 'We have an update for your Amazon order #112-3456789',
      });
      const matches = flagEmail(email, allRules);
      expect(matches[0].rule_name).toBe('Amazon');
    });
  });

  describe('Bug #2: Shopify "order #" keyword stealing known retailer emails', () => {
    it('Amazon email with "order #" in subject: Amazon first, not Shopify', () => {
      const email = amazonEmail('order_hash');
      const matches = flagEmail(email, allRules);
      expect(matches[0].rule_name).toBe('Amazon');
      // Shopify may also match via "order #" — acceptable if it's lower priority
      const shopify = matches.find(m => m.rule_name === 'Shopify Store');
      if (shopify) {
        expect(matches.indexOf(shopify)).toBeGreaterThan(0);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. META: TEMPLATE COVERAGE ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════════════

describe('Template coverage', () => {
  const testedTemplateIds = [
    'amazon', 'walmart', 'bestbuy', 'target', 'nike', 'apple', 'ebay',
    'costco', 'samsclub', 'dtlr', 'topps', 'pokemoncenter', 'shopify',
    'homedepot', 'staples',
  ];

  it('every template has a corresponding test block', () => {
    const allTemplateIds = RETAILER_TEMPLATES.map(t => t.id);
    expect(testedTemplateIds.sort()).toEqual(allTemplateIds.sort());
  });
});
