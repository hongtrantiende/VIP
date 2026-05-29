# rules.md — Coding Standards & Conventions

> Đây là bộ quy tắc coding dành riêng cho dự án Novel Studio.
> Mọi AI agent PHẢI đọc file này trước khi viết code.
> Xem thêm: [`AGENTS.md`](./AGENTS.md) cho project overview.

---

## 1. TypeScript & General

### Naming Conventions
```
camelCase       → variables, functions, hooks, props
PascalCase      → components, types, interfaces, enums
SCREAMING_SNAKE → constants, env vars
kebab-case      → file names, CSS classes, route segments
```

### Strict Mode
- `tsconfig.json` bật strict mode. **KHÔNG BAO GIỜ** dùng `any` trừ khi có lý do rõ ràng (phải comment giải thích).
- Prefer `unknown` over `any` khi type không xác định.
- Luôn dùng explicit return types cho exported functions.

### Imports
- Dùng path alias `@/*` (maps to project root).
- shadcn components: `@/components/ui/*`.
- Sắp xếp imports: React → External libs → Internal modules → Types → Styles.

---

## 2. React Components

### Patterns
```tsx
// ✅ Đúng: Function component với explicit typing
interface ChapterListProps {
  novelId: string;
  onSelect?: (chapterId: string) => void;
}

export function ChapterList({ novelId, onSelect }: ChapterListProps) {
  // Hook calls first
  const chapters = useLiveQuery(/* ... */);
  const [isLoading, setIsLoading] = useState(false);

  // Event handlers
  const handleSelect = useCallback((id: string) => {
    onSelect?.(id);
  }, [onSelect]);

  // Early returns for loading/error states
  if (!chapters) return <Skeleton />;

  // Render
  return (/* ... */);
}
```

### Rules
- **Single Responsibility**: Mỗi component chỉ làm 1 việc.
- **Composition over Inheritance**: Dùng children, render props, hoặc hooks.
- **No inline styles**: Dùng Tailwind classes hoặc CSS modules.
- **Memoize khi cần**: `useMemo` / `useCallback` cho expensive computations hoặc stable references.
- **Keys**: Luôn dùng unique, stable keys (không dùng index làm key trừ static lists).

### Server vs Client Components
- **Default = Server Component** (Next.js App Router).
- Chỉ thêm `"use client"` khi component cần: hooks, event handlers, browser APIs, Zustand stores.
- Đặt `"use client"` boundary càng sâu càng tốt (leaf components).

---

## 3. Database (Dexie / IndexedDB)

### Schema
- Schema definitions trong `lib/db.ts`, migrations trong `lib/db-migrations.ts`.
- Current version: **v11**. Luôn tăng version khi thay đổi schema.
- Mỗi entity type PHẢI có `id`, `createdAt`, `updatedAt`.

### Hooks Pattern
Mọi data access qua hooks trong `lib/hooks/use-*.ts`:
```tsx
// ✅ Reads — dùng useLiveQuery (reactive)
const novels = useLiveQuery(() => db.novels.toArray());

// ✅ Mutations — plain async functions
async function createNovel(data: Partial<Novel>) {
  const id = crypto.randomUUID();
  const now = new Date();
  await db.novels.add({
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

// ✅ Cascading deletes — dùng Dexie transactions
async function deleteNovel(id: string) {
  await db.transaction('rw', [db.novels, db.chapters, db.scenes], async () => {
    await db.scenes.where('novelId').equals(id).delete();
    await db.chapters.where('novelId').equals(id).delete();
    await db.novels.delete(id);
  });
}
```

### ID Generation
- Luôn dùng `crypto.randomUUID()` cho entity IDs.
- Singletons dùng fixed IDs (e.g., `id: "default"` cho ChatSettings, TTSSettings).

---

## 4. State Management (Zustand)

### Conventions
- Stores trong `lib/stores/` — **ephemeral UI state ONLY**, không bao giờ persisted data.
- Mỗi store = 1 file, export 1 `useXxxStore` hook.
- Naming: `use-xxx-store.ts` → `useXxxStore`.

```tsx
// ✅ Pattern chuẩn
interface ChatPanelState {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useChatPanelStore = create<ChatPanelState>((set) => ({
  isOpen: false,
  setIsOpen: (open) => set({ isOpen: open }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
}));
```

---

## 5. AI Integration

### Provider Pattern
- `lib/ai/provider.ts`: `getModel(provider, modelId)` maps `ProviderType` → correct `@ai-sdk/*` SDK.
- `lib/ai/resolve-step.ts`: `resolveStep()` turns `StepModelConfig` → `LanguageModel`.
- WebGPU provider: **chat-only**, blocked for API/pipeline inference.

### Rules
- Luôn dùng `resolveStep()` trong analysis/writing pipelines (không gọi `getModel` trực tiếp).
- OpenRouter/openai-compatible: wrapped với `extractJsonMiddleware` cho reliable structured output.
- Prompts luôn bằng **tiếng Việt** (trừ khi user config khác).

---

## 6. Error Handling

```tsx
// ✅ Pattern: try-catch với meaningful error messages
async function importNovel(file: File): Promise<ImportResult> {
  try {
    const content = await readFileContent(file);
    // ... processing
    return { success: true, novelId };
  } catch (error) {
    // Log đủ context để debug
    console.error('[importNovel] Failed to import:', {
      fileName: file.name,
      fileSize: file.size,
      error: error instanceof Error ? error.message : error,
    });
    
    // Re-throw với user-friendly message
    throw new Error(`Không thể import file "${file.name}". Vui lòng kiểm tra định dạng file.`);
  }
}
```

### Rules
- **LUÔN** catch errors ở boundary (page, dialog, API route).
- Dùng `console.error` với prefix `[moduleName]` cho traceability.
- Error messages cho user bằng tiếng Việt.
- Không swallow errors silently (trừ khi có lý do documented).

---

## 7. Performance Patterns

### Web Workers
- Heavy computation (QT engine, replace engine) PHẢI chạy trong Web Workers (`lib/workers/`).
- Access workers qua hooks (`use-qt-engine.ts`, `use-replace-engine.ts`).

### Lazy Loading
- Dynamic imports cho heavy components: `const HeavyEditor = dynamic(() => import('./heavy-editor'))`.
- Dùng `@tanstack/react-virtual` cho long lists.

### Memoization
- `useLiveQuery` đã reactive — KHÔNG wrap thêm `useMemo`.
- `useCallback` cho event handlers passed to child components.

---

## 8. File Naming

```
components/             # PascalCase-ish, kebab-case file names
  chapter-list.tsx      # ✅ kebab-case
  ChapterList.tsx       # ❌ Avoid PascalCase file names

lib/hooks/
  use-novels.ts         # ✅ use-* prefix
  useNovels.ts          # ❌ Avoid camelCase file names

lib/stores/
  use-chat-panel-store.ts  # ✅ Consistent with hooks
```

---

## 9. Git & Commit

- Commit messages theo **Conventional Commits**: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`.
- Commitlint enforced via Husky.
- Branch naming: `feat/xxx`, `fix/xxx`, `refactor/xxx`.

---

## 10. Testing

- Hiện **chưa có test framework**. Khi viết test, dùng Vitest.
- Ưu tiên integration tests cho AI pipelines.
- Unit tests cho utility functions (`lib/utils.ts`, `lib/text-utils.ts`).

---

## 11. Dark Mode

- Manual `classList.toggle("dark")` + `localStorage.theme`.
- Blocking `<script>` in `<head>` để prevent flash.
- Tailwind: dùng `@custom-variant dark` (Tailwind CSS 4 syntax).

---

## 12. Security Notes

- **KHÔNG BAO GIỜ** commit API keys hoặc secrets.
- `.env.local` cho local secrets, Cloudflare env vars cho production.
- Rate limiting: `@upstash/ratelimit` cho API routes.
- Data encryption support trong `lib/db-io.ts` cho database export.
