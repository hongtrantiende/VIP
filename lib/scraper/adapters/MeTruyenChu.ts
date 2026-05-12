import { SiteAdapter } from "../types";

export const MeTruyenChuAdapter: SiteAdapter = {
  name: "MeTruyenChu",
  urlPattern: /metruyenchu\.com\.vn/,

  async getNovelInfo(html, url, onProgress) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    
    // Metadata theo Schema.org (Dựa trên bản JSON cấu hình)
    const coverEl = doc.querySelector("img[itemprop='image']");
    const title = coverEl?.getAttribute("alt")?.trim() || 
                  doc.querySelector('h1.title, h3.title')?.textContent?.trim() || "Unknown Title";
    
    const author = doc.querySelector("[itemprop='author']")?.textContent?.trim() || 
                   doc.querySelector(".info a[href*='/tac-gia/']")?.textContent?.trim() || "Unknown Author";
    
    const cover = coverEl?.getAttribute("src") || "";
    const description = doc.querySelector('.desc-text, [itemprop="description"], #tab-overview .content')?.innerHTML?.trim() || "";

    const chapters: {title: string, url: string, order: number}[] = [];
    const seenUrls = new Set<string>();

    const extractChapters = (d: Document) => {
        // Extract chapters - Sử dụng selector từ bản JSON
        const chapterSelectors = [
          '.list-chapter li a',
          '.chapter-list a',
          '#list-chapter li a'
        ];
        
        let links: Element[] = [];
        for (const selector of chapterSelectors) {
          const found = Array.from(d.querySelectorAll(selector));
          if (found.length > 0) {
            links = found;
            break;
          }
        }

        // Fallback: Tìm các link chương có số thứ tự
        if (links.length === 0) {
          links = Array.from(d.querySelectorAll('a')).filter(a => 
            /chương|chapter|quyển|tập|ch\s*\d+|\d+[\s.:|-]/i.test(a.textContent || "")
          );
        }

        links.forEach(a => {
            const text = a.textContent?.trim() || "";
            const href = a.getAttribute('href');
            if (href) {
                const absoluteUrl = new URL(href, url).toString();
                // prevent obvious nav links
                if (!/^(Trang chủ|Đăng nhập|Đăng ký)/i.test(text) && !seenUrls.has(absoluteUrl)) {
                    seenUrls.add(absoluteUrl);
                    chapters.push({
                        title: text || `Chương ${chapters.length + 1}`,
                        url: absoluteUrl,
                        order: chapters.length
                    });
                }
            }
        });
    };

    extractChapters(doc);
    onProgress?.(chapters.length);

    // ── Pagination via Extension ──
    const mtcPageLinks = Array.from(doc.querySelectorAll('a[onclick^="page("]'));
    if (mtcPageLinks.length > 0) {
      const firstOnClick = mtcPageLinks[0].getAttribute("onclick") || "";
      const match = firstOnClick.match(/page\((\d+)/);
      if (match && match[1]) {
        const storyId = match[1];
        let maxPage = 2;
        mtcPageLinks.forEach(el => {
          const m = (el.getAttribute("onclick") || "").match(/page\(\d+,(\d+)\)/);
          if (m && m[1]) maxPage = Math.max(maxPage, parseInt(m[1]));
        });

        const origin = new URL(url).origin;
        try {
          const { extensionFetch } = await import("../extension-bridge");
          // Fetch up to maxPage
          for (let p = 2; p <= maxPage; p++) {
             const pageUrl = `${origin}/get/listchap/${storyId}?page=${p}`;
             console.log(`[MeTruyenChu] Fetching pagination page ${p}/${maxPage}: ${pageUrl}`);
             const res = await extensionFetch(pageUrl, { timeout: 15000 });
             if (res.html) {
                let actualHtml = res.html;
                try {
                   // if it's rendered as JSON in browser:
                   const bodyText = new DOMParser().parseFromString(res.html, "text/html").body.textContent || "";
                   const parsed = JSON.parse(bodyText);
                   if (parsed.data) actualHtml = parsed.data;
                } catch {}

                const pDoc = new DOMParser().parseFromString(actualHtml, "text/html");
                extractChapters(pDoc);
                onProgress?.(chapters.length);
             }
          }
        } catch (e) {
          console.warn("[MeTruyenChu] Failed to fetch pagination via extension:", e);
        }
      }
    }

    return {
      title,
      author,
      coverImage: cover ? new URL(cover, url).toString() : undefined,
      description,
      chapters
    };
  },

  getChapterContent(html, _url, contentText) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const chapterTitle = doc.querySelector(".chapter-title, h2, h3")?.textContent?.trim() || "";
    
    // Ưu tiên contentText từ Extension (Stealth Mode)
    if (contentText) {
      return { title: chapterTitle, content: contentText };
    }

    // Selector chính xác từ cấu hình: #vungdoc
    const contentNode = doc.querySelector('#vungdoc, .chapter-c, #chapter-c'); 
    if (!contentNode) return { title: chapterTitle, content: "" };

    // --- LÀM SẠCH QUẢNG CÁO VÀ RÁC (Dựa trên mảng cleanup trong JSON) ---
    const junkSelectors = [
      'script', 'noscript', 'style', 'iframe', 
      '.fb-like', '.fb-save', '.fb_iframe_widget',
      '[data-testid]', '.chapter-nav', '.adsbygoogle',
      '.box-notice', 'div[style*="visibility: visible; width: 0px; height: 0px"]'
    ];

    junkSelectors.forEach(selector => {
      contentNode.querySelectorAll(selector).forEach(el => el.remove());
    });

    return {
      title: chapterTitle,
      content: (contentNode as HTMLElement).innerText.trim(),
    };
  }
};
