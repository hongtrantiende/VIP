# 🧠 Lessons Learned — Novel Studio

> File này chứa bài học kinh nghiệm tích lũy qua quá trình phát triển dự án.
> AI agent PHẢI đọc file này để tránh lặp lại lỗi cũ.
> Khi phát hiện bài học mới, agent PHẢI tự động thêm vào đây.

---

## Format

```
### [YYYY-MM-DD] [CATEGORY] [SEVERITY] Tiêu đề ngắn

**Context:** Mô tả tình huống
**Problem:** Vấn đề gặp phải
**Root Cause:** Nguyên nhân gốc
**Lesson:** Bài học rút ra
**Action:** Hành động cụ thể để tránh lặp lại
```

Categories: `BUG` | `ARCHITECTURE` | `PERFORMANCE` | `DX` | `DEPLOY` | `AI` | `DATA`
Severity: `🔴 Critical` | `🟡 Important` | `🟢 Minor`

---

## Entries

### [2025-01-XX] ARCHITECTURE 🟡 Important — Dexie transactions cho cascading deletes

**Context:** Xóa novel cần xóa cả chapters, scenes, characters, notes liên quan.
**Problem:** Nếu không dùng transaction, một phần data có thể bị orphaned khi crash giữa chừng.
**Root Cause:** IndexedDB không có FK constraints tự động.
**Lesson:** Luôn dùng `db.transaction('rw', [...tables], async () => { ... })` cho cascading operations.
**Action:** Pattern này đã được document trong `rules.md` section 3 (Database). Mọi delete cascading PHẢI dùng transactions.

---

### [2025-01-XX] ARCHITECTURE 🟡 Important — Zustand stores chỉ cho ephemeral state

**Context:** Ban đầu cân nhắc persist Zustand stores.
**Problem:** Double source of truth giữa Dexie (persistent) và Zustand (nếu cũng persist).
**Root Cause:** Dexie đã handle reactive queries via `useLiveQuery`. Persist Zustand = redundant sync layer.
**Lesson:** Zustand = UI state only (panel open/close, loading indicators, temp selections). Data = Dexie only.
**Action:** Enforced trong `rules.md` section 4. Không bao giờ persist Zustand stores.

---

### [2025-01-XX] PERFORMANCE 🟡 Important — QT engine PHẢI chạy trong Web Worker

**Context:** QT (Quick Translate) engine xử lý bulk Chinese→Vietnamese conversion.
**Problem:** Chạy trên main thread gây freeze UI khi convert chapters dài.
**Root Cause:** Dictionary lookup + regex matching cho text lớn là CPU-intensive.
**Lesson:** Mọi heavy text processing PHẢI đi qua Web Workers.
**Action:** `lib/workers/qt-engine.worker.ts` và `lib/workers/replace-engine.worker.ts` xử lý offline.

---

### [2025-01-XX] AI 🟡 Important — WebGPU provider chỉ dùng cho chat

**Context:** WebGPU (browser-based LLM) được thêm như AI provider option.
**Problem:** WebGPU models quá chậm cho analysis/writing pipelines (cần nhiều calls liên tiếp).
**Root Cause:** Browser WebGPU inference chậm hơn cloud API nhiều lần.
**Lesson:** Guard WebGPU provider — chặn ở `api-inference.ts`, chỉ cho phép trong chat mode.
**Action:** `resolveStep()` return `undefined` cho WebGPU providers trong pipeline context.

---

### [2025-01-XX] DATA 🟡 Important — Schema migration phải tăng version

**Context:** Dexie dùng version-based schema migrations (`lib/db-migrations.ts`).
**Problem:** Nếu quên tăng version, Dexie silently ignore schema changes → data corruption tiềm ẩn.
**Root Cause:** Dexie chỉ chạy migration code khi detect version mới.
**Lesson:** LUÔN tăng version number trong `db-migrations.ts` khi thay đổi schema. Current: v11.
**Action:** Check `db-migrations.ts` trước khi modify schema. Tăng version + viết migration function.

---

### [2025-01-XX] DEPLOY 🟢 Minor — Next.js 16 breaking changes

**Context:** Dự án dùng Next.js 16 — có nhiều breaking changes so với training data.
**Problem:** AI agents thường generate code theo Next.js 14/15 patterns.
**Root Cause:** Training data outdated.
**Lesson:** LUÔN đọc `node_modules/next/dist/docs/` trước khi viết code Next.js. Heed deprecation notices.
**Action:** Warning đã được đặt ở đầu `AGENTS.md`.

---

### [2025-01-XX] DX 🟢 Minor — OpenRouter cần extractJsonMiddleware

**Context:** Gọi structured output (JSON) qua OpenRouter.
**Problem:** Một số model trả JSON wrapped trong markdown code blocks.
**Root Cause:** OpenRouter relay response as-is từ downstream providers.
**Lesson:** Wrap OpenRouter và openai-compatible providers với `extractJsonMiddleware`.
**Action:** Đã implement trong `lib/ai/provider.ts`.

---

---

### [2026-05-29] DATA 🟡 Important — Bypass Font Obfuscation và Lọc Động Chương Trong Scraper

**Context:** Cào nội dung và danh sách chương từ các trang truyện đặc thù như `petfama.com`.
**Problem:** 
1. Lấy nhầm các liên kết tiện ích "Tiếp tục đọc" và "Chương mới nhất" ở đầu trang dẫn đến lặp chương, lộn xộn thứ tự và sai tiêu đề nghiêm trọng.
2. Nội dung chương bị mã hóa chống sao chép bằng thẻ icon trống `<i class="icon-xxx"></i>` kết hợp font-face, làm mất chữ tiếng Trung gốc khi cào.
**Root Cause:**
1. CSS selector chọn liên kết chương quá rộng (`a[href*='/book/chapter/']`) trên toàn trang mà không giới hạn trong container thực tế.
2. Trang web nhúng động các quy tắc CSS dạng `.icon-xxx:before { content: "\Hex" }` để ánh xạ icon rỗng sang ký tự Unicode thực tế.
**Lesson:**
1. Khi lấy danh sách chương, luôn nhắm mục tiêu vào thẻ container cụ thể nhất của danh sách (ví dụ `#chapterlist`, `.chapterlist`) để tránh các nút tiện ích điều hướng đầu/cuối trang.
2. Giải mã Font Obfuscation bằng cách dùng Regex trích xuất ánh xạ ký tự từ khối `<style>` của trang, sau đó sử dụng DOMParser duyệt qua các thẻ icon và thay thế bằng `doc.createTextNode(decodedChar)` để khôi phục nội dung gốc 100%.

### [2026-05-29] BUG 🔴 Critical — Tránh Thẻ H1 Tiện Ích Ẩn Khi Trích Xuất Tiêu Đề Chương

**Context:** Tải nội dung chương trên các trang như `petfama.com`, `wealwomen.com` bị đổi tên toàn bộ thành `"熱門"` và làm biến mất hoặc gộp đè các chương khác.
**Problem:** Thẻ `h1` đầu tiên trên trang nội dung chương thực chất là các nút tìm kiếm popup ẩn của giao diện (chứa chữ `"熱門"`, `"題材"` v.v.), không phải là tiêu đề chương thực tế. Việc lấy sai tiêu đề trùng lặp làm hỏng cơ chế so khớp chương của IndexedDB dẫn đến ghi đè mất dữ liệu.
**Root Cause:** Sử dụng `doc.querySelector("h1, h2...")` làm cho trình duyệt lấy ngay thẻ khớp đầu tiên trong DOM, vốn là thẻ `h1` menu ẩn thay vì tiêu đề chương thực nằm ở `h2` hoặc trong thẻ `<title>`.
**Lesson:** Khi cào tiêu đề chương, cần đặc biệt lưu ý cấu trúc DOM để tránh các thẻ điều hướng ẩn đầu trang. Nên ưu tiên trích xuất từ thẻ `<title>` (thường chứa định dạng chuẩn sạch như `Tên truyện - Chương X`) hoặc thẻ `h2` chuyên biệt để đảm bảo độ tin cậy tuyệt đối.
**Action:** Cập nhật `Petfama.ts` và `Wealwomen.ts` để ưu tiên bóc tách tiêu đề chương từ thẻ `<title>` và thẻ `h2` trước khi fallback về `h1`.


### [2026-05-29] BUG 🟡 Important — Tránh Lấy Nhầm Các Liên Kết Ngoài Danh Mục Truyện (Guihua)

**Context:** Cào danh sách chương trên `guihualianpian.cn` (hoặc các trang tương tự) gặp lỗi quét thừa 3 chương đầu (là các liên kết phân loại, liên kết tác giả, và liên kết chương mới nhất được ghim ở đầu trang).
**Problem:** Danh sách chương xuất hiện các chương giả mạo hoặc không đúng trình tự, gây lỗi cấu trúc tiểu thuyết và trật tự chương trong thư viện.
**Root Cause:** Sử dụng selector `a[href]` quá rộng trên toàn trang mà không nhắm mục tiêu vào các lớp CSS chuyên biệt hoặc thẻ container thực sự chứa danh sách chương, dẫn đến việc lấy nhầm các liên kết tiện ích có chứa chữ số hoặc các từ khóa liên quan ở header/sidebar.
**Lesson:**
1. Luôn ưu tiên sử dụng các lớp CSS chuyên biệt dành riêng cho liên kết chương (ví dụ `.chapter-link` trên `guihualianpian.cn`) thay vì các selector `a` chung chung.
2. Kết hợp sử dụng `link.closest(...)` để chủ động loại bỏ các khối header (`.top-wrap`, `.breadcrumb`), sidebar (`.author`), hay khối chương mới nhất (`.novel-latest`) khi cần fallback duyệt các liên kết diện rộng.
**Action:** Cập nhật `Guihua.ts` sử dụng `.chapter-link` làm selector chính, kết hợp fallback thông minh và lọc `link.closest(...)`.


### [2026-05-29] BUG 🟡 Important — Tự Động Kích Hoạt Nút Tải Chương Lazy-load (STV)

**Context:** Cào chương trên trang `sangtacviet.com` thông qua Chrome Extension.
**Problem:** Một số chương (đặc biệt là chương 2 trở đi khi tự động bấm chuyển chương) trả về nội dung rỗng (`0 chữ`) mặc dù trang web trên trình duyệt đã hiển thị đầy đủ.
**Root Cause:** Sáng Tác Việt hiển thị một bức tường chặn anti-bot / lazy-load với dòng chữ `"Nhấp vào để tải chương..."` (hoặc `"Nhấp vào để tải"`). Trình cào Extension chỉ thụ động chờ nội dung thay đổi mà không thực hiện hành động nhấp chuột, dẫn đến việc trang web không bao giờ tải nội dung truyện thực tế và trả về chuỗi rỗng.
**Lesson:** Khi cào qua Extension trên các trang có cơ chế lazy-load bằng nút bấm chặn, cần bổ sung logic tự động phát hiện văn bản gợi ý của nút chặn (ví dụ `"Nhấp vào để tải"`) và thực hiện sự kiện `.click()` tự động ngay trong content script để kích hoạt quá trình tải nội dung thực tế trước khi trích xuất.
**Action:** Cập nhật `content.js` của Extension để kiểm tra `innerText` của container, tự động click nút `"Nhấp vào để tải"` nếu phát hiện và đóng gói lại các extension ZIP.


### [2026-05-29] BUG 🔴 Critical — Sửa Lỗi Truyền Sai Tham Số Khiến Trình Cào Bị Trễ 30 Giây (STV)

**Context:** Tải danh sách chương qua Chrome Extension trên trang Sáng Tác Việt (`sangtacviet.com`).
**Problem:** Trình cào lấy văn bản không đồng bộ, lấy quá sớm trước khi trang chuyển chương, hoặc bị đứt quãng khiến dữ liệu tải bị rỗng (0 chữ).
**Root Cause:**
1. Phương thức `waitForTabLoad` yêu cầu 3 tham số: `waitForTabLoad(tabId, targetUrl, timeoutMs)`. Tuy nhiên, trong `stv-handler.js`, mã nguồn lại gọi sai: `await waitForTabLoad(tabId, 15000)`.
2. Do truyền sai vị trí (số `15000` bị gán vào tham số `targetUrl` của hàm), điều kiện kiểm tra URL trùng khớp của Extension luôn trả về `false`. Điều này ép buộc hàm `waitForTabLoad` phải chạy hết toàn bộ thời gian chờ timeout là **30 giây** cho mỗi chương trước khi nạp tiếp. 
3. Thời gian trễ 30 giây này khiến luồng chạy của Extension và luồng đồng bộ trạng thái của ứng dụng bị mất đồng bộ hoàn toàn (out of sync).
**Lesson:** Khi định nghĩa và gọi các hàm tiện ích dùng chung của Extension, phải luôn đối chiếu chính xác số lượng và kiểu dữ liệu của các tham số. Tránh gọi các hàm đợi tải trang bằng các giá trị thô/hardcode mà không chỉ định URL đích để tránh kích hoạt timeout vô lý làm treo luồng.
**Action:** Sửa đổi lệnh gọi thành `await waitForTabLoad(tabId, payload.chapterUrl, 15000);` ở cả hai file `stv-handler.js` và đóng gói lại tiện ích.

---


### [2026-05-29] AI 🔴 Critical — Tự Động Phân Giải Tên Mô Hình AI từ UUID Tránh Lỗi "Model not found"

**Context:** Sử dụng tính năng "Dịch tên truyện" hoặc "Phân loại hàng loạt (Batch Classify)" với các nhà cung cấp AI tùy chỉnh (như GGChan, Bắc Cực Tinh).
**Problem:** Trình duyệt báo lỗi màu đỏ `"Model not found"` khi gửi yêu cầu dịch hoặc phân loại truyện.
**Root Cause:**
1. Trong IndexedDB, danh sách các mô hình AI (`db.aiModels`) được quản lý bằng các hàng ghi nhận với khóa chính `id` là các **UUID tự sinh** (ví dụ: `crypto.randomUUID()`), trong khi tên mã mô hình thực tế của nhà cung cấp được lưu ở cột `modelId` (ví dụ: `gcli-gemini-2.5-flash`).
2. Giao diện dropdown chọn model AI liên kết trực tiếp `value={model.id}` (UUID), nên khi nhấn "Dịch", model ID gửi đi là UUID này.
3. Hàm `resolveStep()` nhận vào cấu hình dạng `{ providerId, modelId }` nhưng lại gửi thẳng UUID này cho Vercel AI SDK làm tên mô hình, khiến các AI Provider trả về lỗi 404 `"Model not found"`.
**Lesson:** Khi thiết kế cơ chế phân giải mô hình (`resolveStep`), luôn phải dự phòng trường hợp `modelId` được truyền vào từ giao diện là UUID khóa chính của DB. Cần chủ động tra cứu ngược IndexedDB để lấy ra `modelId` thực tế của nhà cung cấp trước khi nạp vào AI SDK.
**Action:** Cập nhật `lib/ai/resolve-step.ts` để tự động tra cứu IndexedDB từ `cfg.modelId` và lấy `aiModel.modelId` thực tế nếu tìm thấy.

### [2026-05-30] PERFORMANCE 🟡 Important — Thiết Lập Timeout Chủ Động Và Tránh Vòng Lặp Retry Chồng Chất Khi Dịch Hàng Loạt

**Context:** Dịch hàng loạt (Bulk Translate) nhiều chương truyện bằng các Custom AI Provider (như GGChan, Bắc Cực Tinh) thường bị treo ngầm ở trạng thái "Đang dịch".
**Problem:** 
1. Cuộc gọi API thông qua proxy `/api/ai-proxy` bị treo vô hạn cho đến khi Cloudflare tự động ngắt sau 2 phút với mã 524.
2. Cơ chế thử lại (retry) chồng chất 2 tầng (tối đa lên đến 28 lần: 7 lần trong * 4 lần ngoài) làm luồng dịch bị kẹt cứng hàng chục phút mà không báo lỗi ra UI.
3. Người dùng đặt số luồng chạy song song quá cao (mặc định ban đầu là 3) làm phát sinh lỗi 429 Rate Limit liên tục.
**Root Cause:**
1. Thiếu cấu hình timeout chủ động cho hàm `fetch` trong proxy API.
2. Thiết kế logic retry quá dày đặc và thiếu phân loại lỗi (tất cả các lỗi đều chờ 10s và thử lại nhiều lần vô lý).
**Lesson:**
1. Luôn thiết lập timeout chủ động (ví dụ 60 giây dùng `AbortController`) cho các cuộc gọi API mạng bên ngoài để phát hiện treo kết nối nhanh chóng.
2. Phân loại lỗi thông minh khi retry: Giảm số lần thử lại tối đa xuống mức an toàn (tối đa 3 lần thử), phân tách độ trễ delay (15s cho lỗi 429 Rate Limit để hệ thống AI hồi phục, và chỉ 5s cho lỗi kết nối thường). Loại bỏ các vòng lặp retry chồng chất trùng lặp giữa các tầng.
3. Giảm số luồng song song mặc định xuống 1 đối với các tác vụ AI nặng nề trên Custom Provider để tối đa hóa sự ổn định và tránh lỗi 429.
**Action:** Cập nhật `route.ts` (thêm timeout 60s), `bulk-translate.ts` (tối ưu hóa 2 tầng retry, phân loại delayMs), và `bulk-translate-dialog.tsx` (concurrency mặc định = 1, thêm hướng dẫn UI).

### [2026-05-30] AI 🔴 Critical — Tự Động Phát Hiện Và Dịch Lại Khi AI Trả Về Thiếu Ký Tự (Truncated) Do Silent NSFW Block

**Context:** Dịch các chương truyện dài bằng các AI Provider có context window lớn (1 triệu tokens hoặc cao hơn). Tách phân đoạn không cần thiết vì làm mất thời gian và tăng số lượng API calls.
**Problem:** AI đôi khi trả về bản dịch bị thiếu hụt nghiêm trọng một cách ngẫu nhiên (ví dụ: chương 5000 ký tự Trung chỉ dịch ra 400 ký tự Việt) do lỗi mạng, nghẽn dòng hoặc safety block tạm thời.
**Root Cause:**
1. Mô hình AI thỉnh thoảng ngừng tạo kết quả sớm hơn dự kiến do lỗi ngắt ngẫu nhiên từ server. So sánh trực tiếp độ dài ký tự giữa tiếng Trung (gốc) và tiếng Việt (dịch) là không chính xác do tiếng Việt có mật độ ký tự dài hơn tiếng Trung khoảng 1.3 - 1.5 lần, dẫn tới việc bỏ sót lỗi cụt chương ở các chương ngắn và trung bình.
2. **Đặc biệt, sự thiếu hụt này phần lớn không phải là lỗi API thông thường, mà do chương chứa yếu tố nhạy cảm/cảnh nóng khiến AI tự động ngắt tạo chữ sớm (soft block) mà không hề ném lỗi an toàn (safety) ra API.** Nếu chỉ thực hiện retry ngoài với prompt gốc, AI vẫn sẽ tiếp tục dịch thiếu do vấp phải rào cản NSFW cũ.
**Lesson:**
1. Giữ nguyên việc dịch cả chương nguyên khối (liền mạch 100%) để tận dụng tối đa context window khổng lồ của các mô hình hiện đại mà không cần chia nhỏ phân đoạn làm tăng API calls.
2. Tích hợp cơ chế **Kiểm định độ dài bản dịch (Length Validation Check)** thông minh: Quy đổi số ký tự gốc sang độ dài tiếng Việt kỳ vọng tối thiểu (bằng `Math.round(joinedContent.length * 1.3)`).
3. Bản dịch bị coi là hụt nghiêm trọng nếu:
   - Thiếu hụt quá 2000 ký tự so với độ dài tiếng Việt kỳ vọng.
   - Đối với chương ngắn, độ dài bản dịch thậm chí ngắn hơn cả bản gốc tiếng Trung (vô lý vì tiếng Việt luôn dài hơn), hoặc bản dịch ngắn hơn 75% độ dài bản gốc tiếng Trung.
4. **Xử lý NSFW chủ động trong vòng lặp**: Thực hiện kiểm định độ hụt ký tự ngay bên trong vòng lặp chính của chương. Nếu bản dịch bị hụt nghiêm trọng, hệ thống tự động chèn thêm prompt NSFW R-18+ bổ sung (`NSFW_INSTRUCTION`) vào prompt hệ thống và thực hiện dịch lại tại chỗ, giúp AI vượt qua bộ lọc an toàn và dịch đầy đủ nội dung. Nếu đã thử NSFW mà vẫn hụt chữ, mới ném lỗi ra ngoài cho vòng lặp retry ngoài xử lý.
**Action:** Cập nhật `bulk-translate.ts` và `qt-ai-translate.ts` để kiểm tra độ hụt ký tự ngay trong vòng lặp dịch, tự động chèn prompt NSFW R-18+ và dịch lại tại chỗ khi phát hiện thiếu chữ.

---

### [2026-05-30] ARCHITECTURE 🟡 Important — Kiến Trúc Dịch Thuật Thế Hệ 3: Định Vị XML Nội Tuyến & Phân Tích Hội Thoại Song Song

**Context:** Đảm bảo tính nhất quán từ điển 100% và kiểm soát đại từ xưng hô động chuẩn xác cho các chương tiểu thuyết dài.
**Problem:** Nếu chỉ gửi từ điển rời ở đầu prompt, AI dễ bị trôi bối cảnh, bỏ quên hoặc dịch nhầm xưng hô nhân vật khi dịch văn bản dung lượng lớn.
**Root Cause:** Attention mechanism của LLM bị phân tán ở các chương dài, và các mối quan hệ xưng hô đòi hỏi sự phân tích bối cảnh thoại phức tạp mà code backend thông thường không thể tự động hóa 100% bằng regex.
**Lesson:** Kết hợp thuật toán Backend khớp chuỗi tham lam (Greedy Matching) không chồng lấn để chèn các thẻ `<name vi="...">` và `<item vi="...">` cứng, sau đó dùng Model 2 (Gemini Flash) phân tích bối cảnh thoại để bao bọc thẻ `<dialogue speaker="..." listener="..." rule="...">`. Cuối cùng Model 1 Pro chỉ cần dịch và tuân thủ thẻ, loại bỏ XML khi trả kết quả sạch.
**Action:** Tạo module `semantic-translate.ts` thực thi quy trình 3 giai đoạn này và tích hợp vào UI `translate-tab-panel.tsx` với chế độ "Dịch Semantic (Gen 3)".

---

### [2026-05-30] BUG 🔴 Critical — Khắc Phục Lỗi Service Worker Status Code 3 Khi Cài Đặt Extension Trên Android (Kiwi)

**Context:** Người dùng cài đặt tiện ích mở rộng (Extension) của Novel Studio trên trình duyệt Android (như Kiwi Browser) gặp lỗi đăng ký Service Worker thất bại với mã lỗi `Service worker registration failed. Status code: 3` (hoặc `An unknown error occurred when fetching the script`).
**Problem:** Trình duyệt Android không thể đăng ký được service worker và tiện ích hoàn toàn không hoạt động, trong khi trên máy tính (PC) vẫn chạy bình thường.
**Root Cause:**
1. Tiện ích sử dụng kiến trúc mô-đun ES và khai báo `"type": "module"` trong khóa `"background"` của `manifest.json`.
2. Trình duyệt Chromium trên thiết bị di động (Android Kiwi/Yandex) chưa hỗ trợ đầy đủ hoặc gặp lỗi khi phân giải ES Modules (`type: module`) trong môi trường Service Worker ngầm, dẫn đến việc không thể nạp tệp `background.js` trực tiếp.
**Lesson:**
1. Không khai báo `"type": "module"` cho Service Worker trong `manifest.json` của Extension nếu muốn hỗ trợ tối đa các thiết bị di động Android.
2. Thay vì nạp động trực tiếp qua ES module imports, sử dụng công cụ đóng gói siêu tốc `esbuild` để biên dịch toàn bộ cấu trúc mô-đun thành một tệp `background.js` duy nhất theo chuẩn Classic Script phẳng (không chứa từ khóa `import` hoặc `export` ở phạm vi toàn cục).
**Action:**
1. Đổi tên tệp nguồn thành `background.src.js`, loại bỏ `"type": "module"` khỏi `manifest.json` ở cả phiên bản PC và Android.
2. Thêm kịch bản tự động `build:extension` thông qua `npx esbuild` vào `package.json` và tích hợp thẳng trước các lệnh nén `zip:android`, `zip:pc`, và `zip:all` để đảm bảo tệp phân phối luôn được đóng gói đầy đủ và đồng bộ.

---

### [2026-05-30] AI & BUG 🔴 Critical — Khắc phục Lỗi Signal Aborted Khi Timeout Dịch Thuật và Lưu Trạng Trạng Thái Quét Từ Điển Vĩnh Viễn

**Context:** Dịch các chương nhạy cảm (18+) hoặc chương siêu dài qua proxy AI thường gặp lỗi crash giao diện báo đỏ `AbortError: signal is aborted without reason` và bị quét lại từ điển từ đầu mỗi khi nạp lại trang (F5).
**Problem:**
1. Thời gian timeout 60s hoặc 75s trước đây bị ngắn đối với các chương dài hoặc proxy nghẽn. Khi timeout phụ kích hoạt abort, khối catch rethrow bừa bãi làm crash luồng dịch.
2. Trạng thái quét từ điển (Model 2) chỉ lưu tạm trên RAM Set, khi F5 lại bị mất sạch, ép buộc hệ thống phải quét lại từ đầu gây tốn thời gian và token.
**Root Cause:**
1. Khối `catch` so khớp lỗi `AbortError` chung chung mà không kiểm tra xem có phải do người dùng chủ động bấm Hủy dịch (`signal?.aborted === true`) hay không.
2. Kích thước chunk tối đa của chế độ "Full" quá lớn (25000 ký tự với Semantic Gen 3 chứa đầy thẻ XML phình to) gây quá tải cho AI Pro.
3. IndexedDB thiếu cơ chế lưu trữ cờ đã quét từ điển cho Chapter.
**Lesson:**
1. Chỉ dừng luồng khi người dùng thực sự bấm Hủy (`signal?.aborted`). Các timeout phụ abort phải được bọc lại thành lỗi rõ nghĩa (`Thời gian phản hồi vượt quá 100 giây`) và xử lý như lỗi thường để thử lại NSFW tại chỗ.
2. Tối ưu kích thước chunk tối đa của chế độ dịch nguyên chương (Full) xuống mức **8000 ký tự** (bao gồm cả XML). Đảm bảo chương thường dịch trọn vẹn 1 chunk, còn chương siêu dài tự động chia nhỏ để AI xử lý cực nhanh, chống timeout 100%.
3. Lưu cờ `dictionaryScanned?: boolean;` vào IndexedDB vĩnh viễn cho Chapter để khi F5 hoặc chạy lại, hệ thống skip ngay lập tức trong 1ms.
**Action:** Cập nhật `semantic-translate.ts`, `qt-ai-translate.ts`, `comprehensive-translate.ts`, `bulk-translate.ts` để tăng timeout lên 100s, tối ưu chunk size 8000, và persist cờ `dictionaryScanned` vào IndexedDB.

---

### [2026-05-30] ARCHITECTURE 🟡 Important — Cơ Chế Quét Từ Điển Chạy Ngầm (Lookahead Worker) Và Đồng Bộ Hệ Chỉ Số Tuyệt Đối (Absolute Indexing)

**Context:** Bộ quét từ điển (Model 2) được thiết kế để quét và thêm từ mới trước khi luồng dịch chính (Model 1) chạy, giúp AI dịch mượt mà hơn.
**Problem:** 
1. Tab Dịch Semantic Gen 3 trước đây sử dụng cơ chế quét tuần tự (inline sequential scanner), khiến luồng chính bị nghẽn chờ đợi Model 2 và làm mất tính năng quét đi trước (lookahead), từ điển luôn dừng bằng chương dịch.
2. Tab Comprehensive và Quick Translate gặp lỗi lệch hệ chỉ số so khớp block lookahead khi người dùng bắt đầu dịch từ chương ở giữa truyện (ví dụ Chương 11, index 10). `scanIdx` chạy trên `currentQueue` (từ 0 đến 9) so sánh với `currentTranslateIdx` (index 10 trong `allChapters`) khiến điều kiện chặn `scanIdx >= currentTranslateIdx + 3` luôn luôn false. AI 2 quét một mạch đến hết truyện không phanh, gây lãng phí lớn token.
**Root Cause:**
1. Thiếu cấu trúc background worker song song trong orchestrator của Gen 3.
2. So sánh lệch hệ chỉ số giữa tương đối (trong hàng đợi dịch) và tuyệt đối (trong toàn bộ novel).
**Lesson:**
1. Mọi pha quét từ điển / bối cảnh tiền xử lý (Model 2) PHẢI được thiết kế dưới dạng background worker chạy ngầm song song với luồng dịch chính (AI 1) để tận dụng tối đa sức mạnh đa luồng và tối ưu hóa thời gian chờ của người dùng.
2. Khi thực hiện các cơ chế giới hạn lookahead chặn trước (ví dụ chặn trước tối đa 3 chương), luôn quy đổi chỉ số của chương đang quét về chỉ số tuyệt đối trong toàn bộ novel (`absoluteScanIdx` qua `findIndex` trên `allChapters`) để đảm bảo so sánh đồng nhất hệ chỉ số trong mọi trường hợp (dịch từ đầu hay giữa truyện).
**Action:** Cập nhật `semantic-translate.ts` sang mô hình quét ngầm `runDictWorker`, đồng thời đồng bộ hóa so khớp block bằng chỉ số tuyệt đối `absoluteScanIdx` trong cả 3 tệp `semantic-translate.ts`, `qt-ai-translate.ts` và `comprehensive-translate.ts`.

---

<!-- 
  📝 TEMPLATE cho entry mới — copy paste khi thêm:
  
  ### [YYYY-MM-DD] CATEGORY SEVERITY — Title
  
  **Context:** 
  **Problem:** 
  **Root Cause:** 
  **Lesson:** 
  **Action:** 
  -->


