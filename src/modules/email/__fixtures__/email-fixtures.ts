import type { EmailInput } from '../flag-engine.js';

export function makeEmail(overrides: Partial<EmailInput> = {}): EmailInput {
  return {
    subject: '',
    snippet: '',
    body: '',
    from_email: '',
    has_attachments: false,
    ...overrides,
  };
}

// ── Per-Retailer Email Factories ────────────────────────────────────────────

export function amazonEmail(type: string): EmailInput {
  const base = { from_email: 'shipment-tracking@amazon.com' };
  switch (type) {
    case 'order':
      return makeEmail({ ...base, subject: 'Your Amazon.com order of LEGO Speed Champions...', snippet: 'Order #112-3456789-0123456 placed' });
    case 'shipped':
      return makeEmail({ ...base, subject: 'Your Amazon order has shipped', snippet: 'Your package has shipped and is on its way' });
    case 'delivered':
      return makeEmail({ ...base, subject: 'Your Amazon package was delivered', snippet: 'Your package was delivered today at 2:15 PM' });
    case 'delivery_estimate':
      return makeEmail({ ...base, from_email: 'no-reply@amazon.com', subject: 'Delivery Estimate Update', snippet: 'We have an updated delivery estimate for your Amazon order' });
    case 'out_for_delivery':
      return makeEmail({ ...base, subject: 'Your package is out for delivery', snippet: 'Your Amazon order is out for delivery and arriving today' });
    case 'order_update':
      return makeEmail({ ...base, from_email: 'no-reply@amazon.com', subject: 'Order update for your Amazon order', snippet: 'Order #114-7099381-2375430' });
    case 'your_package':
      return makeEmail({ ...base, subject: 'Your package will arrive tomorrow', snippet: 'Your package from Amazon is on its way' });
    case 'order_hash':
      return makeEmail({ ...base, from_email: 'auto-confirm@amazon.com', subject: 'Your Amazon.com order #112-3456789-0123456', snippet: 'Order placed, estimated delivery March 25' });
    case 'marketing_review':
      return makeEmail({ ...base, from_email: 'store-news@amazon.com', subject: 'Your review helps others', snippet: 'Rate your experience with your recent purchase' });
    case 'marketing_recommended':
      return makeEmail({ ...base, from_email: 'store-news@amazon.com', subject: 'Recommended for you', snippet: 'Based on your purchases, recommended for you' });
    case 'amazon_co_uk':
      return makeEmail({ from_email: 'order-update@amazon.co.uk', subject: 'Your Amazon.co.uk order has shipped', snippet: 'Your order is on its way' });
    case 'amazon_ca':
      return makeEmail({ from_email: 'order-update@amazon.ca', subject: 'Your Amazon.ca order confirmation', snippet: 'Your order has been placed' });
    default:
      throw new Error(`Unknown Amazon email type: ${type}`);
  }
}

export function walmartEmail(type: string): EmailInput {
  const base = { from_email: 'help@walmart.com' };
  switch (type) {
    case 'order':
      return makeEmail({ ...base, subject: 'Your Walmart.com order confirmation', snippet: 'Order #2000144-96704833 has been placed' });
    case 'shipped':
      return makeEmail({ ...base, subject: 'Your Walmart order has shipped', snippet: 'Your order is on the way' });
    case 'delivered':
      return makeEmail({ ...base, subject: 'Your Walmart order was delivered', snippet: 'Your order was delivered today' });
    case 'pickup':
      return makeEmail({ ...base, subject: 'Your order is ready for pickup', snippet: 'Pick up your Walmart order today' });
    case 'marketing_save':
      return makeEmail({ ...base, from_email: 'deals@walmart.com', subject: 'Save on these great items', snippet: 'Save on your favorite products' });
    case 'marketing_rollback':
      return makeEmail({ ...base, from_email: 'deals@walmart.com', subject: 'Rollback prices on hot items', snippet: 'Rollback deals this week' });
    case 'marketing_weekly':
      return makeEmail({ ...base, from_email: 'deals@walmart.com', subject: 'Your weekly ad is here', snippet: 'Check out this weekly ad' });
    default:
      throw new Error(`Unknown Walmart email type: ${type}`);
  }
}

export function bestbuyEmail(type: string): EmailInput {
  const base = { from_email: 'orders@bestbuy.com' };
  switch (type) {
    case 'order':
      return makeEmail({ ...base, subject: 'Best Buy order confirmation', snippet: 'Order #BBY01-1234567890' });
    case 'shipped':
      return makeEmail({ ...base, subject: 'Your Best Buy order has shipped', snippet: 'Tracking info available' });
    case 'delivered':
      return makeEmail({ ...base, subject: 'Your Best Buy order was delivered', snippet: 'Your order was delivered' });
    case 'pickup':
      return makeEmail({ ...base, subject: 'Your order is ready for pickup at Best Buy', snippet: 'Ready for pickup' });
    case 'marketing_deal':
      return makeEmail({ ...base, from_email: 'deals@bestbuy.com', subject: 'Deal of the day: 50% off', snippet: 'Deal of the day on electronics' });
    case 'marketing_top':
      return makeEmail({ ...base, from_email: 'deals@bestbuy.com', subject: 'Top deals this week', snippet: 'Top deals on TVs and laptops' });
    case 'marketing_just':
      return makeEmail({ ...base, from_email: 'deals@bestbuy.com', subject: 'Picks just for you', snippet: 'Products just for you based on your history' });
    default:
      throw new Error(`Unknown Best Buy email type: ${type}`);
  }
}

export function targetEmail(type: string): EmailInput {
  const base = { from_email: 'orders@target.com' };
  switch (type) {
    case 'order':
      return makeEmail({ ...base, subject: 'Your Target order is confirmed', snippet: 'Order placed successfully' });
    case 'shipped':
      return makeEmail({ ...base, subject: 'Your Target order has shipped', snippet: 'Your order is on the way' });
    case 'delivered':
      return makeEmail({ ...base, subject: 'Your Target order was delivered', snippet: 'Delivered today' });
    case 'drive_up':
      return makeEmail({ ...base, subject: 'Your drive up order is ready', snippet: 'Drive up to pick up your order' });
    case 'marketing_circle':
      return makeEmail({ ...base, from_email: 'deals@target.com', subject: 'New circle offer for you', snippet: 'Circle offer: 20% off' });
    case 'marketing_weekly':
      return makeEmail({ ...base, from_email: 'deals@target.com', subject: 'Your weekly ad is here', snippet: 'Weekly ad deals' });
    case 'marketing_just':
      return makeEmail({ ...base, from_email: 'deals@target.com', subject: 'Items just for you', snippet: 'Products just for you' });
    default:
      throw new Error(`Unknown Target email type: ${type}`);
  }
}

export function nikeEmail(type: string): EmailInput {
  const base = { from_email: 'orders@nike.com' };
  switch (type) {
    case 'order':
      return makeEmail({ ...base, subject: 'Nike order confirmation', snippet: 'Order #C01234567890' });
    case 'shipped':
      return makeEmail({ ...base, subject: 'Your Nike order is on its way', snippet: 'Tracking details for your order' });
    case 'delivered':
      return makeEmail({ ...base, subject: 'Your Nike order was delivered', snippet: 'Your order was delivered' });
    case 'marketing_dropped':
      return makeEmail({ ...base, from_email: 'news@nike.com', subject: 'Just dropped: new Air Max', snippet: 'Just dropped this week' });
    case 'marketing_release':
      return makeEmail({ ...base, from_email: 'news@nike.com', subject: 'New release: Jordan 4 Retro', snippet: 'New release available now' });
    case 'marketing_member':
      return makeEmail({ ...base, from_email: 'news@nike.com', subject: 'Member exclusive access', snippet: 'Shop member exclusive deals' });
    default:
      throw new Error(`Unknown Nike email type: ${type}`);
  }
}

export function appleEmail(type: string): EmailInput {
  const base = { from_email: 'noreply@apple.com' };
  switch (type) {
    case 'order':
      return makeEmail({ ...base, subject: 'Your Apple Store order confirmation', snippet: 'Order #W1234567890' });
    case 'shipped':
      return makeEmail({ ...base, subject: 'Your Apple order has shipped', snippet: 'Tracking info for your order' });
    case 'delivered':
      return makeEmail({ ...base, subject: 'Your Apple order was delivered', snippet: 'Your order was delivered today' });
    case 'receipt':
      return makeEmail({ ...base, subject: 'Your receipt from Apple', snippet: 'Thank you for your purchase' });
    case 'marketing_news':
      return makeEmail({ ...base, from_email: 'news@apple.com', subject: 'Apple News+ special offer', snippet: 'Apple News exclusive' });
    case 'marketing_music':
      return makeEmail({ ...base, from_email: 'news@apple.com', subject: 'Apple Music new releases', snippet: 'Listen to Apple Music hits' });
    case 'marketing_appstore':
      return makeEmail({ ...base, from_email: 'no_reply@email.apple.com', subject: 'Your App Store receipt', snippet: 'App Store receipt for $4.99 subscription' });
    default:
      throw new Error(`Unknown Apple email type: ${type}`);
  }
}

export function ebayEmail(type: string): EmailInput {
  const base = { from_email: 'ebay@ebay.com' };
  switch (type) {
    case 'order':
      return makeEmail({ ...base, subject: 'Your order confirmed on eBay', snippet: 'Order confirmed for Pokemon cards' });
    case 'shipped':
      return makeEmail({ ...base, subject: 'Your eBay item has shipped', snippet: 'Tracking number available' });
    case 'delivered':
      return makeEmail({ ...base, subject: 'Your eBay item was delivered', snippet: 'Your item was delivered' });
    case 'bought':
      return makeEmail({ ...base, subject: 'You bought a new item', snippet: 'You bought: Vintage Baseball Cards Lot' });
    case 'payment':
      return makeEmail({ ...base, subject: 'Payment received for your item', snippet: 'Payment received confirmation' });
    case 'marketing_like':
      return makeEmail({ ...base, from_email: 'deals@ebay.com', subject: 'Items you may like', snippet: 'Items you may like based on your search' });
    case 'marketing_price':
      return makeEmail({ ...base, from_email: 'deals@ebay.com', subject: 'Price drop on watched item', snippet: 'Price drop alert' });
    case 'marketing_selling':
      return makeEmail({ ...base, from_email: 'deals@ebay.com', subject: 'Selling tips for your listings', snippet: 'Selling tips to boost your sales' });
    default:
      throw new Error(`Unknown eBay email type: ${type}`);
  }
}

export function costcoEmail(type: string): EmailInput {
  const base = { from_email: 'orders@costco.com' };
  switch (type) {
    case 'order':
      return makeEmail({ ...base, subject: 'Costco.com order confirmation', snippet: 'Your order has been placed' });
    case 'shipped':
      return makeEmail({ ...base, subject: 'Your Costco order has shipped', snippet: 'Shipped via FedEx' });
    case 'delivered':
      return makeEmail({ ...base, subject: 'Your Costco order was delivered', snippet: 'Delivered today' });
    case 'marketing_coupon':
      return makeEmail({ ...base, from_email: 'deals@costco.com', subject: 'New warehouse coupon book', snippet: 'Warehouse coupon savings inside' });
    case 'marketing_savings':
      return makeEmail({ ...base, from_email: 'deals@costco.com', subject: 'Exclusive member savings this month', snippet: 'Member savings on electronics' });
    default:
      throw new Error(`Unknown Costco email type: ${type}`);
  }
}

export function samsclubEmail(type: string): EmailInput {
  const base = { from_email: 'orders@samsclub.com' };
  switch (type) {
    case 'order':
      return makeEmail({ ...base, subject: "Sam's Club order confirmation", snippet: 'Your order has been placed' });
    case 'shipped':
      return makeEmail({ ...base, subject: "Your Sam's Club order has shipped", snippet: 'Shipped via UPS' });
    case 'delivered':
      return makeEmail({ ...base, subject: "Your Sam's Club order was delivered", snippet: 'Delivered today' });
    case 'marketing_savings':
      return makeEmail({ ...base, from_email: 'deals@samsclub.com', subject: 'Instant savings this weekend', snippet: 'Instant savings on bulk items' });
    case 'marketing_picks':
      return makeEmail({ ...base, from_email: 'deals@samsclub.com', subject: 'Top club picks for you', snippet: 'Club picks for the week' });
    default:
      throw new Error(`Unknown Sam's Club email type: ${type}`);
  }
}

export function dtlrEmail(type: string): EmailInput {
  const base = { from_email: 'orders@dtlr.com' };
  switch (type) {
    case 'order':
      return makeEmail({ ...base, subject: 'DTLR order confirmation', snippet: 'Your order has been placed' });
    case 'shipped':
      return makeEmail({ ...base, subject: 'Your DTLR order has shipped', snippet: 'Tracking info available' });
    case 'delivered':
      return makeEmail({ ...base, subject: 'Your DTLR order was delivered', snippet: 'Delivered to your address' });
    case 'marketing_arrivals':
      return makeEmail({ ...base, from_email: 'news@dtlr.com', subject: 'New arrivals at DTLR', snippet: 'New arrivals in sneakers' });
    case 'marketing_dropped':
      return makeEmail({ ...base, from_email: 'news@dtlr.com', subject: 'Just dropped: Nike Dunk Low', snippet: 'Just dropped this week' });
    default:
      throw new Error(`Unknown DTLR email type: ${type}`);
  }
}

export function toppsEmail(type: string): EmailInput {
  const base = { from_email: 'orders@topps.com' };
  switch (type) {
    case 'order':
      return makeEmail({ ...base, subject: 'Topps order confirmation', snippet: 'Your order for trading cards' });
    case 'shipped':
      return makeEmail({ ...base, subject: 'Your Topps order has shipped', snippet: 'Shipped via USPS' });
    case 'delivered':
      return makeEmail({ ...base, subject: 'Your Topps order was delivered', snippet: 'Delivered today' });
    case 'marketing_release':
      return makeEmail({ ...base, from_email: 'news@topps.com', subject: '2026 Topps Series 1 new release', snippet: 'New release available for pre-order' });
    case 'marketing_preorder':
      return makeEmail({ ...base, from_email: 'news@topps.com', subject: 'Pre-order now: Chrome Baseball', snippet: 'Pre-order now before they sell out' });
    default:
      throw new Error(`Unknown Topps email type: ${type}`);
  }
}

export function pokemoncenterEmail(type: string): EmailInput {
  const base = { from_email: 'orders@pokemoncenter.com' };
  switch (type) {
    case 'order':
      return makeEmail({ ...base, subject: 'Pokemon Center order confirmation', snippet: 'Your order has been placed' });
    case 'shipped':
      return makeEmail({ ...base, subject: 'Your Pokemon Center order has shipped', snippet: 'Shipped via FedEx' });
    case 'delivered':
      return makeEmail({ ...base, subject: 'Your Pokemon Center order was delivered', snippet: 'Delivered today' });
    case 'marketing_arrivals':
      return makeEmail({ ...base, from_email: 'news@pokemoncenter.com', subject: 'New arrivals at Pokemon Center', snippet: 'New arrivals: plush and figures' });
    case 'marketing_announced':
      return makeEmail({ ...base, from_email: 'news@pokemoncenter.com', subject: 'Just announced: Scarlet & Violet ETBs', snippet: 'Just announced for this spring' });
    default:
      throw new Error(`Unknown Pokemon Center email type: ${type}`);
  }
}

export function shopifyEmail(type: string): EmailInput {
  switch (type) {
    case 'order_confirmed':
      return makeEmail({ from_email: 'orders@mycoolstore.com', subject: 'Order confirmed - #1234', snippet: 'Thank you for your order' });
    case 'shipping':
      return makeEmail({ from_email: 'orders@boutique-shop.com', subject: 'Shipping confirmation for order #5678', snippet: 'Your order has been shipped' });
    case 'your_order':
      return makeEmail({ from_email: 'noreply@indie-brand.com', subject: 'Your order from Indie Brand', snippet: 'Your order #9012 has been placed' });
    case 'order_hash':
      return makeEmail({ from_email: 'hello@artisan-goods.com', subject: 'Order #3456 is on the way', snippet: 'Order #3456 shipped' });
    case 'no_match':
      return makeEmail({ from_email: 'newsletter@somestore.com', subject: 'New arrivals this week', snippet: 'Check out our latest products' });
    default:
      throw new Error(`Unknown Shopify email type: ${type}`);
  }
}

export function homedepotEmail(type: string): EmailInput {
  const base = { from_email: 'orders@homedepot.com' };
  switch (type) {
    case 'order':
      return makeEmail({ ...base, subject: 'Home Depot order confirmation', snippet: 'Order #WG12345678' });
    case 'shipped':
      return makeEmail({ ...base, subject: 'Your Home Depot order has shipped', snippet: 'Shipped via UPS' });
    case 'delivered':
      return makeEmail({ ...base, subject: 'Your Home Depot order was delivered', snippet: 'Delivered today' });
    case 'pickup':
      return makeEmail({ ...base, subject: 'Your order is ready for pickup', snippet: 'Ready for pickup at your local Home Depot' });
    case 'marketing_pro':
      return makeEmail({ ...base, from_email: 'deals@homedepot.com', subject: 'Pro Xtra members: exclusive deals', snippet: 'Pro Xtra member savings' });
    case 'marketing_special':
      return makeEmail({ ...base, from_email: 'deals@homedepot.com', subject: 'Special buy of the day', snippet: 'Special buy on power tools' });
    case 'marketing_savings':
      return makeEmail({ ...base, from_email: 'deals@homedepot.com', subject: 'Visit our savings center', snippet: 'Savings center deals this week' });
    default:
      throw new Error(`Unknown Home Depot email type: ${type}`);
  }
}

export function staplesEmail(type: string): EmailInput {
  const base = { from_email: 'orders@staples.com' };
  switch (type) {
    case 'order':
      return makeEmail({ ...base, subject: 'Staples order confirmation', snippet: 'Your order has been placed' });
    case 'shipped':
      return makeEmail({ ...base, subject: 'Your Staples order has shipped', snippet: 'Shipped via USPS' });
    case 'delivered':
      return makeEmail({ ...base, subject: 'Your Staples order was delivered', snippet: 'Delivered to your address' });
    case 'marketing_deals':
      return makeEmail({ ...base, from_email: 'deals@staples.com', subject: 'Weekly deals on office supplies', snippet: 'Weekly deals on paper and ink' });
    case 'marketing_clearance':
      return makeEmail({ ...base, from_email: 'deals@staples.com', subject: 'Clearance event: up to 70% off', snippet: 'Clearance on furniture' });
    case 'marketing_rebates':
      return makeEmail({ ...base, from_email: 'deals@staples.com', subject: 'Easy rebates on your purchases', snippet: 'Easy rebates available now' });
    default:
      throw new Error(`Unknown Staples email type: ${type}`);
  }
}
