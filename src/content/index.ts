/**
 * Netflix Household Bypass - Content Script (TypeScript)
 *
 * 1. Injects a runtime trap into the page main world for window.fetch & XMLHttpRequest
 * 2. Observes the DOM to neutralize household modals, backdrops, and pointer traps
 * 3. Ensures audio/video playback and controls remain unblocked
 */

(() => {
  const win = window as any;
  if (win.__nfBypassInitialized) return;
  win.__nfBypassInitialized = true;

  // --- 1. Main World In-Page Runtime Trap ---
  const trapScript = document.createElement('script');
  trapScript.textContent = `
    (() => {
      if (window.__nfFetchTrapActive) return;
      window.__nfFetchTrapActive = true;

      const isHouseholdCheck = (url, body) => {
        if (!url) return false;
        const urlStr = String(url);
        if (urlStr.includes('web.prod.cloud.netflix.com/graphql') || urlStr.includes('/graphql')) {
          if (!body) return true;
          if (typeof body === 'string' && (body.includes('CLCS') || body.includes('Interstitial') || body.includes('household'))) {
            return true;
          }
          return true;
        }
        return false;
      };

      // Monkeypatch fetch
      const origFetch = window.fetch;
      window.fetch = async function(...args) {
        const url = args[0] ? (typeof args[0] === 'string' ? args[0] : args[0].url) : '';
        const options = args[1] || (typeof args[0] === 'object' ? args[0] : {});
        const body = options?.body;

        if (isHouseholdCheck(url, body)) {
          window.postMessage({ type: 'NF_BYPASS_BLOCKED_REQUEST', url: String(url), timestamp: Date.now() }, '*');
          return new Response(JSON.stringify({ data: { clcsInterstitialPlaybackV2: null } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return origFetch.apply(this, args);
      };

      // Monkeypatch XMLHttpRequest
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this.__interceptUrl = url;
        return origOpen.apply(this, [method, url, ...rest]);
      };
      XMLHttpRequest.prototype.send = function(body) {
        if (isHouseholdCheck(this.__interceptUrl, body)) {
          window.postMessage({ type: 'NF_BYPASS_BLOCKED_REQUEST', url: String(this.__interceptUrl), timestamp: Date.now() }, '*');
          setTimeout(() => {
            Object.defineProperty(this, 'status', { value: 200 });
            Object.defineProperty(this, 'responseText', { value: JSON.stringify({ data: { clcsInterstitialPlaybackV2: null } }) });
            this.dispatchEvent(new Event('load'));
            this.dispatchEvent(new Event('loadend'));
          }, 0);
          return;
        }
        return origSend.apply(this, [body]);
      };
    })();
  `;

  try {
    (document.head || document.documentElement).appendChild(trapScript);
    trapScript.remove();
  } catch (err) {
    console.debug('[NF Bypass] Inline injection fallback:', err);
  }

  // Relay trap messages to extension service worker
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.data && event.data.type === 'NF_BYPASS_BLOCKED_REQUEST') {
      chrome.runtime.sendMessage({
        action: 'logBlockEvent',
        url: event.data.url,
        timestamp: event.data.timestamp
      }).catch(() => {});
    }
  });

  // --- 2. DOM Neutralization & Pointer Unlock ---
  const TARGET_SELECTORS = [
    '.nf-modal.interstitial-full-screen',
    'div[data-uia="clcsModal"]',
    'div[data-uia="nf-modal-background"]',
    '.nf-modal-background'
  ];

  function cleanTraps(): void {
    const matchedNodes = document.querySelectorAll<HTMLElement>(TARGET_SELECTORS.join(', '));
    let cleaned = false;

    matchedNodes.forEach((node) => {
      cleaned = true;
      node.style.setProperty('display', 'none', 'important');
      node.style.setProperty('pointer-events', 'none', 'important');
      node.style.setProperty('visibility', 'hidden', 'important');

      // Lift focus-lock wrappers
      let parent = node.parentElement;
      while (parent && parent !== document.body && parent.id !== 'appMountPoint') {
        if (parent.hasAttribute('data-no-focus-lock') || parent.getAttribute('aria-hidden') === 'true') {
          parent.style.setProperty('display', 'none', 'important');
          parent.style.setProperty('pointer-events', 'none', 'important');
        }
        parent = parent.parentElement;
      }
    });

    if (cleaned) {
      document.body.style.removeProperty('overflow');
      document.body.style.removeProperty('pointer-events');
      document.documentElement.style.removeProperty('overflow');
      document.documentElement.style.removeProperty('pointer-events');

      const video = document.querySelector<HTMLVideoElement>('video');
      if (video && video.paused) {
        video.play().catch(() => {});
      }
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.addedNodes.length > 0) {
        cleanTraps();
        break;
      }
    }
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
    cleanTraps();
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
      cleanTraps();
    });
  }

  // Periodic safety sweep during initial player stabilization
  let sweeps = 0;
  const timer = setInterval(() => {
    cleanTraps();
    sweeps++;
    if (sweeps > 15) clearInterval(timer);
  }, 500);
})();
