/**
 * STV (SangTacViet / Fanqie) chapter handler module.
 * Contains: findSTVTab, stvFetchChapter, downloadAllSequential.
 *
 * This handler is specific to websites that use the "click next chapter"
 * scraping strategy via an existing browser tab.
 */

import { delay, waitForTabLoad } from "./utils.js";

// ══════════════════════════════════════════════════════════════
// Shared State (imported by background.js)
// ══════════════════════════════════════════════════════════════

/** Content cache: tabId → { content, title, url, length, timestamp } */
export const contentCache = new Map();

/** Whether the STV scraping loop is active */
let stvScrapeActive = true;

/** Get current scrape active state */
export function isStvScrapeActive() {
  return stvScrapeActive;
}

/** Set scrape active state */
export function setStvScrapeActive(active) {
  stvScrapeActive = active;
}

// ══════════════════════════════════════════════════════════════
// Tab Discovery
// ══════════════════════════════════════════════════════════════

/**
 * Find an existing STV/Fanqie tab in the browser.
 * Searches all tabs for hostnames matching SangTacViet or Fanqie domains.
 * If a targetUrl is provided, tries to match by novel ID first.
 *
 * @param {string} [targetUrl] - Optional URL to match against (for novel ID matching).
 * @returns {Promise<number|null>} The tab ID, or null if no matching tab is found.
 */
export async function findSTVTab(targetUrl) {
  const allTabs = await chrome.tabs.query({});
  const tabs = allTabs.filter(t => {
    if (!t.url) return false;
    try {
      const h = new URL(t.url).hostname;
      return h.includes("sangtacviet") || h.includes("fanqienovel") || h.includes("fanqie");
    } catch {
      return false;
    }
  });
  
  if (tabs.length === 0) return null;
  
  // Try to find a tab that matches the novel ID from the target URL
  if (targetUrl) {
    try {
      const targetObj = new URL(targetUrl);
      const targetPathParts = targetObj.pathname.split('/').filter(Boolean);
      const novelId = targetPathParts[3];
      
      if (novelId) {
        for (const t of tabs) {
          if (t.url.includes(novelId)) {
            return t.id;
          }
        }
      }
    } catch (e) {
      console.error("[STV Tab find] error matching novel ID:", e);
    }
  }
  
  return tabs[0].id;
}

// ══════════════════════════════════════════════════════════════
// Chapter Fetching
// ══════════════════════════════════════════════════════════════

/**
 * Fetch a single chapter from STV/Fanqie by controlling an existing tab.
 *
 * Strategy:
 * - First chapter: Wait for user to manually open chapter 1 (up to 2 min).
 * - Subsequent chapters: Click "Next chapter" button and wait for content to change.
 * - Extract content via EXTRACT_NOW message to content script.
 *
 * @param {object} payload - Chapter fetch parameters.
 * @param {string} payload.chapterUrl - URL of the chapter.
 * @param {number} [payload.delayMs=7000] - Delay between chapters.
 * @param {boolean} [payload.isFirstChapter=false] - Whether this is the first chapter.
 * @param {Function} sendResponse - Chrome message response callback.
 */
export async function stvFetchChapter(payload, sendResponse) {
  try {
    const tabId = await findSTVTab(payload.chapterUrl);
    if (!tabId) { sendResponse({ success: false, error: "Mở 1 tab SangTacViet trước!" }); return; }
    
    const userDelay = payload.delayMs || 7000;
    const isFirstChapter = payload.isFirstChapter === true;

    // Only force focus the window if it's the very first chapter (where we need user to manually click)
    // For subsequent chapters, just updating the tab is enough and prevents stealing focus from the user
    if (isFirstChapter) {
      await chrome.tabs.update(tabId, { active: true });
      try {
        const tabInfo = await chrome.tabs.get(tabId);
        if (tabInfo && tabInfo.windowId) {
          await chrome.windows.update(tabInfo.windowId, { focused: true });
        }
      } catch (winErr) {
        console.warn("[STV] Window focus error:", winErr);
      }
    }

    if (!isFirstChapter) {
      // ── SUBSEQUENT CHAPTERS: Click "Next" button ──
      // First, capture the current content BEFORE clicking next
      let prevContent = "";
      try {
        const prevResp = await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_NOW" });
        if (prevResp && prevResp.content) {
          prevContent = prevResp.content.substring(0, 200); // first 200 chars for comparison
        }
      } catch {}

      // Click the "Next chapter" button
      console.log("[STV] Clicking next chapter button...");
      try {
        // Use scripting.executeScript to click the next button directly
        // This is more reliable than sending a message to content script
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            // Try multiple selectors for the "next" button
            const nextBtn = document.querySelector('#navnextbot') 
              || document.querySelector('#navnexttop')
              || document.querySelector('a[id*="navnext"]');
            if (nextBtn) {
              nextBtn.click();
              return true;
            }
            // Fallback: look for links with "Chương sau" or "Next" text
            const links = document.querySelectorAll('a');
            for (const a of links) {
              const text = (a.textContent || '').trim().toLowerCase();
              if (text.includes('chương sau') || text.includes('chương kế') || text.includes('tiếp') || text === 'next') {
                a.click();
                return true;
              }
            }
            return false;
          }
        });
      } catch (e) {
        console.log("[STV] Click next error:", e.message);
      }

      // Wait for page navigation to complete
      await waitForTabLoad(tabId, 15000);
      
      // Wait for content to actually change (not just page load)
      console.log(`[STV] Waiting for content to change after clicking next...`);
      const waitStart = Date.now();
      const maxContentWait = Math.max(userDelay, 8000);
      let contentChanged = false;
      
      for (let i = 0; i < maxContentWait / 500; i++) {
        if (!stvScrapeActive) break;
        await delay(500);
        
        try {
          const checkResp = await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_NOW" });
          if (checkResp && checkResp.length > 200) {
            const newContentHead = (checkResp.content || "").substring(0, 200);
            // Content must be different from previous chapter
            if (newContentHead !== prevContent) {
              contentChanged = true;
              console.log(`[STV] Content changed after ${Date.now() - waitStart}ms`);
              break;
            }
          }
        } catch {}
      }
      
      if (!contentChanged) {
        console.log("[STV] Content did not change after clicking next, will try extracting anyway...");
      }
    } else {
      // ── FIRST CHAPTER: Wait for user to manually click into chapter 1 ──
      // Poll until content appears (user clicks chapter 1 on STV tab)
      console.log("[STV] First chapter - waiting for user to open chapter 1 on STV tab...");
      const maxWaitForUser = 120000; // 2 minutes max wait
      const pollInterval = 2000; // Check every 2 seconds
      const waitStart = Date.now();
      let contentFound = false;

      for (let i = 0; i < maxWaitForUser / pollInterval; i++) {
        if (!stvScrapeActive) break;
        await delay(pollInterval);

        try {
          const resp = await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_NOW" });
          if (resp && resp.length > 200) {
            contentFound = true;
            console.log(`[STV] Content detected after ${Date.now() - waitStart}ms! User has opened chapter 1.`);
            break;
          }
        } catch {}
        
        // Log progress every 10 seconds
        if (i > 0 && i % 5 === 0) {
          console.log(`[STV] Still waiting for user to open chapter 1... (${Math.round((Date.now() - waitStart) / 1000)}s)`);
        }
      }

      if (!contentFound && stvScrapeActive) {
        console.log("[STV] Timeout: user did not open chapter 1 within 2 minutes.");
        sendResponse({ success: false, error: "Timeout: Vui lòng mở tab STV và bấm vào Chương 1 trước khi tải!", timedOut: true });
        return;
      }
    }

    if (!stvScrapeActive) {
      sendResponse({ success: false, stopped: true });
      return;
    }

    // ── EXTRACT content from current page ──
    let content = "", title = "";
    
    // Clear stale cache
    contentCache.delete(tabId);

    for (let i = 0; i < 15; i++) {
      if (!stvScrapeActive) break;
      try {
        const resp = await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_NOW" });
        if (resp && resp.length > 200) { 
          content = resp.content; 
          title = resp.title;
          break; 
        }
      } catch {}
      await delay(500);
    }

    // Get current page URL for verification
    let currentUrl = "";
    try {
      const tabState = await chrome.tabs.get(tabId);
      currentUrl = tabState.url || "";
    } catch {}
    
    console.log(`[STV] Extracted: title="${title}", length=${content.length}, url=${currentUrl}`);
    
    sendResponse({ 
      success: true, 
      content, 
      contentText: content, 
      data: "", 
      length: content.length, 
      title, 
      timedOut: content.length < 200, 
      stopped: !stvScrapeActive,
      currentUrl // Send back for verification
    });
  } catch (error) { sendResponse({ success: false, error: error.message }); }
}

// ══════════════════════════════════════════════════════════════
// Batch Sequential Download
// ══════════════════════════════════════════════════════════════

/**
 * Download multiple chapters sequentially using the STV handler.
 *
 * @param {object} params
 * @param {Array} params.chapters - Array of { url } objects.
 * @param {number} [params.delay=1000] - Delay between chapters in ms.
 * @param {Function} sendResponse - Chrome message response callback.
 */
export async function downloadAllSequential({ chapters, delay: d = 1000 }, sendResponse) {
  const results = [];
  stvScrapeActive = true;
  for (let i = 0; i < chapters.length; i++) {
    if (!stvScrapeActive) break;
    const ch = chapters[i];
    const res = await new Promise((r) => stvFetchChapter({ chapterUrl: ch.url, allowNext: i < chapters.length - 1 }, r));
    results.push({ chapter: ch, ...res });
  }
  sendResponse({ success: true, results, stopped: !stvScrapeActive });
}
