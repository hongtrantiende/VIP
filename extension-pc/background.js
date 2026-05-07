console.log("%c🚀 Novel Studio Connector v5.0", "color:lime;font-size:16px");
const contentCache = new Map();
let stvScrapeActive = true;

// ── Stealth: Random User-Agent pool ──
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/** Random delay with jitter to appear human */
function humanDelay(baseMs) {
  const jitter = Math.random() * baseMs * 0.5; // ±50% jitter
  return baseMs + jitter;
}

// ── Message handling ──

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "STV_CONTENT_READY" && sender.tab) {
    contentCache.set(sender.tab.id, {
      content: msg.content,
      title: msg.title,
      url: msg.url,
      length: msg.length,
      timestamp: Date.now(),
    });
  }
});

chrome.runtime.onMessageExternal.addListener(
  (request, _sender, sendResponse) => {
    if (request.type === "PING" || request.action === "ping") {
      sendResponse({
        ok: true,
        version: chrome.runtime.getManifest().version,
        success: true,
        status: "online",
      });
      return false;
    }
    if (request.action === "downloadChapter") {
      stvScrapeActive = true;
      stvFetchChapter(request.payload, sendResponse);
      return true;
    }
    if (request.action === "stopScrape") {
      stvScrapeActive = false;
      sendResponse({ success: true });
      return false;
    }
    if (request.action === "downloadAllSequential") {
      downloadAllSequential(request.payload, sendResponse);
      return true;
    }
    if (request.type === "FETCH") {
      handleFetch(
        request.url,
        request.waitSelector,
        request.clickSelector,
        request.timeout || 15000,
      )
        .then((r) => sendResponse({ ok: true, ...r }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }
    return false;
  },
);

// ── STV Chapter Fetching ──

async function findSTVTab() {
  const tabs = await chrome.tabs.query({
    url: ["*://sangtacviet.com/*", "*://sangtacviet.app/*", "*://sangtacviet.vip/*"],
  });
  return tabs.length > 0 ? tabs[0].id : null;
}

async function stvFetchChapter(payload, sendResponse) {
  try {
    const tabId = await findSTVTab();
    if (!tabId) {
      sendResponse({ success: false, error: "Mở 1 tab SangTacViet trước!" });
      return;
    }

    let content = "",
      title = "";
    for (let i = 0; i < 40; i++) {
      if (!stvScrapeActive) break;
      const cached = contentCache.get(tabId);
      if (cached && cached.length > 200) {
        content = cached.content;
        title = cached.title;
        contentCache.delete(tabId);
        break;
      }
      if (i === 6) {
        try {
          const resp = await chrome.tabs.sendMessage(tabId, {
            type: "EXTRACT_NOW",
          });
          if (resp && resp.length > 200) {
            content = resp.content;
            title = resp.title;
            break;
          }
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
        for (let i = 0; i < 30; i++) {
          if (!stvScrapeActive) break;
          if (contentCache.has(tabId)) break;
          await delay(500);
        }
      } catch (e) {
        console.log("[STV] GO_NEXT Error:", e.message);
      }
    }

    sendResponse({
      success: true,
      content,
      contentText: content,
      data: "",
      length: content.length,
      title,
      timedOut: content.length < 200,
      stopped: !stvScrapeActive
    });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function downloadAllSequential(
  { chapters, delay: d = 1000 },
  sendResponse,
) {
  const results = [];
  stvScrapeActive = true;
  for (let i = 0; i < chapters.length; i++) {
    if (!stvScrapeActive) break;
    const ch = chapters[i];
    const res = await new Promise((r) =>
      stvFetchChapter({ chapterUrl: ch.url, allowNext: i < chapters.length - 1 }, r),
    );
    results.push({ chapter: ch, ...res });
  }
  sendResponse({ success: true, results, stopped: !stvScrapeActive });
}

// ── Core Fetch with Full Stealth ──

async function handleFetch(url, waitSelector, clickSelector, timeout) {
  const tab = await chrome.tabs.create({ url, active: false });
  const tabId = tab.id;
  try {
    await waitForTabLoad(tabId, 30000);
    await injectFullStealth(tabId);
    // Human-like random delay before interacting
    await delay(humanDelay(1500));

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
            },
          });
        } catch {}
        if (
          !(await waitForSelector(
            tabId,
            waitSelector,
            Math.floor(timeout / 3),
            200,
          ))
        ) {
          timedOut = false;
          break;
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
      target: { tabId },
      args: [waitSelector || null],
      func: (s) => {
        const html =
          "<!DOCTYPE html><html>" +
          document.head.outerHTML +
          "<body>" +
          document.body.innerHTML +
          "</body></html>";
        let contentText = null;
        if (s) {
          const el = document.querySelector(s);
          if (el) contentText = el.innerText;
        }
        return { html, contentText };
      },
    });
    const data = results?.[0]?.result;
    if (!data) throw new Error("Failed to extract");
    return { html: data.html, contentText: data.contentText, timedOut };
  } finally {
    try {
      await chrome.tabs.remove(tabId);
    } catch {}
  }
}

// ── Full Stealth Injection ──

async function injectFullStealth(tabId) {
  try {
    const ua = randomUA();
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [ua],
      func: (fakeUA) => {
        // 1. Hide webdriver flag
        Object.defineProperty(navigator, "webdriver", {
          get: () => undefined,
          configurable: true,
        });

        // 2. Fake visibility (pretend tab is active)
        Object.defineProperty(document, "hidden", {
          get: () => false,
          configurable: true,
        });
        Object.defineProperty(document, "visibilityState", {
          get: () => "visible",
          configurable: true,
        });
        Document.prototype.hasFocus = () => true;
        document.addEventListener(
          "visibilitychange",
          (e) => e.stopImmediatePropagation(),
          true,
        );

        // 3. Fake User-Agent
        Object.defineProperty(navigator, "userAgent", {
          get: () => fakeUA,
          configurable: true,
        });

        // 4. Fake plugins (headless Chrome has 0 plugins)
        Object.defineProperty(navigator, "plugins", {
          get: () => {
            return [
              { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer" },
              { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai" },
              { name: "Native Client", filename: "internal-nacl-plugin" },
            ];
          },
          configurable: true,
        });

        // 5. Fake languages
        Object.defineProperty(navigator, "languages", {
          get: () => ["vi-VN", "vi", "en-US", "en"],
          configurable: true,
        });

        // 6. Hide automation flags
        if (window.chrome) {
          const originalChrome = window.chrome;
          window.chrome = {
            ...originalChrome,
            runtime: {
              ...originalChrome.runtime,
              // Keep sendMessage working but hide other indicators
            },
          };
        }

        // 7. Fake hardware concurrency (realistic value)
        Object.defineProperty(navigator, "hardwareConcurrency", {
          get: () => 8,
          configurable: true,
        });

        // 8. Fake device memory
        Object.defineProperty(navigator, "deviceMemory", {
          get: () => 8,
          configurable: true,
        });

        // 9. Override permissions query to appear normal
        const originalQuery = window.Permissions?.prototype?.query;
        if (originalQuery) {
          window.Permissions.prototype.query = function (parameters) {
            if (parameters.name === "notifications") {
              return Promise.resolve({ state: "prompt", onchange: null });
            }
            return originalQuery.call(this, parameters);
          };
        }

        // 10. Fake canvas fingerprint (slight noise)
        const origGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
          const ctx = origGetContext.call(this, type, ...args);
          if (type === "2d" && ctx) {
            const origFillText = ctx.fillText.bind(ctx);
            ctx.fillText = function (...fillArgs) {
              // Add invisible noise to canvas fingerprint
              ctx.shadowBlur = Math.random() * 0.01;
              ctx.shadowColor = "rgba(0,0,0,0.001)";
              return origFillText(...fillArgs);
            };
          }
          return ctx;
        };

        // 11. Fake WebGL renderer info
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (param) {
          if (param === 37445) return "Intel Inc."; // UNMASKED_VENDOR
          if (param === 37446) return "Intel Iris OpenGL Engine"; // UNMASKED_RENDERER
          return getParameter.call(this, param);
        };
      },
    });
  } catch {}
}

// ── Utility functions ──

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
      } else stable = 0;
      last = len;
    } catch {}
    await delay(500);
  }
}

function waitForTabLoad(tabId, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(fn);
      resolve();
    }, ms);
    function fn(id, info) {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(fn);
        clearTimeout(t);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(fn);
  });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

chrome.tabs.onRemoved.addListener((tabId) => {
  contentCache.delete(tabId);
});