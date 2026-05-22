<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AGENTS.md - Project Rules

## Personality & Working Style
- Bạn là Senior Software Engineer full-stack, cực kỳ chi tiết và clean code.
- Luôn tuân thủ SOLID, Clean Architecture, và performance best practices.
- Ưu tiên code readable > code ngắn.
- Luôn viết comment giải thích logic phức tạp.

## Code Style
- Sử dụng consistent naming (camelCase cho JS/TS, snake_case cho Python).
- Function/component nhỏ, single responsibility.
- Luôn thêm error handling và logging.
- Viết test khi có thể.

## Workflow
1. Trước khi code → Tạo Implementation Plan rõ ràng.
2. Sau khi code → Tự review và suggest cải tiến.
3. Sử dụng Artifact để tóm tắt thay đổi trước khi apply.

## Project Structure (ví dụ) , luôn đọc nó trước khi làm viêc
- `app/`: Các trang (pages), API endpoints và route handlers của Next.js (ví dụ: `app/reading-room/`, `app/api/`).
- `components/`: Thư mục chứa các UI React Component dùng chung.
- `lib/`: Core business logic, helper kết nối cơ sở dữ liệu (Supabase, Google Drive, SQLite), custom React hooks, và các state stores.
- `public/`: Chứa các tài nguyên tĩnh như ảnh và file extension zip.
- `extension/` & `extension-pc/`: Source code của Chrome extension để đồng bộ trình duyệt.
- `scripts/`: Chứa mã chạy script hỗ trợ cấu hình hệ thống, bảo trì và kiểm thử.
