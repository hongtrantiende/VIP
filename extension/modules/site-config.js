/**
 * Site Configuration Registry — per-website behavior overrides.
 *
 * Instead of scattering `if (url.includes("xtruyen"))` throughout handleFetch(),
 * each website's special behavior is declared here as a config entry.
 * When adding a new website or modifying an existing one, ONLY this file
 * needs to change — no risk of breaking other websites.
 *
 * Config fields:
 * - skipSilentFetch: boolean — If true, skip the background fetch() attempt
 *     and always open a real browser tab. Needed for JS-rendered sites.
 * - forceActiveTab: boolean — If true, create/navigate tabs as active (visible).
 *     Needed for sites that detect hidden/background tabs.
 * - reuseTabHostnames: string[] — Hostname substrings to match when looking for
 *     an existing tab to reuse. If empty, uses exact hostname matching.
 * - isSTV: boolean — Uses the dedicated STV handler (findSTVTab, stvFetchChapter).
 */

// ══════════════════════════════════════════════════════════════
// Site Configuration Entries
// ══════════════════════════════════════════════════════════════

/**
 * @typedef {Object} SiteConfig
 * @property {boolean} [skipSilentFetch] - Skip background fetch, always use tab.
 * @property {boolean} [forceActiveTab] - Open tab as active/visible.
 * @property {string[]} [reuseTabHostnames] - Hostname patterns for tab reuse matching.
 * @property {boolean} [isSTV] - Use dedicated STV chapter handler.
 */

/** @type {Record<string, SiteConfig>} */
const SITE_CONFIGS = {
  // ── Vietnamese Sites ──────────────────────────────────────
  "xtruyen.vn": {
    skipSilentFetch: true,    // XTruyen cần JS render, không dùng silent fetch
    forceActiveTab: false,     // Tab chạy ngầm ẩn đi, đã có injectVisibilityOverride lo phần visibility
  },
  "sangtacviet": {
    skipSilentFetch: true,
    isSTV: true,               // Dùng STV handler riêng (findSTVTab, stvFetchChapter)
    reuseTabHostnames: ["sangtacviet"],
  },

  // ── Chinese Sites ─────────────────────────────────────────
  "69shuba": {
    reuseTabHostnames: ["69shuba"],  // Match tất cả domain 69shuba.*
  },
  "hetushu.com": {
    // Sử dụng sequential tab reuse, không cần config đặc biệt
  },
  "fanqienovel": {
    skipSilentFetch: true,
    isSTV: true,               // Fanqie cũng dùng STV-style tab handler
    reuseTabHostnames: ["fanqienovel", "fanqie"],
  },
};

// ══════════════════════════════════════════════════════════════
// Lookup Functions
// ══════════════════════════════════════════════════════════════

/**
 * Get the site configuration for a given URL.
 * Matches against hostname substrings defined in SITE_CONFIGS.
 *
 * @param {string} url - The URL to look up config for.
 * @returns {SiteConfig} The matching config, or an empty object for unknown sites.
 */
export function getSiteConfig(url) {
  try {
    const hostname = new URL(url).hostname;
    for (const [pattern, config] of Object.entries(SITE_CONFIGS)) {
      if (hostname.includes(pattern)) return config;
    }
  } catch (e) {
    console.warn("[SiteConfig] Error parsing URL:", e.message);
  }
  return {}; // Default: no special behavior
}

/**
 * Check if a tab's hostname matches the target URL's hostname,
 * considering site-specific aliases (e.g., "69shuba" matches "69shuba.com", "69shuba.cc").
 *
 * @param {string} tabHostname - Hostname of the existing tab.
 * @param {string} targetHostname - Hostname of the URL we want to load.
 * @param {SiteConfig} siteConfig - Site config for the target URL.
 * @returns {boolean} Whether the tab is a match for reuse.
 */
export function isHostnameMatch(tabHostname, targetHostname, siteConfig) {
  // Check site-specific aliases first
  if (siteConfig.reuseTabHostnames && siteConfig.reuseTabHostnames.length > 0) {
    for (const alias of siteConfig.reuseTabHostnames) {
      if (targetHostname.includes(alias) && tabHostname.includes(alias)) {
        return true;
      }
    }
  }
  // Fall back to exact hostname comparison
  return tabHostname === targetHostname;
}
