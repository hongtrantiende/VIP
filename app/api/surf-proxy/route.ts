import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import iconv from "iconv-lite";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

export async function GET(req: Request) {
  return handleRequest(req, "GET");
}

export async function POST(req: Request) {
  return handleRequest(req, "POST");
}

async function handleRequest(req: Request, method: string) {
  const urlParams = new URL(req.url).searchParams;
  const targetUrl = urlParams.get("url");
  const type = urlParams.get("type");

  if (!targetUrl) {
    return new NextResponse("Missing url parameter", { status: 400 });
  }

  try {
    const originUrl = new URL(targetUrl);
    
    // Pass along headers (except host and referer)
    const reqHeaders = new Headers();
    req.headers.forEach((value, key) => {
        if (!['host', 'referer', 'origin'].includes(key.toLowerCase())) {
            reqHeaders.set(key, value);
        }
    });
    
    // Fake headers for target
    reqHeaders.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    reqHeaders.set("Referer", originUrl.origin + "/");

    const fetchOptions: RequestInit = {
        method,
        headers: reqHeaders,
    };
    
    if (method !== "GET" && method !== "HEAD") {
        fetchOptions.body = await req.arrayBuffer();
    }

    const response = await fetch(targetUrl, fetchOptions);
    
    if (type === "ajax") {
        // Return raw response for AJAX with CORS headers
        const responseHeaders = new Headers();
        response.headers.forEach((value, key) => responseHeaders.set(key, value));
        responseHeaders.set("Access-Control-Allow-Origin", "*");
        
        return new NextResponse(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders
        });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    
    let charset = "utf-8";
    const contentType = response.headers.get("content-type") || "";
    if (contentType.toLowerCase().includes("gbk") || contentType.toLowerCase().includes("gb2312")) {
      charset = "gbk";
    }

    let html = iconv.decode(buffer, charset);

    // If charset was not in headers, check meta tag
    if (charset === "utf-8") {
      const charsetMatch = html.match(/<meta[^>]*charset=["']?([^"'>]+)["']?/i);
      if (charsetMatch && (charsetMatch[1].toLowerCase().includes("gbk") || charsetMatch[1].toLowerCase().includes("gb2312"))) {
        charset = "gbk";
        html = iconv.decode(buffer, charset);
      }
    }

    const $ = cheerio.load(html);

    // Inject base tag and monkey patches for SPAs (React/Vue)
    $('head').prepend(`
      <script>
        // MUST run before <base> tag to avoid cross-origin replaceState error
        try {
           const targetUrl = new URL('${targetUrl}');
           const targetPath = targetUrl.pathname + targetUrl.search + targetUrl.hash;
           window.history.replaceState(null, '', targetPath);
        } catch(e) {
           console.error('replaceState error:', e);
        }
      </script>
      <base href="${originUrl.origin}/">
      <script>
        // Fix fetch and XHR for relative paths (since they ignore <base> tag)
        const _fetch = window.fetch;
        window.fetch = function() {
           if (typeof arguments[0] === 'string') {
               let url = arguments[0];
               if (url.startsWith('/')) url = '${originUrl.origin}' + url;
               if (url.startsWith('${originUrl.origin}')) {
                   arguments[0] = '/api/surf-proxy?type=ajax&url=' + encodeURIComponent(url);
               }
           }
           return _fetch.apply(this, arguments);
        };
        const _open = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) {
           if (typeof url === 'string') {
               if (url.startsWith('/')) url = '${originUrl.origin}' + url;
               if (url.startsWith('${originUrl.origin}')) {
                   url = '/api/surf-proxy?type=ajax&url=' + encodeURIComponent(url);
               }
           }
           return _open.apply(this, [method, url, ...Array.prototype.slice.call(arguments, 2)]);
        };
      </script>
    `);

    // Rewrite a hrefs
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
        try {
          const absoluteUrl = new URL(href, targetUrl).href;
          $(el).attr('href', `/api/surf-proxy?url=${encodeURIComponent(absoluteUrl)}`);
        } catch (e) {
          // ignore invalid URLs
        }
      }
      $(el).attr('target', '_self'); // Force open in same iframe
    });

    // Strip out some scripts that might break the iframe (like frame-busting scripts)
    $('script').each((_, el) => {
      const scriptHtml = $(el).html() || "";
      if (scriptHtml.includes("top.location") || scriptHtml.includes("window.top")) {
        $(el).remove();
      }
    });

    // Inject injector script
    $('body').append(`
      <script>
        (function() {
          let lastExtractedUrl = "";
          
          function extractContent() {
             // For SPAs, they might change the URL via history.pushState
             // So we should report the true URL they are displaying
             let displayUrl = window.location.href;
             if (displayUrl.includes('/api/surf-proxy')) {
                 displayUrl = '${targetUrl}';
             } else if (displayUrl.startsWith(window.location.origin)) {
                 // After replaceState, the URL is localhost:3000/..., we need to map it back to original origin
                 const originUrl = new URL('${targetUrl}');
                 displayUrl = originUrl.origin + displayUrl.substring(window.location.origin.length);
             }
             
             if (lastExtractedUrl === displayUrl) return;
             
             const titleEl = document.querySelector('h1');
             const title = titleEl ? titleEl.innerText.trim() : document.title;
             
             let contentHtml = "";
             // Heuristic for content extraction
             const contentSelectors = [
                '#content', '.content', '#chaptercontent', '.chaptercontent', 
                '.read-content', '#TextContent', '.txtnav', '#chapter-c',
                '#bookContentBody', '.chapter-c'
             ];
             
             for (const selector of contentSelectors) {
                const el = document.querySelector(selector);
                if (el && el.innerText.trim().length > 100) {
                   contentHtml = el.innerHTML;
                   break;
                }
             }
             
             // Fallback to finding the div with most p tags if no explicit selector matches
             if (!contentHtml) {
                 let maxP = 0;
                 let bestDiv = null;
                 document.querySelectorAll('div').forEach(div => {
                     const pCount = div.querySelectorAll('p').length;
                     if (pCount > maxP) {
                         maxP = pCount;
                         bestDiv = div;
                     }
                 });
                 if (maxP > 3 && bestDiv) {
                     contentHtml = bestDiv.innerHTML;
                 }
             }
             
             if (contentHtml || displayUrl !== lastExtractedUrl) {
               lastExtractedUrl = displayUrl;
               window.parent.postMessage({
                 type: 'SURF_NAVIGATED',
                 url: window.location.href,
                 actualUrl: displayUrl,
                 title: title,
                 content: contentHtml,
                 fullHtml: document.documentElement.outerHTML
               }, '*');
             }
          }
          
          window.addEventListener('load', () => {
             extractContent();
             // For SPAs that load content asynchronously, retry after a delay
             setTimeout(extractContent, 1000);
             setTimeout(extractContent, 3000);
          });
          
          if (document.readyState === 'complete') {
            extractContent();
          }
          
          // Intercept SPA navigation
          const _pushState = window.history.pushState;
          window.history.pushState = function() {
              _pushState.apply(this, arguments);
              setTimeout(extractContent, 1000); // Give SPA time to render
          };
          
          // Fallback observer for dynamic content loading
          let timeout;
          const observer = new MutationObserver(() => {
              clearTimeout(timeout);
              timeout = setTimeout(extractContent, 800);
          });
          observer.observe(document.body, { childList: true, subtree: true });
        })();
      </script>
    `);

    return new NextResponse($.html(), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        // Disable iframe blocking
        'X-Frame-Options': 'ALLOWALL'
      }
    });

  } catch (err: any) {
    let errorMsg = err.message;
    if (errorMsg.includes('403') || errorMsg.includes('503') || errorMsg.includes('cloudflare')) {
       errorMsg = "Trang web này đang bật tường lửa chống Bot (Cloudflare/DDoS). Server Proxy không thể truy cập trực tiếp được.";
    }
    
    const errorHtml = `
      <div style="font-family: sans-serif; padding: 2rem; text-align: center; color: #ef4444; background: #fee2e2; min-height: 100vh; margin: 0;">
         <h2 style="margin-top: 20vh;">Lỗi truy cập trang web</h2>
         <p>${errorMsg}</p>
         <p style="color: #666; font-size: 0.9rem; margin-top: 1rem;">Mẹo: Hãy thử đổi sang web truyện khác ít bảo mật hơn.</p>
      </div>
    `;
    
    return new NextResponse(errorHtml, { 
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}
