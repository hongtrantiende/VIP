"use client";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { db, type Chapter, GENRE_LABELS } from "@/lib/db";
import { runQtAiTranslate, type PromptType, STYLE_PRESETS } from "@/lib/chapter-tools/qt-ai-translate";
import { BotQueueSubmit } from "@/components/novel/bot-queue-submit";
import { runHybridTranslate } from "@/lib/chapter-tools/hybrid-translate";
import type { HybridTranslateResult, HybridTranslateError } from "@/lib/chapter-tools/hybrid-translate";
import { PromptTunerDialog } from "@/components/novel/prompt-tuner-dialog";
import { StyleTunerDialog } from "@/components/novel/style-tuner-dialog";
import { PronounTunerDialog } from "@/components/novel/pronoun-tuner-dialog";
import { scanNovelStyle } from "@/lib/chapter-tools/scan-novel-style";
import { NSFW_INSTRUCTION } from "@/lib/writing/prompts";
import {
    useAIProvider,
    useApiInferenceProviders,
    useAIModels,
} from "@/lib/hooks/use-ai-providers";
import { runComprehensiveTranslate } from "@/lib/chapter-tools/comprehensive-translate";
import { runEditTranslate } from "@/lib/chapter-tools/edit-translate";
import { runScanFix } from "@/lib/chapter-tools/scan-fix-translate";
import { streamText } from "ai";
import { runLocalNameScan, applyFix } from "@/lib/chapter-tools/local-name-scanner";
import type { ScanIssue } from "@/lib/chapter-tools/local-name-scanner";
import { getOriginalContent } from "@/lib/hooks/use-scene-versions";
import { useAnalysisSettings } from "@/lib/hooks/use-analysis-settings";
import { useChatSettings } from "@/lib/hooks/use-chat-settings";
import {
    resolveChapterToolModel,
    getChapterToolModelMissingMessage,
} from "@/lib/chapter-tools/stream-runner";
import type { StepModelConfig } from "@/lib/db";
import {
    CheckCircle2Icon,
    Loader2Icon,
    XCircleIcon,
    BookOpenIcon,
    SparklesIcon,
    ZapIcon,
    ScanSearchIcon,
    CrownIcon,
    PlusIcon,
    Trash2Icon,
    StopCircleIcon,
    PenToolIcon,
    ShieldCheckIcon,
    LanguagesIcon,
    WandIcon,
    BotIcon,
    HelpCircleIcon,
    UsersIcon,
    CheckIcon,
    SearchIcon,
    AlertTriangleIcon,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { toast } from "sonner";
import { useLiveQuery } from "dexie-react-hooks";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useDictMeta } from "@/lib/hooks/use-dict-entries";
import { useProfile } from "@/lib/hooks/use-profile";
import { cn, countWords } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useBulkTranslateStore } from "@/lib/stores/bulk-translate";
import { cleanErrorCausingCharacters } from "@/lib/text-utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";


// ── Types ──
type Phase = "idle" | "dict" | "ai" | "done" | "model1" | "model2" | "model3";
type TranslateMode = "prompt" | "stv-prompt" | "edit" | "comprehensive" | "scan-fix";

const MODES: { id: TranslateMode; label: string; icon: React.ElementType; color: string; desc: string }[] = [
    { id: "prompt", label: "Dịch Prompt", icon: SparklesIcon, color: "text-blue-600 dark:text-blue-400", desc: "Dịch thuần AI theo system prompt, không dùng từ điển" },
    { id: "stv-prompt", label: "STV + Prompt", icon: BookOpenIcon, color: "text-emerald-600 dark:text-emerald-400", desc: "Từ điển STV chuyển đổi thô → AI sửa lỗi theo prompt" },
    { id: "edit", label: "Biên Tập AI", icon: PenToolIcon, color: "text-amber-600 dark:text-amber-400", desc: "Biên tập & làm mịn bản dịch tiếng Việt cho trôi chảy, đúng từ điển, mượt mà theo thể loại" },
    { id: "scan-fix", label: "Quét & Sửa", icon: ShieldCheckIcon, color: "text-rose-600 dark:text-rose-400", desc: "Quét và phát hiện lỗi chính tả, viết sai tên nhân vật theo từ điển" },
];

const GENRE_DICTS = [
    "hiendai", "tienhiep", "huyenhuyen", "dammi", "hocduong",
    "dothi", "vongdu", "dongnhan", "ngontinh"
];

const GENRE_LABEL_MAP: Record<string, string> = {
    hiendai: "Hiện đại", tienhiep: "Tiên hiệp", huyenhuyen: "Huyền huyễn",
    dammi: "Đam mỹ", hocduong: "Học đường", dothi: "Đô thị",
    vongdu: "Võng du", dongnhan: "Đồng nhân", ngontinh: "Ngôn tình"
};

// ── ExtraModelRow sub-component ──
function ExtraModelRow({
    index,
    providers,
    value,
    onChange,
    onRemove,
}: {
    index: number;
    providers: any[] | undefined;
    value: { providerId: string; modelId: string };
    onChange: (val: { providerId: string; modelId: string }) => void;
    onRemove: () => void;
}) {
    const models = useAIModels(value.providerId);
    return (
        <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground w-4 shrink-0">#{index + 2}</span>
            <Select value={value.providerId} onValueChange={(val) => onChange({ providerId: val, modelId: "" })}>
                <SelectTrigger className="flex-1 h-7 text-xs"><SelectValue placeholder="Provider..." /></SelectTrigger>
                <SelectContent>{providers?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={value.modelId} onValueChange={(val) => onChange({ ...value, modelId: val })} disabled={!value.providerId}>
                <SelectTrigger className="flex-1 h-7 text-xs"><SelectValue placeholder="Model..." /></SelectTrigger>
                <SelectContent>{models?.map(m => <SelectItem key={m.id} value={m.modelId}>{m.name || m.modelId}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="ghost" size="icon-xs" onClick={onRemove}><Trash2Icon className="size-3" /></Button>
        </div>
    );
}

// ── Main Component ──
export function TranslateTabPanel({
    open,
    onOpenChange,
    novelId,
    chapterIds,
    chapters,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    novelId: string;
    chapterIds: string[];
    chapters: Chapter[];
}) {
    const providers = useApiInferenceProviders();
    const { profile, isVip, isAdmin } = useProfile();

    // AI Model state
    const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>();
    const [selectedModelId, setSelectedModelId] = useState<string | undefined>();
    const [extraModels, setExtraModels] = useState<Array<{ providerId: string; modelId: string }>>([]);
    const models = useAIModels(selectedProviderId);
    const currentModel = models?.find(m => m.modelId === selectedModelId);
    const novel = useLiveQuery(() => db.novels.get(novelId), [novelId]);

    // 3-Model Pipeline Configuration State
    const [model1ProviderId, setModel1ProviderId] = useState<string>("");
    const [model1ModelId, setModel1ModelId] = useState<string>("");
    const [model2ProviderId, setModel2ProviderId] = useState<string>("");
    const [model2ModelId, setModel2ModelId] = useState<string>("");
    const [model3Enabled, setModel3Enabled] = useState<boolean>(false);
    const [model3ProviderId, setModel3ProviderId] = useState<string>("");
    const [model3ModelId, setModel3ModelId] = useState<string>("");
    const [customModel2Prompt, setCustomModel2Prompt] = useState<string>("");
    const [customModel3Prompt, setCustomModel3Prompt] = useState<string>("");

    const model1Models = useAIModels(model1ProviderId);
    const model2Models = useAIModels(model2ProviderId);
    const model3Models = useAIModels(model3ProviderId);

    // Mode & config state
    const [activeMode, setActiveMode] = useState<TranslateMode>("prompt");
    const [step, setStep] = useState<"config" | "processing" | "done">("config");
    const [processedCount, setProcessedCount] = useState(0);
    const [errors, setErrors] = useState<any[]>([]);
    const [results, setResults] = useState<any[]>([]);
    const [currentPhase, setCurrentPhase] = useState<Phase>("idle");
    const [currentChapterTitle, setCurrentChapterTitle] = useState("");
    const [tunerOpen, setTunerOpen] = useState(false);
    const [tuner2Open, setTuner2Open] = useState(false);
    const [tuner3Open, setTuner3Open] = useState(false);
    const [qtDictSources, setQtDictSources] = useState<string[]>(["tienhiep"]);
    const [extractDict, setExtractDict] = useState(true);
    const [skipTranslated, setSkipTranslated] = useState(true);
    const [errorAction, setErrorAction] = useState<"stop" | "skip">("stop");
    const [twoPass, setTwoPass] = useState(true);
    const [inlinePrompt, setInlinePrompt] = useState("");
    const [customStylePrompt, setCustomStylePrompt] = useState("");
    const [customPronounPrompt, setCustomPronounPrompt] = useState("");
    const [styleTunerOpen, setStyleTunerOpen] = useState(false);
    const [pronounTunerOpen, setPronounTunerOpen] = useState(false);
    const [isScanningInline, setIsScanningInline] = useState(false);
    const [stylePreset, setStylePreset] = useState<string>("default");
    const [pronounMatrix, setPronounMatrix] = useState<string>("");
    const [pronounMatrixEnabled, setPronounMatrixEnabled] = useState(false);
    const [isCleaning, setIsCleaning] = useState(false);
    const [cleanGarbage, setCleanGarbage] = useState(true);
    const [nsfwMode, setNsfwMode] = useState(false);
    const [chunkMode, setChunkMode] = useState<"chunk" | "full">("chunk");
    const [hanVietRatio, setHanVietRatio] = useState<number>(50);
    const [showStepsInfo, setShowStepsInfo] = useState(false);
    const [totalToProcess, setTotalToProcess] = useState(0);
    const abortRef = useRef<AbortController | null>(null);
    const isUnderMaintenance = false;


    // Initialize from novel data
    const loadedNovelIdRef = useRef<string | null>(null);

    useEffect(() => {
        if (!novel || !providers || providers.length === 0) return;
        if (loadedNovelIdRef.current === novelId) return;

        loadedNovelIdRef.current = novelId;

        // Restore mode tab
        if (novel.customTranslateMode && MODES.some(m => m.id === novel.customTranslateMode)) {
            setActiveMode(novel.customTranslateMode as TranslateMode);
        }

        // Restore provider and model
        if (novel.customTranslateProviderId) {
            setSelectedProviderId(novel.customTranslateProviderId);
            if (novel.customTranslateModelId) setSelectedModelId(novel.customTranslateModelId);
        } else {
            const adminP = providers.find(p => p.id === "admin-provider");
            setSelectedProviderId(adminP ? "admin-provider" : providers[0].id);
        }

        // Restore 3-model configuration
        if (novel.customModel1ProviderId) {
            setModel1ProviderId(novel.customModel1ProviderId);
            setModel1ModelId(novel.customModel1ModelId || "");
        } else if (novel.customTranslateProviderId) {
            setModel1ProviderId(novel.customTranslateProviderId);
            setModel1ModelId(novel.customTranslateModelId || "");
        } else {
            const adminP = providers.find(p => p.id === "admin-provider");
            setModel1ProviderId(adminP ? "admin-provider" : providers[0].id);
        }

        if (novel.customModel2ProviderId) {
            setModel2ProviderId(novel.customModel2ProviderId);
            setModel2ModelId(novel.customModel2ModelId || "");
        } else {
            setModel2ProviderId("");
            setModel2ModelId("");
        }

        if (novel.customModel3ProviderId) {
            setModel3ProviderId(novel.customModel3ProviderId);
            setModel3ModelId(novel.customModel3ModelId || "");
        } else {
            setModel3ProviderId("");
            setModel3ModelId("");
        }

        setModel3Enabled(!!novel.customModel3Enabled);
    }, [novel, providers, novelId]);

    useEffect(() => {
        if (novel) {
            if (novel.customTranslatePrompt !== undefined) setInlinePrompt(novel.customTranslatePrompt);
            if (novel.customStylePrompt !== undefined) setCustomStylePrompt(novel.customStylePrompt);
            if (novel.customPronounPrompt !== undefined) setCustomPronounPrompt(novel.customPronounPrompt);
            if (novel.customModel2Prompt !== undefined) setCustomModel2Prompt(novel.customModel2Prompt);
            if (novel.customModel3Prompt !== undefined) setCustomModel3Prompt(novel.customModel3Prompt);
            setStylePreset(novel.stylePreset ?? "default");
            setPronounMatrix(novel.pronounMatrix ?? "");
            setPronounMatrixEnabled(novel.pronounMatrixEnabled ?? false);
        }
    }, [novel]);

    const translateJob = useBulkTranslateStore((s) => s.jobs[novelId]);

    // Đồng bộ trạng thái chạy dịch với Zustand Store
    useEffect(() => {
        if (!open) return;
        if (translateJob) {
            if (translateJob.isRunning || translateJob.step === "progress") {
                setStep("processing");
                setProcessedCount(translateJob.chaptersCompleted);
                setTotalToProcess(translateJob.totalChapters);
                setResults(Array.from(translateJob.results.values()));
                setErrors(translateJob.errors);
                if (translateJob.currentChapterId) {
                    const currentChapter = chapters.find((c) => c.id === translateJob.currentChapterId);
                    if (currentChapter) {
                        setCurrentChapterTitle(currentChapter.title);
                    }
                }
            } else if (translateJob.step === "results") {
                setStep("done");
                setProcessedCount(translateJob.chaptersCompleted);
                setTotalToProcess(translateJob.totalChapters);
                setResults(Array.from(translateJob.results.values()));
                setErrors(translateJob.errors);
            }
        }
    }, [open, translateJob, chapters]);

    // Auto-detect genre dict
    useEffect(() => {
        if (novel?.genre) {
            const gLower = novel.genre.toLowerCase();
            let matchedKey = "tienhiep";
            for (const [key, label] of Object.entries(GENRE_LABEL_MAP)) {
                if (gLower === label.toLowerCase() || gLower.includes(label.toLowerCase())) {
                    matchedKey = key;
                    break;
                }
            }
            setQtDictSources([matchedKey]);
        }
    }, [novel?.genre]);

    const dictMeta = useDictMeta();
    const dynamicGenres = useMemo(() => {
        if (!dictMeta) return [];
        const genres = new Set<string>();
        for (const source of Object.keys(dictMeta.sources)) {
            const g = source.split("_")[0];
            if (g && g !== "core" && !GENRE_DICTS.includes(g)) genres.add(g);
        }
        return Array.from(genres);
    }, [dictMeta]);
    const allGenreSources = [...GENRE_DICTS, ...dynamicGenres];

    const settings = useAnalysisSettings();
    const chatSettings = useChatSettings();
    const defaultProvider = useAIProvider(chatSettings?.providerId);
    const rawQuota = profile?.admin_model_quota || 0;

    useEffect(() => {
        if (settings) {
            setChunkMode(settings.translateChunkMode || "chunk");
            setHanVietRatio(settings.hanVietRatio ?? 50);
        }
    }, [settings]);

    // ── Handlers ──
    const handleProviderChange = async (val: string) => {
        setSelectedProviderId(val);
        setSelectedModelId(undefined);
        await db.novels.update(novelId, { customTranslateProviderId: val, customTranslateModelId: "" });
    };

    const handleModelChange = async (val: string) => {
        setSelectedModelId(val);
        await db.novels.update(novelId, { customTranslateModelId: val });
    };

    const handleModel1ProviderChange = async (val: string) => {
        setModel1ProviderId(val);
        setModel1ModelId("");
        await db.novels.update(novelId, { customModel1ProviderId: val, customModel1ModelId: "" });
    };
    const handleModel1ModelChange = async (val: string) => {
        setModel1ModelId(val);
        await db.novels.update(novelId, { customModel1ModelId: val });
    };

    const handleModel2ProviderChange = async (val: string) => {
        setModel2ProviderId(val);
        setModel2ModelId("");
        await db.novels.update(novelId, { customModel2ProviderId: val, customModel2ModelId: "" });
    };
    const handleModel2ModelChange = async (val: string) => {
        setModel2ModelId(val);
        await db.novels.update(novelId, { customModel2ModelId: val });
    };

    const handleModel3ProviderChange = async (val: string) => {
        setModel3ProviderId(val);
        setModel3ModelId("");
        await db.novels.update(novelId, { customModel3ProviderId: val, customModel3ModelId: "" });
    };
    const handleModel3ModelChange = async (val: string) => {
        setModel3ModelId(val);
        await db.novels.update(novelId, { customModel3ModelId: val });
    };
    const handleModel3EnabledToggle = async (val: boolean) => {
        setModel3Enabled(val);
        await db.novels.update(novelId, { customModel3Enabled: val });
    };
    const handleModel3PromptChange = async (val: string) => {
        setCustomModel3Prompt(val);
        await db.novels.update(novelId, { customModel3Prompt: val });
    };

    const resolveModel = useCallback(async () => {
        let activeModel = novel?.customTranslateProviderId
            ? { providerId: novel.customTranslateProviderId, modelId: novel.customTranslateModelId || "" }
            : settings.translateModel;

        if (selectedProviderId === "admin-provider" && selectedModelId) {
            activeModel = { providerId: "admin-provider", modelId: selectedModelId };
        }

        const model = await resolveChapterToolModel(activeModel, defaultProvider, chatSettings);
        if (!model) toast.error(getChapterToolModelMissingMessage(defaultProvider));
        return model;
    }, [novel?.customTranslateProviderId, novel?.customTranslateModelId, settings.translateModel, defaultProvider, chatSettings, selectedProviderId, selectedModelId]);

    const handleSaveInlinePrompt = async () => {
        await db.novels.update(novelId, { customTranslatePrompt: inlinePrompt.trim(), updatedAt: new Date() });
        toast.success("Đã lưu quy tắc xưng hô!");
    };

    const handleCleanErrorChars = async () => {
        if (chapterIds.length === 0) return;
        setIsCleaning(true);
        try {
            let cleanedCount = 0;
            for (const chId of chapterIds) {
                // Clean chapter title in database first
                const chapter = await db.chapters.get(chId);
                if (chapter) {
                    const cleanedTitle = cleanErrorCausingCharacters(chapter.title);
                    if (cleanedTitle !== chapter.title) {
                        await db.chapters.update(chId, {
                            title: cleanedTitle,
                            updatedAt: new Date()
                        });
                    }
                }

                const scenes = await db.scenes
                    .where("chapterId")
                    .equals(chId)
                    .toArray();

                for (const scene of scenes) {
                    // Update active scene if it's original (not translated yet, and version is 1 or manual)
                    if (scene.isActive === 1 && (scene.versionType === "manual" || scene.version === 1)) {
                        const cleaned = cleanErrorCausingCharacters(scene.content);
                        if (cleaned !== scene.content) {
                            await db.scenes.update(scene.id, {
                                content: cleaned,
                                wordCount: countWords(cleaned),
                                updatedAt: new Date()
                            });
                            cleanedCount++;
                        }
                    }
                    // Update inactive original snapshot (version 1) if it exists
                    if (scene.isActive === 0 && scene.version === 1) {
                        const cleaned = cleanErrorCausingCharacters(scene.content);
                        if (cleaned !== scene.content) {
                            await db.scenes.update(scene.id, {
                                content: cleaned,
                                wordCount: countWords(cleaned),
                                updatedAt: new Date()
                            });
                        }
                    }
                }
            }
            toast.success("Đã dọn dẹp xong emoji/icon lỗi cho các chương!");
        } catch (err: any) {
            toast.error("Lỗi khi dọn dẹp: " + err.message);
        } finally {
            setIsCleaning(false);
        }
    };


    const getSampleText = async () => {
        const chaps = await db.chapters.where("novelId").equals(novelId).sortBy("order");
        const firstChapters = chaps.slice(0, 10);
        if (firstChapters.length === 0) throw new Error("Truyện chưa có chương nào.");

        const chapterIdsSet = new Set(firstChapters.map(c => c.id));
        const allScenes = await db.scenes.where("[novelId+isActive]").equals([novelId, 1]).toArray();
        const scenesByChapter = new Map<string, typeof allScenes>();
        for (const s of allScenes) {
            if (!chapterIdsSet.has(s.chapterId)) continue;
            const arr = scenesByChapter.get(s.chapterId) ?? [];
            arr.push(s);
            scenesByChapter.set(s.chapterId, arr);
        }

        const parts: string[] = [];
        for (const chapter of firstChapters) {
            const scenes = scenesByChapter.get(chapter.id) ?? [];
            if (scenes.length === 0) continue;
            const contents = await Promise.all(scenes.map(s => getOriginalContent(s.id)));
            const content = contents.join("\n\n");
            if (!content.trim()) continue;
            parts.push(content.slice(0, 1000));
        }

        return parts.join("\n---\n");
    };

    const handleInlineScan = async () => {
        const model = await resolveModel();
        if (!model) return;
        setIsScanningInline(true);
        try {
            const sampleText = await getSampleText();
            const result = await streamText({
                model,
                system: `Bạn là chuyên gia thiết lập prompt dịch thuật tiểu thuyết Trung-Việt chuyên nghiệp. Phân tích mẫu truyện và đề xuất 1 prompt hướng dẫn dịch thuật cụ thể, ngắn gọn (ví dụ: các lưu ý đặc biệt khi chuyển ngữ bộ này, cách hành văn, cách xưng xưng hô chung). Trả về bản mô tả cực kỳ ngắn gọn và thực tế, không có lời dẫn luận.`,
                prompt: "MẪU TRUYỆN:\n" + sampleText,
            });

            let fullText = "";
            for await (const chunk of result.textStream) { fullText += chunk; }

            if (!fullText.trim()) {
                throw new Error("Không nhận được phản hồi từ AI (kết quả rỗng). Vui lòng kiểm tra lại cấu hình API Key, kết nối mạng, hoặc thử model khác.");
            }

            setInlinePrompt(fullText.trim());
            await db.novels.update(novelId, { customTranslatePrompt: fullText.trim(), styleScannedAt: new Date(), updatedAt: new Date() });
            toast.success("Quét prompt dịch thành công!");
        } catch (err: any) {
            toast.error("Quét thất bại: " + err.message);
        } finally {
            setIsScanningInline(false);
        }
    };



    const handleStart = useCallback(async (target: "selected" | "all_untranslated" = "selected") => {
        // Resolve model configurations
        let model: any = null;
        let model2: any = null;
        let model3: any = null;

        if (activeMode === "stv-prompt" || activeMode === "comprehensive" || activeMode === "prompt" || activeMode === "edit") {
            const config1 = { providerId: model1ProviderId, modelId: model1ModelId };
            if (!config1.providerId || !config1.modelId) {
                toast.error(activeMode === "edit" ? "Vui lòng cấu hình đầy đủ Model 1 (Biên tập chính)" : "Vui lòng cấu hình đầy đủ Model 1 (Dịch chính)");
                return;
            }
            model = await resolveChapterToolModel(config1, defaultProvider, chatSettings);
            if (!model) {
                toast.error(activeMode === "edit" ? "Không tìm thấy cấu hình Model 1 (Biên tập chính)" : "Không tìm thấy cấu hình Model 1 (Dịch chính)");
                return;
            }

            const config2 = { providerId: model2ProviderId, modelId: model2ModelId };
            if (activeMode !== "edit" && (!config2.providerId || !config2.modelId)) {
                toast.error("Vui lòng cấu hình đầy đủ Model 2 (Trích xuất từ điển)");
                return;
            }
            if (config2.providerId && config2.modelId) {
                model2 = await resolveChapterToolModel(config2, defaultProvider, chatSettings);
                if (!model2 && activeMode !== "edit") {
                    toast.error("Không tìm thấy cấu hình Model 2 (Trích xuất từ điển)");
                    return;
                }
            }

            if (model3Enabled) {
                const config3 = { providerId: model3ProviderId, modelId: model3ModelId };
                if (!config3.providerId || !config3.modelId) {
                    toast.error("Vui lòng cấu hình đầy đủ Model 3 (Audit/QA Bot) hoặc tắt nó đi!");
                    return;
                }
                model3 = await resolveChapterToolModel(config3, defaultProvider, chatSettings);
                if (!model3) {
                    toast.error("Không tìm thấy cấu hình Model 3 (Audit/QA Bot)");
                    return;
                }
            }
        } else {
            model = await resolveModel();
            if (!model) return;
        }

        // Auto-save prompt/xưng hô rules to DB before any translation mode starts
        const updateData: any = {
            customTranslateMode: activeMode,
            customStylePrompt: customStylePrompt.trim(),
            customPronounPrompt: customPronounPrompt.trim(),
            stylePreset: stylePreset,
            updatedAt: new Date()
        };
        if (activeMode === "prompt" || activeMode === "edit" || activeMode === "scan-fix") {
            updateData.customTranslatePrompt = inlinePrompt.trim();
        }
        await db.novels.update(novelId, updateData);

        // Resolve extra models (if in legacy mode)
        let resolvedModels: any[] | undefined;
        if (activeMode !== "stv-prompt" && extraModels.length > 0) {
            const allConfigs = [
                { providerId: selectedProviderId!, modelId: selectedModelId! },
                ...extraModels
            ].filter(item => item.providerId && item.modelId);
            const promises = allConfigs.map(item => resolveChapterToolModel({ providerId: item.providerId, modelId: item.modelId }, defaultProvider, chatSettings));
            resolvedModels = (await Promise.all(promises)).filter(Boolean);
        }

        const targetChapterIds = target === "selected" ? chapterIds : chapters.map(c => c.id);

        // Tự động dọn dẹp các ký tự lỗi (Emoji, Icon...) trong các chương gốc cần dịch (chạy ngầm, không block)
        setTimeout(async () => {
            try {
                for (const chId of targetChapterIds) {
                    // Clean chapter title in database first
                    const chapter = await db.chapters.get(chId);
                    if (chapter) {
                        const cleanedTitle = cleanErrorCausingCharacters(chapter.title);
                        if (cleanedTitle !== chapter.title) {
                            await db.chapters.update(chId, {
                                title: cleanedTitle,
                                updatedAt: new Date()
                            });
                        }
                    }

                    const scenes = await db.scenes
                        .where("chapterId")
                        .equals(chId)
                        .toArray();

                    for (const scene of scenes) {
                        if (scene.isActive === 1 && (scene.versionType === "manual" || scene.version === 1)) {
                            const cleaned = cleanErrorCausingCharacters(scene.content);
                            if (cleaned !== scene.content) {
                                await db.scenes.update(scene.id, {
                                    content: cleaned,
                                    wordCount: countWords(cleaned),
                                    updatedAt: new Date()
                                });
                            }
                        }
                        if (scene.isActive === 0 && scene.version === 1) {
                            const cleaned = cleanErrorCausingCharacters(scene.content);
                            if (cleaned !== scene.content) {
                                await db.scenes.update(scene.id, {
                                    content: cleaned,
                                    wordCount: countWords(cleaned),
                                    updatedAt: new Date()
                                });
                            }
                        }
                    }
                }
            } catch (cleanErr) {
                console.error("Auto cleanup failed:", cleanErr);
            }
        }, 50);

        // Khởi tạo và đồng bộ trạng thái dịch vào global store
        const store = useBulkTranslateStore.getState();
        store.start(novelId, targetChapterIds, selectedProviderId, selectedModelId);

        const job = store.jobs[novelId];
        const controller = job?.abortController || new AbortController();
        abortRef.current = controller;

        setTotalToProcess(targetChapterIds.length);
        setStep("processing");
        setProcessedCount(0);
        setErrors([]);
        setResults([]);
        setCurrentPhase("idle");

        const finalStylePrompt = nsfwMode ? `${customStylePrompt.trim()}\n\n${NSFW_INSTRUCTION}` : customStylePrompt.trim();

        const commonCallbacks = {
            signal: controller.signal,
            delayMs: (settings.translateDelaySeconds ?? 0) * 1000,
            onPhase: (_chId: string, phase: string) => setCurrentPhase(phase as Phase),
            onChapterStart: (_chId: string, title: string) => setCurrentChapterTitle(title),
            onChapterComplete: (result: any) => { setResults(prev => [...prev, result]); setProcessedCount(c => c + 1); },
            onChapterError: (error: any) => { setErrors(prev => [...prev, error]); setProcessedCount(c => c + 1); },
            onAllComplete: () => { if (!controller.signal.aborted) setStep("done"); },
        };

        try {
            if (activeMode === "comprehensive") {
                await runComprehensiveTranslate({
                    novelId, chapterIds: targetChapterIds, model, qtDictSources,
                    dictModel: model2 || undefined,
                    qaModel: model3 || undefined,
                    qaEnabled: model3Enabled,
                    qaPrompt: customModel3Prompt || undefined,
                    extractDict,
                    cleanGarbage,
                    customTranslatePrompt: novel?.customComprehensivePrompt || "",
                    customStylePrompt: finalStylePrompt,
                    customPronounPrompt: customPronounPrompt,
                    twoPass, skipTranslated, errorAction,
                    ...commonCallbacks,
                });
            } else if (activeMode === "stv-prompt") {
                await runHybridTranslate({
                    novelId, chapterIds: targetChapterIds, model,
                    dictModel: model2 || undefined,
                    qaModel: model3 || undefined,
                    qaEnabled: model3Enabled,
                    qaPrompt: customModel3Prompt || undefined,
                    customStylePrompt: finalStylePrompt,
                    globalTranslatePrompt: settings?.translateHybridPrompt,
                    extractDict, cleanGarbage, skipTranslated, continuousMode: target === "all_untranslated", errorAction,
                    chunkMode,
                    ...commonCallbacks,
                });
            } else if (activeMode === "prompt") {
                await runQtAiTranslate({
                    novelId, chapterIds: targetChapterIds, model, models: resolvedModels,
                    dictModel: model2 || undefined,
                    qaModel: model3 || undefined,
                    qaEnabled: model3Enabled,
                    qaPrompt: customModel3Prompt || undefined,
                    qtDictSources: [],
                    promptType: "custom" as PromptType,
                    globalTranslatePrompt: settings?.translatePrompt,
                    customStylePrompt: finalStylePrompt,
                    customPronounPrompt: customPronounPrompt,
                    extractDict, cleanGarbage, skipTranslated,
                    continuousMode: target === "all_untranslated", errorAction,
                    chunkMode,
                    hanVietRatio,
                    ...commonCallbacks,
                });

            } else if (activeMode === "edit") {
                await runEditTranslate({
                    novelId,
                    chapterIds: targetChapterIds,
                    model,
                    novelCustomPrompt: inlinePrompt,
                    globalEditPrompt: settings?.editPrompt,
                    customStylePrompt: finalStylePrompt,
                    customPronounPrompt: customPronounPrompt,
                    twoPass: twoPass,
                    qaModel: model3 || undefined,
                    qaEnabled: model3Enabled,
                    qaPrompt: customModel3Prompt || undefined,
                    cleanGarbage: cleanGarbage,
                    skipTranslated: skipTranslated,
                    errorAction: errorAction,
                    chunkMode,
                    ...commonCallbacks,
                });
            } else if (activeMode === "scan-fix") {
                await runScanFix({
                    novelId, chapterIds: targetChapterIds, model,
                    novelCustomPrompt: inlinePrompt,
                    chunkMode,
                    ...commonCallbacks,
                });
            }
        } catch (err: any) {
            if (err.name !== "AbortError") {
                toast.error("Lỗi: " + err.message);
                setStep("config");
            }
        }
    }, [novelId, chapterIds, chapters, settings, resolveModel, activeMode, extractDict, skipTranslated, qtDictSources, extraModels, selectedProviderId, selectedModelId, defaultProvider, chatSettings, inlinePrompt, twoPass, model1ProviderId, model1ModelId, model2ProviderId, model2ModelId, model3Enabled, model3ProviderId, model3ModelId, customStylePrompt, customPronounPrompt, errorAction, novel, nsfwMode]);

    const handleClose = () => {
        if (step === "processing" || translateJob?.isRunning) {
            abortRef.current?.abort();
            useBulkTranslateStore.getState().cancel(novelId);
        }
        useBulkTranslateStore.getState().reset(novelId);
        setStep("config");
        setProcessedCount(0);
        setErrors([]);
        setResults([]);
        setCurrentPhase("idle");
        onOpenChange(false);
    };

    const handleOpenChange = (isOpen: boolean) => {
        if (!isOpen) {
            if (step === "processing") {
                onOpenChange(false); // Just hide, don't abort
            } else {
                handleClose();
            }
        } else {
            onOpenChange(true);
        }
    };

    const progress = totalToProcess > 0 ? (processedCount / totalToProcess) * 100 : 0;
    const activeModeConfig = MODES.find(m => m.id === activeMode) || MODES[0];
    const ActiveIcon = activeModeConfig.icon;

    const bulkConfigContent = (
        <div className="space-y-4 py-2">
            {/* ── Mode Buttons ── */}
            <div className="grid grid-cols-4 gap-2">
                {MODES.map((mode) => {
                    const Icon = mode.icon;
                    const isActive = activeMode === mode.id;
                    return (
                        <button
                            key={mode.id}
                            type="button"
                            onClick={async () => {
                                setActiveMode(mode.id);
                                await db.novels.update(novelId, { customTranslateMode: mode.id });
                            }}
                            className={cn(
                                "flex flex-col items-center gap-1 rounded-lg border p-2 text-center transition-all",
                                isActive
                                    ? "border-primary bg-primary/10 shadow-sm"
                                    : "border-muted bg-background hover:bg-muted/50"
                            )}
                        >
                            <Icon className={cn("size-4", isActive ? mode.color : "text-muted-foreground")} />
                            <span className={cn("text-[9px] font-medium leading-tight", isActive ? "text-foreground" : "text-muted-foreground")}>
                                {mode.label}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* ── Mode Description ── */}
            <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-2.5">
                <div className="flex items-center justify-between mb-1">
                    <span className="flex items-center gap-2">
                        <ActiveIcon className={cn("size-4", activeModeConfig.color)} />
                        <span className="text-xs font-semibold">{activeModeConfig.label}</span>
                    </span>
                    {(activeMode === "prompt" || activeMode === "stv-prompt") && (
                        <button
                            type="button"
                            onClick={() => setShowStepsInfo(true)}
                            className="text-muted-foreground hover:text-primary transition-colors p-0.5"
                            title="Xem các bước dịch"
                        >
                            <HelpCircleIcon className="size-4" />
                        </button>
                    )}
                </div>
                <p className="text-[10px] text-muted-foreground">{activeModeConfig.desc}</p>
            </div>

            {!isUnderMaintenance ? (
                activeMode === "scan-fix" ? (
                    <ScanFixPanel
                        novelId={novelId}
                        chapterIds={chapterIds}
                        chapters={chapters}
                    />
                ) : (
                    <>
                        {/* ── Mode-specific Setup Panels ── */}

                    {/* Cấu hình Prompt */}
                    {(activeMode === "prompt" || activeMode === "stv-prompt" || activeMode === "comprehensive" || activeMode === "edit") && (() => {
                        const hasPrompt = activeMode === "stv-prompt"
                            ? !!novel?.customStvPrompt?.trim()
                            : activeMode === "comprehensive"
                                ? !!novel?.customComprehensivePrompt?.trim()
                                : !!novel?.customTranslatePrompt?.trim();
                        return (
                            <div className="rounded-lg border bg-card p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-medium flex items-center gap-1.5 select-none">
                                            <ScanSearchIcon className={cn("size-3.5", hasPrompt ? "text-emerald-600" : "text-muted-foreground")} />
                                            {activeMode === "edit" ? "Cấu hình Prompt Biên Tập" : "Cấu hình Prompt Dịch"}
                                        </span>
                                        {hasPrompt ? (
                                            <span className="text-[9px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/20 font-semibold flex items-center gap-0.5">
                                                <CheckCircle2Icon className="size-2.5 text-emerald-600" />
                                                Đã trang bị
                                            </span>
                                        ) : (
                                            <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded border border-muted-foreground/10 font-normal">
                                                Chưa có
                                            </span>
                                        )}
                                    </div>
                                    <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => setTunerOpen(true)}>
                                        <SparklesIcon className="size-3 mr-1" /> Mở Tuner
                                    </Button>
                                </div>
                            </div>
                        );
                    })()}

                    {/* Comprehensive mode configuration */}
                    {(activeMode === "comprehensive" || activeMode === "edit") && (
                        <div className="space-y-3">
                            {/* Văn Phong Dịch */}
                            <div className="rounded-lg border bg-card p-3 space-y-2 border-indigo-500/20">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-medium flex items-center gap-1.5 select-none">
                                            <BookOpenIcon className={cn("size-3.5", customStylePrompt?.trim() ? "text-indigo-600" : "text-muted-foreground")} />
                                            {activeMode === "edit" ? "Văn Phong Biên Tập" : "Văn Phong Dịch"}
                                        </span>
                                        {customStylePrompt?.trim() ? (
                                            <span className="text-[9px] bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 px-1.5 py-0.5 rounded border border-indigo-500/20 font-semibold flex items-center gap-0.5">
                                                <CheckCircle2Icon className="size-2.5 text-indigo-600" />
                                                Đã trang bị
                                            </span>
                                        ) : (
                                            <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded border border-muted-foreground/10 font-normal">
                                                Chưa có
                                            </span>
                                        )}
                                    </div>
                                    <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => setStyleTunerOpen(true)}>
                                        <SparklesIcon className="size-3 mr-1" /> Mở Tuner
                                    </Button>
                                </div>
                            </div>

                            {/* Quy Tắc Xưng Hô & Bối Cảnh */}
                            <div className="rounded-lg border bg-card p-3 space-y-2 border-purple-500/20">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-medium flex items-center gap-1.5 select-none">
                                            <UsersIcon className={cn("size-3.5", customPronounPrompt?.trim() ? "text-purple-600" : "text-muted-foreground")} />
                                            Quy Tắc Xưng Hô & Bối Cảnh
                                        </span>
                                        {customPronounPrompt?.trim() ? (
                                            <span className="text-[9px] bg-purple-500/10 text-purple-700 dark:text-purple-400 px-1.5 py-0.5 rounded border border-purple-500/20 font-semibold flex items-center gap-0.5">
                                                <CheckCircle2Icon className="size-2.5 text-purple-600" />
                                                Đã trang bị
                                            </span>
                                        ) : (
                                            <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded border border-muted-foreground/10 font-normal">
                                                Chưa có
                                            </span>
                                        )}
                                    </div>
                                    <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => setPronounTunerOpen(true)}>
                                        <SparklesIcon className="size-3 mr-1" /> Mở Tuner
                                    </Button>
                                </div>
                            </div>

                            {/* Two-pass toggle */}
                            <div className="flex items-center justify-between border-t pt-2 mt-2">
                                <div>
                                    <Label htmlFor="two-pass" className="text-xs cursor-pointer">Biên tập 2-Pass</Label>
                                    <p className="text-[10px] text-muted-foreground">AI biên tập thêm bước 2 cho mượt hơn</p>
                                </div>
                                <Switch id="two-pass" checked={twoPass} onCheckedChange={setTwoPass} />
                            </div>
                        </div>
                    )}



                    {/* ── AI Model Configuration ── */}
                    {activeMode === "stv-prompt" || activeMode === "comprehensive" || activeMode === "prompt" || activeMode === "edit" ? (
                        <div className="space-y-3.5 border-t pt-3.5">
                            <div className="space-y-1.5">
                                <div className="flex justify-between items-center text-xs">
                                    <Label className="text-xs font-bold text-blue-600 dark:text-blue-400">
                                        {activeMode === "edit" ? "Model 1: Biên tập chính (Khuyên dùng Pro)" : "Model 1: Dịch chính (Khuyên dùng Pro)"}
                                    </Label>
                                </div>
                                <div className="flex gap-2">
                                    <Select value={model1ProviderId} onValueChange={handleModel1ProviderChange}>
                                        <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue placeholder="Provider..." /></SelectTrigger>
                                        <SelectContent>{providers?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                                    </Select>
                                    <Select value={model1ModelId} onValueChange={handleModel1ModelChange} disabled={!model1ProviderId}>
                                        <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue placeholder="Model..." /></SelectTrigger>
                                        <SelectContent>{model1Models?.map(m => <SelectItem key={m.id} value={m.modelId}>{m.name || m.modelId}</SelectItem>)}</SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="space-y-1.5 pt-2 border-t border-muted/30">
                                <div className="flex justify-between items-center text-xs">
                                    <Label className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                                        Model 2: Quét từ điển (Khuyên dùng Flash)
                                    </Label>
                                </div>
                                <div className="flex gap-2">
                                    <Select value={model2ProviderId} onValueChange={handleModel2ProviderChange}>
                                        <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue placeholder="Provider..." /></SelectTrigger>
                                        <SelectContent>{providers?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                                    </Select>
                                    <Select value={model2ModelId} onValueChange={handleModel2ModelChange} disabled={!model2ProviderId}>
                                        <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue placeholder="Model..." /></SelectTrigger>
                                        <SelectContent>{model2Models?.map(m => <SelectItem key={m.id} value={m.modelId}>{m.name || m.modelId}</SelectItem>)}</SelectContent>
                                    </Select>
                                </div>
                                
                                {/* Cấu hình Prompt cho Model 2 */}
                                <div className="rounded-lg border bg-card p-2.5 mt-1 space-y-2 border-emerald-500/10">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[11px] font-medium flex items-center gap-1.5 select-none">
                                                <ScanSearchIcon className={cn("size-3.5", customModel2Prompt?.trim() ? "text-emerald-600" : "text-muted-foreground")} />
                                                Prompt Quét từ điển
                                            </span>
                                            {customModel2Prompt?.trim() ? (
                                                <span className="text-[9px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/20 font-semibold flex items-center gap-0.5">
                                                    <CheckCircle2Icon className="size-2.5 text-emerald-600" />
                                                    Đã trang bị
                                                </span>
                                            ) : (
                                                <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded border border-muted-foreground/10 font-normal">
                                                    Chưa có
                                                </span>
                                            )}
                                        </div>
                                        <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => setTuner2Open(true)}>
                                            <SparklesIcon className="size-3 mr-1" /> Mở Tuner
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-1.5 pt-2 border-t border-muted/30">
                                <div className="flex justify-between items-center">
                                    <Label htmlFor="model3-enable" className="text-xs font-bold cursor-pointer text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                                        <BotIcon className="size-3.5" /> Model 3: QA Bot (Giám sát & Tinh chỉnh)
                                    </Label>
                                    <Switch id="model3-enable" checked={model3Enabled} onCheckedChange={handleModel3EnabledToggle} />
                                </div>
                                {model3Enabled && (
                                    <div className="space-y-2 pt-1 animate-in fade-in slide-in-from-top-1 duration-200">
                                        <div className="flex gap-2">
                                            <Select value={model3ProviderId} onValueChange={handleModel3ProviderChange}>
                                                <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue placeholder="Provider..." /></SelectTrigger>
                                                <SelectContent>{providers?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                                            </Select>
                                            <Select value={model3ModelId} onValueChange={handleModel3ModelChange} disabled={!model3ProviderId}>
                                                <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue placeholder="Model..." /></SelectTrigger>
                                                <SelectContent>{model3Models?.map(m => <SelectItem key={m.id} value={m.modelId}>{m.name || m.modelId}</SelectItem>)}</SelectContent>
                                            </Select>
                                        </div>

                                        {/* Cấu hình Prompt cho Model 3 */}
                                        <div className="rounded-lg border bg-card p-2.5 mt-1 space-y-2 border-purple-500/10">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[11px] font-medium flex items-center gap-1.5 select-none">
                                                        <BotIcon className={cn("size-3.5", customModel3Prompt?.trim() ? "text-purple-600" : "text-muted-foreground")} />
                                                        Prompt QA Bot
                                                    </span>
                                                    {customModel3Prompt?.trim() ? (
                                                        <span className="text-[9px] bg-purple-500/10 text-purple-700 dark:text-purple-400 px-1.5 py-0.5 rounded border border-purple-500/20 font-semibold flex items-center gap-0.5">
                                                            <CheckCircle2Icon className="size-2.5 text-purple-600" />
                                                            Đã trang bị
                                                        </span>
                                                    ) : (
                                                        <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded border border-muted-foreground/10 font-normal">
                                                            Chưa có
                                                        </span>
                                                    )}
                                                </div>
                                                <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => setTuner3Open(true)}>
                                                    <SparklesIcon className="size-3 mr-1" /> Mở Tuner
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-2 border-t pt-3">
                            <Label className="text-xs">AI Model:</Label>
                            <div className="flex gap-2">
                                <Select value={selectedProviderId} onValueChange={(val) => { handleProviderChange(val); setExtraModels([]); }}>
                                    <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue placeholder="Provider..." /></SelectTrigger>
                                    <SelectContent>{providers?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                                </Select>
                                <Select value={selectedModelId || ""} onValueChange={handleModelChange} disabled={!selectedProviderId}>
                                    <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue placeholder="Model..." /></SelectTrigger>
                                    <SelectContent>{models?.map(m => <SelectItem key={m.id} value={m.modelId}>{m.name || m.modelId}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>

                            {/* Extra models */}
                            {selectedProviderId && selectedModelId && (
                                <div className="space-y-1 pl-1">
                                    {extraModels.map((item, idx) => (
                                        <ExtraModelRow
                                            key={idx} index={idx} providers={providers} value={item}
                                            onChange={(newVal) => { const m = [...extraModels]; m[idx] = newVal; setExtraModels(m); }}
                                            onRemove={() => setExtraModels(prev => prev.filter((_, i) => i !== idx))}
                                        />
                                    ))}
                                    <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={() => setExtraModels(prev => [...prev, { providerId: selectedProviderId || "", modelId: "" }])}>
                                        <PlusIcon className="size-3" /> Thêm Model
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="space-y-2 pt-2 border-t border-muted/30">
                        {(activeMode === "comprehensive" || activeMode === "prompt" || activeMode === "stv-prompt") && (
                            <label className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5 cursor-pointer hover:bg-emerald-500/10">
                                <Checkbox checked={extractDict} onCheckedChange={(c) => setExtractDict(!!c)} className="mt-0.5 border-emerald-500 data-[state=checked]:bg-emerald-500" />
                                <div>
                                    <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">Càng dịch càng hay ✨</span>
                                    <p className="text-[10px] text-muted-foreground">AI trích xuất tên → lưu từ điển → chương sau chính xác hơn</p>
                                </div>
                            </label>
                        )}
                        
                        <label className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5 cursor-pointer hover:bg-primary/10">
                            <Checkbox checked={cleanGarbage} onCheckedChange={(c) => setCleanGarbage(!!c)} className="mt-0.5" />
                            <div>
                                <span className="text-[11px] font-medium">Xóa bỏ ký tự lỗi (Khuyên dùng)</span>
                                <p className="text-[10px] text-muted-foreground">Tự động dọn dẹp URL, quảng cáo, ký tự rác trước khi dịch.</p>
                            </div>
                        </label>

                        <label className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 cursor-pointer hover:bg-amber-500/10">
                            <Checkbox 
                                checked={chunkMode === "full"} 
                                onCheckedChange={async (c) => {
                                    const val = c ? "full" : "chunk";
                                    setChunkMode(val);
                                    await db.analysisSettings.update("default", { translateChunkMode: val });
                                }} 
                                className="mt-0.5 border-amber-500 data-[state=checked]:bg-amber-500" 
                            />
                            <div>
                                <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">Dịch gộp cả chương (Tốc độ cao) ⚡</span>
                                <p className="text-[10px] text-muted-foreground">Không chia nhỏ chương, giữ nguyên văn phong mạch lạc nhất. (Chỉ dùng cho API xịn như Gemini Pro 1.5 / Claude 3.5 để tránh lỗi)</p>
                            </div>
                        </label>

                        {(isVip || isAdmin) && (
                            <label className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-2.5 cursor-pointer hover:bg-red-500/10">
                                <Checkbox checked={nsfwMode} onCheckedChange={(c) => setNsfwMode(!!c)} className="mt-0.5 border-red-500 data-[state=checked]:bg-red-500" />
                                <div>
                                    <span className="text-[11px] font-medium text-red-700 dark:text-red-400">Dịch NSFW (Cảnh H / R-18+) 🔞</span>
                                    <p className="text-[10px] text-muted-foreground">Kích hoạt bộ từ vựng và văn phong đặc tả cảnh nóng táo bạo.</p>
                                </div>
                            </label>
                        )}

                        <div className="flex flex-col gap-2 rounded-lg border border-border/50 bg-muted/30 p-2.5">
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] font-medium">Tỷ lệ từ vựng: {hanVietRatio}% Hán Việt / {100 - hanVietRatio}% Thuần Việt</span>
                                <Button 
                                    size="sm" 
                                    variant="outline" 
                                    className="h-6 text-[10px] px-2"
                                    onClick={async () => {
                                        await db.analysisSettings.update("default", { hanVietRatio: hanVietRatio });
                                        toast.success("Đã lưu tỷ lệ dịch");
                                    }}
                                >
                                    Lưu Tỷ Lệ
                                </Button>
                            </div>
                            <Slider
                                value={[hanVietRatio]}
                                min={0}
                                max={100}
                                step={10}
                                onValueChange={(vals) => setHanVietRatio(vals[0])}
                                className="my-2"
                            />
                            <p className="text-[10px] text-muted-foreground">
                                Kéo sang trái (0%) để AI ưu tiên dùng từ thuần Việt, dễ hiểu. Kéo sang phải (100%) để AI ưu tiên Hán Việt, đậm chất tu tiên / cổ trang.
                            </p>
                        </div>

                        <div className="flex items-center gap-2">
                            <Switch id="skip-tl" checked={skipTranslated} onCheckedChange={setSkipTranslated} />
                            <Label htmlFor="skip-tl" className="cursor-pointer text-xs">Bỏ qua chương đã dịch</Label>
                        </div>

                        <div className="space-y-1.5 pt-1.5 border-t border-muted/50 mt-1">
                            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Khi gặp lỗi dịch</span>
                            <RadioGroup value={errorAction} onValueChange={(val: any) => setErrorAction(val)} className="flex items-center gap-4 mt-0.5">
                                <div className="flex items-center gap-1.5 cursor-pointer">
                                    <RadioGroupItem value="stop" id="err-stop" />
                                    <Label htmlFor="err-stop" className="text-xs cursor-pointer">Dừng lại</Label>
                                </div>
                                <div className="flex items-center gap-1.5 cursor-pointer">
                                    <RadioGroupItem value="skip" id="err-skip" />
                                    <Label htmlFor="err-skip" className="text-xs cursor-pointer">Bỏ qua & Dịch tiếp</Label>
                                </div>
                            </RadioGroup>
                        </div>
                    </div>

                    {/* ── Chapter count & Admin info ── */}
                    <div className="rounded-md bg-muted/50 p-2 space-y-1">
                        <p className="text-sm">Sẽ xử lý <strong>{chapterIds.length}</strong> chương đã chọn.</p>
                        {selectedProviderId === "admin-provider" && (
                            <p className="text-[10px] text-blue-600 dark:text-blue-400 font-medium flex items-center gap-1">
                                <CrownIcon className="size-3" />
                                Model Admin {isAdmin ? "(Không giới hạn)" : `(Còn ${rawQuota} lượt)`}
                            </p>
                        )}
                    </div>

                    {/* ── Action Buttons ── */}
                    <div className="grid grid-cols-2 gap-2">
                        <Button
                            onClick={() => handleStart("selected")}
                            className="w-full gap-1.5 bg-primary hover:bg-primary/90"
                            disabled={
                                selectedProviderId === "admin-provider"
                                    ? (!isAdmin && rawQuota <= 0)
                                    : ((activeMode === "stv-prompt" || activeMode === "comprehensive" || activeMode === "prompt" || activeMode === "edit")
                                        ? (!model1ProviderId || !model1ModelId || (activeMode !== "edit" && (!model2ProviderId || !model2ModelId)) || (model3Enabled && (!model3ProviderId || !model3ModelId)))
                                        : !currentModel)
                            }
                        >
                            <ActiveIcon className="size-3.5" />
                            {activeMode === "edit" ? `${chapterIds.length} chương biên tập` : `${chapterIds.length} chương đã chọn`}
                        </Button>
                        <Button
                            onClick={() => handleStart("all_untranslated")}
                            variant="outline"
                            className="w-full gap-1.5"
                            disabled={
                                selectedProviderId === "admin-provider"
                                    ? (!isAdmin && rawQuota <= 0)
                                    : ((activeMode === "stv-prompt" || activeMode === "comprehensive" || activeMode === "prompt" || activeMode === "edit")
                                        ? (!model1ProviderId || !model1ModelId || (activeMode !== "edit" && (!model2ProviderId || !model2ModelId)) || (model3Enabled && (!model3ProviderId || !model3ModelId)))
                                        : !currentModel)
                            }
                        >
                            <ActiveIcon className="size-3.5" />
                            {activeMode === "edit" ? "Biên tập đến hết truyện" : "Dịch đến hết truyện"}
                        </Button>
                    </div>
                </>
            )
        ) : (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2 border border-dashed rounded-lg bg-muted/20">
                    <PenToolIcon className="size-8 text-muted-foreground/45 animate-pulse" />
                    <p className="text-xs font-medium">Chương trình bảo trì, chưa có ý tưởng phát triển</p>
                </div>
            )}
        </div>
    );

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto transition-all duration-300 sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ZapIcon className="size-5 text-primary" />
                        Khu Vực Dịch Truyện
                    </DialogTitle>
                    <DialogDescription>
                        Chọn chế độ dịch phù hợp bên dưới
                    </DialogDescription>
                </DialogHeader>

                {step === "config" && bulkConfigContent}

                <PromptTunerDialog open={tunerOpen} onOpenChange={setTunerOpen} novelId={novelId} mode={activeMode} />
                <PromptTunerDialog open={tuner2Open} onOpenChange={setTuner2Open} novelId={novelId} mode="model2-prompt" />
                <PromptTunerDialog open={tuner3Open} onOpenChange={setTuner3Open} novelId={novelId} mode="model3-prompt" />
                <StyleTunerDialog open={styleTunerOpen} onOpenChange={setStyleTunerOpen} novelId={novelId} />
                <PronounTunerDialog open={pronounTunerOpen} onOpenChange={setPronounTunerOpen} novelId={novelId} />

                {/* Dialog hiển thị các bước dịch ở chế độ Dịch Prompt hoặc STV + Prompt */}
                <Dialog open={showStepsInfo} onOpenChange={setShowStepsInfo}>
                    <DialogContent className="sm:max-w-md">
                        {activeMode === "edit" ? (
                            <>
                                <DialogHeader>
                                    <DialogTitle className="flex items-center gap-2 text-sm font-bold">
                                        <HelpCircleIcon className="size-5 text-blue-500" />
                                        Quy Trình Biên Tập AI
                                    </DialogTitle>
                                    <DialogDescription className="text-xs">
                                        Chi tiết các bước thực hiện khi chạy chế độ Biên Tập AI:
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="space-y-3.5 py-3 text-xs leading-relaxed">
                                    <div className="space-y-1">
                                        <span className="font-bold text-blue-600 dark:text-blue-400">Bước 1: Tải Ngữ Cảnh & Từ Điển Riêng</span>
                                        <p className="text-muted-foreground">
                                            Hệ thống kết hợp Bảng tên riêng xưng hô và các hướng dẫn văn phong riêng để định hình khung biên tập chuẩn.
                                        </p>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="font-bold text-blue-600 dark:text-blue-400">Bước 2: Model 1 Biên Tập & Đồng Nhất Từ Vựng</span>
                                        <p className="text-muted-foreground">
                                            AI tiến hành rà soát ngữ pháp tiếng Việt, loại bỏ từ Hán Việt thô cứng, và thay thế tên riêng theo đúng từ điển đã trang bị.
                                        </p>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="font-bold text-blue-600 dark:text-blue-400">Bước 3: Model 3 (QA Bot) Làm Mịn Nâng Cao</span>
                                        <p className="text-muted-foreground">
                                            (Nếu bật QA Bot) AI thực hiện rà soát lại toàn bộ văn bản để nâng cao độ trôi chảy của văn phong, chỉnh sửa nhịp điệu câu cú mượt mà.
                                        </p>
                                    </div>
                                </div>
                            </>
                        ) : activeMode === "stv-prompt" ? (
                            <>
                                <DialogHeader>
                                    <DialogTitle className="flex items-center gap-2 text-sm font-bold">
                                        <HelpCircleIcon className="size-5 text-blue-500" />
                                        Quy Trình Dịch STV + Prompt
                                    </DialogTitle>
                                    <DialogDescription className="text-xs">
                                        Chi tiết các bước thực hiện khi dịch ở chế độ STV + Prompt
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="space-y-3.5 py-3 text-xs leading-relaxed">
                                    <div className="space-y-1">
                                        <span className="font-bold text-blue-600 dark:text-blue-400">Bước 1: Quét Từ Điển Chương</span>
                                        <p className="text-muted-foreground">
                                            Tìm kiếm các bộ từ điển Tên riêng/Địa danh liên quan đến chương này đã được thiết lập.
                                        </p>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="font-bold text-blue-600 dark:text-blue-400">Bước 2: Thế Tên Từ Vựng</span>
                                        <p className="text-muted-foreground">
                                            Thay thế, chuyển đổi các danh từ Hán Việt, tên nhân vật, vật phẩm... tiếng Trung thô trong chương bằng từ điển đã khớp trước khi chuyển dịch.
                                        </p>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="font-bold text-blue-600 dark:text-blue-400">Bước 3: Dịch máy qua API STV</span>
                                        <p className="text-muted-foreground">
                                            Chuyển dịch nội dung đã thế từ điển sang tiếng Việt thô bằng bộ máy dịch STV. Kết quả gửi sang bước kế tiếp hoàn toàn là tiếng Việt.
                                        </p>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="font-bold text-blue-600 dark:text-blue-400">Bước 4: AI Biên tập và Làm mượt</span>
                                        <p className="text-muted-foreground">
                                            Đưa văn bản tiếng Việt thô lên AI kèm theo System Prompt tùy chỉnh của người dùng để sửa lỗi ngữ pháp, lỗi diễn đạt và cấu trúc lại câu văn cho mượt mà, đúng văn phong.
                                        </p>
                                    </div>
                                </div>
                            </>
                        ) : activeMode === "comprehensive" ? (
                            <>
                                <DialogHeader>
                                    <DialogTitle className="flex items-center gap-2 text-sm font-bold">
                                        <HelpCircleIcon className="size-5 text-blue-500" />
                                        Quy Trình Dịch Toàn Diện (AI nâng cao)
                                    </DialogTitle>
                                    <DialogDescription className="text-xs">
                                        Chi tiết quy trình xử lý dịch toàn diện đa bước:
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="space-y-3.5 py-3 text-xs leading-relaxed">
                                    <div className="space-y-1">
                                        <span className="font-bold text-blue-600 dark:text-blue-400">Bước 1: Quét Từ Điển & Prompt</span>
                                        <p className="text-muted-foreground">
                                            Hệ thống hợp nhất Từ điển phân cảnh cùng 3 tài liệu định hướng cá nhân hóa: Prompt dịch thuật, mô tả văn phong và ma trận xưng hô.
                                        </p>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="font-bold text-blue-600 dark:text-blue-400">Bước 2: Dịch Nháp Hán Việt thô (QT)</span>
                                        <p className="text-muted-foreground">
                                            Thực hiện quét dịch máy thô bước 1 để cung cấp khung cột mốc từ vựng chính xác cho AI.
                                        </p>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="font-bold text-blue-600 dark:text-blue-400">Bước 3: AI Dịch Tinh Giai đoạn 1 (Translation Draft)</span>
                                        <p className="text-muted-foreground">
                                            AI kết hợp bản gốc, bản dịch thô QT, từ điển chương và 3 prompt chỉ dẫn để tạo ra bản dịch tinh bước 1.
                                        </p>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="font-bold text-blue-600 dark:text-blue-400">Bước 4: AI Biên tập chuyên sâu (Biên kịch 2-Pass)</span>
                                        <p className="text-muted-foreground">
                                            (Nếu bật 2-Pass) AI đóng vai trò nhà hiệu đính chuyên nghiệp, đọc lại toàn bộ bản draft để làm mịn ngữ pháp tiếng Việt, xóa bỏ từ thô cứng và tối ưu hóa văn cảnh mượt mà nhất.
                                        </p>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <>
                                <DialogHeader>
                                    <DialogTitle className="flex items-center gap-2 text-sm font-bold">
                                        <HelpCircleIcon className="size-5 text-blue-500" />
                                        Quy Trình Dịch Prompt (Thuần AI + Từ Điển)
                                    </DialogTitle>
                                    <DialogDescription className="text-xs">
                                        Chi tiết các bước thực hiện khi dịch chương ở chế độ Dịch Prompt
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="space-y-3.5 py-3 text-xs leading-relaxed">
                                    <div className="space-y-1">
                                        <span className="font-bold text-blue-600 dark:text-blue-400">Bước 1: Quét Từ Điển Chương</span>
                                        <p className="text-muted-foreground">
                                            Khi bắt đầu dịch một chương, hệ thống tự động tìm kiếm các bộ từ điển Tên riêng/Địa danh đã được quét và lưu cho riêng chương đó trước đó.
                                        </p>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="font-bold text-blue-600 dark:text-blue-400">Bước 2: Đối Chiếu Từ Vựng</span>
                                        <p className="text-muted-foreground">
                                            So sánh nội dung chương gốc tiếng Trung với danh sách mục từ điển đã tìm thấy để xem chương này có chứa những từ nào, tránh việc sử dụng từ điển không liên quan.
                                        </p>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="font-bold text-blue-600 dark:text-blue-400">Bước 3: Dịch AI Cùng Từ Điển</span>
                                        <p className="text-muted-foreground">
                                            Đưa toàn bộ danh sách các từ trùng khớp tìm thấy kèm theo nội dung chương gốc tiếng Trung lên AI. AI thực hiện dịch thuật và bắt buộc phải tuân thủ nghiêm ngặt các quy tắc từ điển đã khớp cũng như System Prompt tùy chỉnh.
                                        </p>
                                    </div>
                                </div>
                            </>
                        )}

                        <div className="flex justify-end pt-2">
                            <Button size="sm" onClick={() => setShowStepsInfo(false)}>
                                Đóng
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>

                {/* ── Processing View ── */}
                {step === "processing" && (
                    <div className="space-y-4 py-4">
                        <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2">
                                <Loader2Icon className="size-4 animate-spin text-primary" />
                                {currentChapterTitle ? <span className="truncate max-w-[200px]">{currentChapterTitle}</span> : "Đang xử lý..."}
                            </span>
                            <span className="font-medium tabular-nums">{processedCount} / {totalToProcess}</span>
                        </div>
                        <Progress value={progress} className="h-2" />
                        {currentPhase !== "idle" && (
                            <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
                                {(currentPhase === "dict" || currentPhase === "model2") && (
                                    <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                                        <ScanSearchIcon className="size-3.5 animate-pulse text-emerald-500" /> Model 2 [Flash]: Đang quét từ điển & phân tích...
                                    </span>
                                )}
                                {(currentPhase === "ai" || currentPhase === "model1") && (
                                    <span className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 font-medium">
                                        <LanguagesIcon className="size-3.5 animate-pulse text-blue-500" /> {activeMode === "edit" ? "Model 1 [Pro]: Đang biên tập nội dung..." : "Model 1 [Pro]: Đang dịch nội dung chính..."}
                                    </span>
                                )}
                                {currentPhase === "model3" && (
                                    <span className="flex items-center gap-1.5 text-xs text-purple-600 dark:text-purple-400 font-medium">
                                        <BotIcon className="size-3.5 animate-pulse text-purple-500" /> {activeMode === "edit" ? "Model 3 [QA Bot]: Giám sát & Tinh chỉnh bản biên tập..." : "Model 3 [QA Bot]: Giám sát & Tinh chỉnh bản dịch..."}
                                    </span>
                                )}
                            </div>
                        )}
                        {errors.length > 0 && (
                            <div className="max-h-24 overflow-y-auto rounded-md bg-destructive/10 p-2 text-[10px] text-destructive">
                                {errors.map((err, i) => <div key={i}>Chương &quot;{err.chapterTitle}&quot;: {err.message}</div>)}
                            </div>
                        )}
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full">Ẩn xuống nền</Button>
                            <Button variant="destructive" onClick={handleClose} className="w-full gap-1.5">
                                <StopCircleIcon className="size-4" /> Dừng
                            </Button>
                        </div>
                    </div>
                )}

                {/* ── Done View ── */}
                {step === "done" && (
                    <div className="space-y-4 py-4 text-center">
                        <div className="flex justify-center">
                            {errors.length === totalToProcess
                                ? <XCircleIcon className="size-12 text-destructive" />
                                : <CheckCircle2Icon className="size-12 text-emerald-500" />}
                        </div>
                        <div>
                            <p className="text-lg font-bold">{errors.length === 0 ? "Hoàn tất!" : "Đã xong (có lỗi)"}</p>
                            <p className="text-sm text-muted-foreground">
                                Đã xử lý {processedCount} / {totalToProcess} chương.
                                {results.length > 0 && ` Thành công: ${results.length}.`}
                                {errors.length > 0 && ` Lỗi: ${errors.length}.`}
                            </p>
                        </div>
                        {errors.length > 0 && (
                            <div className="max-h-32 overflow-y-auto rounded-md bg-destructive/10 p-2 text-left text-[10px] text-destructive">
                                {errors.map((err, i) => <div key={i}>Chương &quot;{err.chapterTitle}&quot;: {err.message}</div>)}
                            </div>
                        )}
                        <Button onClick={handleClose} className="w-full">Đóng</Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

// ── Quét & Sửa (Scan & Fix) sub-components ──

function HighlightedContext({ context, matchedText }: { context: string; matchedText: string }) {
    if (!matchedText) return <span>{context}</span>;
    const escaped = matchedText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escaped})`, "gi");
    const parts = context.split(regex);
    return (
        <span>
            {parts.map((part, i) => {
                const isMatch = part.toLowerCase() === matchedText.toLowerCase();
                return isMatch ? (
                    <mark key={i} className="bg-rose-100 dark:bg-rose-950/60 px-1 py-0.5 rounded font-bold text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/40">
                        {part}
                    </mark>
                ) : (
                    part
                );
            })}
        </span>
    );
}

interface ScanFixPanelProps {
    novelId: string;
    chapterIds: string[];
    chapters: any[];
}

function ScanFixPanel({ novelId, chapterIds, chapters }: ScanFixPanelProps) {
    const [scope, setScope] = useState<"selected" | "all">("selected");
    const [status, setStatus] = useState<"idle" | "scanning" | "done">("idle");
    const [progress, setProgress] = useState({ current: 0, total: 0, chapterTitle: "" });
    const [issues, setIssues] = useState<ScanIssue[]>([]);
    const [fixingIssueId, setFixingIssueId] = useState<string | null>(null);

    // Default scope if no chapters are selected
    useEffect(() => {
        if (chapterIds.length === 0) {
            setScope("all");
        } else {
            setScope("selected");
        }
    }, [chapterIds]);

    const handleScan = async () => {
        const targetIds = scope === "selected" ? chapterIds : chapters.map(c => c.id);
        if (targetIds.length === 0) {
            toast.error("Không có chương nào để quét!");
            return;
        }

        setStatus("scanning");
        setProgress({ current: 0, total: targetIds.length, chapterTitle: "Bắt đầu..." });
        setIssues([]);

        try {
            const results = await runLocalNameScan(novelId, targetIds, (idx, total) => {
                const targetId = targetIds[idx];
                const currentChapter = chapters.find(c => c.id === targetId);
                setProgress({
                    current: idx,
                    total,
                    chapterTitle: currentChapter ? currentChapter.title : `Chương ${idx + 1}`
                });
            });

            setIssues(results);
            setStatus("done");
            toast.success(`Đã quét xong! Tìm thấy ${results.length} lỗi nghi vấn.`);
        } catch (err: any) {
            console.error("Scan error:", err);
            toast.error("Lỗi khi quét: " + err.message);
            setStatus("idle");
        }
    };

    const handleFix = async (issue: ScanIssue) => {
        setFixingIssueId(issue.id);
        try {
            const diff = await applyFix(novelId, issue);
            toast.success("Sửa thành công!");
            
            // Adjust offsets for other pending matches in the same scene
            setIssues(prev => prev.map(item => {
                if (item.sceneId === issue.sceneId && item.start > issue.start) {
                    return {
                        ...item,
                        start: item.start + diff,
                        end: item.end + diff
                    };
                }
                return item;
            }).filter(item => item.id !== issue.id));
        } catch (err: any) {
            console.error("Fix error:", err);
            toast.error("Không thể sửa: " + err.message);
        } finally {
            setFixingIssueId(null);
        }
    };

    const handleSkip = (issue: ScanIssue) => {
        setIssues(prev => prev.filter(item => item.id !== issue.id));
    };

    // Group issues by chapter title
    const groupedIssues = useMemo(() => {
        const groups: Record<string, ScanIssue[]> = {};
        for (const iss of issues) {
            const key = iss.chapterTitle || "Không rõ chương";
            if (!groups[key]) groups[key] = [];
            groups[key].push(iss);
        }
        return groups;
    }, [issues]);

    if (status === "scanning") {
        const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
        return (
            <div className="flex flex-col items-center justify-center py-10 gap-4">
                <Loader2Icon className="size-8 text-rose-500 animate-spin" />
                <div className="text-center space-y-1">
                    <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">Đang quét tìm lỗi chính tả...</p>
                    <p className="text-[10px] text-muted-foreground italic truncate max-w-[280px]">
                        {progress.chapterTitle}
                    </p>
                    <p className="text-[10px] text-muted-foreground font-mono">
                        {progress.current} / {progress.total} ({pct}%)
                    </p>
                </div>
                <Progress value={pct} className="h-2 w-full max-w-[240px]" />
            </div>
        );
    }

    if (status === "done") {
        if (issues.length === 0) {
            return (
                <div className="space-y-4 pt-2">
                    <div className="flex flex-col items-center justify-center py-10 text-center gap-2 border border-dashed rounded-lg bg-emerald-50/20 border-emerald-500/30">
                        <CheckCircle2Icon className="size-10 text-emerald-500" />
                        <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">Sạch sẽ! ✨</p>
                        <p className="text-xs text-muted-foreground max-w-[280px]">
                            Không phát hiện lỗi viết sai/na ná tên nhân vật nào dựa theo từ điển hiện tại.
                        </p>
                    </div>
                    <Button onClick={() => setStatus("idle")} className="w-full text-xs h-9">
                        Quét lại chương khác
                    </Button>
                </div>
            );
        }

        return (
            <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground font-medium">
                        Phát hiện <strong className="text-rose-600 dark:text-rose-400">{issues.length}</strong> từ nghi vấn
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => setStatus("idle")} className="h-7 text-[10px] text-muted-foreground">
                        Hủy / Quét lại
                    </Button>
                </div>

                <div className="space-y-4 max-h-[45vh] overflow-y-auto pr-1">
                    {Object.entries(groupedIssues).map(([chapterTitle, chapterIssues]) => (
                        <div key={chapterTitle} className="space-y-2 border-l-2 border-rose-500/20 pl-3">
                            <h4 className="text-[11px] font-bold text-foreground flex items-center gap-1.5 sticky top-0 bg-background/95 py-1 z-10">
                                <BookOpenIcon className="size-3 text-rose-500" />
                                {chapterTitle}
                            </h4>
                            <div className="space-y-2.5">
                                {chapterIssues.map((issue) => (
                                    <div key={issue.id} className="rounded-lg border bg-card p-2.5 text-xs space-y-2 hover:border-rose-500/30 transition-colors">
                                        <div className="flex items-center justify-between gap-2 flex-wrap">
                                            <div className="flex items-center gap-1 text-[11px] flex-wrap">
                                                <span className="font-semibold text-rose-600 dark:text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                                                    {issue.matchedText}
                                                </span>
                                                <span className="text-muted-foreground">→</span>
                                                <span className="font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20" title={`Tiếng Trung: ${issue.chineseName}`}>
                                                    {issue.dictName}
                                                </span>
                                                {issue.chineseName && (
                                                    <span className="text-[9px] text-muted-foreground font-mono bg-muted px-1 py-0.2 rounded">
                                                        {issue.chineseName}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <Button
                                                    size="xs"
                                                    variant="outline"
                                                    className="h-6 text-[10px] px-2 text-muted-foreground"
                                                    onClick={() => handleSkip(issue)}
                                                    disabled={fixingIssueId === issue.id}
                                                >
                                                    Bỏ qua
                                                </Button>
                                                <Button
                                                    size="xs"
                                                    className="h-6 text-[10px] px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                                                    onClick={() => handleFix(issue)}
                                                    disabled={fixingIssueId !== null}
                                                >
                                                    {fixingIssueId === issue.id ? (
                                                        <Loader2Icon className="size-3 animate-spin" />
                                                    ) : (
                                                        <CheckIcon className="size-3" />
                                                    )}
                                                    Sửa
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="p-2 rounded bg-muted/30 border text-muted-foreground leading-relaxed italic text-[11px] break-words">
                                            <HighlightedContext context={issue.context} matchedText={issue.matchedText} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4 pt-2">
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
                    <AlertTriangleIcon className="size-4" />
                    <span>Lưu ý quét chính tả tên nhân vật</span>
                </div>
                <ul className="list-disc pl-4 text-[10px] space-y-1 text-muted-foreground">
                    <li>Hệ thống chỉ quét các tên trong từ điển có từ <strong>2 từ trở lên</strong> để tránh gây nhiễu/báo lỗi giả.</li>
                    <li>Sẽ tìm các biến thể cùng số từ nhưng viết sai dấu, viết hoa không khớp hoặc bỏ dấu (ví dụ: &quot;Lâm Phong&quot; tìm thấy &quot;lam phong&quot;, &quot;lâm phóng&quot;, &quot;lam phóng&quot;).</li>
                    <li>Phát hiện và đề xuất sửa đổi trực tiếp vào database cảnh truyện.</li>
                </ul>
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-medium">Phạm vi quét:</Label>
                <div className="grid grid-cols-2 gap-2">
                    <button
                        type="button"
                        onClick={() => setScope("selected")}
                        disabled={chapterIds.length === 0}
                        className={cn(
                            "flex flex-col items-center justify-center p-2.5 rounded-lg border text-center transition-all gap-1",
                            scope === "selected"
                                ? "border-rose-500 bg-rose-500/10 text-rose-900 dark:text-rose-100"
                                : "border-muted bg-background hover:bg-muted/50 text-muted-foreground",
                            chapterIds.length === 0 && "opacity-50 cursor-not-allowed"
                        )}
                    >
                        <span className="text-xs font-semibold">Chương đã chọn</span>
                        <span className="text-[10px] font-medium opacity-80">{chapterIds.length} chương</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setScope("all")}
                        className={cn(
                            "flex flex-col items-center justify-center p-2.5 rounded-lg border text-center transition-all gap-1",
                            scope === "all"
                                ? "border-rose-500 bg-rose-500/10 text-rose-900 dark:text-rose-100"
                                : "border-muted bg-background hover:bg-muted/50 text-muted-foreground"
                        )}
                    >
                        <span className="text-xs font-semibold">Tất cả chương</span>
                        <span className="text-[10px] font-medium opacity-80">{chapters.length} chương</span>
                    </button>
                </div>
            </div>

            <Button onClick={handleScan} className="w-full bg-rose-600 hover:bg-rose-700 text-white font-medium h-9 text-xs gap-1.5">
                <SearchIcon className="size-3.5" />
                Bắt đầu quét từ điển
            </Button>
        </div>
    );
}
