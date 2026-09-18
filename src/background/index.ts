import { BypassStats, ActivityLog, ExtensionMessage, ActiveTabResponse } from '../types';

const STORAGE_KEY = 'extensionEnabled';
const STATS_KEY = 'bypassStats';
const LOGS_KEY = 'bypassLogs';
const MAX_LOGS = 50;

let isExtensionEnabled = true;

/**
 * Initialize state from storage & activate declarative ruleset
 */
async function init(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEY, STATS_KEY, LOGS_KEY]);
    isExtensionEnabled = stored[STORAGE_KEY] !== false;

    if (!stored[STATS_KEY]) {
      const initialStats: BypassStats = { blockCount: 0, lastBlockedTime: null };
      await chrome.storage.local.set({ [STATS_KEY]: initialStats });
    }
    if (!stored[LOGS_KEY]) {
      await chrome.storage.local.set({ [LOGS_KEY]: [] });
    }

    await applyBypassRules(isExtensionEnabled);
  } catch (error) {
    console.error('[Background] Init error:', error);
  }
}

/**
 * Enable or disable static declarativeNetRequest ruleset
 */
async function applyBypassRules(enable: boolean): Promise<void> {
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: enable ? ['ruleset_1'] : [],
      disableRulesetIds: enable ? [] : ['ruleset_1']
    });
    console.log(`[DNR] Ruleset ruleset_1 set to ${enable ? 'ENABLED' : 'DISABLED'}`);
  } catch (err) {
    console.error('[DNR] Failed to toggle ruleset:', err);
  }
}

/**
 * Record intercepted check and update persistent circular log
 */
async function recordBlock(rawUrl: string = 'web.prod.cloud.netflix.com/graphql'): Promise<void> {
  try {
    const data = await chrome.storage.local.get([STATS_KEY, LOGS_KEY]) as { [key: string]: any };
    const rawStats = data[STATS_KEY];
    const stats: BypassStats = (rawStats && typeof rawStats.blockCount === 'number')
      ? rawStats as BypassStats
      : { blockCount: 0, lastBlockedTime: null };
    const logs: ActivityLog[] = Array.isArray(data[LOGS_KEY]) ? data[LOGS_KEY] : [];

    stats.blockCount = (stats.blockCount || 0) + 1;
    stats.lastBlockedTime = Date.now();

    const sanitizedUrl = rawUrl.replace(/^https?:\/\//, '');
    logs.unshift({
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      url: sanitizedUrl,
      timestamp: Date.now()
    });

    if (logs.length > MAX_LOGS) {
      logs.length = MAX_LOGS;
    }

    await chrome.storage.local.set({
      [STATS_KEY]: stats,
      [LOGS_KEY]: logs
    });
  } catch (err) {
    console.error('[Background] Failed to record block:', err);
  }
}

// Runtime message dispatcher
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.action === 'logBlockEvent') {
    recordBlock(message.url);
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'getActiveTabInfo') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const response: ActiveTabResponse = {
          tabId: tab?.id || null,
          url: tab?.url || '',
          isNetflix: Boolean(tab?.url?.includes('netflix.com')),
          isWatch: Boolean(tab?.url?.includes('/watch/'))
        };
        sendResponse(response);
      } catch (err: any) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'reloadActiveTab') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.reload(tab.id);
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false });
      }
    })();
    return true;
  }

  if (message.action === 'clearLogs') {
    chrome.storage.local.set({ [LOGS_KEY]: [] }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  return false;
});

// Storage sync listener
chrome.storage.onChanged.addListener(async (changes, namespace) => {
  if (namespace === 'local' && changes[STORAGE_KEY]) {
    isExtensionEnabled = changes[STORAGE_KEY].newValue !== false;
    await applyBypassRules(isExtensionEnabled);
  }
});

// Listen directly to browser-level DeclarativeNetRequest rule match events
if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    if (info?.request?.url) {
      recordBlock(info.request.url);
    }
  });
}

// Lifecycle events
chrome.runtime.onInstalled.addListener(() => {
  init();
});

chrome.runtime.onStartup.addListener(() => {
  init();
});

init();

