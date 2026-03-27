// ── Finance Module Routes ────────────────────────────────────────────────────
// Express router for SimpleFIN integration, spending capacity, and pipeline tracking.
// Mount at /api/finance/* on the dashboard server.

import { Router } from 'express';
import {
  claimSetupToken,
  syncAccounts,
  isSimpleFINConnected,
  saveSimpleFINAccessUrl,
  removeSimpleFINCredentials,
  loadSimpleFINAccessUrl,
} from './simplefin-client.js';
import {
  initPipelineSchema,
  createBatch,
  getBatches,
  getBatch,
  updateBatchStatus,
  updateBatch,
  deleteBatch,
  getPipelineSummary,
  createPrepCenter,
  getPrepCenters,
  getPrepCenter,
  updatePrepCenter,
  deletePrepCenter,
} from './pipeline.js';
import { calculateFromFeeTable, calculateAmazonProfitFromAPI, getWalmartCategories, getEbayCategories } from './profitability.js';
import {
  initFinanceDB,
  getAccounts,
  getAccount,
  updateAccountType,
  hideAccount,
  upsertAccount,
  upsertTransactions,
  getTransactions,
  categorizeTransaction,
  getSpendingCapacity,
  logSync,
  getLastSync,
  autoCategorizeAll,
  autoCategorizeTransaction,
  createEmployee,
  getEmployees,
  getEmployee,
  updateEmployee,
  deleteEmployee,
  assignAccountToEmployee,
  getEmployeeSpending,
} from './db.js';

export function createFinanceRouter(dataDir: string): Router {
  // Initialize the DB + pipeline schema on first use
  initFinanceDB(dataDir);
  initPipelineSchema();

  const router = Router();

  // ── Connection Status ─────────────────────────────────────────────────

  router.get('/status', (_req, res) => {
    const connected = isSimpleFINConnected();
    const creds = loadSimpleFINAccessUrl();
    const lastSync = getLastSync();
    res.json({
      connected,
      connectedAt: creds?.connectedAt || null,
      lastSyncAt: creds?.lastSyncAt || lastSync?.synced_at || null,
    });
  });

  // ── Connect (claim setup token) ───────────────────────────────────────

  router.post('/connect', async (req, res) => {
    const { setupToken } = req.body;
    if (!setupToken || typeof setupToken !== 'string') {
      return res.status(400).json({ error: 'Missing setupToken' });
    }

    try {
      const accessUrl = await claimSetupToken(setupToken.trim());
      saveSimpleFINAccessUrl(accessUrl);

      // Immediately sync to populate accounts
      const data = await syncAccounts({ balancesOnly: false });
      if (data) {
        let txnCount = 0;
        for (const acct of data.accounts) {
          upsertAccount(acct);
          if (acct.transactions) {
            txnCount += upsertTransactions(acct.id, acct.transactions);
          }
        }
        autoCategorizeAll();
        logSync(data.accounts.length, txnCount);
      }

      res.json({
        success: true,
        accountCount: data?.accounts.length || 0,
        accounts: (data?.accounts || []).map(a => ({
          id: a.id,
          name: a.name,
          institution: a.org?.name || null,
          balance: a.balance,
          availableBalance: a['available-balance'],
        })),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to connect';
      res.status(400).json({ error: message });
    }
  });

  // ── Disconnect ────────────────────────────────────────────────────────

  router.post('/disconnect', (_req, res) => {
    removeSimpleFINCredentials();
    res.json({ success: true });
  });

  // ── Sync (manual trigger) ─────────────────────────────────────────────

  router.post('/sync', async (_req, res) => {
    if (!isSimpleFINConnected()) {
      return res.status(400).json({ error: 'SimpleFIN not connected' });
    }

    try {
      // Fetch last 30 days of transactions
      const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
      const data = await syncAccounts({ startDate: thirtyDaysAgo });

      if (data) {
        let txnCount = 0;
        for (const acct of data.accounts) {
          upsertAccount(acct);
          if (acct.transactions) {
            txnCount += upsertTransactions(acct.id, acct.transactions);
          }
        }
        const categorized = autoCategorizeAll();
        logSync(data.accounts.length, txnCount);

        res.json({
          success: true,
          accountsSynced: data.accounts.length,
          transactionsSynced: txnCount,
          autoCategorized: categorized,
          errors: data.errors.length > 0 ? data.errors : undefined,
        });
      } else {
        res.status(500).json({ error: 'Sync returned no data' });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sync failed';
      res.status(500).json({ error: message });
    }
  });

  // ── Accounts ──────────────────────────────────────────────────────────

  router.get('/accounts', (_req, res) => {
    res.json({ accounts: getAccounts() });
  });

  router.put('/accounts/:id', (req, res) => {
    const { accountType, creditLimit, hidden } = req.body;
    if (accountType) updateAccountType(req.params.id, accountType, creditLimit);
    if (hidden !== undefined) hideAccount(req.params.id, hidden);
    res.json({ success: true, account: getAccount(req.params.id) });
  });

  // ── Transactions ──────────────────────────────────────────────────────

  router.get('/transactions', (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const options = {
      accountId: q['account_id'],
      category: q['category'],
      startDate: q['start_date'],
      endDate: q['end_date'],
      limit: q['limit'] ? parseInt(q['limit'], 10) : 100,
      offset: q['offset'] ? parseInt(q['offset'], 10) : 0,
    };
    res.json(getTransactions(options));
  });

  router.put('/transactions/:id/categorize', (req, res) => {
    const { accountId, category, notes } = req.body;
    if (!accountId || !category) {
      return res.status(400).json({ error: 'Missing accountId or category' });
    }
    categorizeTransaction(req.params.id, accountId, category, notes);
    res.json({ success: true });
  });

  // ── Spending Capacity ─────────────────────────────────────────────────

  router.get('/capacity', (_req, res) => {
    const capacity = getSpendingCapacity();
    res.json(capacity);
  });

  // ── Summary (for dashboard + agent context) ───────────────────────────

  router.get('/summary', (_req, res) => {
    if (!isSimpleFINConnected()) {
      return res.json({ connected: false });
    }
    const capacity = getSpendingCapacity();
    const lastSync = getLastSync();
    res.json({
      connected: true,
      lastSyncAt: lastSync?.synced_at || null,
      totalAvailableCredit: capacity.totalAvailableCredit,
      totalCreditLimit: capacity.totalCreditLimit,
      spentThisWeek: capacity.spentThisWeek,
      spentToday: capacity.spentToday,
      accountCount: capacity.accounts.length,
      accounts: capacity.accounts.map(a => ({
        name: a.name,
        institution: a.institution,
        type: a.accountType,
        balance: a.balance,
        availableCredit: a.availableCredit,
        creditLimit: a.creditLimit,
      })),
    });
  });

  // ── Pipeline (Source-to-Sale) ─────────────────────────────────────────

  router.get('/pipeline/summary', (_req, res) => {
    res.json(getPipelineSummary());
  });

  router.get('/pipeline/batches', (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    res.json(getBatches({
      status: q['status'],
      limit: q['limit'] ? parseInt(q['limit'], 10) : 50,
      offset: q['offset'] ? parseInt(q['offset'], 10) : 0,
    }));
  });

  router.get('/pipeline/batches/:id', (req, res) => {
    const batch = getBatch(parseInt(req.params.id, 10));
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    res.json(batch);
  });

  router.post('/pipeline/batches', (req, res) => {
    const { name, source, prepCenter, notes, items } = req.body;
    if (!name || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Missing name or items' });
    }
    try {
      const id = createBatch({ name, source, prepCenter, notes, items });
      res.json({ success: true, id, batch: getBatch(id) });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create batch' });
    }
  });

  router.put('/pipeline/batches/:id', (req, res) => {
    try {
      updateBatch(parseInt(req.params.id, 10), req.body);
      res.json({ success: true, batch: getBatch(parseInt(req.params.id, 10)) });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update batch' });
    }
  });

  router.post('/pipeline/batches/:id/status', (req, res) => {
    const { status, notes } = req.body;
    if (!status) return res.status(400).json({ error: 'Missing status' });
    try {
      updateBatchStatus(parseInt(req.params.id, 10), status, notes);
      res.json({ success: true, batch: getBatch(parseInt(req.params.id, 10)) });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid status transition' });
    }
  });

  router.delete('/pipeline/batches/:id', (req, res) => {
    deleteBatch(parseInt(req.params.id, 10));
    res.json({ success: true });
  });

  // ── Employees / VAs ──────────────────────────────────────────────────────

  router.get('/employees', (_req, res) => {
    res.json({ employees: getEmployees() });
  });

  router.get('/employees/spending', (_req, res) => {
    res.json({ employees: getEmployeeSpending() });
  });

  router.get('/employees/:id', (req, res) => {
    const emp = getEmployee(parseInt(req.params.id, 10));
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    res.json(emp);
  });

  router.post('/employees', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const id = createEmployee(req.body);
    res.json({ success: true, id, employee: getEmployee(id) });
  });

  router.put('/employees/:id', (req, res) => {
    updateEmployee(parseInt(req.params.id, 10), req.body);
    res.json({ success: true, employee: getEmployee(parseInt(req.params.id, 10)) });
  });

  router.delete('/employees/:id', (req, res) => {
    deleteEmployee(parseInt(req.params.id, 10));
    res.json({ success: true });
  });

  router.post('/accounts/:id/assign', (req, res) => {
    const { employeeId } = req.body;
    assignAccountToEmployee(req.params.id, employeeId ?? null);
    res.json({ success: true });
  });

  // ── Prep Centers ─────────────────────────────────────────────────────────

  router.get('/prep-centers', (_req, res) => {
    res.json({ prepCenters: getPrepCenters() });
  });

  router.get('/prep-centers/:id', (req, res) => {
    const center = getPrepCenter(parseInt(req.params.id, 10));
    if (!center) return res.status(404).json({ error: 'Prep center not found' });
    res.json(center);
  });

  router.post('/prep-centers', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const id = createPrepCenter(req.body);
    res.json({ success: true, id, prepCenter: getPrepCenter(id) });
  });

  router.put('/prep-centers/:id', (req, res) => {
    updatePrepCenter(parseInt(req.params.id, 10), req.body);
    res.json({ success: true, prepCenter: getPrepCenter(parseInt(req.params.id, 10)) });
  });

  router.delete('/prep-centers/:id', (req, res) => {
    deletePrepCenter(parseInt(req.params.id, 10));
    res.json({ success: true });
  });

  // ── Profitability Calculator ────────────────────────────────────────────

  router.post('/profitability', async (req, res) => {
    const { salePrice, costOfGoods, marketplace, category, asin, weightOz, prepCost, shippingToFba, quantity, isAmazonFulfilled } = req.body;
    if (salePrice == null || costOfGoods == null) {
      return res.status(400).json({ error: 'Missing salePrice or costOfGoods' });
    }

    const input = {
      salePrice: Number(salePrice),
      costOfGoods: Number(costOfGoods),
      marketplace: marketplace || 'amazon',
      category,
      asin,
      weightOz: weightOz ? Number(weightOz) : undefined,
      prepCost: prepCost ? Number(prepCost) : undefined,
      shippingToFba: shippingToFba ? Number(shippingToFba) : undefined,
      quantity: quantity ? Number(quantity) : undefined,
      isAmazonFulfilled: isAmazonFulfilled ?? true,
    };

    // For Amazon with an ASIN, try the real fee API first
    if (input.marketplace === 'amazon' && input.asin) {
      try {
        // Lazy-import to avoid circular dependency
        const { getMarketplaceService } = await import('../../core/marketplace/marketplace-service.js');
        const svc = getMarketplaceService();
        const amazonClient = svc.getAmazonClient();
        if (amazonClient) {
          const apiResult = await calculateAmazonProfitFromAPI(input, amazonClient);
          if (apiResult) return res.json(apiResult);
        }
      } catch (err) {
        console.warn('[Profitability] Amazon API fee lookup failed, using fee table:', err);
      }
    }

    // Fall back to fee table for all marketplaces
    const result = calculateFromFeeTable(input);
    res.json(result);
  });

  // Fee category lists for UI dropdowns
  router.get('/profitability/categories', (_req, res) => {
    res.json({
      walmart: getWalmartCategories(),
      ebay: getEbayCategories(),
      amazon: 'Use ASIN for exact Amazon fees via API',
    });
  });

  return router;
}
