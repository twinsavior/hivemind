/**
 * Email Module — Express Router
 * Mounts at /api/email/ on Hivemind's Express server.
 * Converted from Email Parsing's Next.js API routes.
 */

import { Router, type Request, type Response } from 'express';
import {
  getAllSettings, getSetting, setSetting,
  getGmailAuth, deleteGmailAuth,
  getImapAuth, setImapAuth, deleteImapAuth,
  getApiKey, setApiKey, deleteApiKey,
  getExtractionConfig,
  getAllRules, getRule, createRule, updateRule, deleteRule,
  getAllDestinations, getDestination, createDestination, updateDestination, deleteDestination,
  getProcessedEmails,
  getLastPipelineRun,
  getBlockedSenders, blockSender, unblockSender,
  getOrders, getOrderStats, getOrderDailyTrend, getOrdersByRetailer,
  getPurchaseStats, getPurchaseSpendTrend, getPurchasesByRetailer,
  getSellerAlerts, getUnacknowledgedAlertCount, acknowledgeAlert, acknowledgeAllAlerts,
  getAllEmailAccounts, getEmailAccount, createEmailAccount, updateEmailAccount, deleteEmailAccount,
  getProcessedEmailStats, getCostToday,
  getPushQueueStats,
} from './db.js';
import { encrypt, decrypt } from './crypto.js';
import { getSchedulerStatus, triggerManualRun, startScheduler } from './scheduler.js';
import { getTemplate, RETAILER_TEMPLATES } from './retailer-templates.js';

// Lazy-load heavy modules only when needed
let _toggleScheduler: ((enabled: boolean) => void) | null = null;
let _updateInterval: ((minutes: number) => void) | null = null;

function getSchedulerControls() {
  if (!_toggleScheduler) {
    const mod = require('./scheduler.js');
    _toggleScheduler = mod.toggleScheduler;
    _updateInterval = mod.updateInterval;
  }
  return { toggleScheduler: _toggleScheduler!, updateInterval: _updateInterval! };
}

const SENSITIVE_CONFIG_KEYS = ['password', 'access_token', 'refresh_token', 'client_secret', 'api_key', 'webhook_url', 'url', 'auth_header_value'];

function maskSensitive(config: Record<string, any>): Record<string, any> {
  const masked = { ...config };
  for (const key of SENSITIVE_CONFIG_KEYS) {
    if (masked[key] && typeof masked[key] === 'string') {
      const val = masked[key] as string;
      masked[key] = val.length > 4 ? '****' + val.slice(-4) : '****';
    }
  }
  return masked;
}

function safeParseJSON(val: any, fallback: any = null): any {
  if (!val) return fallback;
  if (typeof val !== 'string') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

export function createEmailRouter(): Router {
  const router = Router();

  // ── Accounts ─────────────────────────────────────────────────────────────

  router.get('/accounts', (_req: Request, res: Response) => {
    try {
      const accounts = getAllEmailAccounts().map(a => ({
        ...a,
        config: maskSensitive(safeParseJSON(a.config, {})),
        enabled: Boolean(a.enabled),
      }));
      res.json(accounts);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  router.post('/accounts', (req: Request, res: Response) => {
    try {
      const { name, type, email, config, enabled } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
      if (!['imap', 'gmail_oauth'].includes(type)) return res.status(400).json({ error: 'type must be imap or gmail_oauth' });
      if (!email?.trim()) return res.status(400).json({ error: 'email is required' });

      const configObj = config ?? {};
      for (const key of SENSITIVE_CONFIG_KEYS) {
        if (configObj[key]) configObj[key] = encrypt(configObj[key]);
      }

      const id = createEmailAccount({
        name: name.trim(), type, email: email.trim(),
        config: JSON.stringify(configObj), enabled: enabled !== false,
      });
      res.status(201).json({ id });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  router.put('/accounts/:id', (req: Request, res: Response) => {
    try {
      const { name, email, config, enabled } = req.body;
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (email !== undefined) updates.email = email;
      if (enabled !== undefined) updates.enabled = enabled;
      if (config !== undefined) {
        const configObj = { ...config };
        for (const key of SENSITIVE_CONFIG_KEYS) {
          if (configObj[key] && !configObj[key].startsWith('****')) configObj[key] = encrypt(configObj[key]);
        }
        updates.config = JSON.stringify(configObj);
      }
      updateEmailAccount(Number(req.params['id']), updates);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  router.delete('/accounts/:id', (req: Request, res: Response) => {
    try {
      deleteEmailAccount(Number(req.params['id']));
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  router.get('/auth/gmail', (req: Request, res: Response) => {
    try {
      const { getAuthUrl } = require('./gmail-oauth.js');
      const accountId = req.query['account_id'];
      const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const authUrl = getAuthUrl(fullUrl, accountId);
      res.redirect(authUrl);
    } catch (e) {
      res.redirect('/accounts?error=' + encodeURIComponent((e as Error).message));
    }
  });

  router.get('/auth/gmail/callback', async (req: Request, res: Response) => {
    try {
      const { code, error: oauthError, state } = req.query;
      if (oauthError) return res.redirect('/accounts?error=' + encodeURIComponent(String(oauthError)));
      if (!code) return res.status(400).json({ error: 'Missing authorization code' });

      const { exchangeCode } = require('./gmail-oauth.js');
      const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const tokens = await exchangeCode(String(code), fullUrl);

      let accountId: string | null = null;
      if (state) {
        try { accountId = JSON.parse(String(state)).account_id; } catch {}
      }

      if (accountId) {
        const configObj: Record<string, string> = {
          access_token: encrypt(tokens.access_token),
          refresh_token: encrypt(tokens.refresh_token || ''),
          token_expiry: tokens.expiry_date ? String(tokens.expiry_date) : '',
          scopes: tokens.scope || '',
        };
        updateEmailAccount(Number(accountId), {
          config: JSON.stringify(configObj),
          ...(tokens.email ? { email: tokens.email } : {}),
        });
        res.redirect('/accounts?connected=true');
      } else {
        setSetting('connection_type', 'gmail_oauth');
        res.redirect('/?connected=true');
      }
    } catch (e) {
      res.redirect('/accounts?error=' + encodeURIComponent((e as Error).message));
    }
  });

  router.post('/auth/imap', async (req: Request, res: Response) => {
    try {
      const { email, password, host, port = 993, tls = true } = req.body;
      if (!email || !password || !host) return res.status(400).json({ success: false, error: 'email, password, and host are required' });

      const { testImapConnection } = require('./imap-client.js');
      await testImapConnection({ email, password, host, port, tls });

      setImapAuth({ email, password: encrypt(password), host, port, tls });
      setSetting('connection_type', 'imap');
      res.json({ success: true, email });
    } catch (e) { res.status(500).json({ success: false, error: (e as Error).message }); }
  });

  router.delete('/auth/imap', (_req: Request, res: Response) => {
    try {
      deleteImapAuth();
      if (getSetting('connection_type') === 'imap') setSetting('connection_type', 'none');
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: (e as Error).message }); }
  });

  // ── Pipeline ──────────────────────────────────────────────────────────────

  router.get('/pipeline/status', (_req: Request, res: Response) => {
    try {
      const status = getSchedulerStatus();
      const lastRun = getLastPipelineRun();
      const accounts = getAllEmailAccounts();
      res.json({
        ...status,
        lookback_minutes: Number(getSetting('lookback_minutes') || 1440),
        max_emails_per_run: Number(getSetting('max_emails_per_run') || 50),
        last_run_stats: lastRun ? {
          emails_scanned: lastRun.emails_scanned,
          emails_flagged: lastRun.emails_flagged,
          emails_pushed: lastRun.emails_pushed,
          emails_errored: lastRun.emails_errored,
        } : null,
        gmail_connected: Boolean(getGmailAuth()),
        connection_type: getSetting('connection_type') || 'none',
        rules_count: getAllRules().length,
        destinations_count: getAllDestinations().length,
        cost_today: getCostToday(),
        retry_queue: getPushQueueStats(),
        accounts_count: accounts.length,
      });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  router.post('/pipeline/run', async (_req: Request, res: Response) => {
    try {
      const result = await triggerManualRun();
      res.json(result);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  router.post('/pipeline/toggle', (req: Request, res: Response) => {
    try {
      const { enabled } = req.body;
      const { toggleScheduler } = getSchedulerControls();
      toggleScheduler(Boolean(enabled));
      res.json({ ok: true, enabled: Boolean(enabled) });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── Purchases ─────────────────────────────────────────────────────────────

  router.get('/purchases', (req: Request, res: Response) => {
    try {
      if (req.query['dashboard'] === 'true') {
        const granularity = (req.query['granularity'] as string) || 'day';
        const days = Number(req.query['days'] || 30);
        res.json({
          stats: getPurchaseStats('month'),
          spend_trend: getPurchaseSpendTrend(granularity as any, days),
          by_retailer: getPurchasesByRetailer(),
        });
        return;
      }

      const limit = Number(req.query['limit'] || 50);
      const offset = Number(req.query['offset'] || 0);
      const opts: any = { limit, offset };
      if (req.query['retailer']) opts.retailer = req.query['retailer'];
      if (req.query['status']) opts.status = req.query['status'];
      if (req.query['search']) opts.search = req.query['search'];
      if (req.query['date_from']) opts.date_from = req.query['date_from'];
      if (req.query['date_to']) opts.date_to = req.query['date_to'];

      res.json(getOrders(opts));
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── Orders ────────────────────────────────────────────────────────────────

  router.get('/orders', (req: Request, res: Response) => {
    try {
      if (req.query['stats'] === 'true') return res.json(getOrderStats());
      if (req.query['dashboard'] === 'true') {
        return res.json({
          stats: getOrderStats(),
          daily_trend: getOrderDailyTrend(14),
          by_retailer: getOrdersByRetailer(),
        });
      }

      const limit = Number(req.query['limit'] || 50);
      const offset = Number(req.query['offset'] || 0);
      const opts: any = { limit, offset };
      if (req.query['retailer']) opts.retailer = req.query['retailer'];
      if (req.query['status']) opts.status = req.query['status'];
      if (req.query['search']) opts.search = req.query['search'];
      if (req.query['date_from']) opts.date_from = req.query['date_from'];
      if (req.query['date_to']) opts.date_to = req.query['date_to'];

      res.json(getOrders(opts));
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── Seller Alerts ─────────────────────────────────────────────────────────

  router.get('/alerts', (req: Request, res: Response) => {
    try {
      const acknowledged = req.query['acknowledged'] === 'true' ? true
        : req.query['acknowledged'] === 'false' ? false : undefined;
      res.json(getSellerAlerts({
        acknowledged,
        urgency: req.query['urgency'] as string,
        limit: Number(req.query['limit'] || 100),
        offset: Number(req.query['offset'] || 0),
      }));
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  router.get('/alerts/count', (_req: Request, res: Response) => {
    try { res.json({ count: getUnacknowledgedAlertCount() }); }
    catch { res.json({ count: 0 }); }
  });

  router.post('/alerts/acknowledge', (req: Request, res: Response) => {
    try {
      const { id, all } = req.body;
      if (all) { acknowledgeAllAlerts(); }
      else if (id) { acknowledgeAlert(Number(id)); }
      else { return res.status(400).json({ error: 'id or all:true required' }); }
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── Dashboard ─────────────────────────────────────────────────────────────

  router.get('/dashboard', (_req: Request, res: Response) => {
    try {
      const stats = getPurchaseStats('week');
      const unreadAlerts = getUnacknowledgedAlertCount();
      const criticalAlerts = getSellerAlerts({ acknowledged: false, urgency: 'critical', limit: 5 });
      const highAlerts = getSellerAlerts({ acknowledged: false, urgency: 'high', limit: 5 });
      const inTransit = getOrders({ limit: 500, status: 'shipped' });
      const recentOrders = getOrders({ limit: 8 });
      const recentAlerts = getSellerAlerts({ limit: 8 });
      const accounts = getAllEmailAccounts();

      res.json({
        spent_this_week: stats?.total_spend ?? 0,
        in_transit: inTransit?.total ?? 0,
        unread_alerts: unreadAlerts,
        critical_alerts: criticalAlerts?.rows ?? [],
        high_alerts: highAlerts?.rows ?? [],
        recent_orders: recentOrders?.rows ?? [],
        recent_alerts: recentAlerts?.rows ?? [],
        has_accounts: accounts.length > 0,
      });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── Activity ──────────────────────────────────────────────────────────────

  router.get('/activity', (req: Request, res: Response) => {
    try {
      const result = getProcessedEmails({
        limit: Number(req.query['limit'] || 50),
        offset: Number(req.query['offset'] || 0),
        status: req.query['status'] as string,
        rule: req.query['rule'] as string,
        search: req.query['search'] as string,
      });
      const rows = (result?.rows ?? []).map((r: any) => ({
        ...r,
        matched_rules: safeParseJSON(r.matched_rules, []),
        extracted_data: safeParseJSON(r.extracted_data, null),
        destinations_pushed: safeParseJSON(r.destinations_pushed, []),
      }));
      res.json({ rows, total: result?.total ?? 0 });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── Rules ─────────────────────────────────────────────────────────────────

  router.get('/rules', (_req: Request, res: Response) => {
    try {
      const rules = getAllRules().map((r: any) => ({
        ...r,
        keywords: safeParseJSON(r.keywords, []),
        required_keywords: safeParseJSON(r.required_keywords, []),
        sender_patterns: safeParseJSON(r.sender_patterns, []),
        exclude_phrases: safeParseJSON(r.exclude_phrases, []),
        destination_ids: safeParseJSON(r.destination_ids, []),
        field_mappings: safeParseJSON(r.field_mappings, {}),
        expected_fields: safeParseJSON(r.expected_fields, []),
        account_ids: safeParseJSON(r.account_ids, []),
        check_subject: Boolean(r.check_subject),
        check_body: Boolean(r.check_body),
        check_snippet: Boolean(r.check_snippet),
        require_attachment: Boolean(r.require_attachment),
        enabled: Boolean(r.enabled),
        scan_all: Boolean(r.scan_all),
      }));
      res.json(rules);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  router.post('/rules', (req: Request, res: Response) => {
    try {
      const body = req.body;
      if (!body.name?.trim()) return res.status(400).json({ error: 'name is required' });

      // Merge template defaults if template_id provided
      if (body.template_id) {
        const template = getTemplate(body.template_id);
        if (template) {
          if (!body.sender_patterns?.length) body.sender_patterns = template.sender_patterns;
          if (!body.keywords?.length) body.keywords = template.keywords;
          if (body.instructions === undefined) body.instructions = template.instructions;
          if (body.expected_fields === undefined) body.expected_fields = template.expected_fields;
        }
      }

      const id = createRule({
        name: body.name.trim(),
        keywords: body.keywords || [],
        required_keywords: body.required_keywords || [],
        sender_patterns: body.sender_patterns || [],
        exclude_phrases: body.exclude_phrases || [],
        check_subject: body.check_subject !== false,
        check_body: body.check_body !== false,
        check_snippet: body.check_snippet !== false,
        require_attachment: body.require_attachment === true,
        priority: body.priority ?? 0,
        enabled: body.enabled !== false,
        destination_ids: body.destination_ids || [],
        instructions: body.instructions || '',
        field_mappings: body.field_mappings || {},
        expected_fields: body.expected_fields || [],
        scan_all: body.scan_all === true,
        template_id: body.template_id || undefined,
        account_ids: body.account_ids || [],
      });
      res.status(201).json({ id });
    } catch (e: any) {
      if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Rule name already exists' });
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/rules/:id', (req: Request, res: Response) => {
    try {
      updateRule(Number(req.params['id']), req.body);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  router.delete('/rules/:id', (req: Request, res: Response) => {
    try {
      deleteRule(Number(req.params['id']));
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── Destinations ──────────────────────────────────────────────────────────

  router.get('/destinations', (_req: Request, res: Response) => {
    try {
      const dests = getAllDestinations().map((d: any) => ({
        ...d,
        config: maskSensitive(safeParseJSON(d.config, {})),
        field_mapping: safeParseJSON(d.field_mapping, {}),
        enabled: Boolean(d.enabled),
      }));
      res.json(dests);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  router.post('/destinations', (req: Request, res: Response) => {
    try {
      const { name, type, config, field_mapping, enabled } = req.body;
      if (!name?.trim() || !type) return res.status(400).json({ error: 'name and type are required' });

      const configObj = config ?? {};
      for (const key of SENSITIVE_CONFIG_KEYS) {
        if (configObj[key]) configObj[key] = encrypt(configObj[key]);
      }

      const id = createDestination({
        name: name.trim(), type,
        config: JSON.stringify(configObj),
        field_mapping: JSON.stringify(field_mapping || {}),
        enabled: enabled !== false,
      });
      res.status(201).json({ id });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  router.put('/destinations/:id', (req: Request, res: Response) => {
    try {
      const { name, type, config, field_mapping, enabled } = req.body;
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (type !== undefined) updates.type = type;
      if (enabled !== undefined) updates.enabled = enabled;
      if (config !== undefined) {
        const configObj = { ...config };
        for (const key of SENSITIVE_CONFIG_KEYS) {
          if (configObj[key] && !String(configObj[key]).startsWith('****')) configObj[key] = encrypt(String(configObj[key]));
        }
        updates.config = JSON.stringify(configObj);
      }
      if (field_mapping !== undefined) updates.field_mapping = JSON.stringify(field_mapping);
      updateDestination(Number(req.params['id']), updates);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  router.delete('/destinations/:id', (req: Request, res: Response) => {
    try {
      deleteDestination(Number(req.params['id']));
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── Settings ──────────────────────────────────────────────────────────────

  router.get('/settings', (_req: Request, res: Response) => {
    try { res.json(getAllSettings()); }
    catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  router.put('/settings', (req: Request, res: Response) => {
    try {
      for (const [key, value] of Object.entries(req.body)) {
        setSetting(key, String(value));
      }
      if (req.body.scan_interval_minutes) {
        const { updateInterval } = getSchedulerControls();
        updateInterval(parseInt(String(req.body.scan_interval_minutes), 10));
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── Blocked Senders ───────────────────────────────────────────────────────

  router.get('/blocked-senders', (_req: Request, res: Response) => {
    try { res.json(getBlockedSenders()); }
    catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  router.post('/blocked-senders', (req: Request, res: Response) => {
    try {
      const { email, reason, source_email_id } = req.body;
      if (!email?.trim()) return res.status(400).json({ error: 'email is required' });
      const id = blockSender({ email: email.trim(), reason, source_email_id });
      res.status(201).json({ id });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  router.delete('/blocked-senders/:id', (req: Request, res: Response) => {
    try {
      unblockSender(Number(req.params['id']));
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── Templates ─────────────────────────────────────────────────────────────

  router.get('/templates', (_req: Request, res: Response) => {
    try {
      const rules = getAllRules();
      const templates = (RETAILER_TEMPLATES as any[]).map(t => {
        const matchingRule = rules.find((r: any) => r.template_id === t.id);
        return {
          ...t,
          activated: Boolean(matchingRule),
          rule_id: matchingRule ? matchingRule.id : null,
          rule_enabled: matchingRule ? Boolean(matchingRule.enabled) : null,
        };
      });
      res.json(templates);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  return router;
}
