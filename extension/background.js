/**
 * Novel Studio Connector (PC) — Background Service Worker
 * ═══════════════════════════════════════════════════════════
 *
 * Entry point that wires up all modules.
 * Each module handles a single responsibility:
 *   - utils.js        → delay, waitForSelector, waitForStableContent, waitForTabLoad
 *   - stealth.js      → Fingerprint profiles & anti-detection injection
 *   - human-sim.js    → Gaussian delay, adaptive throttle, mouse/scroll simulation
 *   - proxy.js        → Proxy rotation & Chrome proxy API integration
 *   - site-config.js  → Per-website behavior configuration
 *   - stv-handler.js  → SangTacViet / Fanqie chapter handler
 *   - fetch-handler.js → Generic fetch handler for all other websites
 *
 * When modifying behavior for a specific website:
 *   1. If it's a config change (e.g., skip silent fetch) → edit site-config.js
 *   2. If it's STV/Fanqie specific → edit stv-handler.js
 *   3. If it's a generic scraping change → edit fetch-handler.js
 *   4. Other websites should NOT be affected by your changes.
 */

// ══════════════════════════════════════════════════════════════
// Module Imports
// ══════════════════════════════════════════════════════════════
import { initProxy, clearProxy } from "./modules/proxy.js";
import { contentCache, setStvScrapeActive, stvFetchChapter, downloadAllSequential } from "./modules/stv-handler.js";
import { handleFetch, persistentTabIds } from "./modules/fetch-handler.js";

// ══════════════════════════════════════════════════════════════
// Startup
// ══════════════════════════════════════════════════════════════
console.log("%c🚀 Novel Studio Connector v2.0 — Modular Stealth Mode", "color:lime;font-size:16px");

// Initialize proxy system (auth handler, storage listeners)
initProxy();

// ══════════════════════════════════════════════════════════════
// Content Script Message Handler
// ══════════════════════════════════════════════════════════════
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "STV_CONTENT_READY" && sender.tab) {
    contentCache.set(sender.tab.id, {
      content: msg.content, title: msg.title, url: msg.url,
      length: msg.length, timestamp: Date.now(),
    });
  }
});

// ══════════════════════════════════════════════════════════════
// External Message Router (from Novel Studio web app)
// ══════════════════════════════════════════════════════════════
chrome.runtime.onMessageExternal.addListener((request, _sender, sendResponse) => {
  // ── PING: Health check ──
  if (request.type === "PING" || request.action === "ping") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version, success: true, status: "online" });
    return false;
  }

  // ── Download Chapter (STV/Fanqie) ──
  if (request.action === "downloadChapter") {
    setStvScrapeActive(true);
    stvFetchChapter(request.payload, sendResponse);
    return true;
  }

  // ── Stop Scraping ──
  if (request.action === "stopScrape") {
    setStvScrapeActive(false);
    clearProxy();
    // Close any persistent background tabs created for reuseTab adapters
    (async () => {
      for (const tid of [...persistentTabIds]) {
        try { await chrome.tabs.remove(tid); } catch {}
      }
      persistentTabIds.clear();
    })();
    sendResponse({ success: true });
    return false;
  }

  // ── Close Persistent Tab (cleanup after scraping) ──
  if (request.action === "closePersistentTab") {
    (async () => {
      for (const tid of [...persistentTabIds]) {
        try { await chrome.tabs.remove(tid); } catch {}
      }
      persistentTabIds.clear();
    })();
    sendResponse({ success: true });
    return false;
  }

  // ── Download All Sequential ──
  if (request.action === "downloadAllSequential") {
    downloadAllSequential(request.payload, sendResponse);
    return true;
  }

  // ── Generic FETCH (for all websites) ──
  if (request.type === "FETCH") {
    handleFetch(request.url, request.waitSelector, request.clickSelector, request.timeout || 15000, request.activeTab, request.reuseTab)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  return false;
});

// ══════════════════════════════════════════════════════════════
// Tab cleanup: remove cached content when tabs are closed
// ══════════════════════════════════════════════════════════════
chrome.tabs.onRemoved.addListener((tabId) => {
  contentCache.delete(tabId);
});