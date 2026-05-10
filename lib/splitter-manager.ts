import { createClient } from "@/lib/supabase/client";
import { db, type DictSource } from "@/lib/db";
import { resolveChapterToolModel } from "./chapter-tools/stream-runner";
import { useChatSettings } from "./hooks/use-chat-settings";
import { useAIProvider } from "./hooks/use-ai-providers";
import { splitDictionaryChunk } from "./ai/splitter-tools";
import { appendToDictSource } from "./hooks/use-dict-entries";
import type { SplitterWorkerConfig } from "./stores/splitter-store";

export interface SplitterState {
  id: number;
  providerId: string;
  modelId: string;
  sourceDict: string;
  targetGenre: string;
  isProcessing: boolean;
  processedLines: number;
  currentChunk: string;
  sourceEntries?: Array<{ chinese: string; vietnamese: string }>;
  currentIndex: number;
}

let isRunning = false;
let shouldStop = false;
let globalConfig: {
  workers: SplitterWorkerConfig[];
  chunkSize: number;
  genreSequence: string[];
} | null = null;

let workerStates: SplitterState[] = [];
let listeners: Array<() => void> = [];

export function subscribeSplitterManager(listener: () => void) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

export function isSplitterRunning() {
  return isRunning;
}

export function getSplitterWorkerStates() {
  return workerStates;
}

export function configureSplitter(config: {
  workers: SplitterWorkerConfig[];
  chunkSize: number;
  genreSequence: string[];
}) {
  globalConfig = config;
  workerStates = config.workers.map((w) => ({
    id: w.id,
    providerId: w.providerId,
    modelId: w.modelId,
    sourceDict: w.sourceDict,
    targetGenre: w.targetGenre,
    isProcessing: false,
    processedLines: 0,
    currentChunk: "",
    currentIndex: 0,
    genreIndex: 0, // Used for auto_stt
  }));
  notify();
}

export function startSplitter() {
  if (isRunning) return;
  if (!globalConfig) throw new Error("Splitter not configured");
  
  isRunning = true;
  shouldStop = false;
  notify();
  
  runLoop().catch((err) => {
    console.error("Splitter loop crashed:", err);
    isRunning = false;
    notify();
  });
}

export function stopSplitter() {
  shouldStop = true;
  isRunning = false;
  notify();
}

async function runLoop() {
  if (!globalConfig) return;
  
  // 1. Load the dictionary into memory for each worker
  for (const w of workerStates) {
    if (!w.sourceDict) continue;
    w.sourceEntries = await db.dictEntries
      .where("source")
      .equals(w.sourceDict)
      .toArray();
    w.currentIndex = 0;
  }
  
  while (!shouldStop) {
    const idleWorkers = workerStates.filter(w => !w.isProcessing && w.sourceEntries);
    
    // Check if all workers are fully done
    const allDone = workerStates.every(w => {
      if (w.isProcessing || !w.sourceEntries) return false;
      if (w.currentIndex < w.sourceEntries.length) return false;
      // If auto_stt, it is done when genreIndex >= genreSequence.length
      if (w.targetGenre === "auto_stt" && w.genreIndex !== undefined && w.genreIndex < globalConfig!.genreSequence.length - 1) return false;
      return true;
    });
    
    if (allDone) break;
    
    // Transition auto_stt workers to next genre if they finished current file
    for (const w of workerStates) {
      if (!w.isProcessing && w.sourceEntries && w.currentIndex >= w.sourceEntries.length) {
        if (w.targetGenre === "auto_stt" && w.genreIndex !== undefined && w.genreIndex < globalConfig!.genreSequence.length - 1) {
          w.genreIndex++;
          // We must reload sourceEntries from DB because some were deleted!
          w.sourceEntries = await db.dictEntries.where("source").equals(w.sourceDict).toArray();
          w.currentIndex = 0; // Restart from top of the file!
        }
      }
    }

    const readyWorkers = idleWorkers.filter(w => w.currentIndex < w.sourceEntries!.length);

    if (readyWorkers.length === 0) {
      await new Promise(r => setTimeout(r, 500));
      continue;
    }
    
    // Assign chunks to idle workers
    for (const worker of readyWorkers) {
      if (shouldStop) break;
      
      const chunk = worker.sourceEntries!.slice(worker.currentIndex, worker.currentIndex + globalConfig.chunkSize);
      worker.currentIndex += globalConfig.chunkSize;
      
      worker.isProcessing = true;
      worker.currentChunk = chunk.slice(0, 5).map(e => `${e.chinese}=${e.vietnamese}`).join("\\n") + (chunk.length > 5 ? "\\n..." : "");
      notify();
      
      processChunk(worker, chunk).finally(() => {
        worker.isProcessing = false;
        notify();
      });
    }
    
    await new Promise(r => setTimeout(r, 500));
  }
  
  // Wait for all workers to finish
  while (workerStates.some(w => w.isProcessing)) {
    await new Promise(r => setTimeout(r, 500));
  }
  
  isRunning = false;
  notify();
}

async function processChunk(worker: SplitterState, chunk: Array<{ chinese: string; vietnamese: string }>) {
  try {
    const model = await resolveChapterToolModel(
      { providerId: worker.providerId, modelId: worker.modelId },
      undefined,
    );
    if (!model) throw new Error("Model not found");

    const activeTargetGenre = (worker.targetGenre === "auto_stt" 
      ? globalConfig!.genreSequence[worker.genreIndex || 0] 
      : worker.targetGenre) || "khac";

    const result = await splitDictionaryChunk(model, activeTargetGenre, chunk);
    
    if (result && result.results) {
      // Group by category (which is just 'target' or 'khac')
      const grouped = result.results.reduce((acc, curr) => {
        const cat = curr.category;
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push({ chinese: curr.chinese, vietnamese: curr.vietnamese });
        return acc;
      }, {} as Record<string, Array<{ chinese: string; vietnamese: string }>>);
      
      // Save to IDB
      for (const [cat, entries] of Object.entries(grouped)) {
        if (cat === "khac") continue; // Keep them in source dictionary, do nothing

        // Map category to DictSource. E.g. worker.sourceDict is "core_names", targetGenre is "tienhiep",
        // then the output file should be "tienhiep_names".
        const sourceSuffix = worker.sourceDict.split("_")[1] || "tuvung";
        const targetSource = `${activeTargetGenre}_${sourceSuffix}` as DictSource;
        
        await appendToDictSource(targetSource, entries);
        
        // Also delete them from the ORIGINAL source dict so we don't process them again!
        const chineseKeys = entries.map(e => e.chinese);
        await db.dictEntries
          .where("[source+chinese]")
          .anyOf(chineseKeys.map(c => [worker.sourceDict, c]))
          .delete();
      }
    }
    
    worker.processedLines += chunk.length;
  } catch (err) {
    console.error(`Worker ${worker.id} failed chunk:`, err);
    // In a robust system we would requeue the chunk, but for now we just skip
  }
}
