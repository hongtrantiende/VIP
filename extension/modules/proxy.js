/**
 * Proxy manager module — handles proxy rotation, authentication,
 * and Chrome proxy API integration.
 */

// ══════════════════════════════════════════════════════════════
// State
// ══════════════════════════════════════════════════════════════
let proxyList = [];
let proxyIndex = 0;
let proxyEnabled = false;
let proxyRotateMode = "per-chapter"; // "per-chapter" | "per-5" | "disabled"
let chaptersSinceRotate = 0;

// ══════════════════════════════════════════════════════════════
// Settings
// ══════════════════════════════════════════════════════════════

/**
 * Load proxy settings from chrome.storage.local.
 */
export async function loadProxySettings() {
  try {
    const data = await chrome.storage.local.get(["proxyList", "proxyEnabled", "proxyRotateMode"]);
    proxyList = (data.proxyList || []).filter(p => p.trim());
    proxyEnabled = data.proxyEnabled || false;
    proxyRotateMode = data.proxyRotateMode || "per-chapter";
    proxyIndex = 0;
  } catch {}
}

/**
 * Parse a proxy string into a structured object.
 * Supports formats:
 *   - socks5://host:port[:user:pass]
 *   - socks4://host:port[:user:pass]
 *   - host:port[:user:pass]
 *
 * @param {string} proxyStr - Raw proxy string.
 * @returns {{ type: string, host: string, port: number, user?: string, pass?: string }}
 */
export function parseProxy(proxyStr) {
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

/**
 * Get the next proxy in rotation order.
 * @returns {object|null} Parsed proxy object, or null if proxy disabled/empty.
 */
export function getNextProxy() {
  if (!proxyEnabled || proxyList.length === 0) return null;
  const proxy = parseProxy(proxyList[proxyIndex % proxyList.length]);
  proxyIndex++;
  return proxy;
}

// ══════════════════════════════════════════════════════════════
// Chrome Proxy API
// ══════════════════════════════════════════════════════════════

/**
 * Set Chrome's proxy configuration via PAC script.
 * @param {object|null} proxy - Parsed proxy object. Pass null to clear proxy.
 */
export async function setProxy(proxy) {
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

/**
 * Clear Chrome proxy settings (reset to direct connection).
 */
export async function clearProxy() {
  try { await chrome.proxy.settings.clear({ scope: "regular" }); } catch {}
}

/**
 * Rotate to next proxy before a chapter fetch, according to rotation mode.
 */
export async function rotateProxyIfNeeded() {
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

// ══════════════════════════════════════════════════════════════
// Initialization — proxy auth & storage listeners
// ══════════════════════════════════════════════════════════════

/**
 * Initialize the proxy system: register auth handler, load settings,
 * and listen for storage changes.
 */
export function initProxy() {
  // Handle proxy authentication
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

  // Load settings on startup
  loadProxySettings();

  // Re-load when settings change
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.proxyList || changes.proxyEnabled || changes.proxyRotateMode) {
      loadProxySettings();
    }
  });
}
