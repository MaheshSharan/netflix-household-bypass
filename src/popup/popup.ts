import { ActivityLog, BypassStats, ActiveTabResponse } from '../types';

const STORAGE_KEY = 'extensionEnabled';
const STATS_KEY = 'bypassStats';
const LOGS_KEY = 'bypassLogs';

const toggleSwitch = document.getElementById('toggleSwitch') as HTMLInputElement;
const statusText = document.getElementById('statusText') as HTMLElement;
const tabDot = document.getElementById('tabDot') as HTMLElement;
const tabState = document.getElementById('tabState') as HTMLElement;
const blockedCount = document.getElementById('blockedCount') as HTMLElement;
const logsList = document.getElementById('logsList') as HTMLUListElement;
const btnClearLogs = document.getElementById('btnClearLogs') as HTMLButtonElement;
const btnReloadTab = document.getElementById('btnReloadTab') as HTMLButtonElement;

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toTimeString().split(' ')[0];
}

async function renderPopup(): Promise<void> {
  try {
    const data = await chrome.storage.local.get([STORAGE_KEY, STATS_KEY, LOGS_KEY]) as { [key: string]: any };
    const enabled: boolean = data[STORAGE_KEY] !== false;
    const rawStats = data[STATS_KEY];
    const stats: BypassStats = (rawStats && typeof rawStats.blockCount === 'number')
      ? rawStats as BypassStats
      : { blockCount: 0, lastBlockedTime: null };
    const logs: ActivityLog[] = Array.isArray(data[LOGS_KEY]) ? data[LOGS_KEY] : [];

    if (toggleSwitch) {
      toggleSwitch.checked = enabled;
    }
    if (statusText) {
      statusText.textContent = enabled ? 'Bypass Enabled' : 'Bypass Disabled';
      statusText.className = enabled ? 'switch-status active' : 'switch-status';
    }
    if (blockedCount) {
      blockedCount.textContent = String(stats.blockCount || 0);
    }

    if (logsList) {
      if (logs.length === 0) {
        logsList.innerHTML = '<li class="empty-logs">No checks intercepted yet</li>';
      } else {
        logsList.innerHTML = logs.slice(0, 10).map((item) => `
          <li class="log-item">
            <span class="log-url" title="${item.url}">${item.url}</span>
            <span class="log-time">${formatTime(item.timestamp)}</span>
          </li>
        `).join('');
      }
    }
  } catch (err) {
    console.error('Failed to render popup:', err);
  }
}

async function checkActiveTab(): Promise<void> {
  try {
    chrome.runtime.sendMessage({ action: 'getActiveTabInfo' }, (response: ActiveTabResponse) => {
      if (!response || response.error) {
        tabDot.className = 'status-dot';
        tabState.textContent = 'Unknown';
        return;
      }

      if (response.isWatch) {
        tabDot.className = 'status-dot watching';
        tabState.textContent = 'Watching Video';
      } else if (response.isNetflix) {
        tabDot.className = 'status-dot idle';
        tabState.textContent = 'Browsing Netflix';
      } else {
        tabDot.className = 'status-dot';
        tabState.textContent = 'Not Netflix';
      }
    });
  } catch {
    tabDot.className = 'status-dot';
    tabState.textContent = 'Offline';
  }
}

// Event Listeners
if (toggleSwitch) {
  toggleSwitch.addEventListener('change', async () => {
    const enabled = toggleSwitch.checked;
    await chrome.storage.local.set({ [STORAGE_KEY]: enabled });
    statusText.textContent = enabled ? 'Bypass Enabled' : 'Bypass Disabled';
    statusText.className = enabled ? 'switch-status active' : 'switch-status';
  });
}

if (btnClearLogs) {
  btnClearLogs.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'clearLogs' }, () => {
      renderPopup();
    });
  });
}

if (btnReloadTab) {
  btnReloadTab.addEventListener('click', () => {
    btnReloadTab.textContent = 'Reloading...';
    chrome.runtime.sendMessage({ action: 'reloadActiveTab' }, () => {
      setTimeout(() => {
        btnReloadTab.innerHTML = '<span class="btn-icon">↻</span> Refresh Netflix Tab';
        checkActiveTab();
      }, 1000);
    });
  });
}

// Storage sync listener
chrome.storage.onChanged.addListener((changes) => {
  if (changes[STORAGE_KEY] || changes[STATS_KEY] || changes[LOGS_KEY]) {
    renderPopup();
  }
});

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  renderPopup();
  checkActiveTab();
});
