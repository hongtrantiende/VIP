/**
 * CloakBrowser client — calls the server-side API route to fetch HTML
 * using the stealth Chromium browser (bypasses Cloudflare, DataDome, etc.).
 *
 * This is a client-side wrapper that sends requests to /api/cloak-scrape,
 * which runs CloakBrowser on the server (Node.js only).
 */

export interface CloakFetchResult {
    html: string;
    url: string;
    status: number;
}

/**
 * Fetch a URL using CloakBrowser (stealth Chromium) via the server API route.
 * Falls through to this when extensionFetch / server-scraper are blocked by anti-bot.
 */
export async function cloakFetch(
    url: string,
    options?: {
        /** Wait for this CSS selector to appear before extracting HTML */
        waitForSelector?: string;
        /** Timeout in ms (default 30000) */
        timeout?: number;
        signal?: AbortSignal;
    }
): Promise<CloakFetchResult> {
    const res = await fetch("/api/cloak-scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            url,
            waitForSelector: options?.waitForSelector,
            timeout: options?.timeout ?? 30000,
        }),
        signal: options?.signal,
    });

    if (!res.ok) {
        const errorBody = await res.text().catch(() => "");
        throw new Error(`CloakBrowser fetch failed (${res.status}): ${errorBody}`);
    }

    return res.json();
}

/**
 * Check if CloakBrowser is available on the server.
 * Returns true if the API route responds and the binary is installed.
 */
export async function isCloakAvailable(): Promise<boolean> {
    try {
        const res = await fetch("/api/cloak-scrape", {
            method: "GET",
        });
        if (!res.ok) return false;
        const data = await res.json();
        return data?.available === true;
    } catch {
        return false;
    }
}
