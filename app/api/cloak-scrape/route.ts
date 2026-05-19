/**
 * API Route: /api/cloak-scrape
 *
 * Server-side endpoint that uses CloakBrowser (stealth Chromium) to fetch
 * web pages that are protected by anti-bot systems (Cloudflare, DataDome, etc.).
 *
 * GET  → Check if CloakBrowser binary is available
 * POST → Fetch a URL using stealth Chromium and return the HTML
 *
 * NOTE: This only works when running locally (npm run dev) or on a VPS.
 *       It will NOT work on Cloudflare Pages / Vercel serverless.
 */

import { NextRequest, NextResponse } from "next/server";

// Lazy-load cloakbrowser to avoid crashing on serverless platforms
let cloakModule: any = null;

async function getCloakModule() {
    if (cloakModule) return cloakModule;
    try {
        cloakModule = await import("cloakbrowser");
        return cloakModule;
    } catch (err) {
        console.warn("[CloakBrowser] Module not available:", (err as Error).message);
        return null;
    }
}

// ─── GET: Health check ────────────────────────────────────────

export async function GET() {
    const mod = await getCloakModule();
    if (!mod) {
        return NextResponse.json({ available: false, reason: "Module not installed" });
    }

    try {
        const info = mod.binaryInfo?.();
        return NextResponse.json({
            available: true,
            binaryInfo: info ?? "unknown",
        });
    } catch {
        return NextResponse.json({ available: false, reason: "Binary not downloaded yet" });
    }
}

// ─── POST: Fetch a URL with stealth Chromium ──────────────────

export async function POST(request: NextRequest) {
    const mod = await getCloakModule();
    if (!mod) {
        return NextResponse.json(
            { error: "CloakBrowser is not available on this server" },
            { status: 503 }
        );
    }

    let body: { url: string; waitForSelector?: string; timeout?: number };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { url, waitForSelector, timeout = 30000 } = body;

    if (!url || typeof url !== "string") {
        return NextResponse.json({ error: "Missing 'url' in request body" }, { status: 400 });
    }

    let browser: any = null;

    try {
        // Launch stealth Chromium (headless)
        browser = await mod.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });

        const page = await browser.newPage();

        // Set a generous timeout
        page.setDefaultTimeout(timeout);

        // Navigate to the target URL
        const response = await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout,
        });

        // Wait for optional selector (e.g., chapter content container)
        if (waitForSelector) {
            try {
                await page.waitForSelector(waitForSelector, { timeout: 10000 });
            } catch {
                // Selector not found within timeout — continue with what we have
                console.warn(`[CloakBrowser] Selector "${waitForSelector}" not found, continuing...`);
            }
        }

        // Small delay to let JS-rendered content settle
        await page.waitForTimeout(1500);

        // Extract the full HTML
        const html = await page.content();
        const status = response?.status() ?? 200;

        await browser.close();
        browser = null;

        return NextResponse.json({
            html,
            url: page.url(),
            status,
        });
    } catch (err: any) {
        console.error("[CloakBrowser] Scrape error:", err.message);

        return NextResponse.json(
            { error: `CloakBrowser error: ${err.message}` },
            { status: 500 }
        );
    } finally {
        // Always close the browser to prevent leaks
        if (browser) {
            try {
                await browser.close();
            } catch { }
        }
    }
}
