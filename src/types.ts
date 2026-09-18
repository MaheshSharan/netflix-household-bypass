export interface BypassStats {
  blockCount: number;
  lastBlockedTime: number | null;
}

export interface ActivityLog {
  id: string;
  url: string;
  timestamp: number;
}

export interface StorageSchema {
  extensionEnabled: boolean;
  bypassStats: BypassStats;
  bypassLogs: ActivityLog[];
}

export interface ActiveTabResponse {
  tabId: number | null;
  url: string;
  isNetflix: boolean;
  isWatch: boolean;
  error?: string;
}

export type ExtensionMessage =
  | { action: 'logBlockEvent'; url: string; timestamp: number }
  | { action: 'getActiveTabInfo' }
  | { action: 'reloadActiveTab' }
  | { action: 'clearLogs' };
