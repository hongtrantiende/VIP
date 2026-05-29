/**
 * stv-stealth.js — Content script injected at document_start for sangtacviet.* tabs.
 *
 * Runs BEFORE any page script. Spoofs visibility state so STV's JS-based
 * text de-obfuscation runs unconditionally, even when the tab is in a
 * minimized or background window.
 */

// 1. Fake document.hidden / visibilityState so STV thinks the page is visible
Object.defineProperty(document, "hidden", { get: () => false, configurable: true });
Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });

// 2. Block visibilitychange events so STV can't detect focus loss mid-render
document.addEventListener("visibilitychange", (e) => {
  e.stopImmediatePropagation();
  e.preventDefault();
}, true);

// 3. Fake document.hasFocus()
Document.prototype.hasFocus = () => true;

// 4. Fake window.focus events (belt-and-suspenders)
window.addEventListener("blur", (e) => {
  e.stopImmediatePropagation();
}, true);

console.log("[STV Stealth] Visibility spoof injected at document_start.");
