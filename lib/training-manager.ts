/**
 * Global Training Manager — runs training queue independently of React component lifecycle.
 * 
 * Architecture: Self-dispatching workers
 * Each worker, upon finishing a task, immediately grabs the next chunk.
 * No central polling loop — zero idle time between tasks.
 */

import { db, type DictSource, type AIProvider } from "@/lib/db";
import { useTrainingStore } from "@/lib/stores/training-store";
import { extractDictionaryEntries, type TrainingSuggestion } from "@/lib/ai/training-tools";
import { getModel } from "@/lib/ai/provider";
import { appendToDictSource } from "@/lib/hooks/use-dict-entries";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

const GENRE_DICTS = [
  "ngontinh", "hiendai", "tienhiep", "huyenhuyen", "dammi", "hocduong",
  "nsfw", "hentai", "dongphuong", "dothi", "vongdu", "khoahuyen",
  "quybi", "xuyenkhong", "hethong", "trinhtham", "lichsu"
];

export interface TrainingWorkerConfig {
  id: number;
  providerId: string;
  modelId: string;
}

interface RunningWorkerState {
  id: number;
  isProcessing: boolean;
  currentChunk: string;
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

// Mutex-like lock for taking chunks from input (prevents two workers grabbing same lines)
let _chunkLock = false;

// ─── Public API ──────────────────────────────────────────────

export function isTrainingRunning(): boolean {
  return _isRunning;
}

export function getWorkerStates(): RunningWorkerState[] {
  return _workerStates;
}

function notifyListeners() {
  _listeners.forEach(fn => fn());
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
  notifyListeners();
}

// ─── Internal helpers ────────────────────────────────────────

async function processAutoSave(suggestions: TrainingSuggestion[]) {
  const grouped = suggestions.reduce((acc, curr) => {
    const g = curr.genre || "global";
    if (!acc[g]) acc[g] = [];
    acc[g].push(curr);
    return acc;
  }, {} as Record<string, TrainingSuggestion[]>);

  let totalSaved = 0;
  const supabase = createClient();

  for (const [genre, terms] of Object.entries(grouped)) {
    const targetSource = genre === "global" ? "names" : (genre as DictSource);
    const savedCount = await appendToDictSource(targetSource, terms.map(t => ({ chinese: t.chinese, vietnamese: t.vietnamese })));
    
    if (savedCount > 0) {
      totalSaved += savedCount;
      
      try {
        const records = await db.dictEntries.where("source").equals(targetSource).toArray();
        const text = records.map(r => `${r.chinese}=${r.vietnamese}`).join("\n");
        const filename = `${targetSource}.txt`;
        
        await supabase.storage
          .from("dictionaries")
          .upload(filename, text, {
            contentType: 'text/plain;charset=UTF-8',
            upsert: true,
          });
      } catch (err) {
        console.error(`Lỗi tải lên ${targetSource}:`, err);
      }
    }
  }
  if (totalSaved > 0) {
    toast.success(`Đã lưu tự động ${totalSaved} từ vào từ điển và đồng bộ lên server.`);
  }
}

async function getProviderById(id: string): Promise<AIProvider | undefined> {
  return db.aiProviders.get(id);
}

function requeueChunk(chunkText: string) {
  const currentInput = useTrainingStore.getState().input;
  const newInput = chunkText + (currentInput ? "\n" + currentInput : "");
  useTrainingStore.getState().setInput(newInput);
}

/**
 * Try to grab the next chunk of text from the input queue.
 * Uses a simple lock to prevent two workers from grabbing the same lines.
 * Returns null if no text available.
 */
async function takeNextChunk(): Promise<string | null> {
  // Wait for lock
  while (_chunkLock) {
    await new Promise(r => setTimeout(r, 10));
    if (!_isRunning) return null;
  }
  _chunkLock = true;

  try {
    let currentInput = useTrainingStore.getState().input;

    if (!currentInput.trim()) {
      // Input empty — try to advance to next chapter
      if (_selectedChapterId) {
        const currCh = await db.chapters.get(_selectedChapterId);
        if (currCh) {
          const nextCh = await db.chapters.where("novelId").equals(currCh.novelId)
            .filter(c => c.order > currCh.order)
            .sortBy("order")
            .then(arr => arr[0]);

          if (nextCh) {
            const scenes = await db.scenes.where("[chapterId+isActive]").equals([nextCh.id, 1]).sortBy("order");
            const text = scenes.map(s => s.content).join("\n");
            useTrainingStore.getState().setInput(text);
            _selectedChapterId = nextCh.id;
            // Also update the store so UI reflects
            useTrainingStore.getState().setSelectedChapterId(nextCh.id);
            toast.info(`Tự động chuyển sang chương tiếp theo: ${nextCh.title}`);
            notifyListeners();
            currentInput = text;
          }
        }
      }
    }

    if (!currentInput.trim()) {
      return null; // Truly nothing left
    }

    // Take 15 lines
    const lines = currentInput.split('\n');
    const chunkLines = lines.slice(0, 15);
    const remainingLines = lines.slice(15);
    const chunkText = chunkLines.join('\n');
    useTrainingStore.getState().setInput(remainingLines.join('\n'));

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
  _workerStates = _workers.map(w => ({ id: w.id, isProcessing: false, currentChunk: "" }));
  notifyListeners();

  // Launch all workers concurrently — each one self-dispatches
  for (const worker of _workers) {
    if (worker.providerId && worker.modelId) {
      workerLoop(worker);
    }
  }
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
  // Update UI state
  _workerStates = _workerStates.map(w =>
    w.id === worker.id ? { ...w, isProcessing: true, currentChunk: chunkText } : w
  );
  notifyListeners();

  try {
    const provider = await getProviderById(worker.providerId);
    if (!provider) {
      requeueChunk(chunkText);
      return;
    }
    const model = await getModel(provider, worker.modelId);

    const suggestions = await extractDictionaryEntries({
      model,
      sourceText: chunkText,
      targetGenres: _targetGenres,
    });

    if (suggestions.length > 0) {
      useTrainingStore.getState().addExtractedTerms(suggestions);
      if (_autoSave) {
        await processAutoSave(suggestions);
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`Worker ${worker.id} error:`, err);

    if (_isRunning) {
      requeueChunk(chunkText);
    }
  } finally {
    // Clear UI state
    _workerStates = _workerStates.map(w =>
      w.id === worker.id ? { ...w, isProcessing: false, currentChunk: "" } : w
    );
    notifyListeners();
  }
}
