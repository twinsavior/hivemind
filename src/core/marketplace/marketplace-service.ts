// ── Unified Marketplace Service ──────────────────────────────────────────────
// Single entry point for all marketplace operations. Aggregates data across
// Amazon, Walmart, and eBay into unified views (orders, inventory, health).

import { AmazonSPAPI } from './amazon-sp-api.js';
import { WalmartAPI } from './walmart-api.js';
import { EbayAPI } from './ebay-api.js';
import { loadCredentials, saveMarketplaceCredentials, removeMarketplaceCredentials, getConnectedMarketplaces } from './credentials.js';
import type {
  MarketplaceType,
  MarketplaceCredentials,
  MarketplaceOrder,
  MarketplaceInventoryItem,
  MarketplaceListing,
  FBAShipment,
  AccountHealthNotification,
  MarketplaceSummary,
  DailyBriefing,
  MarketplaceHealth,
  BriefingCoverage,
} from './types.js';

export class MarketplaceService {
  private amazon: AmazonSPAPI | null = null;
  private walmart: WalmartAPI | null = null;
  private ebay: EbayAPI | null = null;

  private healthMap = new Map<string, {
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastError: string | null;
  }>();

  constructor() {
    this.initializeClients();
  }

  private recordSuccess(mp: MarketplaceType): void {
    this.healthMap.set(mp, {
      ...this.healthMap.get(mp),
      lastSuccessAt: new Date().toISOString(),
      lastErrorAt: this.healthMap.get(mp)?.lastErrorAt ?? null,
      lastError: this.healthMap.get(mp)?.lastError ?? null,
    });
  }

  private recordFailure(mp: MarketplaceType, error: string): void {
    this.healthMap.set(mp, {
      ...this.healthMap.get(mp),
      lastSuccessAt: this.healthMap.get(mp)?.lastSuccessAt ?? null,
      lastErrorAt: new Date().toISOString(),
      lastError: error,
    });
  }

  /** Re-initialize clients from stored credentials. */
  initializeClients(): void {
    const store = loadCredentials();

    if (store.credentials.amazon?.connected && store.credentials.amazon.amazon) {
      try { this.amazon = new AmazonSPAPI(store.credentials.amazon); } catch { this.amazon = null; }
    } else { this.amazon = null; }

    if (store.credentials.walmart?.connected && store.credentials.walmart.walmart) {
      try { this.walmart = new WalmartAPI(store.credentials.walmart); } catch { this.walmart = null; }
    } else { this.walmart = null; }

    if (store.credentials.ebay?.connected && store.credentials.ebay.ebay) {
      try { this.ebay = new EbayAPI(); } catch { this.ebay = null; }
    } else { this.ebay = null; }
  }

  // ── Connection Status ────────────────────────────────────────────────────

  getConnectedMarketplaces(): MarketplaceType[] {
    return getConnectedMarketplaces();
  }

  getConnectionStatus(): Record<MarketplaceType, { connected: boolean; connectedAt?: string }> {
    const store = loadCredentials();
    return {
      amazon: {
        connected: store.credentials.amazon?.connected ?? false,
        connectedAt: store.credentials.amazon?.connectedAt,
      },
      walmart: {
        connected: store.credentials.walmart?.connected ?? false,
        connectedAt: store.credentials.walmart?.connectedAt,
      },
      ebay: {
        connected: store.credentials.ebay?.connected ?? false,
        connectedAt: store.credentials.ebay?.connectedAt,
      },
    };
  }

  /** Get health status for all marketplaces, combining connection + API health tracking. */
  getHealthStatus(): Record<string, MarketplaceHealth> {
    const connectionStatus = this.getConnectionStatus();
    const result: Record<string, MarketplaceHealth> = {};

    for (const mp of ['amazon', 'walmart', 'ebay'] as MarketplaceType[]) {
      const conn = connectionStatus[mp];
      const health = this.healthMap.get(mp);
      const lastSuccess = health?.lastSuccessAt ? new Date(health.lastSuccessAt).getTime() : null;
      const lastError = health?.lastErrorAt ? new Date(health.lastErrorAt).getTime() : null;

      result[mp] = {
        marketplace: mp,
        connected: conn.connected,
        healthy: conn.connected && (!lastError || (lastSuccess !== null && lastSuccess > lastError)),
        lastSuccessAt: health?.lastSuccessAt ?? null,
        lastErrorAt: health?.lastErrorAt ?? null,
        lastError: health?.lastError ?? null,
        dataFreshnessMs: lastSuccess ? Date.now() - lastSuccess : null,
      };
    }
    return result;
  }

  // ── Connect / Disconnect ───────���─────────────────────────────────────────

  /** Connect Amazon with SP-API credentials. */
  async connectAmazon(clientId: string, clientSecret: string, refreshToken: string, region: 'na' | 'eu' | 'fe' = 'na'): Promise<{ success: boolean; error?: string; sellerId?: string }> {
    const creds: MarketplaceCredentials = {
      marketplace: 'amazon',
      connected: false,
      amazon: { clientId, clientSecret, refreshToken, region },
    };
    try {
      const client = new AmazonSPAPI(creds);
      const result = await client.testConnection();
      if (result.success) {
        creds.connected = true;
        creds.connectedAt = new Date().toISOString();
        creds.amazon!.sellerId = result.sellerId;
        creds.amazon!.marketplaceIds = result.marketplaceIds;
        saveMarketplaceCredentials('amazon', creds);
        this.amazon = client;
        return { success: true, sellerId: result.sellerId };
      }
      return { success: false, error: 'Connection test failed' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  /** Connect Walmart with API credentials. */
  async connectWalmart(clientId: string, clientSecret: string): Promise<{ success: boolean; error?: string }> {
    const creds: MarketplaceCredentials = {
      marketplace: 'walmart',
      connected: false,
      walmart: { clientId, clientSecret },
    };
    try {
      const client = new WalmartAPI(creds);
      const result = await client.testConnection();
      if (result.success) {
        creds.connected = true;
        creds.connectedAt = new Date().toISOString();
        saveMarketplaceCredentials('walmart', creds);
        this.walmart = client;
        return { success: true };
      }
      return { success: false, error: 'Connection test failed' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  /** Get eBay authorization URL for OAuth consent flow. */
  getEbayAuthUrl(state?: string): string {
    // Need temporary credentials to build the URL
    const store = loadCredentials();
    const creds = store.credentials.ebay;
    if (!creds?.ebay) throw new Error('eBay credentials not configured. Set clientId, clientSecret, and redirectUri first.');
    const client = new EbayAPI();
    return client.getAuthorizationUrl(state);
  }

  /** Complete eBay OAuth flow with the authorization code. */
  async connectEbayWithCode(code: string): Promise<{ success: boolean; error?: string; userId?: string }> {
    try {
      const client = new EbayAPI();
      await client.exchangeAuthorizationCode(code);
      const result = await client.testConnection();
      if (result.success) {
        this.ebay = client;
        return { success: true, userId: result.userId };
      }
      return { success: false, error: 'Connection test failed after code exchange' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  /** Pre-configure eBay app credentials before OAuth flow. */
  configureEbayApp(clientId: string, clientSecret: string, redirectUri: string, environment: 'production' | 'sandbox' = 'production'): void {
    const creds: MarketplaceCredentials = {
      marketplace: 'ebay',
      connected: false,
      ebay: { clientId, clientSecret, redirectUri, environment },
    };
    saveMarketplaceCredentials('ebay', creds);
  }

  /** Disconnect a marketplace. */
  disconnect(marketplace: MarketplaceType): void {
    removeMarketplaceCredentials(marketplace);
    if (marketplace === 'amazon') this.amazon = null;
    if (marketplace === 'walmart') this.walmart = null;
    if (marketplace === 'ebay') this.ebay = null;
  }

  // ── Unified Data Fetching ────────────────────────────────────────────────

  /** Get orders across all connected marketplaces. */
  async getAllOrders(since?: string): Promise<MarketplaceOrder[]> {
    const orders: MarketplaceOrder[] = [];
    const promises: Promise<void>[] = [];

    if (this.amazon) {
      promises.push(
        this.amazon.getOrders(since).then(o => { orders.push(...o); this.recordSuccess('amazon'); }).catch(err => {
          console.warn('[Marketplace] Amazon orders fetch failed:', err.message);
          this.recordFailure('amazon', err.message);
        }),
      );
    }
    if (this.walmart) {
      promises.push(
        this.walmart.getOrders(since).then(o => { orders.push(...o); this.recordSuccess('walmart'); }).catch(err => {
          console.warn('[Marketplace] Walmart orders fetch failed:', err.message);
          this.recordFailure('walmart', err.message);
        }),
      );
    }
    if (this.ebay) {
      promises.push(
        this.ebay.getOrders().then(o => { orders.push(...o); this.recordSuccess('ebay'); }).catch(err => {
          console.warn('[Marketplace] eBay orders fetch failed:', err.message);
          this.recordFailure('ebay', err.message);
        }),
      );
    }

    await Promise.all(promises);
    return orders.sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
  }

  /** Get inventory across all connected marketplaces. */
  async getAllInventory(): Promise<MarketplaceInventoryItem[]> {
    const inventory: MarketplaceInventoryItem[] = [];
    const promises: Promise<void>[] = [];

    if (this.amazon) {
      promises.push(
        this.amazon.getInventorySummaries().then(items => { inventory.push(...items); this.recordSuccess('amazon'); }).catch(err => {
          console.warn('[Marketplace] Amazon inventory fetch failed:', err.message);
          this.recordFailure('amazon', err.message);
        }),
      );
    }
    if (this.ebay) {
      promises.push(
        this.ebay.getInventoryItems().then(items => { inventory.push(...items); this.recordSuccess('ebay'); }).catch(err => {
          console.warn('[Marketplace] eBay inventory fetch failed:', err.message);
          this.recordFailure('ebay', err.message);
        }),
      );
    }

    await Promise.all(promises);
    return inventory;
  }

  /** Get FBA shipments (Amazon only). */
  async getFBAShipments(): Promise<FBAShipment[]> {
    if (!this.amazon) return [];
    try {
      const result = await this.amazon.getInboundShipments();
      this.recordSuccess('amazon');
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[Marketplace] FBA shipments fetch failed:', message);
      this.recordFailure('amazon', message);
      return [];
    }
  }

  /** Get account health alerts across all connected marketplaces. */
  async getAccountHealthAlerts(): Promise<AccountHealthNotification[]> {
    const alerts: AccountHealthNotification[] = [];
    const promises: Promise<void>[] = [];

    if (this.amazon) {
      promises.push(
        this.amazon.getAccountHealth().then(a => { alerts.push(...a); this.recordSuccess('amazon'); }).catch(err => {
          console.warn('[Marketplace] Amazon health fetch failed:', err.message);
          this.recordFailure('amazon', err.message);
        }),
      );
    }

    // Walmart and eBay don't have direct account health notification APIs,
    // but we can check for policy issues through order/return patterns
    await Promise.all(promises);
    return alerts.sort((a, b) => {
      const severity = { critical: 0, warning: 1, info: 2 };
      return severity[a.severity] - severity[b.severity];
    });
  }

  // ── Daily Briefing ───────────────────────────────────────────────────────

  /** Generate a daily briefing across all connected marketplaces. */
  async getDailyBriefing(): Promise<DailyBriefing> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const since = yesterday.toISOString();

    const [orders, alerts, shipments] = await Promise.all([
      this.getAllOrders(since),
      this.getAccountHealthAlerts(),
      this.getFBAShipments(),
    ]);

    const totalRevenue = orders.reduce((sum, o) => sum + o.totalAmount, 0);
    const activeShipments = shipments.filter(s =>
      ['WORKING', 'SHIPPED', 'RECEIVING', 'IN_TRANSIT'].includes(s.status),
    ).length;

    const suggestedActions: string[] = [];
    const criticalAlerts = alerts.filter(a => a.severity === 'critical');
    if (criticalAlerts.length > 0) {
      suggestedActions.push(`Address ${criticalAlerts.length} critical account health alert(s)`);
    }
    if (activeShipments > 0) {
      suggestedActions.push(`${activeShipments} FBA shipment(s) in transit — check receiving status`);
    }

    // Build per-marketplace summaries
    const summaries: MarketplaceSummary[] = [];
    const connected = this.getConnectedMarketplaces();

    for (const mp of connected) {
      const mpOrders = orders.filter(o => o.marketplace === mp);
      const mpAlerts = alerts.filter(a => a.marketplace === mp);
      summaries.push({
        marketplace: mp,
        connected: true,
        activeListings: 0, // Would need a separate call — skip for briefing speed
        pendingOrders: mpOrders.length,
        recentRevenue: mpOrders.reduce((sum, o) => sum + o.totalAmount, 0),
        alerts: mpAlerts,
      });
    }

    // Build coverage info from health tracking
    const coverage: BriefingCoverage = { responded: [], failed: [] };
    for (const mp of connected) {
      const health = this.healthMap.get(mp);
      const lastSuccess = health?.lastSuccessAt ? new Date(health.lastSuccessAt).getTime() : null;
      const lastError = health?.lastErrorAt ? new Date(health.lastErrorAt).getTime() : null;
      if (lastError && (!lastSuccess || lastError > lastSuccess)) {
        coverage.failed.push({ marketplace: mp, error: health?.lastError ?? 'Unknown error' });
      } else {
        coverage.responded.push(mp);
      }
    }

    return {
      date: new Date().toISOString().split('T')[0]!,
      summaries,
      totalOrders: orders.length,
      totalRevenue,
      activeShipments,
      alerts,
      suggestedActions,
      coverage,
    };
  }

  // ── Per-Marketplace Client Access ────────────────────────────────────────
  // For when agents need direct access to a specific marketplace client.

  getAmazonClient(): AmazonSPAPI | null { return this.amazon; }
  getWalmartClient(): WalmartAPI | null { return this.walmart; }
  getEbayClient(): EbayAPI | null { return this.ebay; }
}

// Singleton instance
let _instance: MarketplaceService | null = null;

export function getMarketplaceService(): MarketplaceService {
  if (!_instance) _instance = new MarketplaceService();
  return _instance;
}
