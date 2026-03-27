// ── Walmart Marketplace API Client ───────────────────────────────────────────
// Full Marketplace API integration for HIVEMIND marketplace module.
// Uses OAuth 2.0 client credentials grant. Tokens expire every 15 minutes.

import * as crypto from 'crypto';

import {
  type MarketplaceCredentials,
  type MarketplaceOrder,
  type MarketplaceOrderItem,
  type MarketplaceInventoryItem,
  type MarketplaceListing,
  type AccountHealthNotification,
  MarketplaceApiError,
  MarketplaceAuthError,
  WALMART_BASE_URL,
  WALMART_TOKEN_URL,
} from './types.js';

import {
  getMarketplaceCredentials,
  updateAccessToken,
} from './credentials.js';

// ── Constants ────────────────────────────────────────────────────────────────

const USER_AGENT = 'HIVEMIND/1.0 (Language=TypeScript; Platform=Node)';

/**
 * Buffer before token expiry to trigger a refresh.
 * Walmart tokens only last 15 minutes (900s), so we use a 2-minute buffer
 * to avoid mid-request expiration.
 */
const TOKEN_REFRESH_BUFFER_MS = 2 * 60 * 1000;

/** Maximum number of retries on rate-limit (429) responses. */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff on 429 (milliseconds). */
const BASE_RETRY_DELAY_MS = 1_000;

/** Service name required by Walmart API headers. */
const WM_SVC_NAME = 'Walmart Marketplace';

// ── Walmart Marketplace API Client ──────────────────────────────────────────

export class WalmartAPI {
  private credentials: MarketplaceCredentials;

  /**
   * Create a Walmart Marketplace API client.
   * Loads credentials from the encrypted credential store.
   * @param credentialsOverride Optional credentials to use instead of the credential store.
   */
  constructor(credentialsOverride?: MarketplaceCredentials) {
    const creds = credentialsOverride ?? getMarketplaceCredentials('walmart');

    if (!creds) {
      throw new MarketplaceAuthError(
        'walmart',
        'No Walmart credentials found. Connect your Walmart account first.',
      );
    }

    if (!creds.walmart) {
      throw new MarketplaceAuthError(
        'walmart',
        'Walmart credential block is missing. Re-authenticate your Walmart account.',
      );
    }

    this.credentials = creds;
  }

  // ── Token Management ────────────────────────────────────────────────────

  /**
   * Ensure we have a valid access token. Fetches a new one via client credentials
   * grant if the current token is expired or within the 2-minute buffer window.
   * Walmart tokens expire every 15 minutes.
   */
  private async ensureAccessToken(): Promise<string> {
    const walmart = this.credentials.walmart!;

    // Check if current token is still valid (with buffer)
    if (
      walmart.accessToken &&
      walmart.accessTokenExpiresAt &&
      Date.now() < walmart.accessTokenExpiresAt - TOKEN_REFRESH_BUFFER_MS
    ) {
      return walmart.accessToken;
    }

    // Request a new token via OAuth 2.0 client credentials grant
    const basicAuth = Buffer.from(
      `${walmart.clientId}:${walmart.clientSecret}`,
    ).toString('base64');

    let response: Response;
    try {
      response = await fetch(WALMART_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'WM_SVC.NAME': WM_SVC_NAME,
          'WM_QOS.CORRELATION_ID': this.generateCorrelationId(),
        },
        body: 'grant_type=client_credentials',
      });
    } catch (err) {
      throw new MarketplaceAuthError(
        'walmart',
        `Token request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new MarketplaceAuthError(
        'walmart',
        `Token request failed (${response.status}): ${errorBody}`,
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
    walmart.accessToken = data.access_token;
    walmart.accessTokenExpiresAt = expiresAt;

    // Persist to encrypted credential store
    updateAccessToken('walmart', data.access_token, expiresAt);

    return data.access_token;
  }

  // ── Correlation ID ─────────────────────────────────────────────────────

  /**
   * Generate a UUID v4 correlation ID for request tracing.
   * Walmart requires WM_QOS.CORRELATION_ID on every API call.
   */
  private generateCorrelationId(): string {
    return crypto.randomUUID();
  }

  // ── Generic API Request ─────────────────────────────────────────────────

  /**
   * Make an authenticated request to the Walmart Marketplace API.
   * Handles auth headers (WM_SEC.ACCESS_TOKEN, WM_QOS.CORRELATION_ID,
   * WM_SVC.NAME), JSON serialization, error mapping, and 429 retry
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
    const url = new URL(path, WALMART_BASE_URL);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') {
          url.searchParams.set(key, value);
        }
      }
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const headers: Record<string, string> = {
        'WM_SEC.ACCESS_TOKEN': accessToken,
        'WM_QOS.CORRELATION_ID': this.generateCorrelationId(),
        'WM_SVC.NAME': WM_SVC_NAME,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      };

      let response: Response;
      try {
        response = await fetch(url.toString(), {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (err) {
        throw new MarketplaceApiError(
          'walmart',
          `Network error: ${err instanceof Error ? err.message : String(err)}`,
          undefined,
          path,
        );
      }

      // Rate limited — exponential backoff and retry
      if (response.status === 429 && attempt < MAX_RETRIES) {
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
        await this.sleep(delay);
        lastError = new MarketplaceApiError(
          'walmart',
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
          'walmart',
          `Authentication failed (${response.status}): ${errorBody}`,
          response.status,
        );
      }

      // Other errors
      if (!response.ok) {
        const errorBody = await response.text();
        throw new MarketplaceApiError(
          'walmart',
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
      'walmart',
      'Max retries exceeded',
      429,
      path,
    );
  }

  // ── Orders API ──────────────────────────────────────────────────────────

  /**
   * Fetch orders, optionally filtered by creation date.
   * @param createdStartDate ISO 8601 date string (e.g. "2026-03-01")
   */
  async getOrders(createdStartDate?: string): Promise<MarketplaceOrder[]> {
    const params: Record<string, string> = {};

    if (createdStartDate) {
      params['createdStartDate'] = createdStartDate;
    }

    interface WMOrdersResponse {
      list: {
        elements: {
          order: Array<{
            purchaseOrderId: string;
            customerOrderId: string;
            orderDate: string;
            status: string;
            orderLines: {
              orderLine: Array<{
                item: {
                  sku: string;
                  productName: string;
                };
                charges: {
                  charge: Array<{
                    chargeType: string;
                    chargeAmount: {
                      currency: string;
                      amount: number;
                    };
                  }>;
                };
                orderLineQuantity: {
                  unitOfMeasurement: string;
                  amount: string;
                };
                orderLineStatuses: {
                  orderLineStatus: Array<{
                    status: string;
                  }>;
                };
              }>;
            };
            shippingInfo?: {
              postalAddress?: {
                name?: string;
                city?: string;
                state?: string;
                country?: string;
              };
            };
          }>;
        };
        meta?: {
          totalCount: number;
          limit: number;
          nextCursor?: string;
        };
      };
    }

    const response = await this.apiRequest<WMOrdersResponse>(
      'GET',
      '/v3/orders',
      undefined,
      params,
    );

    const orders = response.list?.elements?.order ?? [];

    return orders.map((order) => {
      const items: MarketplaceOrderItem[] = (
        order.orderLines?.orderLine ?? []
      ).map((line) => {
        const productCharge = line.charges?.charge?.find(
          (c) => c.chargeType === 'PRODUCT',
        );

        return {
          sku: line.item.sku,
          title: line.item.productName,
          quantity: parseInt(line.orderLineQuantity.amount, 10) || 1,
          price: productCharge?.chargeAmount.amount ?? 0,
        };
      });

      const totalAmount = items.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0,
      );

      const address = order.shippingInfo?.postalAddress;

      return {
        marketplace: 'walmart' as const,
        orderId: order.purchaseOrderId,
        status: order.status,
        orderDate: order.orderDate,
        totalAmount,
        currency: 'USD',
        items,
        buyerName: address?.name,
        shippingAddress: address
          ? [address.city, address.state, address.country]
              .filter(Boolean)
              .join(', ')
          : undefined,
      };
    });
  }

  /**
   * Fetch a single order by purchase order ID.
   */
  async getOrder(purchaseOrderId: string): Promise<MarketplaceOrder> {
    interface WMOrderResponse {
      order: {
        purchaseOrderId: string;
        customerOrderId: string;
        orderDate: string;
        status: string;
        orderLines: {
          orderLine: Array<{
            item: {
              sku: string;
              productName: string;
            };
            charges: {
              charge: Array<{
                chargeType: string;
                chargeAmount: {
                  currency: string;
                  amount: number;
                };
              }>;
            };
            orderLineQuantity: {
              unitOfMeasurement: string;
              amount: string;
            };
          }>;
        };
        shippingInfo?: {
          postalAddress?: {
            name?: string;
            city?: string;
            state?: string;
            country?: string;
          };
        };
      };
    }

    const response = await this.apiRequest<WMOrderResponse>(
      'GET',
      `/v3/orders/${encodeURIComponent(purchaseOrderId)}`,
    );

    const order = response.order;
    const items: MarketplaceOrderItem[] = (
      order.orderLines?.orderLine ?? []
    ).map((line) => {
      const productCharge = line.charges?.charge?.find(
        (c) => c.chargeType === 'PRODUCT',
      );

      return {
        sku: line.item.sku,
        title: line.item.productName,
        quantity: parseInt(line.orderLineQuantity.amount, 10) || 1,
        price: productCharge?.chargeAmount.amount ?? 0,
      };
    });

    const totalAmount = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );

    const address = order.shippingInfo?.postalAddress;

    return {
      marketplace: 'walmart' as const,
      orderId: order.purchaseOrderId,
      status: order.status,
      orderDate: order.orderDate,
      totalAmount,
      currency: 'USD',
      items,
      buyerName: address?.name,
      shippingAddress: address
        ? [address.city, address.state, address.country]
            .filter(Boolean)
            .join(', ')
        : undefined,
    };
  }

  // ── Items / Listings API ────────────────────────────────────────────────

  /**
   * Fetch item listings, with optional pagination.
   * @param nextCursor Pagination cursor from a previous response.
   */
  async getItems(nextCursor?: string): Promise<MarketplaceListing[]> {
    const params: Record<string, string> = {};

    if (nextCursor) {
      params['nextCursor'] = nextCursor;
    }

    interface WMItemsResponse {
      ItemResponse: Array<{
        sku: string;
        productName: string;
        price?: {
          currency: string;
          amount: number;
        };
        publishedStatus?: string;
        lifecycleStatus?: string;
        unpublishedReasons?: { reason: string[] };
        images?: Array<{ url: string }>;
      }>;
      totalItems?: number;
      nextCursor?: string;
    }

    const response = await this.apiRequest<WMItemsResponse>(
      'GET',
      '/v3/items',
      undefined,
      params,
    );

    return (response.ItemResponse ?? []).map((item) => ({
      marketplace: 'walmart' as const,
      sku: item.sku,
      title: item.productName,
      price: item.price?.amount ?? 0,
      status: item.publishedStatus ?? item.lifecycleStatus ?? 'Unknown',
      imageUrl: item.images?.[0]?.url,
    }));
  }

  /**
   * Fetch a single item by SKU.
   */
  async getItem(sku: string): Promise<MarketplaceListing> {
    interface WMItemResponse {
      sku: string;
      productName: string;
      price?: {
        currency: string;
        amount: number;
      };
      publishedStatus?: string;
      lifecycleStatus?: string;
      condition?: string;
      images?: Array<{ url: string }>;
    }

    const response = await this.apiRequest<WMItemResponse>(
      'GET',
      `/v3/items/${encodeURIComponent(sku)}`,
    );

    return {
      marketplace: 'walmart' as const,
      sku: response.sku,
      title: response.productName,
      price: response.price?.amount ?? 0,
      status: response.publishedStatus ?? response.lifecycleStatus ?? 'Unknown',
      condition: response.condition,
      imageUrl: response.images?.[0]?.url,
    };
  }

  // ── Inventory API ──────────────────────────────────────────────────────

  /**
   * Fetch inventory for a specific SKU.
   * @param sku The seller SKU to look up.
   */
  async getInventory(sku: string): Promise<MarketplaceInventoryItem> {
    interface WMInventoryResponse {
      sku: string;
      quantity: {
        unit: string;
        amount: number;
      };
      fulfillmentLagTime?: number;
      productName?: string;
    }

    const response = await this.apiRequest<WMInventoryResponse>(
      'GET',
      '/v3/inventory',
      undefined,
      { sku },
    );

    return {
      marketplace: 'walmart' as const,
      sku: response.sku,
      title: response.productName ?? sku,
      quantity: response.quantity.amount,
      status: response.quantity.amount > 0 ? 'In Stock' : 'Out of Stock',
    };
  }

  // ── Returns API ─────────────────────────────────────────────────────────

  /**
   * Fetch recent returns.
   */
  async getReturns(): Promise<Array<{
    returnOrderId: string;
    customerOrderId: string;
    status: string;
    returnDate: string;
    items: Array<{
      sku: string;
      title: string;
      quantity: number;
      reason?: string;
    }>;
  }>> {
    interface WMReturnsResponse {
      returnOrders?: Array<{
        returnOrderId: string;
        customerOrderId: string;
        status: string;
        returnOrderDate: string;
        returnOrderLines?: Array<{
          item: {
            sku: string;
            productName: string;
          };
          returnQuantity: {
            unitOfMeasurement: string;
            amount: number;
          };
          returnReason?: string;
        }>;
      }>;
      meta?: {
        totalCount: number;
        limit: number;
        nextCursor?: string;
      };
    }

    const response = await this.apiRequest<WMReturnsResponse>(
      'GET',
      '/v3/returns',
    );

    return (response.returnOrders ?? []).map((ret) => ({
      returnOrderId: ret.returnOrderId,
      customerOrderId: ret.customerOrderId,
      status: ret.status,
      returnDate: ret.returnOrderDate,
      items: (ret.returnOrderLines ?? []).map((line) => ({
        sku: line.item.sku,
        title: line.item.productName,
        quantity: line.returnQuantity.amount,
        reason: line.returnReason,
      })),
    }));
  }

  // ── Connection Test ────────────────────────────────────────────────────

  /**
   * Verify that credentials are valid and return basic account info.
   * Attempts to fetch a token and make a lightweight API call.
   */
  async testConnection(): Promise<{
    success: boolean;
    sellerId?: string;
  }> {
    try {
      // Ensure we can get a valid token
      await this.ensureAccessToken();

      const walmart = this.credentials.walmart!;

      // Make a lightweight API call to confirm access
      // Fetching items with a limit of 1 is cheap and confirms permissions
      await this.apiRequest(
        'GET',
        '/v3/items',
        undefined,
        { limit: '1' },
      );

      return {
        success: true,
        sellerId: walmart.sellerId,
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

  // ── Helpers ─────────────────────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
