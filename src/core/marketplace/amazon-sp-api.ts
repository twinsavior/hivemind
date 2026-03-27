// ── Amazon Selling Partner API Client ────────────────────────────────────────
// Full SP-API integration for HIVEMIND marketplace module.
// Uses OAuth 2.0 via Login with Amazon (LWA). No AWS Signature V4 required.

import {
  type MarketplaceCredentials,
  type MarketplaceOrder,
  type MarketplaceOrderItem,
  type MarketplaceInventoryItem,
  type MarketplaceListing,
  type FBAShipment,
  type FBAShipmentItem,
  type AccountHealthNotification,
  MarketplaceApiError,
  MarketplaceAuthError,
  AMAZON_TOKEN_URL,
  AMAZON_REGIONS,
  type AmazonRegion,
} from './types.js';

import {
  getMarketplaceCredentials,
  updateAccessToken,
} from './credentials.js';

// ── Constants ────────────────────────────────────────────────────────────────

const USER_AGENT = 'HIVEMIND/1.0 (Language=TypeScript; Platform=Node)';

/** Buffer before token expiry to trigger a refresh (5 minutes). */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** Maximum number of retries on rate-limit (429) responses. */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff on 429 (milliseconds). */
const BASE_RETRY_DELAY_MS = 1_000;

// ── Amazon SP-API Client ─────────────────────────────────────────────────────

export class AmazonSPAPI {
  private credentials: MarketplaceCredentials;
  private baseUrl: string;
  private region: AmazonRegion;

  /**
   * Create an Amazon SP-API client.
   * @param credentialsOverride Optional credentials to use instead of the credential store.
   */
  constructor(credentialsOverride?: MarketplaceCredentials) {
    const creds = credentialsOverride ?? getMarketplaceCredentials('amazon');

    if (!creds) {
      throw new MarketplaceAuthError(
        'amazon',
        'No Amazon credentials found. Connect your Amazon account first.',
      );
    }

    if (!creds.amazon) {
      throw new MarketplaceAuthError(
        'amazon',
        'Amazon credential block is missing. Re-authenticate your Amazon account.',
      );
    }

    this.credentials = creds;
    this.region = creds.amazon.region;
    this.baseUrl = AMAZON_REGIONS[this.region].baseUrl;
  }

  // ── Token Management ────────────────────────────────────────────────────

  /**
   * Ensure we have a valid access token. Refreshes if expired or within
   * the 5-minute buffer window.
   */
  private async ensureAccessToken(): Promise<string> {
    const amazon = this.credentials.amazon!;

    // Check if current token is still valid (with buffer)
    if (
      amazon.accessToken &&
      amazon.accessTokenExpiresAt &&
      Date.now() < amazon.accessTokenExpiresAt - TOKEN_REFRESH_BUFFER_MS
    ) {
      return amazon.accessToken;
    }

    // Refresh the token via LWA
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: amazon.clientId,
      client_secret: amazon.clientSecret,
      refresh_token: amazon.refreshToken,
    });

    let response: Response;
    try {
      response = await fetch(AMAZON_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (err) {
      throw new MarketplaceAuthError(
        'amazon',
        `Token refresh request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new MarketplaceAuthError(
        'amazon',
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
    amazon.accessToken = data.access_token;
    amazon.accessTokenExpiresAt = expiresAt;

    // Persist to encrypted credential store
    updateAccessToken('amazon', data.access_token, expiresAt);

    return data.access_token;
  }

  // ── Generic API Request ─────────────────────────────────────────────────

  /**
   * Make an authenticated request to the SP-API.
   * Handles auth headers, JSON serialization, error mapping, and 429 retry.
   */
  private async apiRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
    params?: Record<string, string>,
  ): Promise<T> {
    const accessToken = await this.ensureAccessToken();

    // Build URL with query params
    const url = new URL(path, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') {
          url.searchParams.set(key, value);
        }
      }
    }

    const headers: Record<string, string> = {
      'x-amz-access-token': accessToken,
      'user-agent': USER_AGENT,
      'content-type': 'application/json',
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
          'amazon',
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
          'amazon',
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
          'amazon',
          `Authentication failed (${response.status}): ${errorBody}`,
          response.status,
        );
      }

      // Other errors
      if (!response.ok) {
        const errorBody = await response.text();
        throw new MarketplaceApiError(
          'amazon',
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
      'amazon',
      'Max retries exceeded',
      429,
      path,
    );
  }

  // ── Orders API ──────────────────────────────────────────────────────────

  /**
   * Fetch orders, optionally filtered by creation date and statuses.
   * @param createdAfter ISO 8601 date string (e.g. "2026-03-01T00:00:00Z")
   * @param statuses Order statuses to filter (e.g. ["Unshipped", "Shipped"])
   */
  async getOrders(
    createdAfter?: string,
    statuses?: string[],
  ): Promise<MarketplaceOrder[]> {
    const amazon = this.credentials.amazon!;
    const marketplaceIds = amazon.marketplaceIds?.join(',')
      ?? Object.values(AMAZON_REGIONS[this.region].marketplaceIds).join(',');

    const params: Record<string, string> = {
      MarketplaceIds: marketplaceIds,
    };

    if (createdAfter) {
      params['CreatedAfter'] = createdAfter;
    }
    if (statuses && statuses.length > 0) {
      params['OrderStatuses'] = statuses.join(',');
    }

    interface SPOrdersResponse {
      payload: {
        Orders: Array<{
          AmazonOrderId: string;
          OrderStatus: string;
          PurchaseDate: string;
          OrderTotal?: { Amount: string; CurrencyCode: string };
          BuyerInfo?: { BuyerName?: string };
          ShippingAddress?: { City?: string; StateOrRegion?: string; CountryCode?: string };
        }>;
      };
    }

    const response = await this.apiRequest<SPOrdersResponse>(
      'GET',
      '/orders/v0/orders',
      undefined,
      params,
    );

    return response.payload.Orders.map((order) => ({
      marketplace: 'amazon' as const,
      orderId: order.AmazonOrderId,
      status: order.OrderStatus,
      orderDate: order.PurchaseDate,
      totalAmount: order.OrderTotal ? parseFloat(order.OrderTotal.Amount) : 0,
      currency: order.OrderTotal?.CurrencyCode ?? 'USD',
      items: [], // Items require a separate call per order
      buyerName: order.BuyerInfo?.BuyerName,
      shippingAddress: order.ShippingAddress
        ? [
            order.ShippingAddress.City,
            order.ShippingAddress.StateOrRegion,
            order.ShippingAddress.CountryCode,
          ]
            .filter(Boolean)
            .join(', ')
        : undefined,
    }));
  }

  /**
   * Fetch line items for a specific order.
   */
  async getOrderItems(orderId: string): Promise<MarketplaceOrderItem[]> {
    interface SPOrderItemsResponse {
      payload: {
        OrderItems: Array<{
          SellerSKU: string;
          ASIN: string;
          Title: string;
          QuantityOrdered: number;
          ItemPrice?: { Amount: string };
        }>;
      };
    }

    const response = await this.apiRequest<SPOrderItemsResponse>(
      'GET',
      `/orders/v0/orders/${encodeURIComponent(orderId)}/orderItems`,
    );

    return response.payload.OrderItems.map((item) => ({
      sku: item.SellerSKU,
      asin: item.ASIN,
      title: item.Title,
      quantity: item.QuantityOrdered,
      price: item.ItemPrice ? parseFloat(item.ItemPrice.Amount) : 0,
    }));
  }

  // ── FBA Inventory API ───────────────────────────────────────────────────

  /**
   * Fetch FBA inventory summaries.
   * @param nextToken Pagination token from a previous call.
   */
  async getInventorySummaries(
    nextToken?: string,
  ): Promise<MarketplaceInventoryItem[]> {
    const amazon = this.credentials.amazon!;
    const marketplaceIds = amazon.marketplaceIds?.[0]
      ?? Object.values(AMAZON_REGIONS[this.region].marketplaceIds)[0];

    const params: Record<string, string> = {
      details: 'true',
      granularityType: 'Marketplace',
      granularityId: marketplaceIds ?? '',
      marketplaceIds: marketplaceIds ?? '',
    };

    if (nextToken) {
      params['nextToken'] = nextToken;
    }

    interface SPInventoryResponse {
      payload: {
        inventorySummaries: Array<{
          sellerSku: string;
          asin: string;
          productName: string;
          totalQuantity: number;
          fulfillableQuantity: number;
          inboundReceivingQuantity: number;
          reservedQuantity?: { totalReservedQuantity: number };
        }>;
      };
    }

    const response = await this.apiRequest<SPInventoryResponse>(
      'GET',
      '/fba/inventory/v1/summaries',
      undefined,
      params,
    );

    return response.payload.inventorySummaries.map((item) => ({
      marketplace: 'amazon' as const,
      sku: item.sellerSku,
      asin: item.asin,
      title: item.productName,
      quantity: item.totalQuantity,
      fulfillableQuantity: item.fulfillableQuantity,
      inboundQuantity: item.inboundReceivingQuantity,
      reservedQuantity: item.reservedQuantity?.totalReservedQuantity,
      status: item.fulfillableQuantity > 0 ? 'In Stock' : 'Out of Stock',
    }));
  }

  // ── Listings API ────────────────────────────────────────────────────────

  /**
   * Fetch a specific listing by seller ID and SKU.
   */
  async getListings(
    sellerId: string,
    sku: string,
  ): Promise<MarketplaceListing> {
    const amazon = this.credentials.amazon!;
    const marketplaceIds = amazon.marketplaceIds ?? Object.values(AMAZON_REGIONS[this.region].marketplaceIds);

    const params: Record<string, string> = {
      marketplaceIds: marketplaceIds.join(','),
      includedData: 'summaries,attributes,offers',
    };

    interface SPListingsResponse {
      sku: string;
      summaries?: Array<{
        asin: string;
        productType: string;
        status: string[];
        itemName: string;
        mainImage?: { link: string };
        conditionType?: string;
      }>;
      offers?: Array<{
        offerType: string;
        price: { Amount: number; CurrencyCode: string };
      }>;
    }

    const response = await this.apiRequest<SPListingsResponse>(
      'GET',
      `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(sku)}`,
      undefined,
      params,
    );

    const summary = response.summaries?.[0];
    const offer = response.offers?.[0];

    return {
      marketplace: 'amazon' as const,
      sku: response.sku,
      asin: summary?.asin,
      title: summary?.itemName ?? sku,
      price: offer?.price?.Amount ?? 0,
      status: summary?.status?.join(', ') ?? 'Unknown',
      condition: summary?.conditionType,
      imageUrl: summary?.mainImage?.link,
    };
  }

  // ── Catalog API ─────────────────────────────────────────────────────────

  /**
   * Fetch catalog item details by ASIN.
   */
  async getCatalogItem(asin: string): Promise<{
    asin: string;
    title: string;
    brand?: string;
    imageUrl?: string;
    salesRank?: number;
    category?: string;
  }> {
    const amazon = this.credentials.amazon!;
    const marketplaceIds = amazon.marketplaceIds ?? Object.values(AMAZON_REGIONS[this.region].marketplaceIds);

    const params: Record<string, string> = {
      marketplaceIds: marketplaceIds.join(','),
      includedData: 'summaries,images,salesRanks',
    };

    interface SPCatalogResponse {
      asin: string;
      summaries?: Array<{
        marketplaceId: string;
        itemName: string;
        brand?: string;
        itemClassification?: string;
      }>;
      images?: Array<{
        marketplaceId: string;
        images: Array<{ link: string; variant: string }>;
      }>;
      salesRanks?: Array<{
        marketplaceId: string;
        classificationRanks?: Array<{
          classificationId: string;
          title: string;
          rank: number;
        }>;
      }>;
    }

    const response = await this.apiRequest<SPCatalogResponse>(
      'GET',
      `/catalog/2022-04-01/items/${encodeURIComponent(asin)}`,
      undefined,
      params,
    );

    const summary = response.summaries?.[0];
    const mainImage = response.images?.[0]?.images?.find((i) => i.variant === 'MAIN');
    const topRank = response.salesRanks?.[0]?.classificationRanks?.[0];

    return {
      asin: response.asin,
      title: summary?.itemName ?? asin,
      brand: summary?.brand,
      imageUrl: mainImage?.link,
      salesRank: topRank?.rank,
      category: topRank?.title,
    };
  }

  // ── FBA Inbound Shipments ───────────────────────────────────────────────

  /**
   * Fetch current FBA inbound shipments.
   * Uses the inbound eligibility/shipment API.
   */
  async getInboundShipments(): Promise<FBAShipment[]> {
    const params: Record<string, string> = {
      ShipmentStatusList: 'WORKING,READY_TO_SHIP,SHIPPED,RECEIVING,IN_TRANSIT',
      QueryType: 'SHIPMENT',
    };

    interface SPShipmentResponse {
      payload: {
        ShipmentData: Array<{
          ShipmentId: string;
          ShipmentName?: string;
          ShipmentStatus: string;
          DestinationFulfillmentCenterId: string;
          CreatedDate?: string;
          Items?: Array<{
            SellerSKU: string;
            ASIN?: string;
            Title?: string;
            QuantityShipped: number;
            QuantityReceived: number;
          }>;
        }>;
      };
    }

    const response = await this.apiRequest<SPShipmentResponse>(
      'GET',
      '/fba/inbound/v0/shipments',
      undefined,
      params,
    );

    return response.payload.ShipmentData.map((shipment) => {
      const items: FBAShipmentItem[] = (shipment.Items ?? []).map((item) => ({
        sku: item.SellerSKU,
        asin: item.ASIN,
        title: item.Title,
        quantityShipped: item.QuantityShipped,
        quantityReceived: item.QuantityReceived,
      }));

      return {
        shipmentId: shipment.ShipmentId,
        shipmentName: shipment.ShipmentName,
        status: shipment.ShipmentStatus,
        destination: shipment.DestinationFulfillmentCenterId,
        createdDate: shipment.CreatedDate ?? new Date().toISOString(),
        itemCount: items.reduce((sum, i) => sum + i.quantityShipped, 0),
        items,
      };
    });
  }

  // ── Account Health ──────────────────────────────────────────────────────

  /**
   * Fetch account health notifications and performance metrics.
   * Uses the notifications-based approach to surface warnings, policy violations,
   * and performance alerts.
   */
  async getAccountHealth(): Promise<AccountHealthNotification[]> {
    const amazon = this.credentials.amazon!;
    const marketplaceIds = amazon.marketplaceIds ?? Object.values(AMAZON_REGIONS[this.region].marketplaceIds);

    // Use the Account Health endpoint for performance data
    const params: Record<string, string> = {
      marketplaceIds: marketplaceIds.join(','),
    };

    interface SPAccountHealthResponse {
      payload?: {
        accountHealthNotifications?: Array<{
          notificationType: string;
          severity: string;
          title: string;
          description: string;
          actionRequired: boolean;
          deadline?: string;
          asin?: string;
          createdAt: string;
        }>;
      };
      // Fallback: some regions return in a different structure
      notifications?: Array<{
        type: string;
        severity: string;
        title: string;
        body: string;
        actionRequired: boolean;
        expirationDate?: string;
        asin?: string;
        timestamp: string;
      }>;
    }

    try {
      const response = await this.apiRequest<SPAccountHealthResponse>(
        'GET',
        '/notifications/v1/notifications',
        undefined,
        params,
      );

      // Handle primary payload structure
      if (response.payload?.accountHealthNotifications) {
        return response.payload.accountHealthNotifications.map((n) => ({
          marketplace: 'amazon' as const,
          type: n.notificationType,
          severity: this.mapSeverity(n.severity),
          title: n.title,
          description: n.description,
          actionRequired: n.actionRequired,
          deadline: n.deadline,
          asin: n.asin,
          createdAt: n.createdAt,
        }));
      }

      // Handle alternative response structure
      if (response.notifications) {
        return response.notifications.map((n) => ({
          marketplace: 'amazon' as const,
          type: n.type,
          severity: this.mapSeverity(n.severity),
          title: n.title,
          description: n.body,
          actionRequired: n.actionRequired,
          deadline: n.expirationDate,
          asin: n.asin,
          createdAt: n.timestamp,
        }));
      }

      return [];
    } catch (err) {
      // If the notifications endpoint is not available, return empty
      // rather than failing the entire health check
      if (
        err instanceof MarketplaceApiError &&
        (err.statusCode === 404 || err.statusCode === 400)
      ) {
        return [];
      }
      throw err;
    }
  }

  // ── Connection Test ─────────────────────────────────────────────────────

  /**
   * Verify that credentials are valid and return basic account info.
   */
  async testConnection(): Promise<{
    success: boolean;
    sellerId?: string;
    marketplaceIds?: string[];
  }> {
    try {
      // Ensure we can get a valid token
      await this.ensureAccessToken();

      const amazon = this.credentials.amazon!;
      const marketplaceIds = amazon.marketplaceIds
        ?? Object.keys(AMAZON_REGIONS[this.region].marketplaceIds);

      // Make a lightweight API call to confirm access
      // getOrders with a very recent filter is cheap and confirms permissions
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

      await this.apiRequest(
        'GET',
        '/orders/v0/orders',
        undefined,
        {
          MarketplaceIds: marketplaceIds.join(','),
          CreatedAfter: fiveMinutesAgo.toISOString(),
        },
      );

      return {
        success: true,
        sellerId: amazon.sellerId,
        marketplaceIds,
      };
    } catch (err) {
      if (err instanceof MarketplaceAuthError) {
        return { success: false };
      }
      // API errors (e.g. 403) also mean connection failed
      if (err instanceof MarketplaceApiError) {
        return { success: false };
      }
      throw err;
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private mapSeverity(severity: string): 'critical' | 'warning' | 'info' {
    const normalized = severity.toLowerCase();
    if (normalized === 'critical' || normalized === 'high') return 'critical';
    if (normalized === 'warning' || normalized === 'medium') return 'warning';
    return 'info';
  }

  // ── Fee Estimation ──────────────────────────────────────────────────────

  /**
   * Get exact fee estimates for an ASIN at a given price.
   * Uses the Product Fees API v0 — returns referral fee, FBA fee, closing fee, etc.
   * Rate limit: 1 request/sec, burst 2.
   */
  async getFeesEstimateForASIN(
    asin: string,
    listingPrice: number,
    isAmazonFulfilled: boolean = true,
    shippingPrice: number = 0,
    currency: string = 'USD',
  ): Promise<AmazonFeeEstimate> {
    const marketplaceId = this.getDefaultMarketplaceId();
    const body = {
      FeesEstimateRequest: {
        MarketplaceId: marketplaceId,
        IsAmazonFulfilled: isAmazonFulfilled,
        PriceToEstimateFees: {
          ListingPrice: { CurrencyCode: currency, Amount: listingPrice },
          Shipping: { CurrencyCode: currency, Amount: shippingPrice },
        },
        Identifier: `hivemind-${asin}-${Date.now()}`,
        ...(isAmazonFulfilled ? { OptionalFulfillmentProgram: 'FBA_CORE' } : {}),
      },
    };

    const response = await this.apiRequest<any>(
      'POST',
      `/products/fees/v0/items/${encodeURIComponent(asin)}/feesEstimate`,
      body,
    );

    const result = response?.payload?.FeesEstimateResult;
    if (!result || result.Status !== 'Success') {
      const errorMsg = result?.Error?.Message || 'Fee estimation failed';
      throw new MarketplaceApiError('amazon', errorMsg, undefined, `/products/fees/v0/items/${asin}/feesEstimate`);
    }

    const estimate = result.FeesEstimate;
    const feeDetails: Record<string, number> = {};

    if (estimate?.FeeDetailList) {
      for (const fee of estimate.FeeDetailList) {
        const feeType = fee.FeeType;
        const amount = fee.FinalFee?.Amount ?? fee.FeeAmount?.Amount ?? 0;
        feeDetails[feeType] = parseFloat(amount) || 0;
      }
    }

    const totalFees = estimate?.TotalFeesEstimate?.Amount
      ? parseFloat(estimate.TotalFeesEstimate.Amount)
      : Object.values(feeDetails).reduce((sum: number, v: number) => sum + v, 0);

    return {
      asin,
      marketplaceId,
      listingPrice,
      isAmazonFulfilled,
      totalFees,
      currency: estimate?.TotalFeesEstimate?.CurrencyCode || currency,
      feeBreakdown: {
        referralFee: feeDetails['ReferralFee'] || 0,
        fulfillmentFee: feeDetails['FBAFees'] || feeDetails['FBAPerUnitFulfillmentFee'] || 0,
        variableClosingFee: feeDetails['VariableClosingFee'] || 0,
        perItemFee: feeDetails['PerItemFee'] || 0,
        digitalServicesFee: feeDetails['DigitalServicesFee'] || 0,
      },
      allFees: feeDetails,
    };
  }

  /**
   * Batch fee estimation for up to 20 items at once.
   * Each item is identified by ASIN or SKU.
   */
  async getFeesEstimateBatch(
    items: Array<{
      asin?: string;
      sku?: string;
      listingPrice: number;
      isAmazonFulfilled?: boolean;
      shippingPrice?: number;
    }>,
    currency: string = 'USD',
  ): Promise<AmazonFeeEstimate[]> {
    const marketplaceId = this.getDefaultMarketplaceId();

    const requestBody = items.slice(0, 20).map((item, idx) => ({
      FeesEstimateRequest: {
        MarketplaceId: marketplaceId,
        IsAmazonFulfilled: item.isAmazonFulfilled ?? true,
        PriceToEstimateFees: {
          ListingPrice: { CurrencyCode: currency, Amount: item.listingPrice },
          Shipping: { CurrencyCode: currency, Amount: item.shippingPrice || 0 },
        },
        Identifier: `hivemind-batch-${idx}`,
        ...((item.isAmazonFulfilled ?? true) ? { OptionalFulfillmentProgram: 'FBA_CORE' } : {}),
      },
      IdType: item.asin ? 'Asin' : 'SellerSKU',
      IdValue: item.asin || item.sku || '',
    }));

    const response = await this.apiRequest<any>(
      'POST',
      '/products/fees/v0/feesEstimate',
      requestBody as any,
    );

    const results: AmazonFeeEstimate[] = [];
    for (const r of (response || [])) {
      if (r.Status === 'Success' && r.FeesEstimateResult?.FeesEstimate) {
        const estimate = r.FeesEstimateResult.FeesEstimate;
        const feeDetails: Record<string, number> = {};
        if (estimate.FeeDetailList) {
          for (const fee of estimate.FeeDetailList) {
            feeDetails[fee.FeeType] = parseFloat(fee.FinalFee?.Amount ?? fee.FeeAmount?.Amount ?? 0) || 0;
          }
        }
        const id = r.FeesEstimateResult?.FeesEstimateIdentifier;
        results.push({
          asin: id?.IdValue || '',
          marketplaceId: id?.MarketplaceId || marketplaceId,
          listingPrice: id?.PriceToEstimateFees?.ListingPrice?.Amount || 0,
          isAmazonFulfilled: id?.IsAmazonFulfilled ?? true,
          totalFees: parseFloat(estimate.TotalFeesEstimate?.Amount) || 0,
          currency: estimate.TotalFeesEstimate?.CurrencyCode || currency,
          feeBreakdown: {
            referralFee: feeDetails['ReferralFee'] || 0,
            fulfillmentFee: feeDetails['FBAFees'] || feeDetails['FBAPerUnitFulfillmentFee'] || 0,
            variableClosingFee: feeDetails['VariableClosingFee'] || 0,
            perItemFee: feeDetails['PerItemFee'] || 0,
            digitalServicesFee: feeDetails['DigitalServicesFee'] || 0,
          },
          allFees: feeDetails,
        });
      }
    }
    return results;
  }

  private getDefaultMarketplaceId(): string {
    const marketplaceIds = this.credentials.amazon?.marketplaceIds;
    if (marketplaceIds && marketplaceIds.length > 0) return marketplaceIds[0]!;
    // Fallback to US marketplace
    const regionConfig = AMAZON_REGIONS[this.region];
    return regionConfig.marketplaceIds['US'] || 'ATVPDKIKX0DER';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ── Fee Estimate Types ──────────────────────────────────────────────────────

export interface AmazonFeeEstimate {
  asin: string;
  marketplaceId: string;
  listingPrice: number;
  isAmazonFulfilled: boolean;
  totalFees: number;
  currency: string;
  feeBreakdown: {
    referralFee: number;
    fulfillmentFee: number;
    variableClosingFee: number;
    perItemFee: number;
    digitalServicesFee: number;
  };
  /** All fee types returned by Amazon, keyed by FeeType name */
  allFees: Record<string, number>;
}
