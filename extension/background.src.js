/**
 * Novel Studio Extension - Background Script
 * Strictly follows the user's "Open All, Then Scrape" requirement.
 */

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

let hiddenTabId = null;

async function getOrCreateHiddenTab(forceActive = false) {
  const data = await chrome.storage.local.get("hiddenTabId");
  let hTabId = data.hiddenTabId;
  
  if (hTabId) {
    try {
      const tab = await chrome.tabs.get(hTabId);
      if (tab) {
        if (forceActive) {
          await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
        }
        return tab.id;
      }
    } catch {
      hTabId = null;
    }
  }
  
  // Create a background tab (active: forceActive) instead of a window for Kiwi Browser
  const tab = await chrome.tabs.create({
    url: "about:blank",
    active: forceActive,
  });
  
  await chrome.storage.local.set({ hiddenTabId: tab.id });
  return tab.id;
}

async function handleFetch(url, options = {}) {
  const { smartScrape, timeout = 60000, waitSelector } = options;
  const logs = [];
  const log = (msg) => logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);

  // 1. Try silent background fetch first if no special scraping/waiting is needed
  // DO NOT use silent fetch for XTruyen to comply with the active tab sequential scraping
  const isXTruyen = url.includes("xtruyen.vn");
  if (!smartScrape && !waitSelector && !options.clickSelector && !isXTruyen) {
    try {
      log(`Attempting silent background fetch for ${url}`);
      const controller = new AbortController();
      const fetchTimeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, { 
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      clearTimeout(fetchTimeout);
      
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        
        // Detect charset from headers or HTML content
        let charset = 'utf-8';
        const headersContentType = res.headers.get('content-type') || '';
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
          log(`TextDecoder failed for charset ${charset}, falling back to utf-8`);
          const decoder = new TextDecoder('utf-8');
          text = decoder.decode(buffer);
        }

        const hasCf = text.includes("Just a moment...") || text.includes("Cloudflare") || text.includes("cf-challenge") || text.includes("cf_challenge") || text.includes("Turnstile") || text.includes("Checking your browser") || text.includes("Attention Required!");
        
        let isValid = !hasCf && text.length > 200;
        if (waitSelector && isValid) {
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
        }

        if (isValid) {
          log(`Silent fetch successful (${text.length} bytes, charset: ${charset})`);
          return { ok: true, html: text, contentText: null, logs };
        }
        log(`Silent fetch returned anti-bot/invalid page, falling back to tab...`);
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
    const isXTruyen = url.includes("xtruyen.vn");
    const forceActive = isXTruyen || options.activeTab || options.reuseTab;
    
    tabId = await getOrCreateHiddenTab(forceActive);
    
    // Navigate the hidden tab to the new URL
    await chrome.tabs.update(tabId, { url, active: forceActive });
    log(`Navigating hidden tab (id=${tabId}) to ${url} (forceActive: ${forceActive})`);

    // Inject visibilityState=visible ASAP so JS/Cloudflare doesn't throttle.
    (async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        await delay(500);
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
        } catch { /* try again */ }
      }
    })();

    // Block automatic browser translation
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          document.documentElement.classList.add('notranslate');
          const meta = document.createElement('meta');
          meta.name = 'google';
          meta.content = 'notranslate';
          document.head.appendChild(meta);
        }
      });
    } catch (e) {
      log(`Failed to inject translate-blocking script: ${e.message}`);
    }

    // Wait for tab load for XTruyen or if no selector is provided
    if (isXTruyen) {
      await waitForTabLoad(tabId, url, 30000);
    }

    // Wait for selector if provided
    if (waitSelector) {
      for (let i = 0; i < (timeout / 500); i++) {
        try {
          const r = await chrome.scripting.executeScript({
            target: { tabId },
            args: [waitSelector],
            func: (s) => {
              const el = document.querySelector(s);
              return el ? el.innerText.trim().length > 50 : false;
            },
          });
          if (r && r[0] && r[0].result) break;
        } catch {}
        await delay(500);
      }
    } else {
      await delay(3000); 
    }

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
    // DO NOT navigate to about:blank if reuseTab or XTruyen to allow seamless sequential crawling
    const isXTruyen = url.includes("xtruyen.vn");
    if (tabId && !options.reuseTab && !isXTruyen) {
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

function waitForTabLoad(tabId, targetUrl, ms = 30000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); resolve(); }, ms);
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
            chrome.tabs.onUpdated.removeListener(fn); clearTimeout(t); resolve();
          }
        } catch (e) {
          console.warn("[waitForTabLoad] Error:", e.message);
        }
      }
    }
    chrome.tabs.onUpdated.addListener(fn);
  });
}