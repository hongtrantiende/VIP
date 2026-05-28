(function() {
  'use strict';
  let sent = false;

  const cleanText = (text) => {
    return (text || '')
      .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
      .replace(/@Bạn đang đọc bản lưu trong hệ thống/g, '')
      .replace(/Bạn đang xem văn bản gốc chưa dịch, có thể kéo xuống cuối trang để chọn bản dịch\./g, '')
      .replace(/Đang tải nội dung chương\.\.\./g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const doExtract = () => {
    // 1. SangTacViet selector
    let box = document.querySelector('#content-container .contentbox');
    if (box) {
      const inner = cleanText(box.innerText);
      let obf = '';
      box.querySelectorAll('i').forEach(el => {
        if ((el.id && el.id.startsWith('ran')) || el.id?.startsWith('exran') || el.hasAttribute('h') || el.hasAttribute('t') || el.hasAttribute('v')) {
          obf += el.textContent;
        }
      });
      obf = cleanText(obf);
      return obf.length > inner.length ? obf : inner;
    }

    // 2. XTruyen selector
    box = document.querySelector('#chapter-reading-content');
    if (box) {
      return cleanText(box.innerText);
    }

    // 3. Generic fallbacks for standard reading containers
    box = document.querySelector('.chapter-content') || 
          document.querySelector('.chapter-c') || 
          document.querySelector('.reading-content') ||
          document.querySelector('.entry-content');
    if (box) {
      return cleanText(box.innerText);
    }

    return '';
  };

  const getTitle = () => {
    const activeBreadcrumb = document.querySelector('.breadcrumb li.active');
    if (activeBreadcrumb) return activeBreadcrumb.textContent.trim();

    const h1 = document.querySelector('h1');
    if (h1) return h1.textContent.trim();

    return (document.title || '').split(/\s+-\s+/)[0]?.trim() || '';
  };

  const sendToBackground = (content) => {
    if (sent || content.length < 1) return;
    sent = true;
    const title = getTitle();
    chrome.runtime.sendMessage({ 
      type: "STV_CONTENT_READY", 
      content, 
      title, 
      url: location.href, 
      length: content.length 
    });
  };

  const clickNextChapter = () => {
    // XTruyen standard next page selector
    const xtruyenNext = document.querySelector('a.next_page');
    if (xtruyenNext) {
      xtruyenNext.click();
      return true;
    }

    const links = document.querySelectorAll('a');
    for (const a of links) {
      const text = (a.textContent || '').trim().toLowerCase();
      if (text.includes('chương sau') || text.includes('chương kế') || text.includes('tiếp') || text === 'next') {
        a.click();
        return true;
      }
    }
    return false;
  };

  const autoExtract = () => {
    if (sent) return;
    const content = doExtract();
    if (content.length > 0) {
      sendToBackground(content);
    }
  };

  const startPolling = () => {
    for (let i = 0; i < 15; i++) {
      setTimeout(autoExtract, 1500 + i * 1000);
    }
  };

  startPolling();

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "EXTRACT_NOW") {
      sent = false;
      const tryExtract = (n) => {
        if (n <= 0) {
          sendResponse({ content: '', length: 0 });
          return;
        }
        const content = doExtract();
        if (content.length > 0) {
          const title = getTitle();
          
          // Detect nextChapterUrl directly from the DOM to report back to the engine
          const nextBtn = document.querySelector('a.next_page') || 
                          document.querySelector('#navnextbot') || 
                          document.querySelector('#navnexttop') || 
                          document.querySelector('a[id*="navnext"]');
          
          let nextChapterUrl = '';
          if (nextBtn && nextBtn.href && nextBtn.href.startsWith('http')) {
            nextChapterUrl = nextBtn.href;
          } else {
            // Fallback to searching for standard links with next chapter semantics
            const links = document.querySelectorAll('a');
            for (const a of links) {
              const text = (a.textContent || '').trim().toLowerCase();
              if ((text.includes('chương sau') || text.includes('chương kế') || text.includes('tiếp') || text === 'next') && a.href && a.href.startsWith('http')) {
                nextChapterUrl = a.href;
                break;
              }
            }
          }

          sendResponse({ 
            content, 
            title, 
            length: content.length, 
            url: location.href,
            nextChapterUrl
          });
        } else {
          setTimeout(() => tryExtract(n - 1), 1000);
        }
      };
      setTimeout(() => tryExtract(12), 1500);
      return true;
    }

    if (msg.type === "GO_NEXT") {
      const ok = clickNextChapter();
      sendResponse({ ok });
      return false;
    }
  });

  chrome.runtime.sendMessage({ type: "STV_PAGE_LOADED", url: location.href });
})();