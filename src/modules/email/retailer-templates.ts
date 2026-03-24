// ── Retailer Template Registry ───────────────────────────────────────────────
// Static, app-provided rule templates for common retailers.
// Templates are NOT stored in the DB — they define the defaults for creating rules.

export interface RetailerTemplate {
  id: string;
  name: string;
  description: string;
  icon: string; // Lucide icon name
  category: 'retail' | 'electronics' | 'fashion' | 'collectibles' | 'wholesale' | 'generic';
  sender_patterns: string[];
  keywords: string[];
  required_keywords: string[];
  exclude_phrases: string[];
  check_subject: boolean;
  check_body: boolean;
  check_snippet: boolean;
  instructions: string;
  expected_fields: string[];
  priority: number;
  is_order_template: boolean;
}

const ORDER_EXPECTED_FIELDS = [
  'order_id', 'order_date', 'items',
  'subtotal', 'tax', 'total', 'currency',
  'tracking_number', 'carrier', 'order_status',
  'estimated_delivery', 'shipping_address', 'retailer_name',
];

const STATUS_INSTRUCTION = `
Normalize order_status to exactly one of: ordered, processing, shipped, out_for_delivery, delivered, cancelled, returned.
If the email is an order confirmation, set order_status to "ordered".
If it mentions shipping/tracking, set order_status to "shipped".
If it mentions delivery confirmation, set order_status to "delivered".
If it mentions cancellation, set order_status to "cancelled".
Always set currency to the 3-letter code (e.g. "USD").
Dates should be in YYYY-MM-DD format. Monetary amounts should be numbers without currency symbols.
If this email is not related to an order, set _relevant to false.

IMPORTANT — Multi-item handling:
Return ALL line items in an "items" array. Each element must have: "item_name" (string), "item_quantity" (number), "item_price" (number, per-unit price NOT total).
Example: "items": [{"item_name": "Widget", "item_quantity": 2, "item_price": 9.99}]
Even if there is only one item, use the items array. Do NOT use top-level item_name, item_quantity, or item_price fields.
If individual item prices are not shown in the email, set item_price to null for those items but still include them in the array.
The "total" field is the order-level total, NOT a per-item total.

CRITICAL — Item naming rules:
NEVER use generic placeholder names like "Item 2", "Item 3", "Other items", "Unknown item", "Additional items", or "Various items".
Every item MUST have its actual product name exactly as shown in the email. Copy the product name verbatim from the email text.
If the email lists 5 items, return 5 items with their real names. If you cannot determine an item's specific name, use whatever descriptive text is available (brand, category, SKU, size, color) rather than a placeholder.`;

export const RETAILER_TEMPLATES: RetailerTemplate[] = [
  {
    id: 'amazon',
    name: 'Amazon',
    description: 'Order confirmations, shipment updates, and delivery notifications from Amazon.',
    icon: 'ShoppingCart',
    category: 'retail',
    sender_patterns: ['amazon.com', 'amazon.co.uk', 'amazon.ca'],
    keywords: ['your order', 'shipped', 'delivered', 'order confirmation', 'arriving', 'delivery estimate', 'delivery update', 'order update', 'order #', 'out for delivery', 'on its way', 'has shipped', 'was delivered', 'your amazon order', 'your package'],
    required_keywords: [],
    exclude_phrases: ['your review', 'rate your experience', 'recommended for you'],
    check_subject: true,
    check_body: true,
    check_snippet: true,
    instructions: `Extract order information from this Amazon email.
- Order numbers typically look like #xxx-xxxxxxx-xxxxxxx
- Look for item names, quantities, and prices
- Extract order total, subtotal, tax, and shipping cost
- Find tracking numbers and carrier (USPS, UPS, FedEx, Amazon Logistics)
- Identify estimated delivery dates
- Extract shipping address if present
Always set retailer_name to "Amazon".
${STATUS_INSTRUCTION}`,
    expected_fields: ORDER_EXPECTED_FIELDS,
    priority: 10,
    is_order_template: true,
  },
  {
    id: 'walmart',
    name: 'Walmart',
    description: 'Order confirmations, shipping updates, and pickup notifications from Walmart.',
    icon: 'Store',
    category: 'retail',
    sender_patterns: ['walmart.com'],
    keywords: ['order', 'shipped', 'delivered', 'ready for pickup', 'order confirmation'],
    required_keywords: [],
    exclude_phrases: ['save on', 'rollback', 'weekly ad'],
    check_subject: true,
    check_body: true,
    check_snippet: true,
    instructions: `Extract order information from this Walmart email.
- Order numbers are typically numeric (e.g. 2001234567890)
- Look for item names, quantities, and prices
- Extract order total, subtotal, tax
- Find tracking numbers and carrier (FedEx, UPS, USPS, Lasership)
- Identify estimated delivery or pickup dates
- Note if this is a shipping or pickup order
Always set retailer_name to "Walmart".
${STATUS_INSTRUCTION}`,
    expected_fields: ORDER_EXPECTED_FIELDS,
    priority: 10,
    is_order_template: true,
  },
  {
    id: 'bestbuy',
    name: 'Best Buy',
    description: 'Order confirmations, shipping updates, and store pickup from Best Buy.',
    icon: 'Monitor',
    category: 'electronics',
    sender_patterns: ['bestbuy.com'],
    keywords: ['order', 'shipped', 'delivered', 'ready for pickup', 'order confirmation'],
    required_keywords: [],
    exclude_phrases: ['deal of the day', 'top deals', 'just for you'],
    check_subject: true,
    check_body: true,
    check_snippet: true,
    instructions: `Extract order information from this Best Buy email.
- Order numbers are typically formatted like BBY01-xxxxxxxxxx
- Look for product names (electronics, appliances), quantities, and prices
- Extract order total, subtotal, tax
- Find tracking numbers and carrier
- Identify estimated delivery or pickup dates
Always set retailer_name to "Best Buy".
${STATUS_INSTRUCTION}`,
    expected_fields: ORDER_EXPECTED_FIELDS,
    priority: 10,
    is_order_template: true,
  },
  {
    id: 'target',
    name: 'Target',
    description: 'Order confirmations, shipping, and drive-up notifications from Target.',
    icon: 'Target',
    category: 'retail',
    sender_patterns: ['target.com'],
    keywords: ['order', 'shipped', 'delivered', 'ready for pickup', 'drive up'],
    required_keywords: [],
    exclude_phrases: ['circle offer', 'weekly ad', 'just for you'],
    check_subject: true,
    check_body: true,
    check_snippet: true,
    instructions: `Extract order information from this Target email.
- Order numbers are numeric
- Look for item names, quantities, and prices
- Extract order total, subtotal, tax
- Find tracking numbers and carrier
- Identify estimated delivery or pickup dates
Always set retailer_name to "Target".
${STATUS_INSTRUCTION}`,
    expected_fields: ORDER_EXPECTED_FIELDS,
    priority: 10,
    is_order_template: true,
  },
  {
    id: 'nike',
    name: 'Nike',
    description: 'Order confirmations and shipping updates from Nike.com and SNKRS.',
    icon: 'Footprints',
    category: 'fashion',
    sender_patterns: ['nike.com'],
    keywords: ['order', 'shipped', 'delivered', 'order confirmation', 'on its way'],
    required_keywords: [],
    exclude_phrases: ['just dropped', 'new release', 'member exclusive'],
    check_subject: true,
    check_body: true,
    check_snippet: true,
    instructions: `Extract order information from this Nike email.
- Order numbers are typically alphanumeric (e.g. C01234567890)
- Look for product names (shoes, apparel), sizes, quantities, and prices
- Extract order total, subtotal, tax
- Find tracking numbers and carrier (UPS, FedEx)
- Identify estimated delivery dates
Always set retailer_name to "Nike".
${STATUS_INSTRUCTION}`,
    expected_fields: ORDER_EXPECTED_FIELDS,
    priority: 10,
    is_order_template: true,
  },
  {
    id: 'apple',
    name: 'Apple',
    description: 'Order confirmations, shipping updates, and receipts from Apple Store.',
    icon: 'Smartphone',
    category: 'electronics',
    sender_patterns: ['apple.com'],
    keywords: ['order', 'shipped', 'delivered', 'your receipt', 'order confirmation'],
    required_keywords: [],
    exclude_phrases: ['apple news', 'apple music', 'app store receipt'],
    check_subject: true,
    check_body: true,
    check_snippet: true,
    instructions: `Extract order information from this Apple Store email.
- Order numbers typically start with W (e.g. W1234567890)
- Look for product names (iPhone, Mac, iPad, etc.), quantities, and prices
- Extract order total, subtotal, tax
- Find tracking numbers and carrier (UPS, FedEx)
- Identify estimated delivery dates
Always set retailer_name to "Apple".
${STATUS_INSTRUCTION}`,
    expected_fields: ORDER_EXPECTED_FIELDS,
    priority: 10,
    is_order_template: true,
  },
  {
    id: 'ebay',
    name: 'eBay',
    description: 'Order confirmations, shipping updates, and payment receipts from eBay.',
    icon: 'Gavel',
    category: 'retail',
    sender_patterns: ['ebay.com', 'ebay.co.uk'],
    keywords: ['order confirmed', 'shipped', 'delivered', 'you bought', 'payment received'],
    required_keywords: [],
    exclude_phrases: ['items you may like', 'price drop', 'selling tips'],
    check_subject: true,
    check_body: true,
    check_snippet: true,
    instructions: `Extract order information from this eBay email.
- Look for item titles, quantities, and prices
- eBay order/item numbers are numeric
- Extract total paid, shipping cost
- Find tracking numbers and carrier
- Identify estimated delivery dates
- Note the seller name if visible
Always set retailer_name to "eBay".
${STATUS_INSTRUCTION}`,
    expected_fields: ORDER_EXPECTED_FIELDS,
    priority: 10,
    is_order_template: true,
  },
  {
    id: 'costco',
    name: 'Costco',
    description: 'Order confirmations and shipping updates from Costco.com.',
    icon: 'Warehouse',
    category: 'wholesale',
    sender_patterns: ['costco.com'],
    keywords: ['order', 'shipped', 'delivered', 'order confirmation'],
    required_keywords: [],
    exclude_phrases: ['warehouse coupon', 'member savings'],
    check_subject: true,
    check_body: true,
    check_snippet: true,
    instructions: `Extract order information from this Costco email.
- Order numbers are numeric
- Look for item names, quantities, and prices
- Extract order total, subtotal, tax
- Find tracking numbers and carrier
- Identify estimated delivery dates
Always set retailer_name to "Costco".
${STATUS_INSTRUCTION}`,
    expected_fields: ORDER_EXPECTED_FIELDS,
    priority: 10,
    is_order_template: true,
  },
  {
    id: 'samsclub',
    name: "Sam's Club",
    description: "Order confirmations and shipping updates from Sam's Club.",
    icon: 'Warehouse',
    category: 'wholesale',
    sender_patterns: ['samsclub.com'],
    keywords: ['order', 'shipped', 'delivered', 'order confirmation'],
    required_keywords: [],
    exclude_phrases: ['instant savings', 'club picks'],
    check_subject: true,
    check_body: true,
    check_snippet: true,
    instructions: `Extract order information from this Sam's Club email.
- Order numbers are numeric
- Look for item names, quantities, and prices
- Extract order total, subtotal, tax
- Find tracking numbers and carrier
- Identify estimated delivery dates
Always set retailer_name to "Sam's Club".
${STATUS_INSTRUCTION}`,
    expected_fields: ORDER_EXPECTED_FIELDS,
    priority: 10,
    is_order_template: true,
  },
  {
    id: 'dtlr',
    name: 'DTLR',
    description: 'Order confirmations and shipping updates from DTLR.',
    icon: 'ShoppingBag',
    category: 'fashion',
    sender_patterns: ['dtlr.com'],
    keywords: ['order', 'shipped', 'delivered', 'order confirmation'],
    required_keywords: [],
    exclude_phrases: ['new arrivals', 'just dropped'],
    check_subject: true,
    check_body: true,
    check_snippet: true,
    instructions: `Extract order information from this DTLR email.
- Look for product names (sneakers, apparel), sizes, quantities, and prices
- Extract order total, subtotal, tax
- Find tracking numbers and carrier
- Identify estimated delivery dates
Always set retailer_name to "DTLR".
${STATUS_INSTRUCTION}`,
    expected_fields: ORDER_EXPECTED_FIELDS,
    priority: 10,
    is_order_template: true,
  },
  {
    id: 'topps',
    name: 'Topps',
    description: 'Order confirmations and shipping updates from Topps.',
    icon: 'Layers',
    category: 'collectibles',
    sender_patterns: ['topps.com'],
    keywords: ['order', 'shipped', 'delivered', 'order confirmation'],
    required_keywords: [],
    exclude_phrases: ['new release', 'pre-order now'],
    check_subject: true,
    check_body: true,
    check_snippet: true,
    instructions: `Extract order information from this Topps email.
- Look for product names (trading cards, boxes, packs), quantities, and prices
- Extract order total, subtotal, tax
- Find tracking numbers and carrier
- Identify estimated delivery dates
Always set retailer_name to "Topps".
${STATUS_INSTRUCTION}`,
    expected_fields: ORDER_EXPECTED_FIELDS,
    priority: 10,
    is_order_template: true,
  },
  {
    id: 'pokemoncenter',
    name: 'Pokemon Center',
    description: 'Order confirmations and shipping updates from Pokemon Center.',
    icon: 'Sparkles',
    category: 'collectibles',
    sender_patterns: ['pokemoncenter.com'],
    keywords: ['order', 'shipped', 'delivered', 'order confirmation'],
    required_keywords: [],
    exclude_phrases: ['new arrivals', 'just announced'],
    check_subject: true,
    check_body: true,
    check_snippet: true,
    instructions: `Extract order information from this Pokemon Center email.
- Look for product names (Pokemon cards, plush, figures), quantities, and prices
- Extract order total, subtotal, tax
- Find tracking numbers and carrier
- Identify estimated delivery dates
Always set retailer_name to "Pokemon Center".
${STATUS_INSTRUCTION}`,
    expected_fields: ORDER_EXPECTED_FIELDS,
    priority: 10,
    is_order_template: true,
  },
  {
    id: 'shopify',
    name: 'Shopify Store',
    description: 'Generic extractor for any Shopify-powered store. Uses AI to detect Shopify email templates.',
    icon: 'Store',
    category: 'generic',
    sender_patterns: [],
    keywords: ['order confirmed', 'shipping confirmation', 'your order', 'order #'],
    required_keywords: [],
    exclude_phrases: [],
    check_subject: true,
    check_body: true,
    check_snippet: true,
    instructions: `Extract order information from this email. This may be from any Shopify-powered online store.
- Look for order numbers (often formatted as #1001, #12345, etc.)
- Extract item names, quantities, and prices
- Extract order total, subtotal, tax, shipping cost
- Find tracking numbers and carrier
- Identify estimated delivery dates
- Set retailer_name to the store/company name visible in the email
${STATUS_INSTRUCTION}`,
    expected_fields: ORDER_EXPECTED_FIELDS,
    priority: 5, // Lower priority — generic fallback
    is_order_template: true,
  },
  {
    id: 'homedepot',
    name: 'Home Depot',
    description: 'Order confirmations, shipping updates, and pickup notifications from Home Depot.',
    icon: 'Hammer',
    category: 'retail',
    sender_patterns: ['homedepot.com'],
    keywords: ['order', 'shipped', 'delivered', 'ready for pickup', 'order confirmation'],
    required_keywords: [],
    exclude_phrases: ['pro xtra', 'special buy', 'savings center'],
    check_subject: true,
    check_body: true,
    check_snippet: true,
    instructions: `Extract order information from this Home Depot email.
- Order numbers are typically formatted like WG12345678 or H1234-56789
- Look for item names (tools, building materials, hardware), quantities, and prices
- Extract order total, subtotal, tax
- Find tracking numbers and carrier (UPS, FedEx, USPS)
- Identify estimated delivery or pickup dates
- Note if this is a delivery or store pickup order
Always set retailer_name to "Home Depot".
${STATUS_INSTRUCTION}`,
    expected_fields: ORDER_EXPECTED_FIELDS,
    priority: 10,
    is_order_template: true,
  },
  {
    id: 'staples',
    name: 'Staples',
    description: 'Order confirmations and shipping updates from Staples.',
    icon: 'Paperclip',
    category: 'retail',
    sender_patterns: ['staples.com'],
    keywords: ['order', 'shipped', 'delivered', 'order confirmation'],
    required_keywords: [],
    exclude_phrases: ['weekly deals', 'clearance', 'easy rebates'],
    check_subject: true,
    check_body: true,
    check_snippet: true,
    instructions: `Extract order information from this Staples email.
- Order numbers are numeric
- Look for item names (office supplies, electronics, furniture), quantities, and prices
- Extract order total, subtotal, tax
- Find tracking numbers and carrier (UPS, FedEx, USPS)
- Identify estimated delivery dates
Always set retailer_name to "Staples".
${STATUS_INSTRUCTION}`,
    expected_fields: ORDER_EXPECTED_FIELDS,
    priority: 10,
    is_order_template: true,
  },
];

export function getTemplate(id: string): RetailerTemplate | undefined {
  return RETAILER_TEMPLATES.find(t => t.id === id);
}

export function getOrderTemplates(): RetailerTemplate[] {
  return RETAILER_TEMPLATES.filter(t => t.is_order_template);
}
