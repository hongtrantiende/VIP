document.addEventListener("DOMContentLoaded", async () => {
  const proxyEnabled = document.getElementById("proxyEnabled");
  const rotateMode = document.getElementById("rotateMode");
  const proxyInput = document.getElementById("proxyInput");
  const proxyStatus = document.getElementById("proxyStatus");
  const saveBtn = document.getElementById("saveBtn");

  // Load saved settings
  const data = await chrome.storage.local.get(["proxyList", "proxyEnabled", "proxyRotateMode"]);
  proxyEnabled.checked = data.proxyEnabled || false;
  rotateMode.value = data.proxyRotateMode || "per-chapter";
  if (data.proxyList && data.proxyList.length > 0) {
    proxyInput.value = data.proxyList.join("\n");
  }
  updateStatus();

  // Save button
  saveBtn.addEventListener("click", async () => {
    const lines = proxyInput.value.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    await chrome.storage.local.set({
      proxyList: lines,
      proxyEnabled: proxyEnabled.checked,
      proxyRotateMode: rotateMode.value,
    });
    updateStatus();
    saveBtn.textContent = "✅ Đã lưu!";
    setTimeout(() => { saveBtn.textContent = "💾 Lưu Proxy"; }, 1500);
  });

  proxyEnabled.addEventListener("change", async () => {
    await chrome.storage.local.set({ proxyEnabled: proxyEnabled.checked });
    if (!proxyEnabled.checked) {
      try { await chrome.proxy.settings.clear({ scope: "regular" }); } catch {}
    }
    updateStatus();
  });

  rotateMode.addEventListener("change", async () => {
    await chrome.storage.local.set({ proxyRotateMode: rotateMode.value });
  });

  function updateStatus() {
    const lines = proxyInput.value.split("\n").filter(l => l.trim().length > 0);
    if (!proxyEnabled.checked) {
      proxyStatus.textContent = "⏸ Proxy chưa bật";
      proxyStatus.className = "status";
    } else if (lines.length === 0) {
      proxyStatus.textContent = "⚠️ Chưa có proxy nào";
      proxyStatus.className = "status warn";
    } else {
      proxyStatus.textContent = `✅ ${lines.length} proxy sẵn sàng — xoay vòng ${rotateMode.value === "per-chapter" ? "mỗi chương" : rotateMode.value === "per-5" ? "mỗi 5 chương" : "tắt"}`;
      proxyStatus.className = "status ok";
    }
  }
});
