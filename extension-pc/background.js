console.log("%c🚀 Novel Studio Connector v1.0 — Stealth Mode", "color:lime;font-size:16px");
const contentCache = new Map();
let stvScrapeActive = true;
const persistentTabIds = new Set(); // Track background tabs created for reuseTab adapters (cleaned up on stopScrape)

// ══════════════════════════════════════════════════════════════
// 1. STEALTH: Platform-Consistent Fingerprint Profiles (30+)
// ══════════════════════════════════════════════════════════════
const PROFILES = [
  { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36", platform: "Win32", langs: ["zh-CN","zh","en-US","en"], screen: [1920,1080], cores: 8, mem: 8 },
  { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", platform: "Win32", langs: ["zh-TW","zh","en-US","en"], screen: [1920,1080], cores: 4, mem: 8 },
  { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36", platform: "Win32", langs: ["vi-VN","vi","en-US","en"], screen: [1366,768], cores: 4, mem: 4 },
  { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", platform: "Win32", langs: ["en-US","en"], screen: [2560,1440], cores: 12, mem: 16 },
  { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36", platform: "MacIntel", langs: ["zh-CN","zh","en"], screen: [1440,900], cores: 8, mem: 8 },
  { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", platform: "MacIntel", langs: ["zh-TW","zh","en"], screen: [2560,1600], cores: 10, mem: 16 },
  { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", platform: "MacIntel", langs: ["en-US","en"], screen: [1920,1200], cores: 8, mem: 8 },
  { ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36", platform: "Linux x86_64", langs: ["en-US","en"], screen: [1920,1080], cores: 8, mem: 16 },
  { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0", platform: "Win32", langs: ["zh-CN","zh","en-US","en"], screen: [1920,1080], cores: 8, mem: 8 },
  { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0", platform: "Win32", langs: ["vi-VN","vi","en"], screen: [1536,864], cores: 4, mem: 8 },
  { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36", platform: "Win32", langs: ["zh-CN","en"], screen: [1680,1050], cores: 6, mem: 8 },
  { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36", platform: "Win32", langs: ["en-US","en","zh"], screen: [1920,1200], cores: 8, mem: 16 },
  { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36", platform: "MacIntel", langs: ["zh-CN","en"], screen: [1680,1050], cores: 8, mem: 8 },
  { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36", platform: "MacIntel", langs: ["en-US","en"], screen: [1512,982], cores: 10, mem: 16 },
  { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", platform: "Win32", langs: ["zh-TW","zh","en"], screen: [1440,900], cores: 4, mem: 4 },
];

function randomProfile() {
  return PROFILES[Math.floor(Math.random() * PROFILES.length)];
}

// ══════════════════════════════════════════════════════════════
// 2. HUMAN SIMULATION: Gaussian delay, scroll, mouse
// ══════════════════════════════════════════════════════════════
function gaussianRandom(mean, stddev) {
  const u1 = Math.random(), u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(mean * 0.3, mean + z * stddev);
}

function humanDelay(baseMs) {
  return gaussianRandom(baseMs, baseMs * 0.3);
}

// Adaptive delay: increases when errors occur
let adaptiveMultiplier = 1;
function getAdaptiveDelay(baseMs) {
  return humanDelay(baseMs * adaptiveMultiplier);
}
function increaseThrottle() { adaptiveMultiplier = Math.min(adaptiveMultiplier * 1.5, 5); }
function decreaseThrottle() { adaptiveMultiplier = Math.max(adaptiveMultiplier * 0.8, 1); }

// ══════════════════════════════════════════════════════════════
// 3. PROXY MANAGER
// ══════════════════════════════════════════════════════════════
let proxyList = [];
let proxyIndex = 0;
let proxyEnabled = false;
let proxyRotateMode = "per-chapter"; // "per-chapter" | "per-5" | "disabled"
let chaptersSinceRotate = 0;

async function loadProxySettings() {
  try {
    const data = await chrome.storage.local.get(["proxyList", "proxyEnabled", "proxyRotateMode"]);
    proxyList = (data.proxyList || []).filter(p => p.trim());
    proxyEnabled = data.proxyEnabled || false;
    proxyRotateMode = data.proxyRotateMode || "per-chapter";
    proxyIndex = 0;
  } catch {}
}

function parseProxy(proxyStr) {
  const s = proxyStr.trim();
  // socks5://host:port or socks5://host:port:user:pass
  if (s.startsWith("socks5://") || s.startsWith("socks4://")) {
    const type = s.startsWith("socks5") ? "SOCKS5" : "SOCKS4";
    const rest = s.replace(/^socks[45]:\/\//, "");
    const parts = rest.split(":");
    return { type, host: parts[0], port: parseInt(parts[1]) || 1080, user: parts[2], pass: parts[3] };
  }
  // host:port or host:port:user:pass
  const parts = s.split(":");
  return { type: "PROXY", host: parts[0], port: parseInt(parts[1]) || 8080, user: parts[2], pass: parts[3] };
}

function getNextProxy() {
  if (!proxyEnabled || proxyList.length === 0) return null;
  const proxy = parseProxy(proxyList[proxyIndex % proxyList.length]);
  proxyIndex++;
  return proxy;
}

async function setProxy(proxy) {
  if (!proxy) {
    await chrome.proxy.settings.clear({ scope: "regular" });
    return;
  }
  const pac = `function FindProxyForURL(url, host) { return "${proxy.type} ${proxy.host}:${proxy.port}"; }`;
  await chrome.proxy.settings.set({
    value: { mode: "pac_script", pacScript: { data: pac } },
    scope: "regular"
  });
}

async function clearProxy() {
  try { await chrome.proxy.settings.clear({ scope: "regular" }); } catch {}
}

// Handle proxy auth
chrome.webRequest.onAuthRequired.addListener(
  (details) => {
    if (!proxyEnabled || proxyList.length === 0) return {};
    const current = parseProxy(proxyList[(proxyIndex - 1) % proxyList.length]);
    if (current.user && current.pass) {
      return { authCredentials: { username: current.user, password: current.pass } };
    }
    return {};
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

// Rotate proxy before each chapter fetch
async function rotateProxyIfNeeded() {
  if (!proxyEnabled || proxyList.length === 0) return;
  if (proxyRotateMode === "disabled") return;

  const rotateEvery = proxyRotateMode === "per-5" ? 5 : 1;
  chaptersSinceRotate++;
  if (chaptersSinceRotate >= rotateEvery) {
    chaptersSinceRotate = 0;
    const proxy = getNextProxy();
    if (proxy) {
      await setProxy(proxy);
      console.log(`[Proxy] Rotated to ${proxy.host}:${proxy.port} (${proxy.type})`);
    }
  }
}

// Load proxy on startup
loadProxySettings();
chrome.storage.onChanged.addListener((changes) => {
  if (changes.proxyList || changes.proxyEnabled || changes.proxyRotateMode) {
    loadProxySettings();
  }
});

// ══════════════════════════════════════════════════════════════
// 4. MESSAGE HANDLING (unchanged logic, enhanced stealth)
// ══════════════════════════════════════════════════════════════
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "STV_CONTENT_READY" && sender.tab) {
    contentCache.set(sender.tab.id, {
      content: msg.content, title: msg.title, url: msg.url,
      length: msg.length, timestamp: Date.now(),
    });
  }
});

chrome.runtime.onMessageExternal.addListener((request, _sender, sendResponse) => {
  if (request.type === "PING" || request.action === "ping") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version, success: true, status: "online" });
    return false;
  }
  if (request.action === "downloadChapter") {
    stvScrapeActive = true;
    stvFetchChapter(request.payload, sendResponse);
    return true;
  }
  if (request.action === "stopScrape") {
    stvScrapeActive = false;
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
  if (request.action === "closePersistentTab") {
    // Called by the engine after all chapters are scraped — clean up persistent tabs
    (async () => {
      for (const tid of [...persistentTabIds]) {
        try { await chrome.tabs.remove(tid); } catch {}
      }
      persistentTabIds.clear();
    })();
    sendResponse({ success: true });
    return false;
  }
  if (request.action === "downloadAllSequential") {
    downloadAllSequential(request.payload, sendResponse);
    return true;
  }
  if (request.type === "FETCH") {
    handleFetch(request.url, request.waitSelector, request.clickSelector, request.timeout || 15000, request.activeTab, request.reuseTab)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  return false;
});

// ══════════════════════════════════════════════════════════════
// 5. STV CHAPTER FETCHING (unchanged)
// ══════════════════════════════════════════════════════════════
async function findSTVTab(targetUrl) {
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

async function stvFetchChapter(payload, sendResponse) {
  try {
    const tabId = await findSTVTab(payload.chapterUrl);
    if (!tabId) { sendResponse({ success: false, error: "Mở 1 tab SangTacViet trước!" }); return; }
    
    // Ensure the tab is active and its window is focused!
    await chrome.tabs.update(tabId, { active: true });
    try {
      const tabInfo = await chrome.tabs.get(tabId);
      if (tabInfo && tabInfo.windowId) {
        await chrome.windows.update(tabInfo.windowId, { focused: true });
      }
    } catch (winErr) {
      console.warn("[STV] Window focus error:", winErr);
    }

    // Check if the tab's current URL matches the target chapter URL.
    // If they differ, navigate the tab to the target chapter URL.
    let tabInfo;
    try {
      tabInfo = await chrome.tabs.get(tabId);
    } catch {}
    
    const normPath = (str) => {
      try {
        const uObj = new URL(str);
        return uObj.pathname.replace(/#.*$/, "").replace(/\?.*$/, "").replace(/\/$/, "");
      } catch {
        return str.replace(/#.*$/, "").replace(/\?.*$/, "").replace(/\/$/, "");
      }
    };

    if (tabInfo && tabInfo.url && payload.chapterUrl) {
      const currentNorm = normPath(tabInfo.url);
      const targetNorm = normPath(payload.chapterUrl);
      if (currentNorm !== targetNorm) {
        console.log(`[STV] Tab URL (${tabInfo.url}) differs from target (${payload.chapterUrl}). Navigating...`);
        await chrome.tabs.update(tabId, { url: payload.chapterUrl, active: true });
        // Wait for navigation load
        await waitForTabLoad(tabId, 15000);
      }
    }
    
    // 1. Wait for the user-specified delay BEFORE extracting.
    // The user wants to wait e.g. 5 seconds (out of 7) to let the page fully load.
    const userDelay = payload.delayMs || 7000;
    const waitBeforeExtract = Math.max(1000, userDelay - 2000); // e.g. 5000ms
    
    console.log(`[STV] Waiting ${waitBeforeExtract}ms before extracting text to ensure full load...`);
    for (let i = 0; i < waitBeforeExtract / 500; i++) {
      if (!stvScrapeActive) break;
      await delay(500);
    }

    if (!stvScrapeActive) {
      sendResponse({ success: false, stopped: true });
      return;
    }

    let content = "", title = "";
    
    // Clear any stale cache that might have been captured too early
    contentCache.delete(tabId);

    // 2. Extract NOW
    for (let i = 0; i < 10; i++) {
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
    
    // 3. Trigger GO_NEXT for the next iteration
    const shouldNext = payload.allowNext !== false && stvScrapeActive;
    if (shouldNext && content.length > 200) {
      try {
        await chrome.tabs.sendMessage(tabId, { type: "GO_NEXT" });
        // We let the page navigate, but we should wait the REMAINING time of the user's delay
        // before returning, so the total interval respects the user's setting (e.g. 7s).
        const remainingDelay = Math.max(0, userDelay - waitBeforeExtract);
        console.log(`[STV] GO_NEXT triggered, waiting remaining ${remainingDelay}ms...`);
        for (let i = 0; i < remainingDelay / 500; i++) {
          if (!stvScrapeActive) break;
          await delay(500);
        }
      } catch (e) { console.log("[STV] GO_NEXT Error:", e.message); }
    }
    
    sendResponse({ success: true, content, contentText: content, data: "", length: content.length, title, timedOut: content.length < 200, stopped: !stvScrapeActive });
  } catch (error) { sendResponse({ success: false, error: error.message }); }
}

async function downloadAllSequential({ chapters, delay: d = 1000 }, sendResponse) {
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

// ══════════════════════════════════════════════════════════════
// 6. CORE FETCH — Stealth Enhanced + Proxy Rotation
// ══════════════════════════════════════════════════════════════
async function handleFetch(url, waitSelector, clickSelector, timeout, forceActive = false, reuseTab = false) {
  // Rotate proxy before this chapter
  await rotateProxyIfNeeded();

  // 1. Try silent background fetch first if no clicking/special waiting is needed
  if (!clickSelector) {
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

      if (response.ok) {
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

        const hasCf = text.includes("Just a moment...") || text.includes("cf-challenge") || text.includes("cf_challenge") || text.includes("Turnstile") || text.includes("Checking your browser") || text.includes("Attention Required!");
        
        let isValid = !hasCf && text.length > 200;
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
      } else {
        console.log(`[Silent Fetch] Failed with status ${response.status}, falling back to tab...`);
      }
    } catch (e) {
      console.log(`[Silent Fetch] Error: ${e.message}, falling back to tab...`);
    }
  }

  // Remember the current active tab so we can refocus it (important for Android)
  let originalTabId = null;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) originalTabId = activeTab.id;
  } catch {}

  let tabId = null;
  let isReused = false;
  let didNavigate = false;
  let createdWindowId = null; // Only set when we open a dedicated minimized window (non-reuseTab)

  if (reuseTab) {
    try {
      const u = new URL(url);
      console.log(`[Fetch] reuseTab active. u.hostname: ${u.hostname}`);
      const allTabs = await chrome.tabs.query({});
      const tabs = allTabs.filter(t => {
        if (!t.url) return false;
        try {
          const tabUrl = new URL(t.url);
          if (u.hostname.includes("sangtacviet") && tabUrl.hostname.includes("sangtacviet")) {
            return true;
          }
          if (u.hostname.includes("69shuba") && tabUrl.hostname.includes("69shuba")) {
            return true;
          }
          return tabUrl.hostname === u.hostname;
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
          console.log(`[Fetch] Paths differ. Navigating tab ${tabId} to ${url} (background, no focus steal)`);

          // For all sites including STV: navigate WITHOUT activating the tab.
          // STV novel info is now fetched via silent fetch (static HTML), so chapter fetches
          // are the main reuseTab path. Chapter content renders fine in a background tab
          // when we inject the visibilityState spoof below.
          await chrome.tabs.update(tabId, { url });
          didNavigate = true;

          // Inject visibilityState=visible ASAP so STV's JS doesn't throttle.
          // Retry several times to catch the earliest possible moment after navigation.
          if (url.includes("sangtacviet")) {
            for (let attempt = 0; attempt < 5; attempt++) {
              await delay(200);
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
        } else {
          console.log(`[Fetch] Paths are identical. No navigation needed.`);
          // Brief settle delay — page is already loaded, no need to activate
          await delay(500);
        }
      }
    } catch (e) {
      console.error("[Fetch] reuseTab error:", e);
    }
  }

  if (!isReused) {
    try {
      const isSTV = url.includes("sangtacviet");
      if (reuseTab && !isSTV) {
        // Persistent-tab adapters (hetushu, 69shuba, etc.): create a background tab inside
        // the current window — no new window, no popup, no focus steal.
        // The tab is kept alive across all chapters and cleaned up by stopScrape/closePersistentTab.
        const tab = await chrome.tabs.create({ url, active: false });
        tabId = tab.id;
        persistentTabIds.add(tabId); // register for later cleanup
        didNavigate = true;
        console.log(`[Fetch] Created persistent background tab ${tabId} for reuseTab adapter.`);
      } else {
        // STV or one-shot fetch: create a minimized window so the tab gets full JS execution
        // (no throttling from hidden state). STV needs visible tab to render chapter list.
        const win = await chrome.windows.create({ url, state: "minimized" });
        const tab = win.tabs && win.tabs.length > 0 ? win.tabs[0] : (await chrome.tabs.query({ windowId: win.id }))[0];
        tabId = tab.id;
        createdWindowId = win.id; // track so we can refocus and clean up later
        didNavigate = true;
        console.log(`[Fetch] Created minimized window tab ${tabId} (isSTV: ${isSTV}).`);
      }
    } catch (winErr) {
      console.warn("[Fetch] Error creating tab/window, falling back to background tab:", winErr);
      try {
        const tab = await chrome.tabs.create({ url, active: false });
        tabId = tab.id;
        if (reuseTab && !url.includes("sangtacviet")) persistentTabIds.add(tabId);
        didNavigate = true;
      } catch (tabErr) {
        console.warn("[Fetch] Error creating background tab, falling back to active tab:", tabErr);
        const tab = await chrome.tabs.create({ url, active: forceActive });
        tabId = tab.id;
        didNavigate = true;
      }
    }
  }

  // Refocus the app tab only when we opened a brand-new separate window (one-shot mode).
  // For background tabs (reuseTab mode) the app window never lost focus.
  if (originalTabId && createdWindowId) {
    try { await chrome.tabs.update(originalTabId, { active: true }); } catch {}
  }

  try {
    if (didNavigate) {
      await waitForTabLoad(tabId, 30000);
      
      // Check if Cloudflare is present
      let hasCf = false;
      try {
        const checkRes = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => document.body.innerHTML
        });
        const bodyHtml = checkRes?.[0]?.result || "";
        hasCf = bodyHtml.includes("Just a moment...") || bodyHtml.includes("cf-challenge") || bodyHtml.includes("cf_challenge") || bodyHtml.includes("Turnstile") || bodyHtml.includes("Checking your browser") || bodyHtml.includes("Attention Required!");
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
      // Background tabs in the main window stay in background automatically.
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

// ══════════════════════════════════════════════════════════════
// 7. FULL STEALTH INJECTION — Extended
// ══════════════════════════════════════════════════════════════
async function injectFullStealth(tabId) {
  const profile = randomProfile();
  try {
    await chrome.scripting.executeScript({
      target: { tabId }, world: "MAIN",
      args: [profile],
      func: (p) => {
        // 1. Hide webdriver
        Object.defineProperty(navigator, "webdriver", { get: () => undefined, configurable: true });

        // 2. Fake visibility
        Object.defineProperty(document, "hidden", { get: () => false, configurable: true });
        Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
        Document.prototype.hasFocus = () => true;
        document.addEventListener("visibilitychange", (e) => e.stopImmediatePropagation(), true);

        // Prevent browser translation (Google Translate, Edge Translate, etc.)
        try {
          document.documentElement.classList.add('notranslate');
          const meta = document.createElement('meta');
          meta.name = 'google';
          meta.content = 'notranslate';
          document.head.appendChild(meta);
        } catch (e) {}

        // 3. Fake User-Agent + platform
        Object.defineProperty(navigator, "userAgent", { get: () => p.ua, configurable: true });
        Object.defineProperty(navigator, "platform", { get: () => p.platform, configurable: true });

        // 4. Fake plugins
        Object.defineProperty(navigator, "plugins", {
          get: () => [
            { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer" },
            { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai" },
            { name: "Native Client", filename: "internal-nacl-plugin" },
          ], configurable: true,
        });

        // 5. Fake languages
        Object.defineProperty(navigator, "languages", { get: () => p.langs, configurable: true });

        // 6. Fake hardware
        Object.defineProperty(navigator, "hardwareConcurrency", { get: () => p.cores, configurable: true });
        Object.defineProperty(navigator, "deviceMemory", { get: () => p.mem, configurable: true });

        // 7. Fake screen
        Object.defineProperty(screen, "width", { get: () => p.screen[0], configurable: true });
        Object.defineProperty(screen, "height", { get: () => p.screen[1], configurable: true });
        Object.defineProperty(screen, "availWidth", { get: () => p.screen[0], configurable: true });
        Object.defineProperty(screen, "availHeight", { get: () => p.screen[1] - 40, configurable: true });

        // 8. Permissions query override
        const origQuery = window.Permissions?.prototype?.query;
        if (origQuery) {
          window.Permissions.prototype.query = function (params) {
            if (params.name === "notifications") return Promise.resolve({ state: "prompt", onchange: null });
            return origQuery.call(this, params);
          };
        }

        // 9. Canvas fingerprint noise
        const origGetCtx = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
          const ctx = origGetCtx.call(this, type, ...args);
          if (type === "2d" && ctx) {
            const origFill = ctx.fillText.bind(ctx);
            ctx.fillText = function (...a) { ctx.shadowBlur = Math.random() * 0.01; ctx.shadowColor = "rgba(0,0,0,0.001)"; return origFill(...a); };
          }
          return ctx;
        };

        // 10. WebGL renderer spoof
        const getParam = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (param) {
          if (param === 37445) return "Intel Inc.";
          if (param === 37446) return "Intel Iris OpenGL Engine";
          return getParam.call(this, param);
        };

        // 11. AudioContext fingerprint noise
        try {
          const origCreateOsc = AudioContext.prototype.createOscillator;
          AudioContext.prototype.createOscillator = function () {
            const osc = origCreateOsc.call(this);
            const origConnect = osc.connect.bind(osc);
            osc.connect = function (dest) {
              if (dest.gain !== undefined) dest.gain.value += (Math.random() - 0.5) * 0.0001;
              return origConnect(dest);
            };
            return osc;
          };
        } catch {}

        // 12. chrome.csi / chrome.loadTimes (headless detection)
        try {
          if (!window.chrome) window.chrome = {};
          window.chrome.csi = () => ({ onloadT: Date.now() - Math.floor(Math.random() * 3000), startE: Date.now() - 5000, pageT: Math.random() * 3000 });
          window.chrome.loadTimes = () => ({
            commitLoadTime: Date.now() / 1000 - 2, connectionInfo: "h2", finishDocumentLoadTime: Date.now() / 1000 - 1,
            finishLoadTime: Date.now() / 1000, firstPaintAfterLoadTime: 0, firstPaintTime: Date.now() / 1000 - 0.5,
            navigationType: "Other", npnNegotiatedProtocol: "h2", requestTime: Date.now() / 1000 - 3, wasAlternateProtocolAvailable: false, wasFetchedViaSpdy: true, wasNpnNegotiated: true,
          });
        } catch {}

        // 13. navigator.connection (NetworkInformation)
        try {
          Object.defineProperty(navigator, "connection", {
            get: () => ({ downlink: 10 + Math.random() * 5, effectiveType: "4g", rtt: 50 + Math.floor(Math.random() * 50), saveData: false }),
            configurable: true,
          });
        } catch {}

        // 14. Prevent Selenium/automation detection
        delete navigator.__proto__.webdriver;
        Object.defineProperty(navigator, "maxTouchPoints", { get: () => 0, configurable: true });
      },
    });
  } catch {}
}

// ══════════════════════════════════════════════════════════════
// 8. HUMAN BEHAVIOR SIMULATION
// ══════════════════════════════════════════════════════════════
async function simulateHuman(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Random mouse movements
        const dispatchMouse = (x, y) => {
          document.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }));
        };
        for (let i = 0; i < 3 + Math.floor(Math.random() * 4); i++) {
          setTimeout(() => {
            dispatchMouse(Math.random() * window.innerWidth * 0.8 + 50, Math.random() * window.innerHeight * 0.6 + 50);
          }, i * (150 + Math.random() * 200));
        }

        // Gradual scroll
        const totalScroll = document.documentElement.scrollHeight * (0.3 + Math.random() * 0.4);
        let scrolled = 0;
        const scrollStep = () => {
          if (scrolled >= totalScroll) return;
          const step = 80 + Math.random() * 150;
          window.scrollBy(0, step);
          scrolled += step;
          setTimeout(scrollStep, 100 + Math.random() * 300);
        };
        setTimeout(scrollStep, 300 + Math.random() * 500);
      },
    });
    // Wait for scroll to mostly complete
    await delay(800 + Math.random() * 600);
  } catch {}
}

// ══════════════════════════════════════════════════════════════
// 9. UTILITY FUNCTIONS
// ══════════════════════════════════════════════════════════════
async function waitForSelector(tabId, sel, maxWait, minLen) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const r = await chrome.scripting.executeScript({
        target: { tabId }, args: [sel],
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

async function waitForStableContent(tabId, maxWait) {
  const start = Date.now();
  let last = 0, stable = 0;
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
      if (len === last && len > 0) { stable++; if (stable >= 2) return; }
      else stable = 0;
      last = len;
    } catch {}
    await delay(500);
  }
}

function waitForTabLoad(tabId, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); resolve(); }, ms);
    function fn(id, info) {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(fn); clearTimeout(t); resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(fn);
  });
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

chrome.tabs.onRemoved.addListener((tabId) => { contentCache.delete(tabId); });