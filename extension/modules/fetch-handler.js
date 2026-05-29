/**
 * Core FETCH handler module — handles all website scraping via browser tabs.
 *
 * This is the generic handler that works for ALL websites. Website-specific
 * behavior is driven by the site-config registry, NOT by if/else checks
 * scattered throughout the code.
 *
 * Flow:
 * 1. Try silent background fetch() first (unless site config says skip).
 * 2. If silent fetch fails or is skipped → open a real browser tab.
 * 3. Handle tab reuse for sequential adapters (e.g., HeTuShu, 69Shuba).
 * 4. Inject stealth, simulate human behavior, wait for content.
 * 5. Extract HTML and return.
 */

import { delay, waitForSelector, waitForStableContent, waitForTabLoad } from "./utils.js";
import { injectFullStealth } from "./stealth.js";
import { humanDelay, getAdaptiveDelay, increaseThrottle, decreaseThrottle, simulateHuman } from "./human-sim.js";
import { rotateProxyIfNeeded } from "./proxy.js";
import { getSiteConfig, isHostnameMatch } from "./site-config.js";

/** Set of tab IDs for persistent background tabs (cleaned up on stopScrape) */
export const persistentTabIds = new Set();

/**
 * Inject visibilityState=visible into a tab to prevent JS throttling.
 * Retries several times to catch the earliest possible moment after navigation.
 *
 * @param {number} tabId - Chrome tab ID.
 * @param {number} [retries=5] - Number of attempts.
 * @param {number} [delayMs=200] - Delay between attempts in ms.
 */
async function injectVisibilityOverride(tabId, retries = 5, delayMs = 200) {
  for (let attempt = 0; attempt < retries; attempt++) {
    await delay(delayMs);
    try {
      await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN",
        func: () => {
          Object.defineProperty(document, "hidden", { get: () => false, configurable: true });
          Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
          Document.prototype.hasFocus = () => true;
          document.addEventListener("visibilitychange", (e) => e.stopImmediatePropagation(), true);
        }
      });
      break; // succeeded
    } catch { /* page not ready yet, try again */ }
  }
}

/**
 * Check if a page contains a Cloudflare challenge or similar anti-bot.
 *
 * @param {string} html - HTML content to check.
 * @returns {boolean} True if anti-bot challenge detected.
 */
function hasCloudflareChallenge(html) {
  return html.includes("Just a moment...")
    || html.includes("cf-challenge")
    || html.includes("cf_challenge")
    || html.includes("Turnstile")
    || html.includes("Checking your browser")
    || html.includes("Attention Required!");
}

/**
 * Attempt a silent background fetch (no browser tab, just HTTP request).
 * This is fast but only works for sites that serve full HTML without JS rendering.
 *
 * @param {string} url - URL to fetch.
 * @param {string|null} waitSelector - Optional CSS selector to validate content.
 * @returns {Promise<{html: string, contentText: string, timedOut: boolean}|null>}
 *   The result, or null if silent fetch is not suitable or failed.
 */
async function trySilentFetch(url, waitSelector) {
  try {
    console.log(`[Silent Fetch] Attempting silent background fetch for ${url}`);
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    clearTimeout(fetchTimeout);

    if (!response.ok) {
      console.log(`[Silent Fetch] Failed with status ${response.status}, falling back to tab...`);
      return null;
    }

    const buffer = await response.arrayBuffer();
    
    // Detect charset from headers or HTML content
    let charset = 'utf-8';
    const headersContentType = response.headers.get('content-type') || '';
    const charsetMatch = headersContentType.match(/charset=([\w\-]+)/i);
    if (charsetMatch) {
      charset = charsetMatch[1].toLowerCase();
    } else {
      const firstBytes = new Uint8Array(buffer.slice(0, 2048));
      let firstBytesStr = '';
      for (let i = 0; i < firstBytes.length; i++) {
        firstBytesStr += String.fromCharCode(firstBytes[i]);
      }
      const htmlCharsetMatch = firstBytesStr.match(/<meta[^>]*charset=["']?([\w\-]+)["']?/i) 
                              || firstBytesStr.match(/<meta[^>]*http-equiv=["']?Content-Type["']?[^>]*content=["']?[^"'>]*charset=([\w\-]+)/i);
      if (htmlCharsetMatch) {
        charset = htmlCharsetMatch[1].toLowerCase();
      }
    }
    
    let text;
    try {
      const decoder = new TextDecoder(charset);
      text = decoder.decode(buffer);
    } catch (e) {
      console.warn(`[Silent Fetch] TextDecoder failed for charset ${charset}, falling back to utf-8`, e);
      const decoder = new TextDecoder('utf-8');
      text = decoder.decode(buffer);
    }

    // Validate: no anti-bot, sufficient length
    const hasCf = hasCloudflareChallenge(text);
    let isValid = !hasCf && text.length > 200;

    // If a waitSelector is specified, check if the HTML contains the expected elements
    if (waitSelector && isValid) {
      try {
        const checkSelectorInText = (txt, selector) => {
          const parts = selector.split(',').map(s => s.trim());
          for (const part of parts) {
            const matches = part.match(/[.#][\w\-]+/g);
            if (matches && matches.length > 0) {
              let allFound = true;
              for (const m of matches) {
                const name = m.substring(1);
                if (!txt.includes(name)) { allFound = false; break; }
              }
              if (allFound) return true;
            } else {
              const clean = part.replace(/[^\w\-]/g, '');
              if (clean && txt.includes(clean)) return true;
            }
          }
          return false;
        };
        if (!checkSelectorInText(text, waitSelector)) {
          isValid = false;
        }
      } catch (e) {
        console.error("Selector validation error:", e);
        isValid = false;
      }
    }

    if (isValid) {
      console.log(`[Silent Fetch] Successful silent fetch (${text.length} bytes, charset: ${charset})`);
      return { html: text, contentText: "", timedOut: false };
    }
    console.log(`[Silent Fetch] Raw HTML did not pass validation or contains anti-bot, falling back to tab...`);
    return null;
  } catch (e) {
    console.log(`[Silent Fetch] Error: ${e.message}, falling back to tab...`);
    return null;
  }
}

/**
 * Main fetch handler — the core function that handles all website scraping.
 *
 * Uses site-config to determine per-website behavior instead of hardcoded if/else.
 *
 * @param {string} url - URL to fetch.
 * @param {string|null} waitSelector - CSS selector to wait for before extracting.
 * @param {string|null} clickSelector - CSS selector to click before waiting.
 * @param {number} timeout - Maximum wait time in ms.
 * @param {boolean} [forceActive=false] - Force the tab to be active/visible.
 * @param {boolean} [reuseTab=false] - Reuse an existing tab instead of creating a new one.
 * @returns {Promise<{html: string, contentText: string|null, timedOut: boolean}>}
 */
export async function handleFetch(url, waitSelector, clickSelector, timeout, forceActive = false, reuseTab = false) {
  // Load site-specific config
  const siteConfig = getSiteConfig(url);

  // Rotate proxy before this chapter
  await rotateProxyIfNeeded();

  // 1. Try silent background fetch first (unless site config or request params say otherwise)
  const shouldSkipSilent = siteConfig.skipSilentFetch || clickSelector || waitSelector;
  if (!shouldSkipSilent) {
    const silentResult = await trySilentFetch(url, waitSelector);
    if (silentResult) return silentResult;
  }

  // 2. Remember the current active tab so we can refocus it later
  let originalTabId = null;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) originalTabId = activeTab.id;
  } catch {}

  let tabId = null;
  let isReused = false;
  let didNavigate = false;
  let createdWindowId = null; // Only set when we open a dedicated minimized window (non-reuseTab)

  // 3. Try to reuse an existing tab
  if (reuseTab) {
    try {
      const u = new URL(url);
      console.log(`[Fetch] reuseTab active. u.hostname: ${u.hostname}`);
      const allTabs = await chrome.tabs.query({});
      const tabs = allTabs.filter(t => {
        if (!t.url) return false;
        try {
          const tabUrl = new URL(t.url);
          return isHostnameMatch(tabUrl.hostname, u.hostname, siteConfig);
        } catch {
          return false;
        }
      });
      console.log(`[Fetch] Found ${tabs.length} potential tabs for reuse.`);
      if (tabs.length > 0) {
        let bestTab = tabs.find(t => t.url && t.url.includes(u.pathname));
        if (!bestTab) bestTab = tabs[0];
        tabId = bestTab.id;
        isReused = true;
        console.log(`[Fetch] Reusing tabId: ${tabId}, url: ${bestTab.url}`);
        
        const normPath = (str) => {
          try {
            const uObj = new URL(str);
            return uObj.pathname.replace(/#.*$/, "").replace(/\?.*$/, "").replace(/\/$/, "");
          } catch {
            return str.replace(/#.*$/, "").replace(/\?.*$/, "").replace(/\/$/, "");
          }
        };
        const targetNorm = normPath(url);
        const bestTabNorm = normPath(bestTab.url || "");
        console.log(`[Fetch] targetNorm path: ${targetNorm}, bestTabNorm path: ${bestTabNorm}`);

        if (bestTabNorm !== targetNorm) {
          const shouldActive = forceActive || siteConfig.forceActiveTab || false;
          console.log(`[Fetch] Paths differ. Navigating tab ${tabId} to ${url} (shouldActive: ${shouldActive})`);

          await chrome.tabs.update(tabId, { url, active: shouldActive });
          didNavigate = true;

          // Inject visibilityState=visible ASAP
          await injectVisibilityOverride(tabId, 5, 200);
        } else {
          console.log(`[Fetch] Paths are identical. No navigation needed.`);
          // Brief settle delay — page is already loaded
          await delay(500);
        }
      }
    } catch (e) {
      console.error("[Fetch] reuseTab error:", e);
    }
  }

  // 4. Create a new tab if reuse didn't work
  if (!isReused) {
    try {
      const isSTV = siteConfig.isSTV || false;
      const shouldActive = forceActive || siteConfig.forceActiveTab || false;

      if (reuseTab && !isSTV) {
        // Persistent-tab adapters (hetushu, 69shuba, etc.): create a background tab inside
        // the current window — no new window, no popup, no focus steal.
        const tab = await chrome.tabs.create({ url, active: shouldActive });
        tabId = tab.id;
        persistentTabIds.add(tabId); // register for later cleanup
        didNavigate = true;
        console.log(`[Fetch] Created persistent tab ${tabId} for reuseTab adapter (active: ${shouldActive}).`);
      } else {
        // Android-optimized STV or one-shot fetch: create a background tab inside the current
        // window — no new window, no focus steal (windows are not supported on mobile).
        const tab = await chrome.tabs.create({ url, active: shouldActive });
        tabId = tab.id;
        didNavigate = true;
        console.log(`[Fetch] Created Android background tab ${tabId} (isSTV: ${isSTV}, active: ${shouldActive}).`);
      }
    } catch (winErr) {
      console.warn("[Fetch] Error creating tab/window, falling back to background tab:", winErr);
      try {
        const tab = await chrome.tabs.create({ url, active: false });
        tabId = tab.id;
        if (reuseTab && !siteConfig.isSTV) persistentTabIds.add(tabId);
        didNavigate = true;
      } catch (tabErr) {
        console.warn("[Fetch] Error creating background tab, falling back to active tab:", tabErr);
        const tab = await chrome.tabs.create({ url, active: forceActive });
        tabId = tab.id;
        didNavigate = true;
      }
    }
  }

  // 5. Refocus the app tab only when we opened a brand-new separate window (one-shot mode).
  if (originalTabId && createdWindowId) {
    try { await chrome.tabs.update(originalTabId, { active: true }); } catch {}
  }

  // 6. Wait for page load, inject stealth, simulate human behavior, and extract content
  try {
    if (didNavigate) {
      // Inject visibilityState override in the background (don't await)
      injectVisibilityOverride(tabId, 5, 500);

      await waitForTabLoad(tabId, url, 30000);
      
      // Check if Cloudflare is present
      let hasCf = false;
      try {
        const checkRes = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => document.body.innerHTML
        });
        const bodyHtml = checkRes?.[0]?.result || "";
        hasCf = hasCloudflareChallenge(bodyHtml);
      } catch (e) {
        console.warn("[Fetch] Error checking Cloudflare inside tab:", e);
      }

      if (hasCf) {
        console.log("[Fetch] Cloudflare challenge detected! Activating tab and focusing window for user solve.");
        try {
          await chrome.tabs.update(tabId, { active: true });
          const tInfo = await chrome.tabs.get(tabId);
          if (tInfo && tInfo.windowId) {
            await chrome.windows.update(tInfo.windowId, { focused: true });
          }
        } catch (actErr) {
          console.warn(actErr);
        }
      }

      await injectFullStealth(tabId);
      await delay(getAdaptiveDelay(1500));
      await simulateHuman(tabId);
    }

    let timedOut = false;
    if (clickSelector && waitSelector) {
      for (let i = 0; i < 3; i++) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId }, args: [clickSelector],
            func: (s) => { const el = document.querySelector(s); if (el) el.click(); },
          });
        } catch {}
        if (!(await waitForSelector(tabId, waitSelector, Math.floor(timeout / 3), 1))) {
          timedOut = false; break;
        }
        timedOut = true;
        await delay(humanDelay(500));
      }
    } else if (waitSelector) {
      // Just wait for it, don't fail immediately on timeout so captcha solver can work
      await waitForSelector(tabId, waitSelector, timeout, 1);
      timedOut = false; // We'll extract whatever is there anyway
    } else {
      await waitForStableContent(tabId, timeout);
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId }, args: [waitSelector || null],
      func: (s) => {
        const html = "<!DOCTYPE html><html>" + document.head.outerHTML + "<body>" + document.body.innerHTML + "</body></html>";
        let contentText = null;
        if (s) { const el = document.querySelector(s); if (el) contentText = el.innerText; }
        return { html, contentText };
      },
    });
    const data = results?.[0]?.result;
    if (!data) {
      console.warn("Failed to extract data, returning empty");
      return { html: "", contentText: "", timedOut: true };
    }

    // Success → decrease throttle
    if (data.contentText && data.contentText.length > 100) decreaseThrottle();

    return { html: data.html, contentText: data.contentText, timedOut };
  } catch (err) {
    // Error → increase throttle
    increaseThrottle();
    throw err;
  } finally {
    if (reuseTab) {
      // Persistent tab: KEEP the tab alive so the next chapter can reuse it.
      // If we opened a dedicated window for it, minimize that window.
      if (createdWindowId) {
        try { await chrome.windows.update(createdWindowId, { state: "minimized" }); } catch {}
      }
    } else {
      // One-shot: remove the temporary tab and restore app focus.
      try { await chrome.tabs.remove(tabId); } catch {}
      if (originalTabId) {
        try { await chrome.tabs.update(originalTabId, { active: true }); } catch {}
      }
    }
  }
}
