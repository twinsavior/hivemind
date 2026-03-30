// ── Marketplace Integration Types ─────────────────────────────────────────────

export type MarketplaceType = 'amazon' | 'walmart' | 'ebay';

export interface MarketplaceCredentials {
  marketplace: MarketplaceType;
  connected: boolean;
  connectedAt?: string;
  // Amazon SP-API
  amazon?: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    accessToken?: string;
    accessTokenExpiresAt?: number;
    region: AmazonRegion;
    sellerId?: string;
    marketplaceIds?: string[];
  };
  // Walmart
  walmart?: {
    clientId: string;
    clientSecret: string;
    accessToken?: string;
    accessTokenExpiresAt?: number;
    sellerId?: string;
  };
  // eBay
  ebay?: {
    clientId: string;
    clientSecret: string;
    redirectUri: string; // RuName
    refreshToken?: string;
    refreshTokenExpiresAt?: number;
    accessToken?: string;
    accessTokenExpiresAt?: number;
    userId?: string;
    environment: 'production' | 'sandbox';
  };
}

export type AmazonRegion = 'na' | 'eu' | 'fe';

export interface AmazonRegionConfig {
  baseUrl: string;
  awsRegion: string;
  marketplaceIds: Record<string, string>;
}

export const AMAZON_REGIONS: Record<AmazonRegion, AmazonRegionConfig> = {
  na: {
    baseUrl: 'https://sellingpartnerapi-na.amazon.com',
    awsRegion: 'us-east-1',
    marketplaceIds: {
      US: 'ATVPDKIKX0DER',
      CA: 'A2EUQ1WTGCTBG2',
      MX: 'A1AM78C64UM0Y8',
      BR: 'A2Q3Y263D00KWC',
    },
  },
  eu: {
    baseUrl: 'https://sellingpartnerapi-eu.amazon.com',
    awsRegion: 'eu-west-1',
    marketplaceIds: {
      UK: 'A1F83G8C2ARO7P',
      DE: 'A1PA6795UKMFR9',
      FR: 'A13V1IB3VIYZZH',
      IT: 'APJ6JRA9NG5V4',
      ES: 'A1RKKUPIHCS9HS',
      NL: 'A1805IZSGTT6HS',
      SE: 'A2NODRKZP88ZB9',
      PL: 'A1C3SOZRARQ6R3',
      BE: 'AMEN7PMS3EDWL',
    },
  },
  fe: {
    baseUrl: 'https://sellingpartnerapi-fe.amazon.com',
    awsRegion: 'us-west-2',
    marketplaceIds: {
      JP: 'A1VC38T7YXB528',
      AU: 'A39IBJ37TRP1C6',
      SG: 'A19VAU5U5O7RUS',
      IN: 'A21TJRUUN4KGV',
    },
  },
};

export const AMAZON_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
export const WALMART_BASE_URL = 'https://marketplace.walmartapis.com';
export const WALMART_TOKEN_URL = 'https://marketplace.walmartapis.com/v3/token';
export const EBAY_BASE_URL = 'https://api.ebay.com';
export const EBAY_SANDBOX_URL = 'https://api.sandbox.ebay.com';
export const EBAY_AUTH_URL = 'https://auth.ebay.com/oauth2/authorize';
export const EBAY_SANDBOX_AUTH_URL = 'https://auth.sandbox.ebay.com/oauth2/authorize';

// ── Shared Data Types ────────────────────────────────────────────────────────

export interface MarketplaceOrder {
  marketplace: MarketplaceType;
  orderId: string;
  status: string;
  orderDate: string;
  totalAmount: number;
  currency: string;
  items: MarketplaceOrderItem[];
  buyerName?: string;
  shippingAddress?: string;
}

export interface MarketplaceOrderItem {
  sku: string;
  asin?: string;
  title: string;
  quantity: number;
  price: number;
}

export interface MarketplaceInventoryItem {
  marketplace: MarketplaceType;
  sku: string;
  asin?: string;
  title: string;
  quantity: number;
  fulfillableQuantity?: number;
  inboundQuantity?: number;
  reservedQuantity?: number;
  price?: number;
  condition?: string;
  status: string;
}

export interface MarketplaceListing {
  marketplace: MarketplaceType;
  sku: string;
  asin?: string;
  title: string;
  price: number;
  status: string;
  condition?: string;
  imageUrl?: string;
}

export interface FBAShipment {
  shipmentId: string;
  shipmentName?: string;
  status: string;
  destination: string;
  createdDate: string;
  itemCount: number;
  items?: FBAShipmentItem[];
}

export interface FBAShipmentItem {
  sku: string;
  asin?: string;
  title?: string;
  quantityShipped: number;
  quantityReceived: number;
}

export interface AccountHealthNotification {
  marketplace: MarketplaceType;
  type: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  actionRequired: boolean;
  deadline?: string;
  asin?: string;
  createdAt: string;
}

export interface MarketplaceSummary {
  marketplace: MarketplaceType;
  connected: boolean;
  activeListings: number;
  pendingOrders: number;
  recentRevenue?: number;
  accountHealth?: string;
  alerts: AccountHealthNotification[];
}

export type MarketplaceHealthState = 'healthy' | 'degraded' | 'unverified';

export interface MarketplaceHealth {
  marketplace: MarketplaceType;
  connected: boolean;
  /** Tri-state: 'healthy' = at least one successful fetch, 'degraded' = recent error, 'unverified' = connected but no fetch yet */
  state: MarketplaceHealthState;
  /** Compat: true only when state === 'healthy' */
  healthy: boolean;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  dataFreshnessMs: number | null;
}

export interface BriefingCoverage {
  responded: MarketplaceType[];
  failed: Array<{ marketplace: MarketplaceType; error: string }>;
}

export interface DailyBriefing {
  date: string;
  summaries: MarketplaceSummary[];
  totalOrders: number;
  totalRevenue: number;
  activeShipments: number;
  alerts: AccountHealthNotification[];
  suggestedActions: string[];
  coverage?: BriefingCoverage;
}

// ── Error Types ──────────────────────────────────────────────────────────────

export class MarketplaceAuthError extends Error {
  constructor(
    public marketplace: MarketplaceType,
    message: string,
    public statusCode?: number,
  ) {
    super(`[${marketplace}] Auth error: ${message}`);
    this.name = 'MarketplaceAuthError';
  }
}

export class MarketplaceApiError extends Error {
  constructor(
    public marketplace: MarketplaceType,
    message: string,
    public statusCode?: number,
    public endpoint?: string,
  ) {
    super(`[${marketplace}] API error (${statusCode}): ${message}`);
    this.name = 'MarketplaceApiError';
  }
}
