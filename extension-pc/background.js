"use strict";
(() => {
  // extension-pc/modules/proxy.js
  var proxyList = [];
  var proxyIndex = 0;
  var proxyEnabled = false;
  var proxyRotateMode = "per-chapter";
  var chaptersSinceRotate = 0;
  async function loadProxySettings() {
    try {
      const data = await chrome.storage.local.get(["proxyList", "proxyEnabled", "proxyRotateMode"]);
      proxyList = (data.proxyList || []).filter((p) => p.trim());
      proxyEnabled = data.proxyEnabled || false;
      proxyRotateMode = data.proxyRotateMode || "per-chapter";
      proxyIndex = 0;
    } catch {
    }
  }
  function parseProxy(proxyStr) {
    const s = proxyStr.trim();
    if (s.startsWith("socks5://") || s.startsWith("socks4://")) {
      const type = s.startsWith("socks5") ? "SOCKS5" : "SOCKS4";
      const rest = s.replace(/^socks[45]:\/\//, "");
      const parts2 = rest.split(":");
      return { type, host: parts2[0], port: parseInt(parts2[1]) || 1080, user: parts2[2], pass: parts2[3] };
    }
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
    try {
      await chrome.proxy.settings.clear({ scope: "regular" });
    } catch {
    }
  }
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
  function initProxy() {
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
    loadProxySettings();
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.proxyList || changes.proxyEnabled || changes.proxyRotateMode) {
        loadProxySettings();
      }
    });
  }

  // extension-pc/modules/utils.js
  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  async function waitForSelector(tabId, sel, maxWait, minLen) {
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
          }
        });
        if ((r?.[0]?.result ?? 0) > minLen) return false;
      } catch {
      }
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
          }
        });
        const len = r?.[0]?.result ?? 0;
        if (len === last && len > 0) {
          stable++;
          if (stable >= 2) return;
        } else {
          stable = 0;
        }
        last = len;
      } catch {
      }
      await delay(500);
    }
  }
  function waitForTabLoad(tabId, targetUrl, ms = 3e4) {
    return new Promise(async (resolve) => {
      let targetPath = "";
      try {
        targetPath = new URL(targetUrl).pathname.replace(/\/$/, "");
      } catch {
        targetPath = targetUrl.replace(/\/$/, "");
      }
      try {
        const currentTab = await chrome.tabs.get(tabId);
        if (currentTab && (currentTab.url || "").includes(targetPath)) {
          console.log("[waitForTabLoad] Tab already matches target URL. Resolving instantly.");
          resolve();
          return;
        }
      } catch (e) {
        console.warn("[waitForTabLoad] Instant check error:", e.message);
      }
      const t = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(fn);
        resolve();
      }, ms);
      async function fn(id, info) {
        if (id === tabId) {
          try {
            const tab = await chrome.tabs.get(tabId);
            const currentUrl = tab.url || "";
            const isTarget = currentUrl.includes(targetPath);
            if (isTarget) {
              chrome.tabs.onUpdated.removeListener(fn);
              clearTimeout(t);
              resolve();
            }
          } catch (e) {
            console.warn("[waitForTabLoad] Error in listener:", e.message);
          }
        }
      }
      chrome.tabs.onUpdated.addListener(fn);
    });
  }

  // extension-pc/modules/stv-handler.js
  var contentCache = /* @__PURE__ */ new Map();
  var stvScrapeActive = true;
  function setStvScrapeActive(active) {
    stvScrapeActive = active;
  }
  async function findSTVTab(targetUrl) {
    const allTabs = await chrome.tabs.query({});
    const tabs = allTabs.filter((t) => {
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
        const targetPathParts = targetObj.pathname.split("/").filter(Boolean);
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
      if (!tabId) {
        sendResponse({ success: false, error: "M\u1EDF 1 tab SangTacViet tr\u01B0\u1EDBc!" });
        return;
      }
      const userDelay = payload.delayMs || 7e3;
      const isFirstChapter = payload.isFirstChapter === true;
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
        let prevContent = "";
        try {
          const prevResp = await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_NOW" });
          if (prevResp && prevResp.content) {
            prevContent = prevResp.content.substring(0, 200);
          }
        } catch {
        }
        let oldUrl = "";
        try {
          const oldTabState = await chrome.tabs.get(tabId);
          oldUrl = oldTabState.url || "";
        } catch {
        }
        console.log("[STV] Clicking next chapter button...");
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
              const nextBtn = document.querySelector("#navnextbot") || document.querySelector("#navnexttop") || document.querySelector('a[id*="navnext"]');
              if (nextBtn) {
                nextBtn.click();
                return true;
              }
              const links = document.querySelectorAll("a");
              for (const a of links) {
                const text = (a.textContent || "").trim().toLowerCase();
                if (text.includes("ch\u01B0\u01A1ng sau") || text.includes("ch\u01B0\u01A1ng k\u1EBF") || text.includes("ti\u1EBFp") || text === "next") {
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
        if (oldUrl) {
          console.log("[STV] Waiting for URL to change from:", oldUrl);
          const urlWaitStart = Date.now();
          for (let i = 0; i < 20; i++) {
            if (!stvScrapeActive) break;
            await delay(500);
            try {
              const currentTab = await chrome.tabs.get(tabId);
              if (currentTab.url && currentTab.url !== oldUrl) {
                console.log(`[STV] URL changed to: ${currentTab.url} after ${Date.now() - urlWaitStart}ms`);
                break;
              }
            } catch {
            }
          }
        }
        const completeWaitStart = Date.now();
        for (let i = 0; i < 25; i++) {
          if (!stvScrapeActive) break;
          try {
            const currentTab = await chrome.tabs.get(tabId);
            if (currentTab.status === "complete") {
              console.log(`[STV] Tab loading complete after ${Date.now() - completeWaitStart}ms`);
              break;
            }
          } catch {
          }
          await delay(500);
        }
        console.log(`[STV] Waiting for content to change after clicking next...`);
        const waitStart = Date.now();
        const maxContentWait = Math.max(userDelay, 8e3);
        let contentChanged = false;
        for (let i = 0; i < maxContentWait / 1e3; i++) {
          if (!stvScrapeActive) break;
          try {
            const checkResp = await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_NOW" });
            if (checkResp && checkResp.length > 200) {
              const newContentHead = (checkResp.content || "").substring(0, 200);
              if (!prevContent || newContentHead !== prevContent) {
                contentChanged = true;
                console.log(`[STV] Content changed after ${Date.now() - waitStart}ms`);
                break;
              }
            }
            await delay(1e3);
          } catch (err) {
            await delay(2e3);
          }
        }
        if (!contentChanged) {
          console.log("[STV] Content did not change after clicking next, will try extracting anyway...");
        }
      } else {
        console.log("[STV] First chapter - waiting for user to open chapter 1 on STV tab...");
        const maxWaitForUser = 12e4;
        const pollInterval = 2e3;
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
          } catch {
          }
          if (i > 0 && i % 5 === 0) {
            console.log(`[STV] Still waiting for user to open chapter 1... (${Math.round((Date.now() - waitStart) / 1e3)}s)`);
          }
        }
        if (!contentFound && stvScrapeActive) {
          console.log("[STV] Timeout: user did not open chapter 1 within 2 minutes.");
          sendResponse({ success: false, error: "Timeout: Vui l\xF2ng m\u1EDF tab STV v\xE0 b\u1EA5m v\xE0o Ch\u01B0\u01A1ng 1 tr\u01B0\u1EDBc khi t\u1EA3i!", timedOut: true });
          return;
        }
      }
      if (!stvScrapeActive) {
        sendResponse({ success: false, stopped: true });
        return;
      }
      let content = "", title = "";
      contentCache.delete(tabId);
      for (let i = 0; i < 20; i++) {
        if (!stvScrapeActive) break;
        try {
          const resp = await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_NOW" });
          if (resp && resp.length > 200) {
            content = resp.content;
            title = resp.title;
            break;
          }
        } catch (err) {
          console.log(`[STV] Send message failed (attempt ${i}):`, err.message);
          await delay(2e3);
          continue;
        }
        await delay(1e3);
      }
      let currentUrl = "";
      try {
        const tabState = await chrome.tabs.get(tabId);
        currentUrl = tabState.url || "";
      } catch {
      }
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
        currentUrl
        // Send back for verification
      });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }
  async function downloadAllSequential({ chapters, delay: d = 1e3 }, sendResponse) {
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

  // extension-pc/modules/stealth.js
  var PROFILES = [
    { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36", platform: "Win32", langs: ["zh-CN", "zh", "en-US", "en"], screen: [1920, 1080], cores: 8, mem: 8 },
    { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", platform: "Win32", langs: ["zh-TW", "zh", "en-US", "en"], screen: [1920, 1080], cores: 4, mem: 8 },
    { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36", platform: "Win32", langs: ["vi-VN", "vi", "en-US", "en"], screen: [1366, 768], cores: 4, mem: 4 },
    { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", platform: "Win32", langs: ["en-US", "en"], screen: [2560, 1440], cores: 12, mem: 16 },
    { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36", platform: "MacIntel", langs: ["zh-CN", "zh", "en"], screen: [1440, 900], cores: 8, mem: 8 },
    { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", platform: "MacIntel", langs: ["zh-TW", "zh", "en"], screen: [2560, 1600], cores: 10, mem: 16 },
    { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", platform: "MacIntel", langs: ["en-US", "en"], screen: [1920, 1200], cores: 8, mem: 8 },
    { ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36", platform: "Linux x86_64", langs: ["en-US", "en"], screen: [1920, 1080], cores: 8, mem: 16 },
    { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0", platform: "Win32", langs: ["zh-CN", "zh", "en-US", "en"], screen: [1920, 1080], cores: 8, mem: 8 },
    { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0", platform: "Win32", langs: ["vi-VN", "vi", "en"], screen: [1536, 864], cores: 4, mem: 8 },
    { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36", platform: "Win32", langs: ["zh-CN", "en"], screen: [1680, 1050], cores: 6, mem: 8 },
    { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36", platform: "Win32", langs: ["en-US", "en", "zh"], screen: [1920, 1200], cores: 8, mem: 16 },
    { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36", platform: "MacIntel", langs: ["zh-CN", "en"], screen: [1680, 1050], cores: 8, mem: 8 },
    { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36", platform: "MacIntel", langs: ["en-US", "en"], screen: [1512, 982], cores: 10, mem: 16 },
    { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", platform: "Win32", langs: ["zh-TW", "zh", "en"], screen: [1440, 900], cores: 4, mem: 4 }
  ];
  function randomProfile() {
    return PROFILES[Math.floor(Math.random() * PROFILES.length)];
  }
  async function injectFullStealth(tabId) {
    const profile = randomProfile();
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        args: [profile],
        func: (p) => {
          Object.defineProperty(navigator, "webdriver", { get: () => void 0, configurable: true });
          Object.defineProperty(document, "hidden", { get: () => false, configurable: true });
          Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
          Document.prototype.hasFocus = () => true;
          document.addEventListener("visibilitychange", (e) => e.stopImmediatePropagation(), true);
          try {
            document.documentElement.classList.add("notranslate");
            const meta = document.createElement("meta");
            meta.name = "google";
            meta.content = "notranslate";
            document.head.appendChild(meta);
          } catch (e) {
          }
          Object.defineProperty(navigator, "userAgent", { get: () => p.ua, configurable: true });
          Object.defineProperty(navigator, "platform", { get: () => p.platform, configurable: true });
          Object.defineProperty(navigator, "plugins", {
            get: () => [
              { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer" },
              { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai" },
              { name: "Native Client", filename: "internal-nacl-plugin" }
            ],
            configurable: true
          });
          Object.defineProperty(navigator, "languages", { get: () => p.langs, configurable: true });
          Object.defineProperty(navigator, "hardwareConcurrency", { get: () => p.cores, configurable: true });
          Object.defineProperty(navigator, "deviceMemory", { get: () => p.mem, configurable: true });
          Object.defineProperty(screen, "width", { get: () => p.screen[0], configurable: true });
          Object.defineProperty(screen, "height", { get: () => p.screen[1], configurable: true });
          Object.defineProperty(screen, "availWidth", { get: () => p.screen[0], configurable: true });
          Object.defineProperty(screen, "availHeight", { get: () => p.screen[1] - 40, configurable: true });
          const origQuery = window.Permissions?.prototype?.query;
          if (origQuery) {
            window.Permissions.prototype.query = function(params) {
              if (params.name === "notifications") return Promise.resolve({ state: "prompt", onchange: null });
              return origQuery.call(this, params);
            };
          }
          const origGetCtx = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function(type, ...args) {
            const ctx = origGetCtx.call(this, type, ...args);
            if (type === "2d" && ctx) {
              const origFill = ctx.fillText.bind(ctx);
              ctx.fillText = function(...a) {
                ctx.shadowBlur = Math.random() * 0.01;
                ctx.shadowColor = "rgba(0,0,0,0.001)";
                return origFill(...a);
              };
            }
            return ctx;
          };
          const getParam = WebGLRenderingContext.prototype.getParameter;
          WebGLRenderingContext.prototype.getParameter = function(param) {
            if (param === 37445) return "Intel Inc.";
            if (param === 37446) return "Intel Iris OpenGL Engine";
            return getParam.call(this, param);
          };
          try {
            const origCreateOsc = AudioContext.prototype.createOscillator;
            AudioContext.prototype.createOscillator = function() {
              const osc = origCreateOsc.call(this);
              const origConnect = osc.connect.bind(osc);
              osc.connect = function(dest) {
                if (dest.gain !== void 0) dest.gain.value += (Math.random() - 0.5) * 1e-4;
                return origConnect(dest);
              };
              return osc;
            };
          } catch {
          }
          try {
            if (!window.chrome) window.chrome = {};
            window.chrome.csi = () => ({ onloadT: Date.now() - Math.floor(Math.random() * 3e3), startE: Date.now() - 5e3, pageT: Math.random() * 3e3 });
            window.chrome.loadTimes = () => ({
              commitLoadTime: Date.now() / 1e3 - 2,
              connectionInfo: "h2",
              finishDocumentLoadTime: Date.now() / 1e3 - 1,
              finishLoadTime: Date.now() / 1e3,
              firstPaintAfterLoadTime: 0,
              firstPaintTime: Date.now() / 1e3 - 0.5,
              navigationType: "Other",
              npnNegotiatedProtocol: "h2",
              requestTime: Date.now() / 1e3 - 3,
              wasAlternateProtocolAvailable: false,
              wasFetchedViaSpdy: true,
              wasNpnNegotiated: true
            });
          } catch {
          }
          try {
            Object.defineProperty(navigator, "connection", {
              get: () => ({ downlink: 10 + Math.random() * 5, effectiveType: "4g", rtt: 50 + Math.floor(Math.random() * 50), saveData: false }),
              configurable: true
            });
          } catch {
          }
          delete navigator.__proto__.webdriver;
          Object.defineProperty(navigator, "maxTouchPoints", { get: () => 0, configurable: true });
        }
      });
    } catch {
    }
  }

  // extension-pc/modules/human-sim.js
  function gaussianRandom(mean, stddev) {
    const u1 = Math.random(), u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(mean * 0.3, mean + z * stddev);
  }
  function humanDelay(baseMs) {
    return gaussianRandom(baseMs, baseMs * 0.3);
  }
  var adaptiveMultiplier = 1;
  function getAdaptiveDelay(baseMs) {
    return humanDelay(baseMs * adaptiveMultiplier);
  }
  function increaseThrottle() {
    adaptiveMultiplier = Math.min(adaptiveMultiplier * 1.5, 5);
  }
  function decreaseThrottle() {
    adaptiveMultiplier = Math.max(adaptiveMultiplier * 0.8, 1);
  }
  async function simulateHuman(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const dispatchMouse = (x, y) => {
            document.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }));
          };
          for (let i = 0; i < 3 + Math.floor(Math.random() * 4); i++) {
            setTimeout(() => {
              dispatchMouse(Math.random() * window.innerWidth * 0.8 + 50, Math.random() * window.innerHeight * 0.6 + 50);
            }, i * (150 + Math.random() * 200));
          }
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
        }
      });
      await delay(800 + Math.random() * 600);
    } catch {
    }
  }

  // extension-pc/modules/site-config.js
  var SITE_CONFIGS = {
    // ── Vietnamese Sites ──────────────────────────────────────
    "xtruyen.vn": {
      skipSilentFetch: true,
      // XTruyen cần JS render, không dùng silent fetch
      forceActiveTab: false
      // Tab chạy ngầm ẩn đi, đã có injectVisibilityOverride lo phần visibility
    },
    "sangtacviet": {
      skipSilentFetch: true,
      isSTV: true,
      // Dùng STV handler riêng (findSTVTab, stvFetchChapter)
      reuseTabHostnames: ["sangtacviet"]
    },
    // ── Chinese Sites ─────────────────────────────────────────
    "69shuba": {
      reuseTabHostnames: ["69shuba"]
      // Match tất cả domain 69shuba.*
    },
    "hetushu.com": {
      // Sử dụng sequential tab reuse, không cần config đặc biệt
    },
    "fanqienovel": {
      skipSilentFetch: true,
      isSTV: true,
      // Fanqie cũng dùng STV-style tab handler
      reuseTabHostnames: ["fanqienovel", "fanqie"]
    }
  };
  function getSiteConfig(url) {
    try {
      const hostname = new URL(url).hostname;
      for (const [pattern, config] of Object.entries(SITE_CONFIGS)) {
        if (hostname.includes(pattern)) return config;
      }
    } catch (e) {
      console.warn("[SiteConfig] Error parsing URL:", e.message);
    }
    return {};
  }
  function isHostnameMatch(tabHostname, targetHostname, siteConfig) {
    if (siteConfig.reuseTabHostnames && siteConfig.reuseTabHostnames.length > 0) {
      for (const alias of siteConfig.reuseTabHostnames) {
        if (targetHostname.includes(alias) && tabHostname.includes(alias)) {
          return true;
        }
      }
    }
    return tabHostname === targetHostname;
  }

  // extension-pc/modules/fetch-handler.js
  var persistentTabIds = /* @__PURE__ */ new Set();
  async function injectVisibilityOverride(tabId, retries = 5, delayMs = 200) {
    for (let attempt = 0; attempt < retries; attempt++) {
      await delay(delayMs);
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: () => {
            Object.defineProperty(document, "hidden", { get: () => false, configurable: true });
            Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
            Document.prototype.hasFocus = () => true;
            document.addEventListener("visibilitychange", (e) => e.stopImmediatePropagation(), true);
          }
        });
        break;
      } catch {
      }
    }
  }
  function hasCloudflareChallenge(html) {
    return html.includes("Just a moment...") || html.includes("cf-challenge") || html.includes("cf_challenge") || html.includes("Turnstile") || html.includes("Checking your browser") || html.includes("Attention Required!");
  }
  async function trySilentFetch(url, waitSelector) {
    try {
      console.log(`[Silent Fetch] Attempting silent background fetch for ${url}`);
      const controller = new AbortController();
      const fetchTimeout = setTimeout(() => controller.abort(), 1e4);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });
      clearTimeout(fetchTimeout);
      if (!response.ok) {
        console.log(`[Silent Fetch] Failed with status ${response.status}, falling back to tab...`);
        return null;
      }
      const buffer = await response.arrayBuffer();
      let charset = "utf-8";
      const headersContentType = response.headers.get("content-type") || "";
      const charsetMatch = headersContentType.match(/charset=([\w\-]+)/i);
      if (charsetMatch) {
        charset = charsetMatch[1].toLowerCase();
      } else {
        const firstBytes = new Uint8Array(buffer.slice(0, 2048));
        let firstBytesStr = "";
        for (let i = 0; i < firstBytes.length; i++) {
          firstBytesStr += String.fromCharCode(firstBytes[i]);
        }
        const htmlCharsetMatch = firstBytesStr.match(/<meta[^>]*charset=["']?([\w\-]+)["']?/i) || firstBytesStr.match(/<meta[^>]*http-equiv=["']?Content-Type["']?[^>]*content=["']?[^"'>]*charset=([\w\-]+)/i);
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
        const decoder = new TextDecoder("utf-8");
        text = decoder.decode(buffer);
      }
      const hasCf = hasCloudflareChallenge(text);
      let isValid = !hasCf && text.length > 200;
      if (waitSelector && isValid) {
        try {
          const checkSelectorInText = (txt, selector) => {
            const parts = selector.split(",").map((s) => s.trim());
            for (const part of parts) {
              const matches = part.match(/[.#][\w\-]+/g);
              if (matches && matches.length > 0) {
                let allFound = true;
                for (const m of matches) {
                  const name = m.substring(1);
                  if (!txt.includes(name)) {
                    allFound = false;
                    break;
                  }
                }
                if (allFound) return true;
              } else {
                const clean = part.replace(/[^\w\-]/g, "");
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
  async function handleFetch(url, waitSelector, clickSelector, timeout, forceActive = false, reuseTab = false) {
    const siteConfig = getSiteConfig(url);
    await rotateProxyIfNeeded();
    const shouldSkipSilent = siteConfig.skipSilentFetch || clickSelector || waitSelector;
    if (!shouldSkipSilent) {
      const silentResult = await trySilentFetch(url, waitSelector);
      if (silentResult) return silentResult;
    }
    let originalTabId = null;
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab) originalTabId = activeTab.id;
    } catch {
    }
    let tabId = null;
    let isReused = false;
    let didNavigate = false;
    let createdWindowId = null;
    if (reuseTab) {
      try {
        const u = new URL(url);
        console.log(`[Fetch] reuseTab active. u.hostname: ${u.hostname}`);
        const allTabs = await chrome.tabs.query({});
        const tabs = allTabs.filter((t) => {
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
          let bestTab = tabs.find((t) => t.url && t.url.includes(u.pathname));
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
            await injectVisibilityOverride(tabId, 5, 200);
          } else {
            console.log(`[Fetch] Paths are identical. No navigation needed.`);
            await delay(500);
          }
        }
      } catch (e) {
        console.error("[Fetch] reuseTab error:", e);
      }
    }
    if (!isReused) {
      try {
        const isSTV = siteConfig.isSTV || false;
        const shouldActive = forceActive || siteConfig.forceActiveTab || false;
        if (reuseTab && !isSTV) {
          const tab = await chrome.tabs.create({ url, active: shouldActive });
          tabId = tab.id;
          persistentTabIds.add(tabId);
          didNavigate = true;
          console.log(`[Fetch] Created persistent tab ${tabId} for reuseTab adapter (active: ${shouldActive}).`);
        } else {
          const win = await chrome.windows.create({ url, state: "minimized" });
          const tab = win.tabs && win.tabs.length > 0 ? win.tabs[0] : (await chrome.tabs.query({ windowId: win.id }))[0];
          tabId = tab.id;
          createdWindowId = win.id;
          didNavigate = true;
          console.log(`[Fetch] Created minimized window tab ${tabId} (isSTV: ${isSTV}).`);
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
    if (originalTabId && createdWindowId) {
      try {
        await chrome.tabs.update(originalTabId, { active: true });
      } catch {
      }
    }
    try {
      if (didNavigate) {
        injectVisibilityOverride(tabId, 5, 500);
        await waitForTabLoad(tabId, url, 3e4);
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
              target: { tabId },
              args: [clickSelector],
              func: (s) => {
                const el = document.querySelector(s);
                if (el) el.click();
              }
            });
          } catch {
          }
          if (!await waitForSelector(tabId, waitSelector, Math.floor(timeout / 3), 1)) {
            timedOut = false;
            break;
          }
          timedOut = true;
          await delay(humanDelay(500));
        }
      } else if (waitSelector) {
        await waitForSelector(tabId, waitSelector, timeout, 1);
        timedOut = false;
      } else {
        await waitForStableContent(tabId, timeout);
      }
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        args: [waitSelector || null],
        func: (s) => {
          const html = "<!DOCTYPE html><html>" + document.head.outerHTML + "<body>" + document.body.innerHTML + "</body></html>";
          let contentText = null;
          if (s) {
            const el = document.querySelector(s);
            if (el) contentText = el.innerText;
          }
          return { html, contentText };
        }
      });
      const data = results?.[0]?.result;
      if (!data) {
        console.warn("Failed to extract data, returning empty");
        return { html: "", contentText: "", timedOut: true };
      }
      if (data.contentText && data.contentText.length > 100) decreaseThrottle();
      return { html: data.html, contentText: data.contentText, timedOut };
    } catch (err) {
      increaseThrottle();
      throw err;
    } finally {
      if (reuseTab) {
        if (createdWindowId) {
          try {
            await chrome.windows.update(createdWindowId, { state: "minimized" });
          } catch {
          }
        }
      } else {
        try {
          await chrome.tabs.remove(tabId);
        } catch {
        }
        if (originalTabId) {
          try {
            await chrome.tabs.update(originalTabId, { active: true });
          } catch {
          }
        }
      }
    }
  }

  // extension-pc/background.src.js
  console.log("%c\u{1F680} Novel Studio Connector v2.0 \u2014 Modular Stealth Mode", "color:lime;font-size:16px");
  initProxy();
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg.type === "STV_CONTENT_READY" && sender.tab) {
      contentCache.set(sender.tab.id, {
        content: msg.content,
        title: msg.title,
        url: msg.url,
        length: msg.length,
        timestamp: Date.now()
      });
    }
  });
  chrome.runtime.onMessageExternal.addListener((request, _sender, sendResponse) => {
    if (request.type === "PING" || request.action === "ping") {
      sendResponse({ ok: true, version: chrome.runtime.getManifest().version, success: true, status: "online" });
      return false;
    }
    if (request.action === "downloadChapter") {
      setStvScrapeActive(true);
      stvFetchChapter(request.payload, sendResponse);
      return true;
    }
    if (request.action === "stopScrape") {
      setStvScrapeActive(false);
      clearProxy();
      (async () => {
        for (const tid of [...persistentTabIds]) {
          try {
            await chrome.tabs.remove(tid);
          } catch {
          }
        }
        persistentTabIds.clear();
      })();
      sendResponse({ success: true });
      return false;
    }
    if (request.action === "closePersistentTab") {
      (async () => {
        for (const tid of [...persistentTabIds]) {
          try {
            await chrome.tabs.remove(tid);
          } catch {
          }
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
      handleFetch(request.url, request.waitSelector, request.clickSelector, request.timeout || 15e3, request.activeTab, request.reuseTab).then((r) => sendResponse({ ok: true, ...r })).catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }
    return false;
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    contentCache.delete(tabId);
  });
})();
