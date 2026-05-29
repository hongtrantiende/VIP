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
    const box = document.querySelector('#content-container .contentbox');
    if (!box) return '';
    
    const inner = cleanText(box.innerText);
    
    // Auto-click "Click to download chapter" anti-bot wall if present
    if (inner.includes("Nhấp vào để tải") || inner.includes("Nhấp vào để tải chương")) {
      const divs = Array.from(box.querySelectorAll("*")); // Match center tag or any element
      divs.push(box); // Include container itself
      const btn = divs.find(el => {
        const text = el.textContent?.trim() || "";
        return text.includes("Nhấp vào để tải");
      });
      if (btn) {
        console.log("[STV Extension] Anti-bot wall detected. Clicking button:", btn.tagName);
        btn.click();
      }
      return ''; // Keep as empty so the scraper continues waiting
    }
    
    let obf = '';
    box.querySelectorAll('i').forEach(el => {
      if ((el.id && el.id.startsWith('ran')) || el.id?.startsWith('exran') || el.hasAttribute('h') || el.hasAttribute('t') || el.hasAttribute('v')) {
        obf += el.textContent;
      }
    });
    
    obf = cleanText(obf);
    return obf.length > inner.length ? obf : inner;
  };

  const sendToBackground = (content) => {
    if (sent || content.length < 1) return;
    sent = true;
    const title = (document.title || '').split(/\s+-\s+/)[0]?.trim() || '';
    chrome.runtime.sendMessage({
      type: "STV_CONTENT_READY",
      content,
      title,
      url: location.href,
      length: content.length
    });
  };

  const clickNextChapter = () => {
    const links = document.querySelectorAll('a');
    for (const a of links) {
      const text = (a.textContent || '').trim();
      if (text.includes('Chương sau')) {
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
          const title = (document.title || '').split(/\s+-\s+/)[0]?.trim() || '';
          sendResponse({
            content,
            title,
            length: content.length,
            url: location.href
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