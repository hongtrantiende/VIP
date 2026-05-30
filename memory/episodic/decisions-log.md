# 📋 Decisions Log — Novel Studio

> File này ghi lại các quyết định kiến trúc quan trọng (ADR-lite).
> Giúp AI agent hiểu **TẠI SAO** dự án được thiết kế như hiện tại.
> Khi có quyết định mới, agent PHẢI thêm entry vào đây.

---

## Format

```
### ADR-XXX: Tiêu đề quyết định

**Date:** YYYY-MM-DD
**Status:** Accepted | Superseded | Deprecated
**Context:** Bối cảnh tại sao cần quyết định
**Options Considered:**
1. Option A — Pros / Cons
2. Option B — Pros / Cons
**Decision:** Chọn option nào và tại sao
**Consequences:** Hệ quả của quyết định
```

---

## Entries

### ADR-001: Chọn IndexedDB (Dexie) thay vì SQLite/Backend DB

**Date:** 2024-XX-XX
**Status:** Accepted

**Context:** Novel Studio cần lưu trữ lớn (novels, chapters, dictionaries) mà vẫn hoạt động offline-first. Cần reactive queries cho UI.

**Options Considered:**
1. **SQLite (via sql.js/wa-sqlite)** — SQL powerful, nhưng cần WASM, không reactive natively, complex setup.
2. **IndexedDB trực tiếp** — Low-level, verbose API, khó maintain.
3. **Dexie (IndexedDB wrapper)** — Clean API, built-in reactive hooks (`useLiveQuery`), schema versioning, transactions.
4. **Backend DB (Supabase/PlanetScale)** — Cần server, không offline-first, latency.

**Decision:** Chọn **Dexie 4** vì:
- Zero-server architecture (local-first)
- `useLiveQuery` cho reactive UI miễn phí
- Schema versioning tích hợp
- Transaction support cho cascading operations
- Cộng đồng lớn, well-maintained

**Consequences:**
- ✅ Offline-first hoàn toàn
- ✅ Zero hosting cost cho data layer
- ⚠️ Cần tự handle backup/sync (→ `lib/db-io.ts`)
- ⚠️ Không có server-side query optimization
- ⚠️ Data bị isolate per-browser (→ giải quyết bằng export/import + Google Drive sync)

---

### ADR-002: Multi-provider AI architecture với Vercel AI SDK

**Date:** 2024-XX-XX
**Status:** Accepted

**Context:** Users cần tự chọn AI provider (budget, quality, privacy khác nhau). Cần support OpenAI, Anthropic, Google, Groq, local models.

**Options Considered:**
1. **Hardcode 1 provider** — Simple nhưng lock-in.
2. **Custom abstraction layer** — Flexible nhưng maintenance burden.
3. **Vercel AI SDK** — Unified interface, official SDKs cho mỗi provider, streaming built-in.

**Decision:** Chọn **Vercel AI SDK v6** với dispatch pattern:
- `getModel()` maps `ProviderType` enum → correct `@ai-sdk/*` SDK
- `resolveStep()` cho pipeline inference
- `extractJsonMiddleware` cho unreliable providers

**Consequences:**
- ✅ Thêm provider mới = thêm 1 case trong switch
- ✅ Streaming, tool calling, structured output out-of-the-box
- ⚠️ Phụ thuộc vào Vercel AI SDK version compatibility
- ⚠️ WebGPU provider cần special handling (chat-only)

---

### ADR-003: Web Workers cho QT Engine thay vì Main Thread

**Date:** 2024-XX-XX
**Status:** Accepted

**Context:** QT (Quick Translate) engine cần xử lý dictionary lookup trên text lớn (10K+ ký tự). Regex matching + name replacement là CPU-intensive.

**Options Considered:**
1. **Main thread + chunking** — Simple nhưng vẫn stutter UI.
2. **Web Worker** — Non-blocking, true background processing.
3. **WASM** — Fast nhưng complex build pipeline.

**Decision:** Chọn **Web Workers** (`lib/workers/`):
- `qt-engine.worker.ts` — Dictionary-based conversion
- `replace-engine.worker.ts` — Regex/literal find-replace
- Access qua hooks: `use-qt-engine.ts`, `use-replace-engine.ts`

**Consequences:**
- ✅ UI luôn responsive kể cả khi convert chapter dài
- ✅ Có thể cancel/restart processing
- ⚠️ Serialization overhead (postMessage)
- ⚠️ Không access DOM, Dexie trực tiếp từ Worker

---

### ADR-004: 6-role Writing Pipeline thay vì single-prompt generation

**Date:** 2024-XX-XX
**Status:** Accepted

**Context:** AI-assisted writing cần output chất lượng cao, consistent với plot, characters, và style.

**Options Considered:**
1. **Single prompt** — Simple nhưng output kém quality, hard to control.
2. **2-step (outline → write)** — Better nhưng thiếu review/refinement.
3. **Multi-agent pipeline** — Complex nhưng output quality cao nhất.

**Decision:** Chọn **6-role pipeline** (`lib/writing/`):
1. **Context Agent** — Thu thập context từ DB
2. **Direction Agent** — Xác định hướng viết
3. **Outline Agent** — Tạo outline chi tiết
4. **Writer Agent** — Viết nội dung
5. **Review Agent** — Review & suggest improvements
6. **Rewrite Agent** — Rewrite dựa trên review

**Consequences:**
- ✅ Output quality cao, consistent
- ✅ Mỗi step có thể dùng model khác nhau (tiết kiệm cost)
- ✅ "Hands-free" mode cho full automation
- ⚠️ Tốn nhiều API calls hơn
- ⚠️ Pipeline config phức tạp (→ WritingSettings per-novel)

---

### ADR-005: Browser Extension Bridge cho Web Scraper CORS bypass

**Date:** 2024-XX-XX
**Status:** Accepted

**Context:** Web scraper cần fetch content từ novel sites khác domain. Browser CORS policy chặn cross-origin requests.

**Options Considered:**
1. **Server proxy** — Works nhưng cần backend, hosting cost.
2. **Browser extension** — Can bypass CORS natively.
3. **CORS proxy services** — Unreliable, rate-limited.

**Decision:** Chọn **Browser Extension** (`extension/`, `extension-pc/`):
- Extension có full CORS bypass via `webRequest` API
- Giao tiếp qua `extension-bridge.ts` (message passing)
- 2 variants: Android (Kiwi browser) + PC

**Consequences:**
- ✅ Zero server cost
- ✅ User controls their own scraping
- ⚠️ User phải cài extension
- ⚠️ Extension needs updating khi Manifest V3 changes

---

### ADR-006: Classic Script Bundling via esbuild cho Browser Extension

**Date:** 2026-05-30
**Status:** Accepted

**Context:** Tiện ích mở rộng (Browser Extension) cần hỗ trợ cả môi trường máy tính (PC Chrome) và môi trường di động Android (trình duyệt Kiwi Browser/Yandex). Các trình duyệt Chromium trên di động chưa hỗ trợ ES Modules (`"type": "module"`) trong Service Worker ngầm và báo lỗi `Status code: 3` khi nạp.

**Options Considered:**
1. **Duy trì mã nguồn phẳng phi mô-đun (Classic Script)** — Viết tất cả code trong một file duy nhất hoặc tự quản lý biến toàn cục. Rất khó phát triển và bảo trì.
2. **Khai báo nhiều tệp trong manifest** — Trình duyệt di động vẫn gặp khó khăn khi liên kết và truyền nhận trạng thái.
3. **Đóng gói ES Modules sang Classic Script bằng esbuild** — Cho phép giữ nguyên lập trình mô-đun sạch sẽ khi phát triển (`background.src.js`), đồng thời tự động đóng gói sang Classic Script phẳng (`background.js`) để chạy ổn định trên mọi nền tảng di động và máy tính.

**Decision:** Chọn **đóng gói ES Modules sang Classic Script phẳng bằng esbuild**:
- Sử dụng `npx esbuild` để biên dịch tức thời trước khi nén zip hoặc cài đặt.
- Loại bỏ khai báo `"type": "module"` trong `manifest.json`.
- Tích hợp tự động vào các tác vụ build và zip trong `package.json`.

**Consequences:**
- ✅ Tiện ích tương thích 100% trên cả PC và thiết bị Android (Kiwi Browser).
- ✅ Giữ vững kiến trúc chia nhỏ mô-đun sạch sẽ khi lập trình.
- ✅ Tốc độ biên dịch siêu tốc (chỉ 5-10ms) không làm trễ quá trình đóng gói.
- ⚠️ Cần thực hiện biên dịch tệp nguồn trước khi nén phân phối (đã được tự động hóa qua `npm run build:extension`).

---

<!-- 
  📝 TEMPLATE — Copy khi thêm ADR mới:
  
  ### ADR-XXX: Title
  
  **Date:** YYYY-MM-DD
  **Status:** Accepted | Superseded | Deprecated
  **Context:** 
  **Options Considered:**
  1. 
  2. 
  **Decision:** 
  **Consequences:**
-->
