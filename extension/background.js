/**
 * Novel Studio Extension - Background Script
 * Strictly follows the user's "Open All, Then Scrape" requirement.
 */

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

let hiddenTabId = null;

async function getOrCreateHiddenTab() {
  const data = await chrome.storage.local.get("hiddenTabId");
  let hTabId = data.hiddenTabId;
  
  if (hTabId) {
    try {
      const tab = await chrome.tabs.get(hTabId);
      if (tab) return tab.id;
    } catch {
      hTabId = null;
    }
  }
  
  // Create a background tab (active: false) instead of a window for Kiwi Browser
  const tab = await chrome.tabs.create({
    url: "about:blank",
    active: false,
  });
  
  await chrome.storage.local.set({ hiddenTabId: tab.id });
  return tab.id;
}

async function handleFetch(url, options = {}) {
  const { smartScrape, timeout = 60000 } = options;
  const logs = [];
  const log = (msg) => logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);

  // 1. Try silent background fetch first if no special scraping is needed
  if (!smartScrape) {
    try {
      log(`Attempting silent background fetch for ${url}`);
      const controller = new AbortController();
      const fetchTimeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(fetchTimeout);
      
      if (res.ok) {
        const text = await res.text();
        // Check for common Cloudflare / anti-bot signs
        if (!text.includes("Just a moment...") && !text.includes("Cloudflare") && text.length > 500) {
          log(`Silent fetch successful (${text.length} bytes)`);
          return { ok: true, html: text, contentText: null, logs };
        }
        log(`Silent fetch returned anti-bot page, falling back to tab...`);
      } else {
        log(`Silent fetch failed with status ${res.status}, falling back...`);
      }
    } catch (e) {
      log(`Silent fetch error: ${e.message}, falling back...`);
    }
  }

  // 2. Fallback to real hidden tab (background tab for Kiwi)
  let tabId;
  try {
    tabId = await getOrCreateHiddenTab();
    
    // Navigate the hidden tab to the new URL
    await chrome.tabs.update(tabId, { url });
    log(`Navigating hidden tab (id=${tabId}) to ${url}`);

    // Wait for initial page load
    await delay(3000); 

    if (smartScrape === "XTRUYEN") {
      log("XTruyen: Starting 'Open All' phase...");
      
      await chrome.scripting.executeScript({
        target: { tabId },
        func: async () => {
          const items = document.querySelectorAll('li.has-child[data-value]');
          console.log(`Revealing ${items.length} volumes...`);

          // 1. PHASE 1: Force all blocks to display: block FIRST
          items.forEach(item => {
            const sub = item.querySelector('.sub-chap');
            if (sub) {
              sub.style.display = 'block';
              sub.style.visibility = 'visible';
            }
          });

          // 2. PHASE 2: Trigger click on all headers to start loading
          items.forEach(item => {
            const header = item.querySelector('.single-chapter-list');
            if (header) header.click();
          });

          // 3. PHASE 3: Wait until ALL loading spinners are gone
          const startWait = Date.now();
          const maxWait = 45000; // 45 seconds max
          
          while (Date.now() - startWait < maxWait) {
            const activeSpinners = document.querySelectorAll('.loading-spinner:not([style*="display: none"])');
            if (activeSpinners.length === 0) {
              // Double check if chapters actually appeared in sub-chap-lists
              const emptyLists = Array.from(document.querySelectorAll('.sub-chap-list')).filter(ul => ul.children.length === 0);
              if (emptyLists.length === 0) break; 
            }
            await new Promise(r => setTimeout(r, 1000));
          }
          
          // 4. PHASE 4: Final stabilization
          window.scrollTo(0, document.body.scrollHeight);
          await new Promise(r => setTimeout(r, 2000));
        }
      });
      log("XTruyen: All chapters revealed and loaded.");
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        html: document.documentElement.outerHTML,
        innerText: document.body.innerText
      }),
    });

    const data = results[0].result;
    return { ok: true, html: data.html, contentText: data.innerText, logs };

  } catch (err) {
    log(`Error: ${err.message}`);
    return { ok: false, error: err.message, logs };
  } finally {
    // Navigate to blank to free memory, but keep window open for reuse
    if (tabId) {
      chrome.tabs.update(tabId, { url: "about:blank" }).catch(() => {});
    }
  }
}

chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  if (request.type === "PING") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return false;
  }
  if (request.type === "FETCH") {
    handleFetch(request.url, request).then(sendResponse);
    return true;
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "PING") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return false;
  }
  if (request.type === "FETCH") {
    handleFetch(request.url, request).then(sendResponse);
    return true;
  }
});