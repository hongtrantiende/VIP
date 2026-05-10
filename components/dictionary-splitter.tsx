"use client";

import { useSplitterStore } from "@/lib/stores/splitter-store";
import {
  isSplitterRunning,
  startSplitter,
  stopSplitter,
  configureSplitter,
  getSplitterWorkerStates,
  subscribeSplitterManager,
} from "@/lib/splitter-manager";
import { useSyncExternalStore, useMemo } from "react";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { useAIModels, useAIProviders } from "@/lib/hooks/use-ai-providers";
import { Card, CardContent } from "./ui/card";
import { BotIcon, Loader2Icon, PlayIcon, SquareIcon, ArrowRightIcon } from "lucide-react";
import { useDictMeta } from "@/lib/hooks/use-dict-entries";

export function DictionarySplitter() {
  const store = useSplitterStore();
  
  const isRunning = useSyncExternalStore(subscribeSplitterManager, isSplitterRunning, () => false);
  const managerWorkers = useSyncExternalStore(subscribeSplitterManager, getSplitterWorkerStates, () => []);

  const providers = useAIProviders();
  const availableProviders = useMemo(() => providers?.filter((p) => p.isActive) || [], [providers]);
  
  const dictMeta = useDictMeta();
  const sources = dictMeta 
    ? Object.keys(dictMeta.sources).filter(s => s !== "core_vietphrase" && s !== "vietphrase") 
    : ["core_names", "core_luatnhan"];

  const handleStart = () => {
    configureSplitter({
      workers: store.workerConfigs.filter(w => w.providerId && w.modelId),
      chunkSize: store.chunkSize,
      genreSequence: store.genreSequence || [],
    });
    startSplitter();
  };

  const handleStop = () => {
    stopSplitter();
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold mb-1">Công cụ AI Tách & Phân Loại Từ Điển</h3>
          <p className="text-xs text-muted-foreground">
            Dùng 5 model AI song song để quét từ điển gốc, tự động bóc tách các từ đặc thù (Tiên Hiệp, Hiện Đại, Luật nhân xưng...) sang từ điển riêng biệt, giữ lại các từ phổ thông ở từ điển Core.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="w-[150px] space-y-1.5">
            <Label className="text-xs">Số dòng / model</Label>
            <Select 
              value={store.chunkSize.toString()} 
              onValueChange={v => store.setChunkSize(parseInt(v))}
              disabled={isRunning}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="50">50 dòng</SelectItem>
                <SelectItem value="100">100 dòng</SelectItem>
                <SelectItem value="200">200 dòng</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 space-y-1.5">
            <Label className="text-xs">Thứ tự ưu tiên thể loại (khi chọn Tuần tự)</Label>
            <input 
              type="text" 
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              value={store.genreSequence?.join(", ")}
              onChange={e => store.setGenreSequence(e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
              disabled={isRunning}
              placeholder="tienhiep, huyenhuyen, hiendai..."
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Cấu hình 5 Model chạy song song</Label>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2">
            {store.workerConfigs.map((worker, idx) => (
              <WorkerCard 
                key={worker.id}
                worker={worker}
                idx={idx}
                availableProviders={availableProviders}
                managerState={managerWorkers.find(w => w.id === worker.id)}
                updateWorker={(updated) => {
                  const newConfigs = [...store.workerConfigs];
                  newConfigs[idx] = updated;
                  store.setWorkerConfigs(newConfigs);
                }}
                disabled={isRunning}
                sources={sources}
              />
            ))}
          </div>
        </div>
        
        <div className="pt-2 flex justify-end gap-2">
          {isRunning ? (
            <Button variant="destructive" onClick={handleStop} className="gap-2">
              <SquareIcon className="size-4" /> Dừng tiến trình
            </Button>
          ) : (
            <Button onClick={handleStart} className="gap-2" disabled={!store.workerConfigs.some(w => w.providerId && w.modelId)}>
              <PlayIcon className="size-4" /> Bắt đầu bóc tách
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkerCard({
  worker,
  idx,
  availableProviders,
  managerState,
  updateWorker,
  disabled,
  sources
}: {
  worker: any;
  idx: number;
  availableProviders: any[];
  managerState?: any;
  updateWorker: (w: any) => void;
  disabled: boolean;
  sources: string[];
}) {
  const models = useAIModels(worker.providerId || undefined);

  return (
    <Card className="shadow-none">
      <CardContent className="p-3 space-y-2 relative flex flex-col h-full">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-muted-foreground">Worker {idx + 1}</span>
          {managerState?.isProcessing ? (
            <span className="flex items-center text-[10px] text-blue-600 dark:text-blue-400">
              <Loader2Icon className="mr-1 size-3 animate-spin" /> Đang chạy
            </span>
          ) : managerState ? (
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Rảnh rỗi</span>
          ) : null}
        </div>
        
        <Select 
          value={worker.sourceDict} 
          onValueChange={v => updateWorker({ ...worker, sourceDict: v })}
          disabled={disabled}
        >
          <SelectTrigger className="h-7 text-[10px]">
            <SelectValue placeholder="Từ điển nguồn..." />
          </SelectTrigger>
          <SelectContent>
            {sources.map(s => (
              <SelectItem key={s} value={s} className="text-[10px]">{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select 
          value={worker.targetGenre} 
          onValueChange={v => updateWorker({ ...worker, targetGenre: v })}
          disabled={disabled}
        >
          <SelectTrigger className="h-7 text-[10px]">
            <SelectValue placeholder="Thể loại đích..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto_stt" className="text-[10px] font-bold text-blue-600">Tuần tự (Auto STT)</SelectItem>
            <SelectItem value="tienhiep" className="text-[10px]">Tiên Hiệp</SelectItem>
            <SelectItem value="hiendai" className="text-[10px]">Hiện Đại</SelectItem>
            <SelectItem value="ngontinh" className="text-[10px]">Ngôn Tình</SelectItem>
            <SelectItem value="huyenhuyen" className="text-[10px]">Huyền Huyễn</SelectItem>
            <SelectItem value="dothi" className="text-[10px]">Đô Thị</SelectItem>
            <SelectItem value="khoahuyen" className="text-[10px]">Khoa Huyễn</SelectItem>
            <SelectItem value="khac" className="text-[10px]">Khác</SelectItem>
          </SelectContent>
        </Select>
        
        <Select 
          value={worker.providerId} 
          onValueChange={v => updateWorker({ ...worker, providerId: v, modelId: "" })}
          disabled={disabled}
        >
          <SelectTrigger className="h-7 text-[10px]">
            <SelectValue placeholder="Chọn Provider..." />
          </SelectTrigger>
          <SelectContent>
            {availableProviders.map(p => (
              <SelectItem key={p.id} value={p.id} className="text-[10px]">{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select 
          value={worker.modelId} 
          onValueChange={v => updateWorker({ ...worker, modelId: v })}
          disabled={disabled || !worker.providerId}
        >
          <SelectTrigger className="h-7 text-[10px]">
            <SelectValue placeholder="Chọn Model..." />
          </SelectTrigger>
          <SelectContent>
            {models?.map(m => (
              <SelectItem key={m.id} value={m.modelId} className="text-[10px]">{m.name || m.modelId}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {managerState && (
          <div className="pt-2 border-t text-[10px]">
            <span className="text-muted-foreground">Đã xử lý: </span>
            <span className="font-mono font-medium">{managerState.processedLines} dòng</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
