// ── eBay REST API Client ─────────────────────────────────────────────────────
// Full eBay integration for HIVEMIND marketplace module.
// Uses OAuth 2.0 Authorization Code Grant for seller data access.

import {
  type MarketplaceCredentials,
  type MarketplaceOrder,
  type MarketplaceOrderItem,
  type MarketplaceInventoryItem,
  type AccountHealthNotification,
  MarketplaceApiError,
  MarketplaceAuthError,
  EBAY_BASE_URL,
  EBAY_SANDBOX_URL,
  EBAY_AUTH_URL,
  EBAY_SANDBOX_AUTH_URL,
} from './types.js';

import {
  getMarketplaceCredentials,
  updateAccessToken,
  saveMarketplaceCredentials,
} from './credentials.js';

// ── Constants ────────────────────────────────────────────────────────────────

const USER_AGENT = 'HIVEMIND/1.0 (Language=TypeScript; Platform=Node)';

/** Buffer before token expiry to trigger a refresh (5 minutes). */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** Maximum number of retries on rate-limit (429) responses. */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff on 429 (milliseconds). */
const BASE_RETRY_DELAY_MS = 1_000;

/** Token endpoint paths (appended to base URL). */
const TOKEN_PATH = '/identity/v1/oauth2/token';

/** eBay OAuth scopes required for seller data access. */
export const EBAY_SCOPES: string[] = [
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.finances',
];

// ── eBay REST API Client ─────────────────────────────────────────────────────

export class EbayAPI {
  private credentials: MarketplaceCredentials;
  private environment: 'production' | 'sandbox';

  /**
   * Create an eBay REST API client.
   * Loads credentials from the encrypted credential store.
   * @param environment Target environment — production (default) or sandbox.
   */
  constructor(environment: 'production' | 'sandbox' = 'production') {
    const creds = getMarketplaceCredentials('ebay');

    if (!creds) {
      throw new MarketplaceAuthError(
        'ebay',
        'No eBay credentials found. Connect your eBay account first.',
      );
    }

    if (!creds.ebay) {
      throw new MarketplaceAuthError(
        'ebay',
        'eBay credential block is missing. Re-authenticate your eBay account.',
      );
    }

    this.credentials = creds;
    this.environment = environment;
  }

  // ── OAuth Flow ──────────────────────────────────────────────────────────

  /**
   * Build the eBay authorization consent URL.
   * Redirect the seller to this URL to begin the OAuth flow.
   * After the seller grants access, eBay redirects back to your RuName
   * with an authorization code.
   *
   * @param state Optional opaque state value for CSRF protection.
   * @returns The full authorization URL string.
   */
  getAuthorizationUrl(state?: string): string {
    const ebay = this.credentials.ebay!;
    const authBaseUrl = this.environment === 'production'
      ? EBAY_AUTH_URL
      : EBAY_SANDBOX_AUTH_URL;

    const params = new URLSearchParams({
      client_id: ebay.clientId,
      redirect_uri: ebay.redirectUri,
      response_type: 'code',
      scope: EBAY_SCOPES.join(' '),
    });

    if (state) {
      params.set('state', state);
    }

    return `${authBaseUrl}?${params.toString()}`;
  }

  /**
   * Exchange an authorization code for access and refresh tokens.
   * Called after the seller completes the consent flow and eBay redirects
   * back with an authorization code.
   *
   * @param code The authorization code from the eBay redirect.
   */
  async exchangeAuthorizationCode(code: string): Promise<void> {
    const ebay = this.credentials.ebay!;
    const tokenUrl = this.getTokenUrl();

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: ebay.redirectUri,
    });

    const basicAuth = Buffer.from(`${ebay.clientId}:${ebay.clientSecret}`).toString('base64');

    let response: Response;
    try {
      response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${basicAuth}`,
        },
        body: body.toString(),
      });
    } catch (err) {
      throw new MarketplaceAuthError(
        'ebay',
        `Token exchange request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new MarketplaceAuthError(
        'ebay',
        `Token exchange failed (${response.status}): ${errorBody}`,
        response.status,
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
      refresh_token: string;
      refresh_token_expires_in: number;
    };

    const now = Date.now();

    // Update in-memory credentials
    ebay.accessToken = data.access_token;
    ebay.accessTokenExpiresAt = now + data.expires_in * 1000;
    ebay.refreshToken = data.refresh_token;
    ebay.refreshTokenExpiresAt = now + data.refresh_token_expires_in * 1000;

    // Persist the full credential set (includes new refresh token)
    this.credentials.connected = true;
    this.credentials.connectedAt = new Date().toISOString();
    saveMarketplaceCredentials('ebay', this.credentials);
  }

  // ── Token Management ────────────────────────────────────────────────────

  /**
   * Ensure we have a valid access token. Refreshes automatically if
   * the token is expired or within the 5-minute buffer window.
   */
  private async ensureAccessToken(): Promise<string> {
    const ebay = this.credentials.ebay!;

    // Check if current token is still valid (with buffer)
    if (
      ebay.accessToken &&
      ebay.accessTokenExpiresAt &&
      Date.now() < ebay.accessTokenExpiresAt - TOKEN_REFRESH_BUFFER_MS
    ) {
      return ebay.accessToken;
    }

    // Must have a refresh token to proceed
    if (!ebay.refreshToken) {
      throw new MarketplaceAuthError(
        'ebay',
        'No refresh token available. Complete the OAuth authorization flow first.',
      );
    }

    // Check if refresh token itself is expired
    if (
      ebay.refreshTokenExpiresAt &&
      Date.now() >= ebay.refreshTokenExpiresAt
    ) {
      throw new MarketplaceAuthError(
        'ebay',
        'Refresh token has expired. Re-authorize your eBay account.',
      );
    }

    // Refresh the access token
    const tokenUrl = this.getTokenUrl();
    const basicAuth = Buffer.from(`${ebay.clientId}:${ebay.clientSecret}`).toString('base64');

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: ebay.refreshToken,
      scope: EBAY_SCOPES.join(' '),
    });

    let response: Response;
    try {
      response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${basicAuth}`,
        },
        body: body.toString(),
      });
    } catch (err) {
      throw new MarketplaceAuthError(
        'ebay',
        `Token refresh request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new MarketplaceAuthError(
        'ebay',
        `Token refresh failed (${response.status}): ${errorBody}`,
        response.status,
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
    };

    const expiresAt = Date.now() + data.expires_in * 1000;

    // Update in-memory credentials
    ebay.accessToken = data.access_token;
    ebay.accessTokenExpiresAt = expiresAt;

    // Persist to encrypted credential store
    updateAccessToken('ebay', data.access_token, expiresAt);

    return data.access_token;
  }

  // ── URL Helpers ─────────────────────────────────────────────────────────

  /** Returns the eBay API base URL for the configured environment. */
  private getBaseUrl(): string {
    return this.environment === 'production' ? EBAY_BASE_URL : EBAY_SANDBOX_URL;
  }

  /** Returns the token endpoint for the configured environment. */
  private getTokenUrl(): string {
    return `${this.getBaseUrl()}${TOKEN_PATH}`;
  }

  // ── Generic API Request ─────────────────────────────────────────────────

  /**
   * Make an authenticated request to the eBay REST API.
   * Handles Bearer auth, JSON serialization, error mapping, and 429 retry
   * with exponential backoff.
   */
  private async apiRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
    params?: Record<string, string>,
  ): Promise<T> {
    const accessToken = await this.ensureAccessToken();

    // Build URL with query params
    const url = new URL(path, this.getBaseUrl());
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') {
          url.searchParams.set(key, value);
        }
      }
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let response: Response;
      try {
        response = await fetch(url.toString(), {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (err) {
        throw new MarketplaceApiError(
          'ebay',
          `Network error: ${err instanceof Error ? err.message : String(err)}`,
          undefined,
          path,
        );
      }

      // Rate limited — exponential backoff and retry
      if (response.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
        await this.sleep(delay);
        lastError = new MarketplaceApiError(
          'ebay',
          'Rate limited (429)',
          429,
          path,
        );
        continue;
      }

      // Auth errors
      if (response.status === 401 || response.status === 403) {
        const errorBody = await response.text();
        throw new MarketplaceAuthError(
          'ebay',
          `Authentication failed (${response.status}): ${errorBody}`,
          response.status,
        );
      }

      // Other errors
      if (!response.ok) {
        const errorBody = await response.text();
        throw new MarketplaceApiError(
          'ebay',
          errorBody,
          response.status,
          path,
        );
      }

      // Success
      const json = await response.json();
      return json as T;
    }

    // Exhausted retries
    throw lastError ?? new MarketplaceApiError(
      'ebay',
      'Max retries exceeded',
      429,
      path,
    );
  }

  // ── Orders (Fulfillment API) ────────────────────────────────────────────

  /**
   * Fetch orders from the eBay Fulfillment API.
   * @param filter Optional OData filter string (e.g. "orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}")
   */
  async getOrders(filter?: string): Promise<MarketplaceOrder[]> {
    const params: Record<string, string> = {};
    if (filter) {
      params['filter'] = filter;
    }

    interface EbayOrdersResponse {
      href: string;
      total: number;
      limit: number;
      offset: number;
      orders: Array<{
        orderId: string;
        orderFulfillmentStatus: string;
        creationDate: string;
        pricingSummary: {
          total: { value: string; currency: string };
        };
        buyer: { username: string };
        fulfillmentStartInstructions?: Array<{
          shippingStep?: {
            shipTo?: {
              fullName?: string;
              contactAddress?: {
                city?: string;
                stateOrProvince?: string;
                countryCode?: string;
              };
            };
          };
        }>;
        lineItems: Array<{
          lineItemId: string;
          legacyItemId: string;
          sku?: string;
          title: string;
          quantity: number;
          lineItemCost: { value: string; currency: string };
        }>;
      }>;
    }

    const response = await this.apiRequest<EbayOrdersResponse>(
      'GET',
      '/sell/fulfillment/v1/order',
      undefined,
      params,
    );

    return (response.orders ?? []).map((order) => {
      const shipTo = order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
      const address = shipTo?.contactAddress;

      const items: MarketplaceOrderItem[] = order.lineItems.map((item) => ({
        sku: item.sku ?? item.legacyItemId,
        title: item.title,
        quantity: item.quantity,
        price: parseFloat(item.lineItemCost.value),
      }));

      return {
        marketplace: 'ebay' as const,
        orderId: order.orderId,
        status: order.orderFulfillmentStatus,
        orderDate: order.creationDate,
        totalAmount: parseFloat(order.pricingSummary.total.value),
        currency: order.pricingSummary.total.currency,
        items,
        buyerName: shipTo?.fullName ?? order.buyer.username,
        shippingAddress: address
          ? [address.city, address.stateOrProvince, address.countryCode]
              .filter(Boolean)
              .join(', ')
          : undefined,
      };
    });
  }

  /**
   * Fetch a single order by ID.
   * @param orderId The eBay order ID.
   */
  async getOrder(orderId: string): Promise<MarketplaceOrder> {
    interface EbayOrderResponse {
      orderId: string;
      orderFulfillmentStatus: string;
      creationDate: string;
      pricingSummary: {
        total: { value: string; currency: string };
      };
      buyer: { username: string };
      fulfillmentStartInstructions?: Array<{
        shippingStep?: {
          shipTo?: {
            fullName?: string;
            contactAddress?: {
              city?: string;
              stateOrProvince?: string;
              countryCode?: string;
            };
          };
        };
      }>;
      lineItems: Array<{
        lineItemId: string;
        legacyItemId: string;
        sku?: string;
        title: string;
        quantity: number;
        lineItemCost: { value: string; currency: string };
      }>;
    }

    const order = await this.apiRequest<EbayOrderResponse>(
      'GET',
      `/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}`,
    );

    const shipTo = order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
    const address = shipTo?.contactAddress;

    const items: MarketplaceOrderItem[] = order.lineItems.map((item) => ({
      sku: item.sku ?? item.legacyItemId,
      title: item.title,
      quantity: item.quantity,
      price: parseFloat(item.lineItemCost.value),
    }));

    return {
      marketplace: 'ebay' as const,
      orderId: order.orderId,
      status: order.orderFulfillmentStatus,
      orderDate: order.creationDate,
      totalAmount: parseFloat(order.pricingSummary.total.value),
      currency: order.pricingSummary.total.currency,
      items,
      buyerName: shipTo?.fullName ?? order.buyer.username,
      shippingAddress: address
        ? [address.city, address.stateOrProvince, address.countryCode]
            .filter(Boolean)
            .join(', ')
        : undefined,
    };
  }

  // ── Inventory API ───────────────────────────────────────────────────────

  /**
   * Fetch inventory items from the eBay Inventory API.
   * @param limit Number of items to return (default 25, max 100).
   * @param offset Pagination offset.
   */
  async getInventoryItems(
    limit: number = 25,
    offset: number = 0,
  ): Promise<MarketplaceInventoryItem[]> {
    const params: Record<string, string> = {
      limit: String(Math.min(limit, 100)),
      offset: String(offset),
    };

    interface EbayInventoryResponse {
      href: string;
      total: number;
      limit: number;
      offset: number;
      size: number;
      inventoryItems: Array<{
        sku: string;
        locale?: string;
        product: {
          title: string;
          imageUrls?: string[];
        };
        condition?: string;
        availability: {
          shipToLocationAvailability?: {
            quantity: number;
          };
        };
      }>;
    }

    const response = await this.apiRequest<EbayInventoryResponse>(
      'GET',
      '/sell/inventory/v1/inventory_item',
      undefined,
      params,
    );

    return (response.inventoryItems ?? []).map((item) => ({
      marketplace: 'ebay' as const,
      sku: item.sku,
      title: item.product.title,
      quantity: item.availability.shipToLocationAvailability?.quantity ?? 0,
      condition: item.condition,
      status: (item.availability.shipToLocationAvailability?.quantity ?? 0) > 0
        ? 'In Stock'
        : 'Out of Stock',
    }));
  }

  /**
   * Fetch a single inventory item by SKU.
   * @param sku The seller-defined SKU.
   */
  async getInventoryItem(sku: string): Promise<MarketplaceInventoryItem> {
    interface EbayInventoryItemResponse {
      sku: string;
      locale?: string;
      product: {
        title: string;
        imageUrls?: string[];
      };
      condition?: string;
      availability: {
        shipToLocationAvailability?: {
          quantity: number;
        };
      };
    }

    const response = await this.apiRequest<EbayInventoryItemResponse>(
      'GET',
      `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    );

    return {
      marketplace: 'ebay' as const,
      sku: response.sku,
      title: response.product.title,
      quantity: response.availability.shipToLocationAvailability?.quantity ?? 0,
      condition: response.condition,
      status: (response.availability.shipToLocationAvailability?.quantity ?? 0) > 0
        ? 'In Stock'
        : 'Out of Stock',
    };
  }

  // ── Analytics API ───────────────────────────────────────────────────────

  /**
   * Fetch seller traffic report (impressions, page views, conversion rate).
   * Returns raw response from the Analytics API.
   */
  async getSellerMetrics(): Promise<{
    dimensionMetrics: Array<{
      dimensionKey: string;
      metrics: Record<string, string>;
    }>;
  }> {
    interface EbayTrafficReportResponse {
      header: {
        dimensionKeys: string[];
        metricKeys: string[];
      };
      records: Array<{
        dimensionValues: Array<{ value: string }>;
        metricValues: Array<{ value: string }>;
      }>;
    }

    const response = await this.apiRequest<EbayTrafficReportResponse>(
      'GET',
      '/sell/analytics/v1/traffic_report',
    );

    // Normalize the response into a more usable format
    const { header, records } = response;
    return {
      dimensionMetrics: (records ?? []).map((record) => {
        const dimensionKey = record.dimensionValues
          .map((d) => d.value)
          .join('|');

        const metrics: Record<string, string> = {};
        (header.metricKeys ?? []).forEach((key, idx) => {
          metrics[key] = record.metricValues[idx]?.value ?? '0';
        });

        return { dimensionKey, metrics };
      }),
    };
  }

  // ── Finances API ────────────────────────────────────────────────────────

  /**
   * Fetch recent financial transactions (payouts, refunds, fees, etc.).
   */
  async getTransactions(): Promise<Array<{
    transactionId: string;
    transactionType: string;
    transactionStatus: string;
    amount: { value: string; currency: string };
    transactionDate: string;
    orderId?: string;
  }>> {
    interface EbayTransactionsResponse {
      href: string;
      total: number;
      limit: number;
      offset: number;
      transactions: Array<{
        transactionId: string;
        transactionType: string;
        transactionStatus: string;
        amount: { value: string; currency: string };
        transactionDate: string;
        orderId?: string;
      }>;
    }

    const response = await this.apiRequest<EbayTransactionsResponse>(
      'GET',
      '/sell/finances/v1/transaction',
    );

    return response.transactions ?? [];
  }

  // ── Connection Test ─────────────────────────────────────────────────────

  /**
   * Verify that credentials are valid and return basic account info.
   * Makes a lightweight inventory call to confirm API access.
   */
  async testConnection(): Promise<{
    success: boolean;
    userId?: string;
  }> {
    try {
      // Ensure we can get a valid token
      await this.ensureAccessToken();

      // Make a lightweight API call to confirm access
      await this.apiRequest(
        'GET',
        '/sell/inventory/v1/inventory_item',
        undefined,
        { limit: '1', offset: '0' },
      );

      return {
        success: true,
        userId: this.credentials.ebay?.userId,
      };
    } catch (err) {
      if (err instanceof MarketplaceAuthError) {
        return { success: false };
      }
      if (err instanceof MarketplaceApiError) {
        return { success: false };
      }
      throw err;
    }
  }

  // ── Category Lookup ────────────────────────────────────────────────────

  /**
   * Get category suggestions for a product query string.
   * Uses the Taxonomy API to find the correct eBay category.
   * The category ID can then be used to determine the correct fee rate.
   */
  async getCategorySuggestions(query: string, categoryTreeId: string = '0'): Promise<EbayCategorySuggestion[]> {
    const accessToken = await this.ensureAccessToken();
    const url = `${this.getBaseUrl()}/commerce/taxonomy/v1/category_tree/${categoryTreeId}/get_category_suggestions?q=${encodeURIComponent(query)}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) return [];
    const data = await response.json() as any;
    return (data.categorySuggestions || []).map((s: any) => ({
      categoryId: s.category?.categoryId || '',
      categoryName: s.category?.categoryName || '',
      categoryTreeNodeLevel: s.categoryTreeNodeLevel || 0,
      relevancy: s.relevancy || '',
    }));
  }

  /**
   * Get item details including category from a listing ID.
   * Uses the Browse API.
   */
  async getItemCategory(itemId: string): Promise<{ categoryId: string; categoryPath: string[] } | null> {
    const accessToken = await this.ensureAccessToken();
    const url = `${this.getBaseUrl()}/buy/browse/v1/item/${encodeURIComponent(itemId)}?fieldgroups=PRODUCT`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
    });

    if (!response.ok) return null;
    const data = await response.json() as any;
    const categoryId = data.categoryId || '';
    const categoryPath = (data.categoryPath?.split('|') || []).map((s: string) => s.trim());
    return { categoryId, categoryPath };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export interface EbayCategorySuggestion {
  categoryId: string;
  categoryName: string;
  categoryTreeNodeLevel: number;
  relevancy: string;
}
