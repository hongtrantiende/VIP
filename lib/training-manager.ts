/**
 * Global Training Manager — runs training queue independently of React component lifecycle.
 * 
 * Architecture: Self-dispatching workers
 * Each worker, upon finishing a task, immediately grabs the next chunk.
 * No central polling loop — zero idle time between tasks.
 * 
 * Mobile optimizations:
 * - Throttled UI notifications (max 1 update per 500ms)
 * - Batched auto-save with deferred Supabase upload
 * - Yielding to main thread between heavy operations
 * - Limited extractedTerms accumulation (cap at 300)
 */

import { db, type DictSource, type AIProvider, DICT_GENRES } from "@/lib/db";
import { useTrainingStore } from "@/lib/stores/training-store";
import { extractDictionaryEntries, type TrainingSuggestion } from "@/lib/ai/training-tools";
import { getModel } from "@/lib/ai/provider";
import { appendToDictSource } from "@/lib/hooks/use-dict-entries";
import { toast } from "sonner";
import { compress } from "@/lib/compression";

const GENRE_DICTS = [
  "hiendai", "tienhiep", "huyenhuyen", "dammi", "hocduong",
  "dothi", "vongdu", "dongnhan", "ngontinh"
];

// ─── Limits ──────────────────────────────────────────────────
const MAX_EXTRACTED_TERMS = 300; // Prevent localStorage/render bloat on mobile
const NOTIFY_THROTTLE_MS = 500;  // Max 2 UI updates per second
const AUTOSAVE_DEBOUNCE_MS = 3000; // Batch saves every 3 seconds
const SUPABASE_UPLOAD_DEBOUNCE_MS = 15000; // Upload to cloud at most every 15s

export interface TrainingWorkerConfig {
  id: number;
  providerId: string;
  modelId: string;
}

interface RunningWorkerState {
  id: number;
  isProcessing: boolean;
  currentChunk: string;
  error?: string;
}

// ─── Singleton State ─────────────────────────────────────────

let _isRunning = false;
let _workers: TrainingWorkerConfig[] = [];
let _workerStates: RunningWorkerState[] = [];
let _autoSave = true;
let _targetGenres: string[] = ["auto"];
let _selectedChapterId = "";
let _listeners: Set<() => void> = new Set();
let _activeWorkerCount = 0;
let _pendingInput = ""; // Hàng đợi ảo để không trừ chữ trên UI cho đến khi làm xong

// Mutex-like lock for taking chunks from input (prevents two workers grabbing same lines)
let _chunkLock = false;

// ─── Throttled Notification ──────────────────────────────────
let _notifyScheduled = false;
let _lastNotifyTime = 0;

function notifyListeners() {
  const now = Date.now();
  if (now - _lastNotifyTime < NOTIFY_THROTTLE_MS) {
    // Schedule a deferred notification if not already scheduled
    if (!_notifyScheduled) {
      _notifyScheduled = true;
      setTimeout(() => {
        _notifyScheduled = false;
        _lastNotifyTime = Date.now();
        _listeners.forEach(fn => fn());
      }, NOTIFY_THROTTLE_MS);
    }
    return;
  }
  _lastNotifyTime = now;
  _listeners.forEach(fn => fn());
}

/** Force-flush a notification immediately (for stop/start events) */
function notifyListenersImmediate() {
  _lastNotifyTime = Date.now();
  _listeners.forEach(fn => fn());
}

// ─── Batched Auto-Save ───────────────────────────────────────
// ─── Batched Auto-Save ───────────────────────────────────────
let _pendingSuggestions: TrainingSuggestion[] = [];
let _autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let _cloudUploadTimer: ReturnType<typeof setTimeout> | null = null;
let _dirtySourcesForUpload: Set<string> = new Set();
let _wordsSinceLastWarehouseSync = 0; // Bộ đếm từ mới để đồng bộ kho 1TB

function queueAutoSave(suggestions: TrainingSuggestion[]) {
  _pendingSuggestions.push(...suggestions);

  // Debounce the actual save
  if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => {
    flushAutoSave();
  }, AUTOSAVE_DEBOUNCE_MS);
}

async function flushAutoSave() {
  if (_pendingSuggestions.length === 0) return;

  const toSave = [..._pendingSuggestions];
  _pendingSuggestions = [];

  try {
    await processAutoSaveLocal(toSave);
  } catch (err) {
    console.error("Auto-save failed:", err);
    _pendingSuggestions.push(...toSave);
  }
}

/** Save to local IndexedDB and track word count for warehouse sync */
async function processAutoSaveLocal(suggestions: TrainingSuggestion[]) {
  const grouped = suggestions.reduce((acc, curr) => {
    const genres = (curr.genre || "global").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    const c = curr.category || "tuvung";
    const mappedCat = ["names", "names2", "phienam", "luatnhan", "tuvung", "ngucanh", "vietphrase"].includes(c) ? c : "tuvung";

    for (const g of genres) {
      let mappedGenre = g === "global" ? "core" : g;
      if (!DICT_GENRES.includes(mappedGenre as any)) mappedGenre = "core";

      const targetSource = `${mappedGenre}_${mappedCat}`;
      if (!acc[targetSource]) acc[targetSource] = [];
      acc[targetSource].push(curr);
    }
    return acc;
  }, {} as Record<string, TrainingSuggestion[]>);

  let totalSaved = 0;

  for (const [targetSource, terms] of Object.entries(grouped)) {
    await yieldToMain();
    const result = await appendToDictSource(targetSource as any, terms.map(t => ({ chinese: t.chinese, vietnamese: t.vietnamese })));
    const savedCount = typeof result === "number" ? result : result.added;
    if (savedCount > 0) {
      totalSaved += savedCount;
      _dirtySourcesForUpload.add(targetSource);
    }
  }

  if (totalSaved > 0) {
    toast.success(`Đã lưu ${totalSaved} từ vào từ điển.`);
    useTrainingStore.getState().addSyncedWords(totalSaved);
    _wordsSinceLastWarehouseSync += totalSaved;

    // Nếu đạt mốc 200 từ thì ưu tiên đẩy lên kho ngay
    if (_wordsSinceLastWarehouseSync >= 200) {
      scheduleCloudUpload(true); // true = force fast upload
    } else {
      scheduleCloudUpload();
    }
  }
}

function scheduleCloudUpload(force = false) {
  if (_cloudUploadTimer && !force) return;
  if (_cloudUploadTimer) clearTimeout(_cloudUploadTimer);

  _cloudUploadTimer = setTimeout(async () => {
    _cloudUploadTimer = null;
    await flushCloudUpload(force);
  }, force ? 1000 : SUPABASE_UPLOAD_DEBOUNCE_MS);
}

async function flushCloudUpload(force = false) {
  if (_dirtySourcesForUpload.size === 0) return;

  const sources = Array.from(_dirtySourcesForUpload);

  // Đồng bộ vào Tổng kho 1TB (Google Drive)
  // Chỉ đồng bộ nếu đạt 200 từ, hoặc bị ép buộc (force = true) khi stop/hoàn thành chapter
  if (force || _wordsSinceLastWarehouseSync >= 200) {
    _dirtySourcesForUpload.clear();
    try {
      let warehouseCount = 0;
      for (const targetSource of sources) {
        await yieldToMain();
        const cached = await db.dictCache.get(targetSource as any);
        if (!cached?.rawText) continue;

        const filename = `${targetSource}.txt`;

        // Lấy bản cũ trên kho để hòa nhập (Merge)
        const dlParams = new URLSearchParams({ action: 'download-dict', filename });
        const dlRes = await fetch(`/api/dict/cloud-storage?${dlParams.toString()}`, { method: 'POST' });

        let finalContent = cached.rawText;
        if (dlRes.ok) {
          const cloudText = await dlRes.text();
          const localEntries = cached.rawText.split("\n").filter(l => l.includes("="));
          const cloudEntries = cloudText.split("\n").filter(l => l.includes("="));

          const map = new Map<string, Set<string>>();

          // Hàm hỗ trợ nạp vào map và tách các nghĩa bằng dấu /
          const addToMap = (line: string) => {
            const idx = line.indexOf("=");
            if (idx < 1) return;
            const key = line.slice(0, idx).trim();
            const val = line.slice(idx + 1).trim();
            if (!key || !val) return;
            const meanings = val.split("/").map(m => m.trim()).filter(Boolean);
            if (!map.has(key)) map.set(key, new Set());
            meanings.forEach(m => map.get(key)!.add(m));
          };

          cloudEntries.forEach(addToMap);
          localEntries.forEach(addToMap);

          finalContent = Array.from(map.entries())
            .map(([k, vs]) => `${k}=${Array.from(vs).join("/")}`)
            .join("\n");
        }

        const compressed = await compress(finalContent);
        const upParams = new URLSearchParams({ action: 'upload-dict', filename });
        const upRes = await fetch(`/api/dict/cloud-storage?${upParams.toString()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: new Blob([compressed as any]),
        });

        if (upRes.ok) {
          warehouseCount++;
          console.log(`[WarehouseSync] Updated ${filename}. Size: ${finalContent.length} chars.`);
        }
      }

      if (warehouseCount > 0) {
        toast.success(`Đã tự động hòa nhập ${_wordsSinceLastWarehouseSync} từ mới (Gộp nghĩa) vào Tổng kho 1TB!`);
        _wordsSinceLastWarehouseSync = 0;
      }
    } catch (err) {
      console.error("Warehouse auto-sync failed:", err);
    }
  }
}

// ─── Yield to Main Thread ────────────────────────────────────
/** Yield control back to the browser so UI can update and not freeze */
function yieldToMain(): Promise<void> {
  return new Promise(resolve => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => resolve(), { timeout: 100 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

// ─── Public API ──────────────────────────────────────────────

export function isTrainingRunning(): boolean {
  return _isRunning;
}

export function getWorkerStates(): RunningWorkerState[] {
  return _workerStates;
}

export function subscribeTrainingManager(listener: () => void): () => void {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

export function configureTraining(opts: {
  workers: TrainingWorkerConfig[];
  autoSave: boolean;
  targetGenres: string[];
  selectedChapterId: string;
}) {
  _workers = opts.workers;
  _autoSave = opts.autoSave;
  _targetGenres = opts.targetGenres;
  _selectedChapterId = opts.selectedChapterId;
}

export function updateSelectedChapterId(id: string) {
  _selectedChapterId = id;
}

export function stopTraining() {
  _isRunning = false;
  _activeWorkerCount = 0;
  _chunkLock = false;
  _workerStates = _workerStates.map(w => ({ ...w, isProcessing: false, currentChunk: "" }));

  // Flush any pending saves before stopping
  if (_autoSaveTimer) {
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = null;
  }
  flushAutoSave();

  // Also flush cloud upload
  if (_cloudUploadTimer) {
    clearTimeout(_cloudUploadTimer);
    _cloudUploadTimer = null;
  }
  flushCloudUpload(true); // Force upload whatever is left

  notifyListenersImmediate();
}

// ─── Internal helpers ────────────────────────────────────────

async function getProviderById(id: string): Promise<AIProvider | undefined> {
  return db.aiProviders.get(id);
}

function requeueChunk(chunkText: string) {
  _pendingInput = chunkText + (_pendingInput ? "\n" + _pendingInput : "");
}

/**
 * Try to grab the next chunk of text from the input queue.
 * Uses a simple lock to prevent two workers from grabbing the same lines.
 * Returns null if no text available.
 */
async function takeNextChunk(): Promise<string | null> {
  // Wait for lock with exponential backoff instead of busy-wait
  let waitTime = 10;
  while (_chunkLock) {
    await new Promise(r => setTimeout(r, waitTime));
    waitTime = Math.min(waitTime * 2, 200); // Exponential backoff, max 200ms
    if (!_isRunning) return null;
  }
  _chunkLock = true;

  try {
    if (!_pendingInput.trim()) {
      return null; // Truly nothing left
    }

    // Take 50 lines
    const lines = _pendingInput.split('\n');
    const chunkLines = lines.slice(0, 50);
    const remainingLines = lines.slice(50);
    const chunkText = chunkLines.join('\n');

    _pendingInput = remainingLines.join('\n');

    if (!chunkText.trim()) return null;
    return chunkText;
  } finally {
    _chunkLock = false;
  }
}

// ─── Start / Worker Loop ─────────────────────────────────────

export async function startTraining() {
  if (_isRunning) return;

  const store = useTrainingStore.getState();
  if (!store.input.trim()) return;

  _isRunning = true;
  _activeWorkerCount = 0;
  _chunkLock = false;
  _pendingSuggestions = [];
  _pendingInput = store.input; // Bắt đầu với toàn bộ văn bản
  _dirtySourcesForUpload.clear();
  _workerStates = _workers.map(w => ({ id: w.id, isProcessing: false, currentChunk: "", error: undefined }));
  notifyListenersImmediate();

  // Launch all workers concurrently, but staggered to avoid burst rate limits on APIs
  _workers.forEach((worker, index) => {
    if (worker.providerId && worker.modelId) {
      // Delay each worker by 1.5 seconds to prevent rate limit spikes
      setTimeout(() => {
        if (_isRunning) {
          workerLoop(worker);
        }
      }, index * 1500);
    }
  });
}

/**
 * Each worker runs its own loop:
 * 1. Grab next chunk
 * 2. Process it
 * 3. Repeat until no more chunks or training stopped
 */
async function workerLoop(worker: TrainingWorkerConfig) {
  _activeWorkerCount++;

  while (_isRunning) {
    // Yield to main thread before grabbing next chunk
    await yieldToMain();

    const chunk = await takeNextChunk();

    if (!chunk) {
      // No more input — check if we should stop
      // Wait a moment, other workers might requeue failed chunks
      await new Promise(r => setTimeout(r, 2000));

      // Check again
      const retryChunk = await takeNextChunk();
      if (!retryChunk) {
        // Still nothing — this worker exits
        break;
      }
      // Got something after waiting — process it
      await processChunk(worker, retryChunk);
      continue;
    }

    await processChunk(worker, chunk);
  }

  _activeWorkerCount--;

  // If all workers have exited, stop training
  if (_activeWorkerCount <= 0 && _isRunning) {
    toast.success("Đã phân tích xong toàn bộ văn bản!");
    stopTraining();
  }
}

async function processChunk(worker: TrainingWorkerConfig, chunkText: string) {
  // Update UI state (throttled)
  _workerStates = _workerStates.map(w =>
    w.id === worker.id ? { ...w, isProcessing: true, currentChunk: chunkText, error: undefined } : w
  );
  notifyListeners();

  try {
    const provider = await getProviderById(worker.providerId);
    if (!provider) {
      requeueChunk(chunkText);
      return;
    }
    const model = await getModel(provider, worker.modelId);

    let suggestions = await extractDictionaryEntries({
      model,
      sourceText: chunkText,
      targetGenres: _targetGenres,
    });

    // ─── Junk Filter ──────────────────────────────────────────
    suggestions = suggestions.filter(s => {
      const cn = s.chinese.trim();
      const vi = s.vietnamese.trim();

      // 1. Loại bỏ từ quá ngắn (<= 1 ký tự Trung)
      if (cn.length <= 1) return false;

      // 2. Loại bỏ từ mà bản dịch giống hệt bản gốc
      if (cn.toLowerCase() === vi.toLowerCase()) return false;

      // 3. Loại bỏ từ quá dài (thường là cả câu, > 15 ký tự)
      if (cn.length > 15) return false;

      // 4. Loại bỏ từ chỉ toàn số hoặc ký tự đặc biệt
      if (/^[\d\s\W]+$/.test(cn)) return false;

      // 5. Loại bỏ nếu không có chữ Trung Quốc (đối với phím Trung)
      if (!/[\u4e00-\u9fa5]/.test(cn)) return false;

      return true;
    });

    if (suggestions.length > 0) {
      // Add to store with a cap to prevent memory bloat on mobile
      const store = useTrainingStore.getState();
      const existingKeys = new Set(store.extractedTerms.map(t => t.chinese));
      const newTerms = suggestions.filter(t => !existingKeys.has(t.chinese));

      if (newTerms.length > 0) {
        const combined = [...newTerms, ...store.extractedTerms];
        // Cap at MAX_EXTRACTED_TERMS to prevent UI lag
        store.setExtractedTerms(combined.slice(0, MAX_EXTRACTED_TERMS));
      }

      if (_autoSave) {
        queueAutoSave(suggestions);
      }
    } else {
      // Báo mờ mờ cho user biết là luồng này không có từ mới
      toast.info(`Luồng ${worker.id} xử lý xong (Không có từ mới)`, { duration: 1500, style: { fontSize: '12px' } });
    }

    // AI phân tích xong, TIẾN HÀNH XÓA CHỮ TRÊN UI
    const store = useTrainingStore.getState();
    const currentInput = store.input;

    // Chuẩn hoá để tránh lỗi Windows (\r\n) vs Linux (\n) khiến không xóa được
    let normFull = currentInput.replace(/\r\n/g, '\n');
    const normChunk = chunkText.replace(/\r\n/g, '\n');

    if (normFull.indexOf(normChunk) !== -1) {
      normFull = normFull.replace(normChunk, "");
      normFull = normFull.replace(/^[\r\n]+/, ""); // Xoá dấu xuống dòng dư thừa
      store.setInput(normFull);
    } else {
      // Fallback
      console.warn("Không tìm thấy đoạn text để trừ trên UI.");
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`Worker ${worker.id} error:`, err);

    _workerStates = _workerStates.map(w =>
      w.id === worker.id ? { ...w, error: errMsg } : w
    );
    notifyListenersImmediate();

    if (_isRunning) {
      requeueChunk(chunkText);
      // Add a small delay on error to prevent rapid retry loops on mobile
      await new Promise(r => setTimeout(r, 2000));
    }
  } finally {
    // Clear UI state (throttled)
    _workerStates = _workerStates.map(w =>
      w.id === worker.id ? { ...w, isProcessing: false, currentChunk: "" } : w
    );
    notifyListeners();
  }
}
