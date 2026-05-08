console.log("%c🚀 Novel Studio Connector v6.0 — Stealth Mode", "color:lime;font-size:16px");
const contentCache = new Map();
let stvScrapeActive = true;

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
    sendResponse({ success: true });
    return false;
  }
  if (request.action === "downloadAllSequential") {
    downloadAllSequential(request.payload, sendResponse);
    return true;
  }
  if (request.action === "closePersistentTab") {
    if (persistentTabId) {
      try { chrome.tabs.remove(persistentTabId); } catch {}
      persistentTabId = null;
    }
    sendResponse({ success: true });
    return false;
  }
  if (request.type === "FETCH") {
    handleFetch(request.url, request.waitSelector, request.clickSelector, request.timeout || 15000, request.reuseTab || false)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  return false;
});

// ══════════════════════════════════════════════════════════════
// 5. STV CHAPTER FETCHING (unchanged)
// ══════════════════════════════════════════════════════════════
async function findSTVTab() {
  const tabs = await chrome.tabs.query({ url: ["*://sangtacviet.com/*", "*://sangtacviet.app/*", "*://sangtacviet.vip/*", "*://fanqienovel.com/*", "*://*.fanqienovel.com/*"] });
  return tabs.length > 0 ? tabs[0].id : null;
}

async function stvFetchChapter(payload, sendResponse) {
  try {
    const tabId = await findSTVTab();
    if (!tabId) { sendResponse({ success: false, error: "Mở 1 tab SangTacViet trước!" }); return; }
    let content = "", title = "";
    for (let i = 0; i < 40; i++) {
      if (!stvScrapeActive) break;
      const cached = contentCache.get(tabId);
      if (cached && cached.length > 200) { content = cached.content; title = cached.title; contentCache.delete(tabId); break; }
      if (i === 6) {
        try {
          const resp = await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_NOW" });
          if (resp && resp.length > 200) { content = resp.content; title = resp.title; break; }
        } catch {}
      }
      await delay(500);
    }
    contentCache.delete(tabId);
    const shouldNext = payload.allowNext !== false && stvScrapeActive;
    if (shouldNext && content.length > 200) {
      try {
        await chrome.tabs.sendMessage(tabId, { type: "GO_NEXT" });
        await waitForTabLoad(tabId, 25000);
        for (let i = 0; i < 30; i++) { if (!stvScrapeActive || contentCache.has(tabId)) break; await delay(500); }
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
let persistentTabId = null;

async function handleFetch(url, waitSelector, clickSelector, timeout, reuseTab = false) {
  // Rotate proxy before this chapter
  await rotateProxyIfNeeded();

  let tabId;
  if (reuseTab) {
    if (persistentTabId) {
      try {
        await chrome.tabs.get(persistentTabId);
        tabId = persistentTabId;
        await chrome.tabs.update(tabId, { url });
      } catch {
        const tab = await chrome.tabs.create({ url, active: true });
        tabId = persistentTabId = tab.id;
      }
    } else {
      const tab = await chrome.tabs.create({ url, active: true });
      tabId = persistentTabId = tab.id;
    }
  } else {
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;
  }

  try {
    await waitForTabLoad(tabId, 30000);
    await injectFullStealth(tabId);
    // Human-like random delay
    await delay(getAdaptiveDelay(1500));

    // Simulate human: scroll + mouse
    await simulateHuman(tabId);

    let timedOut = false;
    if (clickSelector && waitSelector) {
      for (let i = 0; i < 3; i++) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId }, args: [clickSelector],
            func: (s) => { const el = document.querySelector(s); if (el) el.click(); },
          });
        } catch {}
        if (!(await waitForSelector(tabId, waitSelector, Math.floor(timeout / 3), 200))) {
          timedOut = false; break;
        }
        timedOut = true;
        await delay(humanDelay(500));
      }
    } else if (waitSelector) {
      timedOut = await waitForSelector(tabId, waitSelector, timeout, 200);
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
    if (!data) throw new Error("Failed to extract");

    // Success → decrease throttle
    if (data.contentText && data.contentText.length > 100) decreaseThrottle();

    return { html: data.html, contentText: data.contentText, timedOut };
  } catch (err) {
    // Error → increase throttle
    increaseThrottle();
    throw err;
  } finally {
    if (!reuseTab) {
      try { await chrome.tabs.remove(tabId); } catch {}
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