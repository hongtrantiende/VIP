"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TextCompareEditor } from "@/components/ui/text-compare-editor";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedValue } from "@/lib/hooks/use-debounce";
import { useTrainingStore, type ConvertTab } from "@/lib/stores/training-store";
import { cn } from "@/lib/utils";
import {
  FileUpIcon,
  LoaderIcon,
  Trash2Icon,
  WrenchIcon,
  SparklesIcon,
  ArrowRightLeftIcon,
  BotIcon,
  LibraryIcon,
} from "lucide-react";
import { useEffect, useRef, useState, useCallback, useMemo, useSyncExternalStore } from "react";
import { convertText, useQTEngineReady } from "@/lib/hooks/use-qt-engine";
import { useConvertSettings } from "@/lib/hooks/use-convert-settings";
import { useAIProviders, useAIModels } from "@/lib/hooks/use-ai-providers";
import { type TrainingSuggestion } from "@/lib/ai/training-tools";
import { appendToDictSource, exportDictSource, deduplicateAllDictSources, useDictMeta } from "@/lib/hooks/use-dict-entries";
import { type DictSource, db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useNovels } from "@/lib/hooks/use-novels";
import { useChapters } from "@/lib/hooks/use-chapters";
import {
  isTrainingRunning,
  startTraining,
  stopTraining,
  configureTraining,
  updateSelectedChapterId,
  subscribeTrainingManager,
  getWorkerStates,
  type TrainingWorkerConfig,
} from "@/lib/training-manager";
import { createClient } from "@/lib/supabase/client";

const GENRE_DICTS = [
  "ngontinh", "hiendai", "tienhiep", "huyenhuyen", "dammi", "hocduong", 
  "nsfw", "hentai", "dongphuong", "dothi", "vongdu", "khoahuyen", 
  "quybi", "xuyenkhong", "hethong", "trinhtham", "lichsu"
];

const GENRE_LABELS: Record<string, string> = {
  ngontinh: "Ngôn tình", hiendai: "Hiện đại", tienhiep: "Tiên hiệp",
  huyenhuyen: "H Huyền huyễn", dammi: "Đam mỹ", hocduong: "Học đường",
  nsfw: "NSFW (18+)", hentai: "Hentai", dongphuong: "Đông phương",
  dothi: "Đô thị", vongdu: "Võng du", khoahuyen: "Khoa huyễn",
  quybi: "Quỷ bí", xuyenkhong: "Xuyên không", hethong: "Hệ thống",
  trinhtham: "Trinh thám", lichsu: "Lịch sử"
};

interface WorkerState {
  id: number;
  providerId: string;
  modelId: string;
  isProcessing: boolean;
  currentChunk: string;
}

export default function ConvertPage() {
  const store = useTrainingStore();
  const qtReady = useQTEngineReady();
  const convertSettings = useConvertSettings();
  
  const { input = "", setInput } = store;
  const [qtOut, setQtOut] = useState("");
  const activeTab = store.activeTab;
  const setActiveTab = store.setActiveTab;
  const [activeDictSources, setActiveDictSources] = useState<string[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [isConvertingQT, setIsConvertingQT] = useState(false);
  
  // Library selection state — persisted in store
  const novels = useNovels();
  const selectedNovelId = store.selectedNovelId;
  const setSelectedNovelId = store.setSelectedNovelId;
  const chapters = useChapters(selectedNovelId);
  const selectedChapterId = store.selectedChapterId;
  const setSelectedChapterId = store.setSelectedChapterId;
  const targetGenres = store.targetGenres || ["auto"];

  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email === "nthanhnam2005@gmail.com") {
        setIsAdmin(true);
      }
    });
  }, []);

  const dictMeta = useDictMeta();
  const dynamicSources = dictMeta 
    ? Object.keys(dictMeta.sources).filter(s => 
        !["vietphrase", "names", "names2", "phienam", "luatnhan"].includes(s) &&
        !GENRE_DICTS.includes(s)
      ) 
    : [];
  const allGenreSources = [...GENRE_DICTS, ...dynamicSources];

  // Subscribe to global training manager state
  const isQueueRunning = useSyncExternalStore(
    subscribeTrainingManager,
    isTrainingRunning,
    () => false // server snapshot
  );
  const managerWorkerStates = useSyncExternalStore(
    subscribeTrainingManager,
    getWorkerStates,
    () => [] // server snapshot
  );

  // Load chapter text when selected
  useEffect(() => {
    if (selectedChapterId && !isQueueRunning) {
      db.scenes.where("[chapterId+isActive]").equals([selectedChapterId, 1]).sortBy("order").then(scenes => {
        const text = scenes.map(s => s.content).join("\n");
        setInput(text);
      });
    }
  }, [selectedChapterId, setInput]);

  // AI Training state
  const aiProviders = useAIProviders();
  const availableProviders = useMemo(() => aiProviders?.filter(p => p.isActive && p.providerType !== "webgpu") || [], [aiProviders]);
  
  // Use persisted extractedTerms from store
  const extractedTerms = store.extractedTerms;
  const [autoSave, setAutoSave] = useState(true);

  // Worker configs are persisted in the store
  const workerConfigs = store.workerConfigs;

  // Build WorkerState[] for UI from persisted configs
  const workers: WorkerState[] = useMemo(() => 
    workerConfigs.map(wc => ({
      ...wc,
      isProcessing: false,
      currentChunk: "",
    }))
  , [workerConfigs]);

  const setWorkers = useCallback((updater: (prev: WorkerState[]) => WorkerState[]) => {
    // Apply updater to get new state, then extract just config fields to store
    const newWorkers = updater(workers);
    store.setWorkerConfigs(newWorkers.map(w => ({ id: w.id, providerId: w.providerId, modelId: w.modelId })));
  }, [workers, store]);

  // Auto-select first provider/model for workers that don't have one yet
  useEffect(() => {
    if (availableProviders.length > 0) {
      const pId = availableProviders[0].id;
      const needsUpdate = workerConfigs.some(w => !w.providerId);
      if (needsUpdate) {
        store.setWorkerConfigs(
          workerConfigs.map(w => w.providerId ? w : { ...w, providerId: pId })
        );
      }
    }
  }, [availableProviders, workerConfigs, store]);

  // Merge manager worker states into local display
  const displayWorkers = useMemo(() => {
    if (managerWorkerStates.length === 0) return workers;
    return workers.map(w => {
      const ms = managerWorkerStates.find(m => m.id === w.id);
      if (ms) {
        return { ...w, isProcessing: ms.isProcessing, currentChunk: ms.currentChunk };
      }
      return w;
    });
  }, [workers, managerWorkerStates]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const debouncedInput = useDebouncedValue(input, 500);

  useEffect(() => {
    if (!qtReady || activeTab !== "qt") return;
    if (!debouncedInput.trim()) {
      setQtOut("");
      return;
    }
    
    let isMounted = true;
    setIsConvertingQT(true);
    convertText(debouncedInput, {
      options: {
        ...convertSettings,
        activeDictSources,
      }
    }).then(res => {
      if (isMounted) setQtOut(res.plainText);
    }).catch(err => {
      console.error(err);
    }).finally(() => {
      if (isMounted) setIsConvertingQT(false);
    });

    return () => { isMounted = false; };
  }, [debouncedInput, qtReady, convertSettings, activeDictSources, activeTab]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      let text = new TextDecoder("utf-8").decode(buffer);
      if (text.includes("\uFFFD")) {
        text = new TextDecoder("gb18030").decode(buffer);
      }
      setInput(text);
      setSelectedNovelId("");
      setSelectedChapterId("");
    };
    reader.readAsArrayBuffer(file);
  };

  const handleClear = useCallback(() => {
    setInput("");
    setQtOut("");
    store.setExtractedTerms([]);
    setSelectedNovelId("");
    setSelectedChapterId("");
    stopTraining();
  }, [setInput, store]);

  const processAutoSave = async (suggestions: TrainingSuggestion[]) => {
    const grouped = suggestions.reduce((acc, curr) => {
      const g = curr.genre || "global";
      if (!acc[g]) acc[g] = [];
      acc[g].push(curr);
      return acc;
    }, {} as Record<string, TrainingSuggestion[]>);

    let totalSaved = 0;
    const supabase = createClient();
    
    for (const [genre, terms] of Object.entries(grouped)) {
      let mappedGenre = genre === "global" ? "core" : genre;
      const targetSource = `${mappedGenre}_names` as DictSource;
      const savedCount = await appendToDictSource(targetSource, terms.map(t => ({ chinese: t.chinese, vietnamese: t.vietnamese })));
      
      if (savedCount > 0) {
        totalSaved += savedCount;
        
        // Auto-upload to Supabase
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
  };

  const handleStartQueue = () => {
    if (!input.trim()) return;
    // Configure and start the global training manager
    const workerConfigs: TrainingWorkerConfig[] = workers
      .filter(w => w.providerId && w.modelId)
      .map(w => ({ id: w.id, providerId: w.providerId, modelId: w.modelId }));
    
    configureTraining({
      workers: workerConfigs,
      autoSave,
      targetGenres,
      selectedChapterId,
    });
    startTraining();
  };

  // Update the manager whenever selectedChapterId changes
  useEffect(() => {
    updateSelectedChapterId(selectedChapterId);
  }, [selectedChapterId]);

  return (
    <main className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden px-6 py-4">
      <div className="mb-4 flex shrink-0 items-start justify-between flex-col sm:flex-row gap-2">
        <div>
          <h1 className="font-serif text-2xl font-bold">Convert QT (Live Test)</h1>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {input && (
            <Button variant="ghost" size="icon-sm" onClick={handleClear} title="Xóa toàn bộ">
              <Trash2Icon className="size-3.5" />
            </Button>
          )}

          {input && <div className="h-5 w-px bg-border hidden sm:block" />}

          {activeTab === "qt" && (
            <div className="flex items-center gap-2 border-l pl-4 mr-2">
              <Switch id="edit-mode" checked={editMode} onCheckedChange={setEditMode} />
              <Label htmlFor="edit-mode" className="text-sm">Sửa bản gốc</Label>
            </div>
          )}

          {activeTab === "train" && (
            <>
              {isQueueRunning ? (
                <Button variant="destructive" size="sm" onClick={stopTraining} className="animate-pulse">
                  <LoaderIcon className="mr-1.5 size-3.5 animate-spin" />
                  Dừng Phân tích
                </Button>
              ) : (
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleStartQueue}
                  disabled={!input.trim()}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <SparklesIcon className="mr-1.5 size-3.5" />
                  Bắt đầu Cuốn chiếu Song song (15 dòng/Worker)
                </Button>
              )}
              
              <div className="flex items-center gap-2 border-l pl-2 ml-2">
                <Switch id="auto-save" checked={autoSave} onCheckedChange={setAutoSave} />
                <Label htmlFor="auto-save" className="text-xs">Tự động Lưu</Label>
              </div>
            </>
          )}

          <div className="flex items-center gap-2">
            {isConvertingQT && activeTab === "qt" && (
              <LoaderIcon className="size-4 animate-spin text-muted-foreground mr-2" />
            )}
            
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              <FileUpIcon className="mr-1.5 size-3.5" /> Nhập File txt
            </Button>
            <input type="file" accept=".txt" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-[600px] flex flex-col">
        <Tabs value={activeTab} onValueChange={(v: string) => setActiveTab(v as ConvertTab)} className="mb-2 w-full">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center bg-muted/30 p-1 rounded-md border gap-2">
            <TabsList className="bg-transparent border-none h-8 shrink-0">
              <TabsTrigger value="qt" className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Từ điển QT (Live)</TabsTrigger>
              <TabsTrigger value="train" className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Train từ điển (Đa luồng)</TabsTrigger>
              <TabsTrigger value="results" className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Kết quả Từ điển Đã Lưu</TabsTrigger>
            </TabsList>
            
            {activeTab === "train" && (
              <div className="flex items-center gap-2 mr-2 flex-wrap">
                <LibraryIcon className="size-3.5 text-muted-foreground shrink-0" />
                <Select value={selectedNovelId} onValueChange={setSelectedNovelId} disabled={isQueueRunning}>
                  <SelectTrigger className="h-7 text-xs w-[160px]">
                    <SelectValue placeholder="Chọn truyện..." />
                  </SelectTrigger>
                  <SelectContent>
                    {novels?.map(n => (
                      <SelectItem key={n.id} value={n.id} className="text-xs">{n.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                {selectedNovelId && (
                  <Select value={selectedChapterId} onValueChange={setSelectedChapterId} disabled={isQueueRunning}>
                    <SelectTrigger className="h-7 text-xs w-[120px]">
                      <SelectValue placeholder="Chọn chương..." />
                    </SelectTrigger>
                    <SelectContent>
                      {chapters?.map(c => (
                        <SelectItem key={c.id} value={c.id} className="text-xs">{c.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                <div className="h-4 w-px bg-border mx-1 hidden sm:block" />
                
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="xs" disabled={isQueueRunning} className="h-7 text-xs bg-emerald-500/5 border-emerald-500/20 text-emerald-700">
                      {targetGenres.includes("auto") || targetGenres.length === 0
                        ? "Tất cả thể loại (AI tự chọn)"
                        : `Đã chọn: ${targetGenres.length} thể loại`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-80 p-3">
                    <h4 className="font-semibold text-xs mb-2 text-muted-foreground">Chọn thể loại lưu từ vựng</h4>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => store.setTargetGenres(["auto"])}
                        className={cn(
                          "text-[10px] px-2 py-1 rounded-md border transition-colors",
                          targetGenres.includes("auto") ? "bg-emerald-500 text-white border-emerald-500" : "bg-background hover:bg-muted"
                        )}
                      >
                        Tất cả thể loại (AI tự chọn)
                      </button>
                      {allGenreSources.map(genre => {
                        const isActive = targetGenres.includes(genre) && !targetGenres.includes("auto");
                        return (
                          <button
                            key={genre}
                            onClick={() => {
                              const newGenres = targetGenres.filter(g => g !== "auto" && g !== genre);
                              if (!isActive) newGenres.push(genre);
                              store.setTargetGenres(newGenres.length > 0 ? newGenres : ["auto"]);
                            }}
                            className={cn(
                              "text-[10px] px-2 py-1 rounded-md border transition-colors",
                              isActive ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
                            )}
                          >
                            {GENRE_LABELS[genre] || genre}
                          </button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            )}
            
            <div className="text-[10px] text-muted-foreground mr-2 flex items-center gap-2">
              {activeTab === "qt" && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="xs" className="h-6 text-[10px] border-primary/20 text-primary bg-primary/5 hover:bg-primary/10">
                      <WrenchIcon className="size-3 mr-1" /> Từ điển: {activeDictSources.length}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-80 p-3">
                    <h4 className="font-semibold text-xs mb-2 text-muted-foreground">Chọn bối cảnh truyện để dịch Live</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {allGenreSources.map(src => {
                        const isActive = activeDictSources.includes(src);
                        return (
                          <button
                            key={src}
                            onClick={() => {
                              if (isActive) setActiveDictSources(activeDictSources.filter(s => s !== src));
                              else setActiveDictSources([...activeDictSources, src]);
                            }}
                            className={cn(
                              "text-[10px] px-2 py-1 rounded-md border transition-colors",
                              isActive ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
                            )}
                          >
                            {GENRE_LABELS[src] || src}
                          </button>
                        )
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>
        </Tabs>

        {activeTab === "qt" && (
          <TextCompareEditor
            panelWrapperClassName="h-[calc(100vh-200px)] min-h-[500px]"
            leftValue={input}
            rightValue={qtOut}
            onChange={editMode ? setInput : undefined}
            editableSide={editMode ? "left" : undefined}
            storageKey="convert-qt"
            leftLabel="Văn bản gốc (Trung)"
            rightLabel="Từ điển QT (Tự động cập nhật)"
          />
        )}
        
        {activeTab === "train" && (
          <div className="flex flex-col gap-4 h-[calc(100vh-200px)] min-h-[500px] overflow-y-auto pr-2 pb-10">
            <div className="flex flex-col rounded-xl border bg-background shadow-sm overflow-hidden shrink-0">
              <div className="bg-muted px-4 py-2 font-semibold text-sm border-b shrink-0 flex justify-between">
                <span>Văn bản gốc chờ phân tích</span>
                <span className="text-xs font-normal text-muted-foreground">Tự động cắt 15 dòng cho mỗi luồng</span>
              </div>
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="flex-1 resize-y rounded-none border-0 focus-visible:ring-0 p-4 min-h-[150px] max-h-[300px]"
                placeholder="Dán nội dung tiếng Trung, nhập File txt, hoặc chọn truyện từ thư viện ở bên trên..."
              />
            </div>

            <div className="flex flex-col gap-2">
              <h3 className="font-semibold text-sm text-muted-foreground pl-1">Công nhân AI (Workers)</h3>
              <div className="flex flex-col gap-2">
                {displayWorkers.map((worker) => (
                  <WorkerCard 
                    key={worker.id} 
                    worker={worker} 
                    availableProviders={availableProviders}
                    onUpdate={(updates) => setWorkers(prev => prev.map(w => w.id === worker.id ? { ...w, ...updates } : w))}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "results" && (
          <div className="flex flex-col rounded-xl border bg-background shadow-sm overflow-hidden h-[calc(100vh-200px)] min-h-[500px]">
            <div className="bg-muted px-4 py-2 font-semibold text-sm border-b shrink-0 flex justify-between items-center">
              <span>Các Thể Loại Từ Điển Đã Train ({extractedTerms.length} từ)</span>
              <div className="flex items-center gap-2">
                {extractedTerms.length > 0 && !autoSave && (
                  <Button size="xs" variant="secondary" onClick={() => processAutoSave(extractedTerms)}>Lưu toàn bộ</Button>
                )}
                {extractedTerms.length > 0 && (
                  <Button size="xs" variant="outline" onClick={() => {
                    const seen = new Set<string>();
                    const deduped = extractedTerms.filter(t => {
                      if (seen.has(t.chinese)) return false;
                      seen.add(t.chinese);
                      return true;
                    });
                    const removed = extractedTerms.length - deduped.length;
                    store.setExtractedTerms(deduped);
                    toast.success(`Đã lọc ${removed} từ trùng lặp.`);
                  }}>Lọc trùng ({extractedTerms.length - new Set(extractedTerms.map(t => t.chinese)).size})</Button>
                )}
                {extractedTerms.length > 0 && (
                  <Button size="xs" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => { if(confirm('Xóa toàn bộ kết quả đã train?')) store.setExtractedTerms([]); }}>Xóa tất cả</Button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-muted/10">
              {extractedTerms.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm">
                  {isQueueRunning ? (
                    <><LoaderIcon className="size-6 animate-spin mb-2" /> Đang nhận kết quả từ các luồng AI...</>
                  ) : "Kết quả từ các AI sẽ được phân loại vào từng ngăn kéo tương ứng ở đây."}
                </div>
              ) : (
                <GroupedExtractionList terms={extractedTerms} onRemove={(term) => store.removeExtractedTerm(term)} isAdmin={isAdmin} />
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────────────

function WorkerCard({ 
  worker, 
  availableProviders, 
  onUpdate 
}: { 
  worker: WorkerState, 
  availableProviders: ReturnType<typeof useAIProviders>,
  onUpdate: (u: Partial<WorkerState>) => void 
}) {
  const models = useAIModels(worker.providerId);
  
  useEffect(() => {
    if (models && models.length > 0 && !worker.modelId) {
      onUpdate({ modelId: models[0].modelId });
    }
  }, [models, worker.modelId, onUpdate]);

  return (
    <div className={cn("border rounded-lg flex items-stretch overflow-hidden text-xs transition-colors h-[100px]", worker.isProcessing ? "border-emerald-500 shadow-sm bg-emerald-50/30" : "bg-muted/10")}>
      <div className={cn("px-3 py-2 font-bold border-r flex flex-col justify-center items-center w-20 shrink-0", worker.isProcessing ? "bg-emerald-500/10 text-emerald-700" : "bg-muted text-muted-foreground")}>
        <BotIcon className="size-5 mb-1" />
        W{worker.id}
        {worker.isProcessing && <LoaderIcon className="size-3 animate-spin mt-1" />}
      </div>
      
      <div className="p-3 border-r bg-background flex flex-col justify-center gap-2 w-[220px] shrink-0">
        <Select value={worker.providerId} onValueChange={v => onUpdate({ providerId: v, modelId: "" })} disabled={worker.isProcessing}>
          <SelectTrigger className="h-7 px-2 text-[11px]">
            <SelectValue placeholder="AI API" />
          </SelectTrigger>
          <SelectContent>
            {availableProviders?.map(p => (
              <SelectItem key={p.id} value={p.id} className="text-[11px]">{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        
        <Select value={worker.modelId} onValueChange={v => onUpdate({ modelId: v })} disabled={!models?.length || worker.isProcessing}>
          <SelectTrigger className="h-7 px-2 text-[11px]">
            <SelectValue placeholder="Model" />
          </SelectTrigger>
          <SelectContent>
            {models?.map(m => (
              <SelectItem key={m.modelId} value={m.modelId} className="text-[11px]">{m.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="p-3 flex-1 overflow-hidden relative">
        {worker.currentChunk ? (
          <div className="text-[10px] text-muted-foreground whitespace-pre-wrap leading-tight opacity-80 h-full overflow-y-auto pr-2 custom-scrollbar">
            {worker.currentChunk}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <span className="text-[10px] text-muted-foreground/50 italic">Đang chờ việc...</span>
          </div>
        )}
      </div>
    </div>
  );
}

function GroupedExtractionList({ terms, onRemove, isAdmin }: { terms: TrainingSuggestion[], onRemove: (term: TrainingSuggestion) => void, isAdmin?: boolean }) {
  const grouped = terms.reduce((acc, curr) => {
    const g = curr.genre || "global";
    const mappedGenre = g === "global" ? "core" : g;
    const c = curr.category || "tuvung";
    const mappedCat = ["names", "names2", "phienam", "luatnhan", "tuvung"].includes(c) ? c : "tuvung";
    const key = `${mappedGenre}_${mappedCat}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(curr);
    return acc;
  }, {} as Record<string, TrainingSuggestion[]>);

  const handleDownloadDict = async (targetSource: string) => {
    try {
      await exportDictSource(targetSource as DictSource);
      toast.success(`Đã tải xuống kho từ điển ${targetSource}.txt`);
    } catch (err) {
      toast.error("Lỗi khi tải từ điển");
    }
  };

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([targetSource, items]) => {
        const [g, c] = targetSource.split("_");
        const catLabel = c === "names" ? "Tên nhân vật, địa danh" : c === "names2" ? "Tên bổ sung" : c === "phienam" ? "Phiên âm" : c === "luatnhan" ? "Luật nhân xưng" : c === "tuvung" ? "Từ vựng thể loại" : "Từ điển chính";
        const label = `${GENRE_LABELS[g] || g} - ${catLabel} (${targetSource})`;
        return (
        <div key={targetSource} className="space-y-2 bg-background border p-4 rounded-xl shadow-sm">
          <h4 className="font-bold text-[13px] text-primary border-b pb-2 uppercase flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span>{label}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="font-mono">{items.length} từ mới</Badge>
              {isAdmin && (
                <Button size="xs" variant="outline" className="h-5 px-2 text-[10px]" onClick={() => handleDownloadDict(targetSource)}>
                  Tải Kho Từ Điển (.txt)
                </Button>
              )}
            </div>
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[400px] overflow-y-auto pr-1">
            {items.map((term, idx) => (
               <div key={`${term.chinese}-${idx}`} className="flex flex-col gap-1.5 p-2 bg-muted/20 rounded-md border hover:border-emerald-500/50 transition-colors">
                 <div className="flex items-center justify-between">
                   <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 bg-background">{term.category}</Badge>
                   <span className="text-[9px] text-muted-foreground italic truncate max-w-[120px]">{term.context_zh}</span>
                 </div>
                 <div className="flex items-center gap-2">
                   <span className="font-mono font-bold text-sm text-foreground/90">{term.chinese}</span>
                   <ArrowRightLeftIcon className="size-3 text-muted-foreground/50 shrink-0" />
                   <span className="font-medium text-emerald-600 text-sm truncate">{term.vietnamese}</span>
                 </div>
               </div>
            ))}
          </div>
        </div>
        );
      })}
    </div>
  );
}
