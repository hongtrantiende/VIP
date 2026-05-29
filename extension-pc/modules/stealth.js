/**
 * Stealth module — fingerprint profiles & anti-detection injection.
 * Provides randomized browser fingerprints and full stealth injection
 * to avoid bot detection on target websites.
 */

// ══════════════════════════════════════════════════════════════
// Platform-Consistent Fingerprint Profiles (15 profiles)
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

/**
 * Pick a random fingerprint profile from the list.
 * @returns {object} A profile object with ua, platform, langs, screen, cores, mem.
 */
export function randomProfile() {
  return PROFILES[Math.floor(Math.random() * PROFILES.length)];
}

/**
 * Inject comprehensive anti-detection overrides into a tab.
 * Covers: webdriver, visibility, UA, plugins, languages, hardware,
 * screen, permissions, canvas, WebGL, AudioContext, chrome.csi/loadTimes,
 * NetworkInformation, and Selenium detection.
 *
 * @param {number} tabId - Chrome tab ID to inject into.
 */
export async function injectFullStealth(tabId) {
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
