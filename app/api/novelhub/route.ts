import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";

export const maxDuration = 60; // Max allowed duration on Vercel

const TRUYENFULL_URL = "https://truyenfull.today";
const WIKIDICH_URL = "https://wikicv.net";
const METRUYENCHU_URL = "https://metruyenchu.co";

const MTC_ACTION_BOOK_DETAIL = "402111577e440b52e3eabcb8919dc7a3c8bdeb0a50";
const MTC_ACTION_CHAPTERS = "40641d0c24de3cff37d81503659e25f3b402280e1a";

async function fetchMtcServerAction(actionId: string, bodyData: any, refererUrl: string): Promise<any> {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "next-action": actionId,
    "content-type": "application/json",
    "accept": "text/x-component",
    "Referer": refererUrl
  };
  
  const res = await fetch(refererUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(bodyData)
  });
  
  if (res.status !== 200) {
    throw new Error(`Server Action ${actionId} returned status ${res.status}`);
  }
  
  const text = await res.text();
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("1:{")) {
      const jsonStr = line.substring(2);
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.statusCode === 200) {
          return parsed.data;
        }
      } catch (e) {
        console.error("Error parsing RSC line:", e);
      }
    }
  }
  
  for (const line of lines) {
    const startIdx = line.indexOf('{"statusCode":200');
    if (startIdx !== -1) {
      try {
        const parsed = JSON.parse(line.substring(startIdx));
        return parsed.data;
      } catch (e) {}
    }
  }
  
  throw new Error("Could not parse Server Action response data");
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0"
];

const getHeaders = (referer?: string) => {
  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const headers: Record<string, string> = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    "Sec-Ch-Ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": referer ? "same-origin" : "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };
  if (referer) {
    headers["Referer"] = referer;
  }
  return headers;
};

const getSlug = (url: string) => {
  if (!url) return "";
  const cleanUrl = url.split("?")[0].split("#")[0];
  const parts = cleanUrl.split("/").filter((p) => p);
  return parts[parts.length - 1] || "";
};

const getWikiSlug = (url: string) => {
  if (!url) return "";
  const cleanUrl = url.split("?")[0].split("#")[0];
  const parts = cleanUrl.split("/").filter((p) => p);
  return parts[parts.length - 1] || "";
};

function wikiSign(W: string): string {
  function V(d: number, c: number) {
    return (d >>> c) | (d << (32 - c));
  }
  const S = Math.pow;
  const R = S(2, 32);
  const Q = "length";
  let P = "";
  const O: number[] = [];
  const N = 8 * W[Q];
  const M: number[] = [];
  const L: number[] = [];
  let K = 0;
  const J: Record<number, number> = {};

  for (let I = 2; 64 > K; I++) {
    if (!J[I]) {
      for (let U = 0; 313 > U; U += I) {
        J[U] = I;
      }
      M[K] = (S(I, 0.5) * R) | 0;
      L[K++] = (S(I, 1 / 3) * R) | 0;
    }
  }

  W += "\x80";
  while (W[Q] % 64 - 56) {
    W += "\x00";
  }
  for (let U = 0; U < W[Q]; U++) {
    const T = W.charCodeAt(U);
    if (T >> 8) {
      return "";
    }
    O[U >> 2] |= T << (3 - U) % 4 * 8;
  }

  O[O[Q]] = (N / R) | 0;
  O[O[Q]] = N;

  for (let T = 0; T < O[Q]; ) {
    const H = O.slice(T, (T += 16));
    const G = [...M];
    for (let U = 0; U < 64; U++) {
      const F = H[U - 15];
      const E = H[U - 2];
      const D = M[0];
      const C = M[4];
      const B =
        M[7] +
        ((V(C, 6) ^ V(C, 11) ^ V(C, 25)) +
        ((C & M[5]) ^ (~C & M[6])) +
        L[U] +
        (H[U] =
          16 > U
            ? H[U]
            : (H[U - 16] +
                (V(F, 7) ^ V(F, 18) ^ (F >>> 3)) +
                H[U - 7] +
                (V(E, 17) ^ V(E, 19) ^ (E >>> 10))) |
              0));
      const A =
        (V(D, 2) ^ V(D, 13) ^ V(D, 22)) +
        ((D & M[1]) ^ (D & M[2]) ^ (M[1] & M[2]));
      M.unshift((B + A) | 0);
      M[4] = (M[4] + B) | 0;
    }
    for (let U = 0; U < 8; U++) {
      M[U] = (M[U] + G[U]) | 0;
    }
  }
  for (let U = 0; U < 8; U++) {
    for (let T = 3; T + 1; T--) {
      const z = (M[U] >> (8 * T)) & 255;
      P += (16 > z ? "0" : "") + z.toString(16);
    }
  }
  return P;
}

function fuzzySign(text: string, offset: number) {
  return text.substring(offset) + text.substring(0, offset);
}

/**
 * Cleans Vietnamese diacritics, maps modifier/spacing accents to their combining
 * equivalents, removes zero-width spaces/invisible characters, collapses spaces
 * before combining marks, removes duplicate consecutive combining marks using NFD,
 * and normalizes back to NFC.
 */
function cleanVietnameseDiacritics(text: string): string {
  if (!text) return text;
  
  let temp = text;
  
  // 1. Map modifier/spacing accents to combining accents
  temp = temp.replace(/\u02ca/g, "\u0301") // modifier acute -> combining acute
             .replace(/\u02cb/g, "\u0300") // modifier grave -> combining grave
             .replace(/\u00b4/g, "\u0301") // spacing acute -> combining acute
             .replace(/\u0060/g, "\u0300"); // backtick -> combining grave
  
  // 2. Strip zero-width spaces and other invisible formatting characters
  temp = temp.replace(/[\u200b-\u200d\ufeff]/g, "");
  
  // 3. Remove spaces that are immediately followed by a combining diacritical mark,
  // to allow the combining mark to merge with the preceding vowel.
  temp = temp.replace(/\s+([\u0300-\u036f])/g, "$1");
  
  // 4. Decompose to NFD to separate base characters and combining marks
  temp = temp.normalize("NFD");
  
  // 5. Remove duplicate consecutive combining marks of the exact same kind
  temp = temp.replace(/([\u0300-\u036f])\1+/g, "$1");
  
  // 6. Normalize back to NFC to compose vowels and combining accents
  temp = temp.normalize("NFC");
  
  // 7. Remove any leftover/redundant combining marks that couldn't be composed
  temp = temp.replace(/[\u0300-\u036f]/g, "");
  
  return temp;
}

/**
 * Extracts paragraphs from a container, strips ad/junk elements,
 * cleans Vietnamese diacritics, and wraps paragraphs in standard tags.
 */
function processChapterContent($: cheerio.CheerioAPI, containerSelector: string): string {
  const container = $(containerSelector);
  if (!container.length) return "<p>Không thể tải nội dung.</p>";

  // Remove common junk/ad elements
  const junkSelectors = [
    "script", "noscript", "style", "iframe",
    ".adsbygoogle", "[data-ad]", ".tpm-unit", ".tpads",
    ".gliaplayer-container", ".InstreamDom_root",
    "ins", "[data-slot]", "#tpmInpageContainer",
    "[id^='tpads']", "[id^='div-ad']",
    "[data-adbro-processed]", ".lemont-banner-host",
    "[data-innity-zone-loaded]",
  ];
  junkSelectors.forEach(sel => {
    container.find(sel).remove();
  });

  // Extract paragraphs
  const paragraphs: string[] = [];
  const pElements = container.find("p");
  
  if (pElements.length > 5) {
    pElements.each((_, el) => {
      const txt = $(el).text().trim();
      if (txt) paragraphs.push(txt);
    });
  } else {
    // Fallback: split HTML by <br> tags or newlines
    let htmlText = container.html() || "";
    // Replace <br> with newlines
    htmlText = htmlText.replace(/<br\s*\/?>/gi, "\n");
    // Load text to strip HTML tags
    const plainText = cheerio.load(htmlText).text();
    plainText.split("\n").forEach(line => {
      const txt = line.trim();
      if (txt) paragraphs.push(txt);
    });
  }

  // Clean diacritics for each paragraph and wrap in standard tags
  const cleanParagraphs = paragraphs.map(p => {
    const cleaned = cleanVietnameseDiacritics(p);
    return `<p class="mb-4 text-justify">${cleaned}</p>`;
  });

  return cleanParagraphs.join("\n");
}

let cloakModule: any = null;

async function getCloakModule() {
  if (cloakModule) return cloakModule;
  try {
    const dynamicImport = new Function('modulePath', 'return import(modulePath)');
    cloakModule = await dynamicImport("cloakbrowser");
    return cloakModule;
  } catch (err) {
    return null;
  }
}

async function fetchHtmlWithStealth(url: string, waitForSelector?: string): Promise<string | null> {
  const mod = await getCloakModule();
  if (!mod) return null;

  let browser: any = null;
  try {
    browser = await mod.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    if (waitForSelector) {
      try {
        await page.waitForSelector(waitForSelector, { timeout: 10000 });
      } catch {
        console.warn(`[CloakBrowser fallback] Selector "${waitForSelector}" not found, continuing...`);
      }
    }

    await page.waitForTimeout(1500);
    const html = await page.content();
    await browser.close();
    browser = null;
    return html;
  } catch (err: any) {
    console.error("[CloakBrowser fallback] Scrape error:", err.message);
    return null;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
}

async function searchWikiDichViaDDG(q: string): Promise<any[]> {
  const ddgUrl = `https://html.duckduckgo.com/html/?q=site:wikicv.net+${encodeURIComponent(q)}`;
  try {
    const res = await fetch(ddgUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
      }
    });
    if (res.status !== 200) {
      console.warn(`[NovelHub API] DDG search returned status ${res.status}`);
      return [];
    }
    const html = await res.text();
    const $ = cheerio.load(html);
    const results: any[] = [];
    
    $(".result__body").each((_, el) => {
      const a = $(el).find(".result__url");
      const href = a.attr("href") || "";
      let finalUrl = href;
      if (href.includes("uddg=")) {
        const match = href.match(/uddg=([^&]+)/);
        if (match) {
          finalUrl = decodeURIComponent(match[1]);
        }
      }
      
      if (finalUrl.includes("/truyen/") && !finalUrl.includes("/chuong-")) {
        const title = $(el).find(".result__title").text().trim();
        const snippet = $(el).find(".result__snippet").text().trim();
        
        const cleanTitle = title
          .replace(/\s*-\s*wikicv\.net/gi, "")
          .replace(/\s*\|\s*WikiDịch/gi, "")
          .replace(/\s*\|\s*Wiki Dịch/gi, "")
          .replace(/\s*-\s*WikiDịch/gi, "")
          .trim();
          
        let author = "Đang cập nhật";
        const authorMatch = snippet.match(/(?:Tác giả|Tác giả:|tac gia|tac gia:)\s*([^\-\|\,\.\;\n]+)/i);
        if (authorMatch) {
          author = authorMatch[1].trim();
        }
        
        const slug = getWikiSlug(finalUrl);
        if (slug) {
          results.push({
            title: cleanTitle,
            slug,
            author,
            latestChapter: "Đang ra...",
          });
        }
      }
    });
    return results;
  } catch (err) {
    console.error("[NovelHub API] DDG search error:", err);
    return [];
  }
}

async function searchWikiDichViaGoogle(q: string): Promise<any[]> {
  const googleUrl = `https://www.google.com/search?q=site:wikicv.net+${encodeURIComponent(q)}`;
  console.log(`[NovelHub API] Searching WikiDich via Google for: ${q}`);
  try {
    const html = await fetchHtmlWithStealth(googleUrl);
    if (!html) {
      console.warn("[NovelHub API] Google search fetched no HTML");
      return [];
    }
    if (html.includes("detected unusual traffic")) {
      console.warn("[NovelHub API] Google CAPTCHA detected during search fallback");
      return [];
    }
    const $ = cheerio.load(html);
    const results: any[] = [];
    
    $('a[href*="wikicv.net/truyen/"]').each((_, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim();
      const h3 = $(el).find("h3").text().trim();
      const title = h3 || text || "Unknown Title";
      
      let finalUrl = href;
      if (href.includes("/url?")) {
        const match = href.match(/[?&]q=([^&]+)/);
        if (match) {
          finalUrl = decodeURIComponent(match[1]);
        }
      }
      
      const cleanTitle = title
        .replace(/\s*-\s*wikicv\.net/gi, "")
        .replace(/\s*\|\s*WikiDịch/gi, "")
        .replace(/\s*\|\s*Wiki Dịch/gi, "")
        .replace(/\s*-\s*WikiDịch/gi, "")
        .replace(/\s*Wiki Dịch Tiếng Hoa/gi, "")
        .replace(/\s*WikiDich/gi, "")
        .trim();
        
      const slug = getWikiSlug(finalUrl);
      if (slug && !results.some(r => r.slug === slug)) {
        results.push({
          title: cleanTitle,
          slug,
          author: "Đang cập nhật",
          latestChapter: "Đang ra...",
        });
      }
    });
    
    return results;
  } catch (err) {
    console.error("[NovelHub API] Google search error:", err);
    return [];
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    const source = searchParams.get("source") || "truyenfull";
    const wikiDichCookie = req.headers.get("x-wikidich-cookie");

    if (!action) {
      return NextResponse.json({ error: "Missing action parameter" }, { status: 400 });
    }

    switch (action) {
      case "home": {
        if (source === "truyenfull") {
          const resHome = await fetch(TRUYENFULL_URL, { headers: getHeaders() });
          const htmlHome = await resHome.text();
          const $ = cheerio.load(htmlHome);

          const hotStories: any[] = [];
          $(".index-intro .item").each((_, el) => {
            const url = $(el).find("a").attr("href") || "";
            const title = $(el).find("h3").text().trim();
            const coverImg = $(el).find("img").attr("src");
            if (title && url) {
              hotStories.push({ title, slug: getSlug(url), cover: coverImg });
            }
          });

          const newUpdates: any[] = [];
          const resNew = await fetch(`${TRUYENFULL_URL}/danh-sach/truyen-moi/`, {
            headers: getHeaders(TRUYENFULL_URL),
          });
          const htmlNew = await resNew.text();
          const $new = cheerio.load(htmlNew);

          $new(".list-truyen .row").each((_, el) => {
            const url = $new(el).find("h3.truyen-title a").attr("href");
            const title = $new(el).find("h3.truyen-title a").text().trim();
            const chapterUrl = $new(el).find(".text-info a").attr("href");
            const chapterTitle = $new(el).find(".text-info a").text().trim();
            if (title && url) {
              newUpdates.push({
                title,
                slug: getSlug(url),
                latestChapter: chapterTitle,
                latestChapterSlug: getSlug(chapterUrl || ""),
              });
            }
          });

          return NextResponse.json({ hotStories, newUpdates });
        } else if (source === "wikidich") {
          const headers = getHeaders();
          if (wikiDichCookie) {
            headers["Cookie"] = wikiDichCookie.includes("express.sid=")
              ? wikiDichCookie
              : `express.sid=${wikiDichCookie}`;
          }
          const resHome = await fetch(WIKIDICH_URL, { headers });
          const htmlHome = await resHome.text();
          const $ = cheerio.load(htmlHome);

          const hotStories: any[] = [];
          const newUpdates: any[] = [];

          $(".book-item").each((i, el) => {
            const url = $(el).find("a").first().attr("href") || "";
            const title = $(el).find(".book-title").text().trim();
            const coverImg = $(el).find("img").attr("src");
            const author = $(el).find(".author").text().trim();

            const itm = {
              title,
              slug: getWikiSlug(url),
              cover: coverImg ? `${WIKIDICH_URL}${coverImg}` : "",
              author,
            };
            if (title && url) {
              if (i < 8) {
                hotStories.push(itm);
              } else {
                newUpdates.push({
                  ...itm,
                  latestChapter: "Đang ra...",
                  latestChapterSlug: "chuong-moi-nhat",
                });
              }
            }
          });

          return NextResponse.json({ hotStories, newUpdates });
        } else if (source === "metruyenchu") {
          try {
            const resHome = await fetch(METRUYENCHU_URL, { headers: getHeaders() });
            const htmlHome = await resHome.text();
            const $ = cheerio.load(htmlHome);

            const hotStories: any[] = [];
            const newUpdates: any[] = [];

            $('a[href*="/truyen/"]').each((_, el) => {
              const href = $(el).attr('href');
              if (!href || href.includes('/chuong-')) return;
              const slug = href.split('/').filter(Boolean).pop();
              if (!slug) return;

              let title = '';
              let cover = '';

              const img = $(el).find('img');
              if (img.length > 0) {
                cover = img.attr('src') || img.attr('srcset') || '';
                if (cover && cover.includes('_next/image')) {
                  const match = cover.match(/url=([^&]+)/);
                  if (match) cover = decodeURIComponent(match[1]);
                }
              }

              title = $(el).find('h3').text().trim() || $(el).find('h2').text().trim() || $(el).text().trim();

              let parent = $(el).parent();
              for (let depth = 0; depth < 3; depth++) {
                if (!parent || parent.length === 0) break;

                if (!cover) {
                  const siblingImg = parent.find('img');
                  if (siblingImg.length > 0) {
                    cover = siblingImg.attr('src') || siblingImg.attr('srcset') || '';
                    if (cover && cover.includes('_next/image')) {
                      const match = cover.match(/url=([^&]+)/);
                      if (match) cover = decodeURIComponent(match[1]);
                    }
                  }
                }

                if (!title) {
                  const siblingTitle = parent.find('h3, h2, .font-semibold').first();
                  if (siblingTitle.length > 0) {
                    title = siblingTitle.text().trim();
                  }
                }

                parent = parent.parent();
              }

              if (slug && title) {
                const storyObj = {
                  title,
                  slug,
                  cover: cover && cover.startsWith('/') ? `${METRUYENCHU_URL}${cover}` : cover,
                  author: "Đang cập nhật"
                };

                if (hotStories.length < 10 && cover && !cover.includes('rank-index')) {
                  if (!hotStories.some(b => b.slug === slug)) {
                    hotStories.push(storyObj);
                  }
                } else {
                  if (!newUpdates.some(b => b.slug === slug) && !hotStories.some(b => b.slug === slug)) {
                    newUpdates.push({
                      ...storyObj,
                      latestChapter: "Đang ra...",
                      latestChapterSlug: "chuong-moi-nhat"
                    });
                  }
                }
              }
            });

            return NextResponse.json({ hotStories, newUpdates });
          } catch (e) {
            console.error("[NovelHub API] Metruyenchu home fetch failed:", e);
            return NextResponse.json({ hotStories: [], newUpdates: [] });
          }
        } else {
          return NextResponse.json({ hotStories: [], newUpdates: [] });
        }
      }

      case "search": {
        const q = searchParams.get("q");
        if (!q) return NextResponse.json({ results: [] });

        if (source === "truyenfull") {
          const searchUrl = `${TRUYENFULL_URL}/tim-kiem/?tukhoa=${encodeURIComponent(q)}`;
          let html = "";
          try {
            const res = await fetch(searchUrl, { headers: getHeaders(TRUYENFULL_URL) });
            if (res.status === 200) {
              html = await res.text();
              if (html.includes("cloudflare") || html.includes("challenge-running")) {
                html = ""; // trigger fallback
              }
            }
          } catch (e) {
            console.warn("[NovelHub API] Standard search fetch failed for TruyenFull, trying CloakBrowser...", e);
          }

          if (!html) {
            const stealthHtml = await fetchHtmlWithStealth(searchUrl, ".list-truyen");
            if (stealthHtml) {
              html = stealthHtml;
            }
          }

          const $ = cheerio.load(html || "");
          const results: any[] = [];

          $(".list-truyen .row").each((_, el) => {
            const url = $(el).find("h3.truyen-title a").attr("href");
            const title = $(el).find("h3.truyen-title a").text().trim();
            const author = $(el).find(".author").text().trim();
            const chapter = $(el).find(".text-info a").text().trim();
            if (title && url) {
              results.push({ title, slug: getSlug(url), author, latestChapter: chapter });
            }
          });

          return NextResponse.json({ results });
        } else if (source === "metruyenchu") {
          let slug = "";
          if (q.includes("metruyenchu.co/truyen/")) {
            const match = q.match(/metruyenchu\.co\/truyen\/([a-zA-Z0-9_\-]+)/);
            if (match) slug = match[1];
          }

          if (slug) {
            try {
              const storyUrl = `${METRUYENCHU_URL}/truyen/${slug}`;
              const resStory = await fetch(storyUrl, { headers: getHeaders() });
              const htmlStory = await resStory.text();
              const bookIdMatch = htmlStory.match(/_id[\\]*"\s*:\s*[\\]*"([a-f0-9]{24})[\\]*"/);

              if (bookIdMatch) {
                const bookId = bookIdMatch[1];
                const data = await fetchMtcServerAction(MTC_ACTION_BOOK_DETAIL, [bookId], storyUrl);
                return NextResponse.json({
                  results: [{
                    title: data.name,
                    slug,
                    author: data.author?.name || "Đang cập nhật",
                    latestChapter: `Chương ${data.lastChapter || "Mới nhất"}`
                  }]
                });
              }
            } catch (e) {
              console.error("[NovelHub API] Direct URL search fetch failed for Metruyenchu:", e);
            }
          }

          let results: any[] = [];
          try {
            const resHome = await fetch(METRUYENCHU_URL, { headers: getHeaders() });
            const htmlHome = await resHome.text();
            const $ = cheerio.load(htmlHome);

            $('a[href*="/truyen/"]').each((_, el) => {
              const href = $(el).attr('href');
              if (!href || href.includes('/chuong-')) return;
              const s = href.split('/').filter(Boolean).pop();
              if (!s) return;

              const title = $(el).find('h3').text().trim() || $(el).find('h2').text().trim() || $(el).text().trim();
              if (title && s && title.toLowerCase().includes(q.toLowerCase())) {
                if (!results.some(r => r.slug === s)) {
                  results.push({
                    title,
                    slug: s,
                    author: "Đang cập nhật",
                    latestChapter: "Mới nhất"
                  });
                }
              }
            });
          } catch (e) {
            console.error("[NovelHub API] Homepage search filtering failed:", e);
          }

          try {
            const ddgUrl = `https://html.duckduckgo.com/html/?q=site:metruyenchu.co+${encodeURIComponent(q)}`;
            const res = await fetch(ddgUrl, { headers: getHeaders() });
            if (res.status === 200) {
              const html = await res.text();
              const $ = cheerio.load(html);
              $('.result__body').each((_, el) => {
                const titleEl = $(el).find('.result__title a');
                const title = titleEl.text().trim();
                const href = titleEl.attr('href') || '';

                const match = href.match(/metruyenchu\.co\/truyen\/([a-zA-Z0-9_\-]+)/);
                if (match && !href.includes('/chuong-')) {
                  const s = match[1];
                  if (!results.some(r => r.slug === s)) {
                    results.push({
                      title: title.replace(' - Mê Truyện Chữ', '').replace(' | Mê Truyện Chữ', '').trim(),
                      slug: s,
                      author: "Đang cập nhật",
                      latestChapter: "Mới nhất"
                    });
                  }
                }
              });
            }
          } catch (e) {
            console.error("[NovelHub API] DDG search fallback failed:", e);
          }

          return NextResponse.json({ results });
        } else {
          // 1. Direct URL check for WikiDich
          let directSlug = "";
          const wikiUrlMatch = q.match(/(?:wikicv\.net|wikidich\.(?:net|com|ru|info)|wikidich3\.(?:com|xyz)|wikidichvip\.(?:net|com))\/truyen\/([a-zA-Z0-9_\-~]+)/i);
          if (wikiUrlMatch) {
            directSlug = wikiUrlMatch[1];
          }

          if (directSlug) {
            try {
              const storyUrl = `${WIKIDICH_URL}/truyen/${directSlug}`;
              const headers = getHeaders();
              if (wikiDichCookie) {
                headers["Cookie"] = wikiDichCookie.includes("express.sid=")
                  ? wikiDichCookie
                  : `express.sid=${wikiDichCookie}`;
              }
              const resStory = await fetch(storyUrl, { headers });
              const htmlStory = await resStory.text();
              const $story = cheerio.load(htmlStory);
              
              const title = $story("h1").text().trim() || $story("title").text().split("-")[0].trim() || directSlug;
              let author = "Đang cập nhật";
              $story('a[href*="/tac-gia/"]').each((_, el) => {
                const text = $story(el).text().trim();
                if (text && !text.toLowerCase().includes("đề cử")) {
                  author = text;
                  return false;
                }
              });
              
              return NextResponse.json({
                results: [{
                  title,
                  slug: directSlug,
                  author,
                  latestChapter: "Xem chi tiết"
                }]
              });
            } catch (e) {
              console.error("[NovelHub API] Direct URL search fetch failed for Wikidich:", e);
              return NextResponse.json({
                results: [{
                  title: directSlug,
                  slug: directSlug,
                  author: "Đang cập nhật",
                  latestChapter: "Xem chi tiết"
                }]
              });
            }
          }

          // Read cookie from request headers
          let results: any[] = [];

          if (wikiDichCookie) {
            console.log("[NovelHub API] Wikidich cookie detected, attempting native search...");
            try {
              const searchUrl = `${WIKIDICH_URL}/tim-kiem?q=${encodeURIComponent(q)}`;
              const headers = getHeaders(WIKIDICH_URL);
              const cookieValue = wikiDichCookie.includes("express.sid=")
                ? wikiDichCookie
                : `express.sid=${wikiDichCookie}`;
              headers["Cookie"] = cookieValue;

              const res = await fetch(searchUrl, { headers });
              const html = await res.text();
              const $ = cheerio.load(html);
              const nativeResults: any[] = [];

              $(".book-item").each((_, el) => {
                const url = $(el).find("a").first().attr("href") || "";
                const title = $(el).find(".book-title").text().trim();
                const author = $(el).find(".author").text().trim();
                if (title && url) {
                  nativeResults.push({ title, slug: getWikiSlug(url), author, latestChapter: "Đang ra..." });
                }
              });

              results = nativeResults;
              console.log(`[NovelHub API] Native search with cookie found ${results.length} results.`);
            } catch (e) {
              console.error("[NovelHub API] Native search with cookie failed:", e);
            }
          }

          if (!results || results.length === 0) {
            // Wikidich search fallback 1: Google Search via CloakBrowser
            results = await searchWikiDichViaGoogle(q);

            if (!results || results.length === 0) {
              // Wikidich search fallback 2: Use DuckDuckGo search to bypass the login requirement.
              console.log(`[NovelHub API] Searching WikiDich via DuckDuckGo for: ${q}`);
              results = await searchWikiDichViaDDG(q);

              if (!results || results.length === 0) {
                console.log("[NovelHub API] DDG returned no results, trying native search fallback (no cookie)...");
                try {
                  const searchUrl = `${WIKIDICH_URL}/tim-kiem?q=${encodeURIComponent(q)}`;
                  const headers = getHeaders(WIKIDICH_URL);
                  if (wikiDichCookie) {
                    headers["Cookie"] = wikiDichCookie.includes("express.sid=")
                      ? wikiDichCookie
                      : `express.sid=${wikiDichCookie}`;
                  }
                  const res = await fetch(searchUrl, { headers });
                  const html = await res.text();
                  const $ = cheerio.load(html);
                  const nativeResults: any[] = [];

                  $(".book-item").each((_, el) => {
                    const url = $(el).find("a").first().attr("href") || "";
                    const title = $(el).find(".book-title").text().trim();
                    const author = $(el).find(".author").text().trim();
                    if (title && url) {
                      nativeResults.push({ title, slug: getWikiSlug(url), author, latestChapter: "Đang ra..." });
                    }
                  });
                  results = nativeResults;
                } catch (e) {
                  console.error("[NovelHub API] Native search fallback failed:", e);
                }
              }
            }
          }

          return NextResponse.json({ results });
        }
      }

      case "story": {
        let slug = searchParams.get("slug");
        const page = searchParams.get("page") || "1";
        if (!slug) return NextResponse.json({ error: "Missing slug parameter" }, { status: 400 });
        slug = slug.split("?")[0].split("#")[0];

        if (source === "truyenfull") {
          let url = `${TRUYENFULL_URL}/${slug}/`;
          if (page && page !== "1") url += `trang-${page}/`;

          let html = "";
          try {
            const res = await fetch(url, { headers: getHeaders(TRUYENFULL_URL) });
            if (res.status === 200) {
              html = await res.text();
              if (html.includes("cloudflare") || html.includes("challenge-running")) {
                html = ""; // trigger fallback
              }
            }
          } catch (e) {
            console.warn("[NovelHub API] Standard fetch failed for TruyenFull story page, trying CloakBrowser...", e);
          }

          if (!html) {
            const stealthHtml = await fetchHtmlWithStealth(url, ".desc-text, .book");
            if (stealthHtml) {
              html = stealthHtml;
            }
          }

          if (!html) {
            return NextResponse.json({ error: "Không thể tải thông tin truyện (hoặc web chặn bots)." }, { status: 403 });
          }

          const $ = cheerio.load(html);

          const title = $("h3.title").text().trim() || "";
          const author = $('.info a[itemprop="author"]').text().trim() || "Đang cập nhật";
          const desc = $(".desc-text").html()?.trim() || "";
          const cover = $(".book img").attr("src");

          const chapters: any[] = [];
          $(".list-chapter li a").each((_, el) => {
            const t = $(el).text().trim();
            const chapUrl = $(el).attr("href");
            if (t && chapUrl) chapters.push({ title: t, slug: getSlug(chapUrl) });
          });

          let totalPages = 1;
          $(".pagination li a").each((_, el) => {
            const href = $(el).attr("href");
            if (href && href.includes("trang-")) {
              const match = href.match(/trang-(\d+)/);
              if (match) {
                const pNum = parseInt(match[1]);
                if (pNum > totalPages) totalPages = pNum;
              }
            }
          });

          return NextResponse.json({
            title,
            slug,
            author,
            cover,
            desc,
            chapters,
            totalPages,
            currentPage: parseInt(page),
          });
        } else if (source === "metruyenchu") {
          const storyUrl = `${METRUYENCHU_URL}/truyen/${slug}`;
          let html = "";
          try {
            const res = await fetch(storyUrl, { headers: getHeaders() });
            if (res.status === 200) {
              html = await res.text();
            }
          } catch (e) {
            console.error("[NovelHub API] GET story page failed for Metruyenchu:", e);
          }

          if (!html) {
            return NextResponse.json({ error: "Không thể kết nối tới Mê Truyện Chữ." }, { status: 403 });
          }

          const bookIdMatch = html.match(/_id[\\]*"\s*:\s*[\\]*"([a-f0-9]{24})[\\]*"/);
          if (!bookIdMatch) {
            return NextResponse.json({ error: "Không tìm thấy định danh truyện (bookId)." }, { status: 404 });
          }
          const bookId = bookIdMatch[1];

          try {
            const bookData = await fetchMtcServerAction(MTC_ACTION_BOOK_DETAIL, [bookId], storyUrl);
            const chaptersData = await fetchMtcServerAction(
              MTC_ACTION_CHAPTERS,
              [{"bookId": bookId, "page": 1, "limit": 1000000000, "isNewest": false}],
              storyUrl
            );

            const title = bookData.name || "N/A";
            const author = bookData.author?.name || "Đang cập nhật";
            const desc = bookData.description || "";
            const cover = bookData.cover?.[0]?.url || "";

            const chapters = (chaptersData || []).map((ch: any) => ({
              title: ch.name,
              slug: ch.slugId
            }));

            return NextResponse.json({
              title,
              slug,
              author,
              cover: cover && cover.startsWith('/') ? `${METRUYENCHU_URL}${cover}` : cover,
              desc,
              chapters,
              totalPages: 1,
              currentPage: 1
            });
          } catch (e: any) {
            console.error("[NovelHub API] Fetching MTC story details failed:", e);
            return NextResponse.json({ error: `Lỗi tải thông tin truyện: ${e.message}` }, { status: 500 });
          }
        } else {
          const url = `${WIKIDICH_URL}/truyen/${slug}`;
          let html = "";
          try {
            const headers = getHeaders(WIKIDICH_URL);
            if (wikiDichCookie) {
              headers["Cookie"] = wikiDichCookie.includes("express.sid=")
                ? wikiDichCookie
                : `express.sid=${wikiDichCookie}`;
            }
            const res = await fetch(url, { headers });
            if (res.status === 200) {
              html = await res.text();
              if (html.includes("cloudflare") || html.includes("challenge-running")) {
                html = ""; // trigger fallback
              }
            }
          } catch (e) {
            console.warn("[NovelHub API] Standard fetch failed for WikiDich story page, trying CloakBrowser...", e);
          }

          if (!html) {
            const stealthHtml = await fetchHtmlWithStealth(url, ".book-desc-detail");
            if (stealthHtml) {
              html = stealthHtml;
            }
          }

          if (!html) {
            return NextResponse.json({ error: "Không thể tải thông tin truyện." }, { status: 403 });
          }

          const $ = cheerio.load(html);

          const title = $("h2").first().text().trim() || "N/A";
          const author = $('a[href*="/tac-gia/"]').first().text().trim() || "Đang cập nhật";
          const desc = $(".book-desc-detail").html()?.trim() || "";
          const c = $("img.materialboxed").attr("src");
          const cover = c && c.startsWith("/") ? `${WIKIDICH_URL}${c}` : c;

          const signKeyMatch = html.match(/signKey\s*=\s*['"](.*?)['"]/);
          const bookIdMatch = html.match(/bookId\s*=\s*['"](.*?)['"]/);
          const loadIndexMatch = html.match(/loadBookIndex\s*\(\s*(\d+)\s*,\s*(\d+)/);
          const fuzzySignMatch = html.match(/fuzzySign[^{]*{\s*return\s*text\.substring\((\d+)\)/);

          const chapters: any[] = [];
          if (signKeyMatch && bookIdMatch && loadIndexMatch && fuzzySignMatch) {
            const signKey = signKeyMatch[1];
            const bookId = bookIdMatch[1];
            const start = parseInt(loadIndexMatch[1], 10);
            const size = parseInt(loadIndexMatch[2], 10);
            const offset = parseInt(fuzzySignMatch[1], 10);
            const b = wikiSign(fuzzySign(signKey + start + size, offset));

            try {
              const indexUrl = `${WIKIDICH_URL}/book/index?bookId=${bookId}&start=${start}&size=${size}&signKey=${signKey}&sign=${b}`;
              let indexData = "";
              try {
                const headers = getHeaders(url);
                if (wikiDichCookie) {
                  headers["Cookie"] = wikiDichCookie.includes("express.sid=")
                    ? wikiDichCookie
                    : `express.sid=${wikiDichCookie}`;
                }
                const resIdx = await fetch(indexUrl, { headers });
                if (resIdx.status === 200) {
                  indexData = await resIdx.text();
                  if (indexData.includes("cloudflare") || indexData.includes("challenge-running")) {
                    indexData = "";
                  }
                }
              } catch (e) {
                console.warn("[NovelHub API] Index fetch failed, trying CloakBrowser...", e);
              }

              if (!indexData) {
                const stealthIdx = await fetchHtmlWithStealth(indexUrl, ".chapter-name");
                if (stealthIdx) {
                  indexData = stealthIdx;
                }
              }

              if (indexData) {
                const $idx = cheerio.load(indexData);
                $idx(".chapter-name a").each((_, el) => {
                  const t = $idx(el).text().trim();
                  const u = $idx(el).attr("href");
                  if (t && u) chapters.push({ title: t, slug: getWikiSlug(u) });
                });
              }
            } catch (e) {
              console.error("Error fetching wikidich chapters: ", e);
            }
          }

          return NextResponse.json({
            title,
            slug,
            author,
            cover,
            desc,
            chapters,
            totalPages: 1,
            currentPage: 1,
          });
        }
      }

      case "chapter": {
        let slug = searchParams.get("slug");
        let chapterSlug = searchParams.get("chapterSlug");
        const referer = searchParams.get("referer") || undefined;
        if (!slug || !chapterSlug) {
          return NextResponse.json({ error: "Missing slug or chapterSlug" }, { status: 400 });
        }
        slug = slug.split("?")[0].split("#")[0];
        chapterSlug = chapterSlug.split("?")[0].split("#")[0];

        if (source === "truyenfull") {
          const url = `${TRUYENFULL_URL}/${slug}/${chapterSlug}/`;
          const defaultReferer = `${TRUYENFULL_URL}/${slug}/`;
          let html = "";
          
          try {
            const res = await fetch(url, { headers: getHeaders(referer || defaultReferer) });
            if (res.status === 200) {
              html = await res.text();
              if (html.includes("cloudflare") || html.includes("challenge-running")) {
                html = ""; // trigger fallback
              }
            }
          } catch (e) {
            console.warn("[NovelHub API] Standard fetch failed for TruyenFull, trying CloakBrowser...", e);
          }

          if (!html) {
            const stealthHtml = await fetchHtmlWithStealth(url, "#chapter-c, .chapter-c, #chapter-content, .chapter-content");
            if (stealthHtml) {
              html = stealthHtml;
              console.log("[CloakBrowser fallback] Successfully scraped TruyenFull chapter!");
            }
          }

          if (!html) {
            return NextResponse.json({ error: "Không thể tải nội dung (hoặc web chặn bots)." }, { status: 403 });
          }

          const $ = cheerio.load(html);
          const title = $(".chapter-title").text().trim() || "Chương không rõ";
          const storyTitle = $(".truyen-title").text().trim() || "Truyện không rõ";
          
          let selector = "";
          if ($("#chapter-c").length) selector = "#chapter-c";
          else if ($(".chapter-c").length) selector = ".chapter-c";
          else if ($("#chapter-content").length) selector = "#chapter-content";
          else if ($(".chapter-content").length) selector = ".chapter-content";

          const content = selector 
            ? processChapterContent($, selector)
            : "<p>Không thể tải nội dung (hoặc web chặn bots).</p>";

          const prevUrl = $("#prev_chap").attr("href");
          const nextUrl = $("#next_chap").attr("href");

          return NextResponse.json({
            title,
            storyTitle,
            content,
            externalApi: `${TRUYENFULL_URL}/${slug}/${chapterSlug}`,
            prevSlug: !prevUrl || prevUrl.includes("javascript") ? null : getSlug(prevUrl),
            nextSlug: !nextUrl || nextUrl.includes("javascript") ? null : getSlug(nextUrl),
          });
        } else if (source === "metruyenchu") {
          const url = `${METRUYENCHU_URL}/truyen/${slug}/${chapterSlug}`;
          const defaultReferer = `${METRUYENCHU_URL}/truyen/${slug}`;
          let html = "";
          
          try {
            const res = await fetch(url, { headers: getHeaders(referer || defaultReferer) });
            if (res.status === 200) {
              html = await res.text();
            }
          } catch (e) {
            console.error("[NovelHub API] Fetching MTC chapter failed:", e);
          }

          if (!html) {
            return NextResponse.json({ error: "Không thể tải nội dung chương." }, { status: 403 });
          }

          const $ = cheerio.load(html);
          
          const pageTitle = $("title").text();
          let title = "";
          $("span").each((_, el) => {
            const txt = $(el).text().trim();
            if (txt.includes("Chương ") && !txt.includes("Chương trước") && !txt.includes("Chương sau")) {
              title = txt;
              return false; // break loop
            }
          });
          if (!title) {
            title = $("h2").first().text().trim() || pageTitle.split("- Chương")[1]?.trim() || "Chương không rõ";
          }
          const storyTitle = $("h1").first().text().trim() || pageTitle.split("- Chương")[0]?.trim() || "Truyện không rõ";
          
          const content = processChapterContent($, "article");

          let prevUrl = "";
          let nextUrl = "";
          
          $('a').each((_, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim();
            if (text === "Chương trước") prevUrl = href || "";
            if (text === "Chương sau") nextUrl = href || "";
          });

          const getMtcSlug = (u: string) => {
            if (!u) return null;
            if (!u.includes("/chuong-")) return null;
            const parts = u.split("/").filter(Boolean);
            return parts[parts.length - 1] || null;
          };

          return NextResponse.json({
            title,
            storyTitle,
            content,
            externalApi: url,
            prevSlug: getMtcSlug(prevUrl),
            nextSlug: getMtcSlug(nextUrl)
          });
        } else {
          const url = `${WIKIDICH_URL}/truyen/${slug}/${chapterSlug}`;
          const defaultReferer = `${WIKIDICH_URL}/truyen/${slug}`;
          let html = "";
          
          try {
            const headers = getHeaders(referer || defaultReferer);
            if (wikiDichCookie) {
              headers["Cookie"] = wikiDichCookie.includes("express.sid=")
                ? wikiDichCookie
                : `express.sid=${wikiDichCookie}`;
            }
            const res = await fetch(url, { headers });
            if (res.status === 200) {
              html = await res.text();
              if (html.includes("cloudflare") || html.includes("challenge-running")) {
                html = ""; // trigger fallback
              }
            }
          } catch (e) {
            console.warn("[NovelHub API] Standard fetch failed for WikiDich, trying CloakBrowser...", e);
          }

          if (!html) {
            const stealthHtml = await fetchHtmlWithStealth(url, "#bookContentBody");
            if (stealthHtml) {
              html = stealthHtml;
              console.log("[CloakBrowser fallback] Successfully scraped WikiDich chapter!");
            }
          }

          if (!html) {
            return NextResponse.json({ error: "Không thể tải nội dung." }, { status: 403 });
          }

          const $ = cheerio.load(html);
          const title = $("title").text().split("- Chương")[1]?.trim() || "Chương";
          const storyTitle = $("title").text().split("- Chương")[0]?.trim() || "Truyện";
          
          const content = processChapterContent($, "#bookContentBody");

          const prevUrl = $("#btnPreChapter").attr("href");
          const nextUrl = $("#btnNextChapter").attr("href");

          return NextResponse.json({
            title,
            storyTitle,
            content,
            externalApi: url,
            prevSlug: !prevUrl || prevUrl.includes("javascript") ? null : getWikiSlug(prevUrl),
            nextSlug: !nextUrl || nextUrl.includes("javascript") ? null : getWikiSlug(nextUrl),
          });
        }
      }

      case "list": {
        const type = searchParams.get("type");
        const page = searchParams.get("page") || "1";
        if (!type) return NextResponse.json({ error: "Missing type parameter" }, { status: 400 });

        if (source === "wikidich") {
          const start = (parseInt(page) - 1) * 20;
          const url = `${WIKIDICH_URL}/${type}?start=${start}`;
          const headers = getHeaders(WIKIDICH_URL);
          if (wikiDichCookie) {
            headers["Cookie"] = wikiDichCookie.includes("express.sid=")
              ? wikiDichCookie
              : `express.sid=${wikiDichCookie}`;
          }
          const res = await fetch(url, { headers });
          const html = await res.text();
          const $ = cheerio.load(html);

          let title = type;
          if (type === "chuong-moi") title = "Chương mới";
          if (type === "truyen-nam") title = "Truyện nam";
          if (type === "nu-tan") title = "Nữ tần";
          if (type === "dam-my") title = "Đam mỹ";

          const results: any[] = [];
          $(".book-item").each((_, el) => {
            const u = $(el).find("a").first().attr("href");
            const t = $(el).find(".book-title").text().trim();
            const author = $(el).find(".author").text().trim();
            if (t && u) {
              results.push({ title: t, slug: getWikiSlug(u), author, latestChapter: "Đang ra..." });
            }
          });

          let totalPages = 1;
          $(".pagination li a").each((_, el) => {
            const href = $(el).attr("href");
            if (href && href.includes("start=")) {
              const match = href.match(/start=(\d+)/);
              if (match) {
                const maxStart = parseInt(match[1]);
                const pNum = Math.floor(maxStart / 20) + 1;
                if (pNum > totalPages) totalPages = pNum;
              }
            }
          });

          return NextResponse.json({
            title,
            results,
            totalPages,
            currentPage: parseInt(page),
          });
        } else if (source === "metruyenchu") {
          try {
            const listTypeSlug = type === "truyen-moi" ? "truyen-moi" : type;
            const url = `${METRUYENCHU_URL}/danh-sach/${listTypeSlug}?page=${page}`;
            
            const res = await fetch(url, { headers: getHeaders() });
            const html = await res.text();
            const $ = cheerio.load(html);

            const results: any[] = [];
            $('.flex.flex-row.items-start.gap-4').each((_, cardEl) => {
              const card = $(cardEl);
              let href = '';
              let title = '';
              
              card.find('a[href*="/truyen/"]').each((_, el) => {
                const h = $(el).attr('href') || '';
                if (h && !h.includes('/chuong-')) {
                  href = h;
                  const t = $(el).text().trim();
                  if (t) title = t;
                }
              });
              
              if (!href) return;
              const slug = href.split('/').filter(Boolean).pop();
              if (!slug) return;
              
              let cover = '';
              const img = card.find('img');
              if (img.length > 0) {
                cover = img.attr('src') || img.attr('srcset') || '';
                if (cover && cover.includes('_next/image')) {
                  const match = cover.match(/url=([^&]+)/);
                  if (match) cover = decodeURIComponent(match[1]);
                }
              }
              
              let author = 'Đang cập nhật';
              const authorLink = card.find('a[href*="/tac-gia/"]');
              if (authorLink.length > 0) {
                author = authorLink.text().trim();
              }
              
              let desc = card.find('.line-clamp-2, p').text().trim();
              if (desc.includes('Tác giả:')) desc = '';
              
              let latestChapter = 'Mới nhất';
              card.find('span').each((_, spanEl) => {
                const txt = $(spanEl).text().trim();
                if (txt.includes('chương') || txt.includes('Chương')) {
                  latestChapter = txt;
                }
              });
              
              results.push({
                title,
                slug,
                cover: cover && cover.startsWith('/') ? `${METRUYENCHU_URL}${cover}` : cover,
                author,
                latestChapter,
                desc: desc || "Chưa có mô tả..."
              });
            });

            let totalPages = 1;
            $('a[href*="page="]').each((_, el) => {
              const href = $(el).attr('href') || '';
              const match = href.match(/page=(\d+)/);
              if (match) {
                const pageNum = parseInt(match[1]);
                if (pageNum > totalPages) {
                  totalPages = pageNum;
                }
              }
            });

            return NextResponse.json({
              title: type === "truyen-moi" ? "Truyện mới" : "Danh sách truyện",
              results,
              totalPages,
              currentPage: parseInt(page)
            });
          } catch (e) {
            console.error("[NovelHub API] Metruyenchu list fetch failed:", e);
            return NextResponse.json({ title: "Danh sách truyện", results: [], totalPages: 1, currentPage: 1 });
          }
        } else {
          let url = `${TRUYENFULL_URL}/danh-sach/${type}/`;
          if (page && page !== "1") url += `trang-${page}/`;

          const res = await fetch(url, { headers: getHeaders(TRUYENFULL_URL) });
          const html = await res.text();
          const $ = cheerio.load(html);

          const title = $(".title-list h2").text().trim() || type;
          const results: any[] = [];

          $(".list-truyen .row").each((_, el) => {
            const a = $(el).find("h3.truyen-title a");
            const url = a.attr("href");
            const titleText = a.text().trim();
            const author = $(el).find(".author").text().trim();
            const chapterUrl = $(el).find(".text-info a").attr("href");
            const chapter = $(el).find(".text-info a").text().trim();
            const coverFromList = $(el).find(".lazyimg").attr("data-image") || "";
            if (titleText && url) {
              results.push({
                title: titleText,
                slug: getSlug(url),
                author,
                latestChapter: chapter,
                latestChapterSlug: getSlug(chapterUrl || ""),
                coverFromList,
              });
            }
          });

          // Fetch description and higher-res cover in parallel for the first 20 items
          const targetStories = results.slice(0, 20);
          const richPromises = targetStories.map(async (story) => {
            try {
              const detailUrl = `${TRUYENFULL_URL}/${story.slug}/`;
              const resDet = await fetch(detailUrl, { headers: getHeaders(detailUrl) });
              const htmlDet = await resDet.text();
              const $det = cheerio.load(htmlDet);
              
              const desc = $det(".desc-text").text().trim().substring(0, 150) + "...";
              let cover = $det(".book img").attr("src") || "";
              if (!cover && story.coverFromList) {
                cover = story.coverFromList.replace("=w60-h85-c", "");
              }
              return { ...story, desc, cover };
            } catch (e) {
              let cover = story.coverFromList || "";
              if (cover) {
                cover = cover.replace("=w60-h85-c", "");
              }
              return { ...story, desc: "Chưa có mô tả...", cover };
            }
          });
          
          const richResults = await Promise.all(richPromises);

          let totalPages = 1;
          $(".pagination li a").each((_, el) => {
            const href = $(el).attr("href");
            if (href && href.includes("trang-")) {
              const match = href.match(/trang-(\d+)/);
              if (match) {
                const pNum = parseInt(match[1]);
                if (pNum > totalPages) totalPages = pNum;
              }
            }
          });

          return NextResponse.json({
            title,
            results: richResults,
            totalPages,
            currentPage: parseInt(page),
          });
        }
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: any) {
    console.error("[/api/novelhub] Error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, source, html, q, slug, chapterSlug, page = "1" } = body;
    const wikiDichCookie = req.headers.get("x-wikidich-cookie");

    if (!action || !source || !html) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
    }

    const $ = cheerio.load(html);

    switch (action) {
      case "home": {
        if (source === "truyenfull") {
          const hotStories: any[] = [];
          $(".index-intro .item").each((_, el) => {
            const url = $(el).find("a").attr("href") || "";
            const title = $(el).find("h3").text().trim();
            const coverImg = $(el).find("img").attr("src");
            if (title && url) {
              hotStories.push({ title, slug: getSlug(url), cover: coverImg });
            }
          });
          return NextResponse.json({ hotStories, newUpdates: [] });
        } else if (source === "wikidich") {
          const hotStories: any[] = [];
          const newUpdates: any[] = [];
          $(".book-item").each((i, el) => {
            const url = $(el).find("a").first().attr("href") || "";
            const title = $(el).find(".book-title").text().trim();
            const coverImg = $(el).find("img").attr("src");
            const author = $(el).find(".author").text().trim();
            const itm = {
              title,
              slug: getWikiSlug(url),
              cover: coverImg ? `${WIKIDICH_URL}${coverImg}` : "",
              author,
            };
            if (title && url) {
              if (i < 8) hotStories.push(itm);
              else newUpdates.push({ ...itm, latestChapter: "Đang ra...", latestChapterSlug: "chuong-moi-nhat" });
            }
          });
          return NextResponse.json({ hotStories, newUpdates });
        }
        return NextResponse.json({ hotStories: [], newUpdates: [] });
      }

      case "search": {
        const results: any[] = [];
        if (source === "truyenfull") {
          $(".list-truyen .row").each((_, el) => {
            const url = $(el).find("h3.truyen-title a").attr("href");
            const title = $(el).find("h3.truyen-title a").text().trim();
            const author = $(el).find(".author").text().trim();
            const chapter = $(el).find(".text-info a").text().trim();
            if (title && url) {
              results.push({ title, slug: getSlug(url), author, latestChapter: chapter });
            }
          });
        } else if (source === "wikidich") {
          $(".book-item").each((_, el) => {
            const url = $(el).find("a").first().attr("href") || "";
            const title = $(el).find(".book-title").text().trim();
            const author = $(el).find(".author").text().trim();
            if (title && url) {
              results.push({ title, slug: getWikiSlug(url), author, latestChapter: "Đang ra..." });
            }
          });
        }
        return NextResponse.json({ results });
      }

      case "story": {
        if (source === "truyenfull") {
          const title = $("h3.title").text().trim() || "";
          const author = $('.info a[itemprop="author"]').text().trim() || "Đang cập nhật";
          const desc = $(".desc-text").html()?.trim() || "";
          const cover = $(".book img").attr("src");
          const chapters: any[] = [];
          $(".list-chapter li a").each((_, el) => {
            const t = $(el).text().trim();
            const chapUrl = $(el).attr("href");
            if (t && chapUrl) chapters.push({ title: t, slug: getSlug(chapUrl) });
          });
          let totalPages = 1;
          $(".pagination li a").each((_, el) => {
            const href = $(el).attr("href");
            if (href && href.includes("trang-")) {
              const match = href.match(/trang-(\d+)/);
              if (match) {
                const pNum = parseInt(match[1]);
                if (pNum > totalPages) totalPages = pNum;
              }
            }
          });
          return NextResponse.json({
            title,
            slug,
            author,
            cover,
            desc,
            chapters,
            totalPages,
            currentPage: parseInt(page),
          });
        } else if (source === "wikidich") {
          const title = $("h2").first().text().trim() || "N/A";
          const author = $('a[href*="/tac-gia/"]').first().text().trim() || "Đang cập nhật";
          const desc = $(".book-desc-detail").html()?.trim() || "";
          const c = $("img.materialboxed").attr("src");
          const cover = c && c.startsWith("/") ? `${WIKIDICH_URL}${c}` : c;

          const signKeyMatch = html.match(/signKey\s*=\s*['"](.*?)['"]/);
          const bookIdMatch = html.match(/bookId\s*=\s*['"](.*?)['"]/);
          const loadIndexMatch = html.match(/loadBookIndex\s*\(\s*(\d+)\s*,\s*(\d+)/);
          const fuzzySignMatch = html.match(/fuzzySign[^{]*{\s*return\s*text\.substring\((\d+)\)/);

          const chapters: any[] = [];
          let needIndexUrl = "";

          if (signKeyMatch && bookIdMatch && loadIndexMatch && fuzzySignMatch) {
            const signKey = signKeyMatch[1];
            const bookId = bookIdMatch[1];
            const start = parseInt(loadIndexMatch[1], 10);
            const size = parseInt(loadIndexMatch[2], 10);
            const offset = parseInt(fuzzySignMatch[1], 10);
            const b = wikiSign(fuzzySign(signKey + start + size, offset));
            const indexUrl = `${WIKIDICH_URL}/book/index?bookId=${bookId}&start=${start}&size=${size}&signKey=${signKey}&sign=${b}`;

            // Try to fetch internally
            try {
              const headers = getHeaders(indexUrl);
              if (wikiDichCookie) {
                headers["Cookie"] = wikiDichCookie.includes("express.sid=") ? wikiDichCookie : `express.sid=${wikiDichCookie}`;
              }
              const resIdx = await fetch(indexUrl, { headers });
              if (resIdx.status === 200) {
                const indexData = await resIdx.text();
                if (indexData && !indexData.includes("cloudflare") && !indexData.includes("challenge-running")) {
                  const $idx = cheerio.load(indexData);
                  $idx(".chapter-name a").each((_, el) => {
                    const t = $idx(el).text().trim();
                    const u = $idx(el).attr("href");
                    if (t && u) chapters.push({ title: t, slug: getWikiSlug(u) });
                  });
                }
              }
            } catch (e) {
              console.warn("[NovelHub API POST] Internal fetch index failed:", e);
            }

            if (chapters.length === 0) {
              needIndexUrl = indexUrl;
            }
          }

          return NextResponse.json({
            title,
            slug,
            author,
            cover,
            desc,
            chapters,
            needIndexUrl,
            totalPages: 1,
            currentPage: 1,
          });
        }
      }

      case "wiki-index": {
        const chapters: any[] = [];
        $(".chapter-name a").each((_, el) => {
          const t = $(el).text().trim();
          const u = $(el).attr("href");
          if (t && u) chapters.push({ title: t, slug: getWikiSlug(u) });
        });
        return NextResponse.json({ chapters });
      }

      case "chapter": {
        if (source === "truyenfull") {
          const title = $(".chapter-title").text().trim() || "Chương không rõ";
          const storyTitle = $(".truyen-title").text().trim() || "Truyện không rõ";
          let selector = "";
          if ($("#chapter-c").length) selector = "#chapter-c";
          else if ($(".chapter-c").length) selector = ".chapter-c";
          else if ($("#chapter-content").length) selector = "#chapter-content";
          else if ($(".chapter-content").length) selector = ".chapter-content";

          const content = selector ? processChapterContent($, selector) : "<p>Không thể tải nội dung.</p>";
          const prevUrl = $("#prev_chap").attr("href");
          const nextUrl = $("#next_chap").attr("href");

          return NextResponse.json({
            title,
            storyTitle,
            content,
            externalApi: `${TRUYENFULL_URL}/${slug}/${chapterSlug}`,
            prevSlug: !prevUrl || prevUrl.includes("javascript") ? null : getSlug(prevUrl),
            nextSlug: !nextUrl || nextUrl.includes("javascript") ? null : getSlug(nextUrl),
          });
        } else if (source === "wikidich") {
          const pageTitle = $("title").text().trim() || "";
          let title = "";
          $(".breadcrumb a").each((_, el) => {
            const txt = $(el).text().trim();
            if (txt.includes("Chương ") && !txt.includes("Chương trước") && !txt.includes("Chương sau")) {
              title = txt;
              return false;
            }
          });
          if (!title) {
            title = $("h2").first().text().trim() || pageTitle.split("- Chương")[1]?.trim() || "Chương không rõ";
          }
          const storyTitle = $("h1").first().text().trim() || pageTitle.split("- Chương")[0]?.trim() || "Truyện không rõ";
          const content = processChapterContent($, "#bookContentBody");
          const prevUrl = $(".pre").attr("href") || "";
          const nextUrl = $(".next").attr("href") || "";

          return NextResponse.json({
            title,
            storyTitle,
            content,
            externalApi: `${WIKIDICH_URL}/truyen/${slug}/${chapterSlug}`,
            prevSlug: !prevUrl || prevUrl.includes("javascript") ? null : getWikiSlug(prevUrl),
            nextSlug: !nextUrl || nextUrl.includes("javascript") ? null : getWikiSlug(nextUrl),
          });
        }
      }
    }
    return NextResponse.json({ error: `Unknown POST action: ${action}` }, { status: 400 });
  } catch (err: any) {
    console.error("[/api/novelhub POST] Error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

