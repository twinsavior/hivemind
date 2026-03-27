// ── Profitability Calculator ─────────────────────────────────────────────────
// Calculate exact profit for arbitrage purchases across Amazon, Walmart, and eBay.
//
// Amazon: Uses SP-API Product Fees v0 for exact fee estimates per ASIN.
// Walmart: Uses category-based referral fee table + WFS weight-based fees.
// eBay: Uses category-based final value fee table.
//
// All marketplace fee tables are maintained separately and can be updated
// when fee changes are announced (e.g., Q4 surcharges).

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProfitabilityInput {
  salePrice: number;
  costOfGoods: number;
  marketplace: 'amazon' | 'walmart' | 'ebay';
  /** Amazon ASIN — required for exact Amazon fee lookup */
  asin?: string;
  /** Walmart/eBay category for fee table lookup */
  category?: string;
  /** Item weight in ounces (used for Walmart WFS and eBay shipping estimate) */
  weightOz?: number;
  /** Prep center cost per unit */
  prepCost?: number;
  /** Shipping cost to FBA/WFS per unit */
  shippingToFba?: number;
  /** Number of units */
  quantity?: number;
  /** Whether Amazon fulfills (FBA) or seller fulfills (FBM) */
  isAmazonFulfilled?: boolean;
}

export interface ProfitabilityResult {
  salePrice: number;
  costOfGoods: number;
  marketplace: string;
  /** Whether fees came from live API or estimated from fee table */
  feeSource: 'api' | 'fee_table';
  fees: {
    referralFee: number;
    fulfillmentFee: number;
    closingFee: number;
    otherFees: number;
    totalMarketplaceFees: number;
  };
  prepCost: number;
  shippingToFba: number;
  totalCost: number;
  profit: number;
  roi: number;
  margin: number;
  breakEvenPrice: number;
  quantity: number;
  /** Raw fee breakdown from Amazon API (only when feeSource is 'api') */
  apiBreakdown?: Record<string, number>;
}

// ── Amazon Fee Estimation (via SP-API) ──────────────────────────────────────

/**
 * Calculate profitability using Amazon's exact fee API.
 * Requires a connected Amazon account and a valid ASIN.
 * Returns null if the API call fails — caller should fall back to fee table.
 */
export async function calculateAmazonProfitFromAPI(
  input: ProfitabilityInput,
  amazonClient: { getFeesEstimateForASIN: (asin: string, price: number, isFba: boolean) => Promise<any> },
): Promise<ProfitabilityResult | null> {
  if (!input.asin) return null;

  try {
    const estimate = await amazonClient.getFeesEstimateForASIN(
      input.asin,
      input.salePrice,
      input.isAmazonFulfilled ?? true,
    );

    const quantity = input.quantity || 1;
    const prepCost = input.prepCost || 0;
    const shippingToFba = input.shippingToFba || 0;

    const totalMarketplaceFees = estimate.totalFees;
    const totalCost = input.costOfGoods + totalMarketplaceFees + prepCost + shippingToFba;
    const profit = input.salePrice - totalCost;
    const roi = input.costOfGoods > 0 ? (profit / input.costOfGoods) * 100 : 0;
    const margin = input.salePrice > 0 ? (profit / input.salePrice) * 100 : 0;

    return {
      salePrice: input.salePrice,
      costOfGoods: input.costOfGoods,
      marketplace: 'amazon',
      feeSource: 'api',
      fees: {
        referralFee: round(estimate.feeBreakdown.referralFee),
        fulfillmentFee: round(estimate.feeBreakdown.fulfillmentFee),
        closingFee: round(estimate.feeBreakdown.variableClosingFee),
        otherFees: round(
          estimate.totalFees
          - estimate.feeBreakdown.referralFee
          - estimate.feeBreakdown.fulfillmentFee
          - estimate.feeBreakdown.variableClosingFee,
        ),
        totalMarketplaceFees: round(totalMarketplaceFees),
      },
      prepCost,
      shippingToFba,
      totalCost: round(totalCost),
      profit: round(profit),
      roi: round(roi, 1),
      margin: round(margin, 1),
      breakEvenPrice: round(input.costOfGoods + totalMarketplaceFees + prepCost + shippingToFba),
      quantity,
      apiBreakdown: estimate.allFees,
    };
  } catch (err) {
    console.warn('[Profitability] Amazon API fee lookup failed, will use fee table:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Walmart Fee Tables ──────────────────────────────────────────────────────
// Source: https://sellerhelp.walmart.com/seller/s/guide?article=000006656
// Updated: 2026-03 (check quarterly for changes)

const WALMART_REFERRAL_FEES: Record<string, number> = {
  'default': 0.15,
  'apparel': 0.15,
  'automotive': 0.12,
  'baby': 0.08,
  'beauty': 0.15,
  'books': 0.15,
  'camera_photo': 0.08,
  'cell_phones': 0.08,
  'clothing': 0.15,
  'computers': 0.08,
  'consumer_electronics': 0.08,
  'electronics_accessories': 0.15,
  'furniture': 0.15,
  'grocery': 0.08,
  'health': 0.08,
  'home': 0.15,
  'industrial': 0.12,
  'jewelry': 0.20,
  'kitchen': 0.15,
  'luggage': 0.15,
  'music': 0.15,
  'musical_instruments': 0.15,
  'office': 0.15,
  'outdoors': 0.15,
  'personal_computers': 0.06,
  'pet_supplies': 0.15,
  'shoes': 0.15,
  'software': 0.15,
  'sports': 0.15,
  'tires': 0.10,
  'tools': 0.15,
  'toys': 0.15,
  'video_games': 0.15,
  'watches': 0.16,
};

// WFS fulfillment fee by weight (approximate, as of 2025-2026)
// Walmart uses dimensional weight or actual weight, whichever is greater
const WALMART_WFS_FEES: Array<{ maxWeightLbs: number; fee: number }> = [
  { maxWeightLbs: 0.5, fee: 3.45 },
  { maxWeightLbs: 1, fee: 3.95 },
  { maxWeightLbs: 2, fee: 4.45 },
  { maxWeightLbs: 3, fee: 4.95 },
  { maxWeightLbs: 5, fee: 5.45 },
  { maxWeightLbs: 10, fee: 6.45 },
  { maxWeightLbs: 15, fee: 7.95 },
  { maxWeightLbs: 20, fee: 9.45 },
  { maxWeightLbs: 30, fee: 11.95 },
  { maxWeightLbs: 50, fee: 15.95 },
  { maxWeightLbs: 70, fee: 19.95 },
  // Oversize: add $0.40/lb over 70 lbs
];

// ── eBay Fee Tables ─────────────────────────────────────────────────────────
// Source: https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees
// Final value fee varies by category and seller store subscription level

// eBay Final Value Fee schedule (2025-2026)
// Source: https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822
// Fees are tiered: different rates above/below certain thresholds.
// Per-order fee: $0.30 for items ≤$10, $0.40 for items >$10

interface EbayFeeTier {
  /** Rate for amounts up to the first threshold */
  rate: number;
  /** First threshold amount */
  threshold?: number;
  /** Rate for amounts above the first threshold */
  overRate?: number;
  /** Second threshold (for 3-tier categories like Watches) */
  threshold2?: number;
  /** Rate for amounts above the second threshold */
  overRate2?: number;
}

const EBAY_FINAL_VALUE_FEES: Record<string, EbayFeeTier> = {
  // Most categories: 13.6% up to $7,500, 2.35% over
  'default':                       { rate: 0.136, threshold: 7500, overRate: 0.0235 },
  'antiques':                      { rate: 0.136, threshold: 7500, overRate: 0.0235 },
  'art':                           { rate: 0.136, threshold: 7500, overRate: 0.0235 },
  'baby':                          { rate: 0.136, threshold: 7500, overRate: 0.0235 },
  'business_industrial':           { rate: 0.136, threshold: 7500, overRate: 0.0235 },
  'cameras_photo':                 { rate: 0.136, threshold: 7500, overRate: 0.0235 },
  'cell_phones':                   { rate: 0.136, threshold: 7500, overRate: 0.0235 },
  'clothing_shoes_accessories':    { rate: 0.136, threshold: 7500, overRate: 0.0235 },
  'computers_tablets':             { rate: 0.136, threshold: 7500, overRate: 0.0235 },
  'consumer_electronics':          { rate: 0.136, threshold: 7500, overRate: 0.0235 },
  'crafts':                        { rate: 0.136, threshold: 7500, overRate: 0.0235 },
  'dolls_bears':                   { rate: 0.136, threshold: 7500, overRate: 0.0235 },
  'health_beauty':                 { rate: 0.136, threshold: 7500, overRate: 0.0235 },
  'home_garden':                   { rate: 0.136, threshold: 7500, overRate: 0.0235 },
  'pet_supplies':                  { rate: 0.136, threshold: 7500, overRate: 0.0235 },
  'pottery_glass':                 { rate: 0.136, threshold: 7500, overRate: 0.0235 },
  'sporting_goods':                { rate: 0.136, threshold: 7500, overRate: 0.0235 },
  'toys_hobbies':                  { rate: 0.136, threshold: 7500, overRate: 0.0235 },
  'video_games_consoles':          { rate: 0.136, threshold: 7500, overRate: 0.0235 },

  // Books, Movies, Music: 15.3% up to $7,500, 2.35% over
  'books_magazines':               { rate: 0.153, threshold: 7500, overRate: 0.0235 },
  'movies_tv':                     { rate: 0.153, threshold: 7500, overRate: 0.0235 },
  'music':                         { rate: 0.153, threshold: 7500, overRate: 0.0235 },

  // Coins & Paper Money (non-bullion): 13.25% up to $7,500, 2.35% over
  'coins_paper_money':             { rate: 0.1325, threshold: 7500, overRate: 0.0235 },

  // Bullion: 13.6% up to $7,500, 7% over
  'bullion':                       { rate: 0.136, threshold: 7500, overRate: 0.07 },

  // Women's Bags & Handbags: 15% up to $2,000, 9% over
  'womens_bags_handbags':          { rate: 0.15, threshold: 2000, overRate: 0.09 },

  // Collectible Trading Cards: 13.25% up to $7,500, 2.35% over
  'trading_cards':                 { rate: 0.1325, threshold: 7500, overRate: 0.0235 },
  'comics':                        { rate: 0.1325, threshold: 7500, overRate: 0.0235 },

  // Jewelry: 15% up to $5,000, 9% over
  'jewelry':                       { rate: 0.15, threshold: 5000, overRate: 0.09 },

  // Watches: 15% up to $1,000, 6.5% $1K-$7.5K, 3% over $7.5K
  'watches':                       { rate: 0.15, threshold: 1000, overRate: 0.065, threshold2: 7500, overRate2: 0.03 },

  // Guitars & Basses: 6.7% up to $7,500, 2.35% over
  'guitars_basses':                { rate: 0.067, threshold: 7500, overRate: 0.0235 },

  // Musical Instruments (general): 6.7% up to $7,500, 2.35% over
  'musical_instruments':           { rate: 0.067, threshold: 7500, overRate: 0.0235 },

  // Heavy Equipment: 3% up to $15,000, 0.5% over
  'heavy_equipment':               { rate: 0.03, threshold: 15000, overRate: 0.005 },

  // Athletic Shoes ($150+): 8% flat (no per-order fee)
  'athletic_shoes_150_plus':       { rate: 0.08 },

  // NFTs: 5% flat
  'nft':                           { rate: 0.05 },
};

// ── Fee Table Calculation (fallback when API unavailable) ───────────────────

export function calculateFromFeeTable(input: ProfitabilityInput): ProfitabilityResult {
  const marketplace = input.marketplace || 'amazon';
  const category = (input.category || 'default').toLowerCase().replace(/\s+/g, '_');
  const quantity = input.quantity || 1;
  const prepCost = input.prepCost || 0;
  const shippingToFba = input.shippingToFba || 0;
  const weightLbs = (input.weightOz || 16) / 16; // default 1 lb if not specified

  let referralFee = 0;
  let fulfillmentFee = 0;
  let closingFee = 0;
  let otherFees = 0;

  if (marketplace === 'amazon') {
    // Amazon referral fee (simplified — use API for exact)
    const referralRate = 0.15; // Most categories are 15%
    referralFee = input.salePrice * referralRate;
    // Amazon FBA fee estimate (use API for exact)
    if (input.isAmazonFulfilled !== false) {
      if (weightLbs <= 0.25) fulfillmentFee = 3.22;
      else if (weightLbs <= 0.5) fulfillmentFee = 3.40;
      else if (weightLbs <= 0.75) fulfillmentFee = 3.58;
      else if (weightLbs <= 1) fulfillmentFee = 3.77;
      else if (weightLbs <= 1.5) fulfillmentFee = 4.75;
      else if (weightLbs <= 2) fulfillmentFee = 5.19;
      else if (weightLbs <= 2.5) fulfillmentFee = 5.68;
      else if (weightLbs <= 3) fulfillmentFee = 6.10;
      else fulfillmentFee = 6.10 + Math.ceil((weightLbs - 3) / 0.5) * 0.38;
    }
  } else if (marketplace === 'walmart') {
    const referralRate = WALMART_REFERRAL_FEES[category] ?? WALMART_REFERRAL_FEES['default']!;
    referralFee = input.salePrice * referralRate;
    // WFS fee
    const wfsTier = WALMART_WFS_FEES.find(t => weightLbs <= t.maxWeightLbs);
    fulfillmentFee = wfsTier?.fee || (19.95 + Math.max(0, weightLbs - 70) * 0.40);
  } else if (marketplace === 'ebay') {
    const tier = EBAY_FINAL_VALUE_FEES[category] ?? EBAY_FINAL_VALUE_FEES['default']!;

    // Calculate tiered final value fee
    if (tier.threshold2 && tier.overRate2) {
      // 3-tier category (e.g., Watches)
      if (input.salePrice <= tier.threshold!) {
        referralFee = input.salePrice * tier.rate;
      } else if (input.salePrice <= tier.threshold2) {
        referralFee = tier.threshold! * tier.rate + (input.salePrice - tier.threshold!) * (tier.overRate || 0);
      } else {
        referralFee = tier.threshold! * tier.rate
          + (tier.threshold2 - tier.threshold!) * (tier.overRate || 0)
          + (input.salePrice - tier.threshold2) * tier.overRate2;
      }
    } else if (tier.threshold && tier.overRate != null) {
      // 2-tier category (most categories)
      if (input.salePrice <= tier.threshold) {
        referralFee = input.salePrice * tier.rate;
      } else {
        referralFee = tier.threshold * tier.rate + (input.salePrice - tier.threshold) * tier.overRate;
      }
    } else {
      // Flat rate (e.g., NFT, Athletic Shoes $150+)
      referralFee = input.salePrice * tier.rate;
    }

    // Per-order fee: $0.30 for items ≤$10, $0.40 for items >$10
    // Athletic shoes $150+ and some categories have no per-order fee
    if (category !== 'athletic_shoes_150_plus' && category !== 'nft') {
      otherFees = input.salePrice <= 10 ? 0.30 : 0.40;
    }

    // eBay doesn't have fulfillment fees (seller ships)
    fulfillmentFee = 0;
  }

  const totalMarketplaceFees = referralFee + fulfillmentFee + closingFee + otherFees;
  const totalCost = input.costOfGoods + totalMarketplaceFees + prepCost + shippingToFba;
  const profit = input.salePrice - totalCost;
  const roi = input.costOfGoods > 0 ? (profit / input.costOfGoods) * 100 : 0;
  const margin = input.salePrice > 0 ? (profit / input.salePrice) * 100 : 0;

  return {
    salePrice: input.salePrice,
    costOfGoods: input.costOfGoods,
    marketplace,
    feeSource: 'fee_table',
    fees: {
      referralFee: round(referralFee),
      fulfillmentFee: round(fulfillmentFee),
      closingFee: round(closingFee),
      otherFees: round(otherFees),
      totalMarketplaceFees: round(totalMarketplaceFees),
    },
    prepCost,
    shippingToFba,
    totalCost: round(totalCost),
    profit: round(profit),
    roi: round(roi, 1),
    margin: round(margin, 1),
    breakEvenPrice: round(input.costOfGoods + totalMarketplaceFees + prepCost + shippingToFba),
    quantity,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function round(value: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// ── Category Lists (for UI dropdowns) ───────────────────────────────────────

export function getWalmartCategories(): string[] {
  return Object.keys(WALMART_REFERRAL_FEES).filter(k => k !== 'default').sort();
}

export function getEbayCategories(): string[] {
  return Object.keys(EBAY_FINAL_VALUE_FEES).filter(k => k !== 'default').sort();
}
