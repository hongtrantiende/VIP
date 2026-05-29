/**
 * Core utility functions for the extension.
 * Contains: delay, waitForSelector, waitForStableContent, waitForTabLoad
 */

/**
 * Promise-based delay helper.
 * @param {number} ms - Milliseconds to wait.
 * @returns {Promise<void>}
 */
export function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Wait until a CSS selector exists in the tab's DOM and has content
 * longer than `minLen`.
 *
 * @param {number} tabId - Chrome tab ID.
 * @param {string} sel - CSS selector to wait for.
 * @param {number} maxWait - Maximum wait time in ms.
 * @param {number} minLen - Minimum text length to consider the element "loaded".
 * @returns {Promise<boolean>} `true` if timed out, `false` if selector found.
 */
export async function waitForSelector(tabId, sel, maxWait, minLen) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const r = await chrome.scripting.executeScript({
        target: { tabId },
        args: [sel],
        func: (s) => {
          const el = document.querySelector(s);
          if (!el) return 0;
          const c = el.cloneNode(true);
          c.querySelectorAll("script,style,noscript").forEach((x) => x.remove());
          return c.textContent.trim().length;
        },
      });
      if ((r?.[0]?.result ?? 0) > minLen) return false;
    } catch {}
    await delay(500);
  }
  return true;
}

/**
 * Wait until the page's body text content stabilizes (stops changing).
 *
 * @param {number} tabId - Chrome tab ID.
 * @param {number} maxWait - Maximum wait time in ms.
 */
export async function waitForStableContent(tabId, maxWait) {
  const start = Date.now();
  let last = 0,
    stable = 0;
  await delay(1500);
  while (Date.now() - start < maxWait) {
    try {
      const r = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const c = document.body.cloneNode(true);
          c.querySelectorAll("script,style,noscript").forEach((e) => e.remove());
          return c.textContent.trim().length;
        },
      });
      const len = r?.[0]?.result ?? 0;
      if (len === last && len > 0) {
        stable++;
        if (stable >= 2) return;
      } else {
        stable = 0;
      }
      last = len;
    } catch {}
    await delay(500);
  }
}

/**
 * Wait for a tab to finish loading a specific URL.
 *
 * @param {number} tabId - Chrome tab ID.
 * @param {string} targetUrl - The URL we expect the tab to navigate to.
 * @param {number} [ms=30000] - Maximum wait time in ms.
 * @returns {Promise<void>}
 */
export function waitForTabLoad(tabId, targetUrl, ms = 30000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(fn);
      resolve();
    }, ms);

    let targetPath = "";
    try {
      targetPath = new URL(targetUrl).pathname.replace(/\/$/, "");
    } catch {
      targetPath = targetUrl.replace(/\/$/, "");
    }

    async function fn(id, info) {
      if (id === tabId) {
        try {
          const tab = await chrome.tabs.get(tabId);
          const currentUrl = tab.url || "";
          const isTarget = currentUrl.includes(targetPath);
          const isComplete = tab.status === "complete";
          if (isTarget && isComplete) {
            chrome.tabs.onUpdated.removeListener(fn);
            clearTimeout(t);
            resolve();
          }
        } catch (e) {
          console.warn("[waitForTabLoad] Error:", e.message);
        }
      }
    }
    chrome.tabs.onUpdated.addListener(fn);
  });
}
