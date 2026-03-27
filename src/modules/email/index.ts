/**
 * Email Module — Extracted from Email Parsing standalone app.
 * Provides email-based purchase tracking, shipment monitoring,
 * and Amazon seller alert detection for the Buy Box / FlipAlert community.
 */

import path from 'path';
import { EventEmitter } from 'events';
import { setEmailDbPath } from './db.js';
import { setEmailDataDir } from './crypto.js';

export { startScheduler, triggerManualRun, getSchedulerStatus } from './scheduler.js';
export { runPipeline, processRetryQueue } from './pipeline.js';
export { flagEmail } from './flag-engine.js';
export { getTemplate } from './retailer-templates.js';
export { setLLMExtractor, hasLLMExtractor } from './llm-extractor.js';

// Re-export DB functions needed by routes
export {
  getSetting, setSetting, getAllSettings,
  getGmailAuth, setGmailAuth, deleteGmailAuth,
  getImapAuth, setImapAuth, deleteImapAuth,
  getApiKey, setApiKey, deleteApiKey,
  getExtractionConfig, updateExtractionConfig,
  getAllRules, getRule, createRule, updateRule, deleteRule,
  getAllDestinations, getDestination, createDestination, updateDestination, deleteDestination,
  getProcessedEmails, isEmailProcessed,
  getLastPipelineRun, createPipelineRun,
  getBlockedSenders, blockSender, unblockSender,
  getOrders, getOrderStats, getOrderDailyTrend, getOrdersByRetailer,
  getPurchaseStats, getPurchaseSpendTrend, getPurchasesByRetailer,
  getSellerAlerts, getUnacknowledgedAlertCount, acknowledgeAlert, acknowledgeAllAlerts,
  getAllEmailAccounts, getEmailAccount, createEmailAccount, updateEmailAccount, deleteEmailAccount,
  getProcessedEmailStats, getCostToday, getWeeklyStats, getRecentPipelineRuns,
  getPushQueueStats, getPushQueueItems, deletePushQueueItem, retryPushQueueItem,
  setEmailDbPath,
} from './db.js';

export { encrypt, decrypt, setEmailDataDir } from './crypto.js';

/** Email module event bus — agents subscribe to these events */
export const emailBus = new EventEmitter();
emailBus.setMaxListeners(20);

/**
 * Initialize the email module with Hivemind's data directory.
 * Must be called before any email module functions.
 */
export function initEmailModule(dataDir: string): void {
  const emailDbPath = path.join(dataDir, 'email.db');
  setEmailDbPath(emailDbPath);
  setEmailDataDir(dataDir);
}
