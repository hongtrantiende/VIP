"use client";

import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import {
  SparklesIcon,
  LanguagesIcon,
  Loader2Icon,
  StopCircleIcon,
  CheckCircle2Icon,
  AlertTriangleIcon,
  BookOpenIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon,
  SettingsIcon,
  CopyIcon,
  Trash2Icon,
  ArrowRightLeftIcon,
  BotIcon,
  FileTextIcon,
  HelpCircleIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { db, type AIProvider, type AIModel, type Novel } from "@/lib/db";
import { useApiInferenceProviders, useAIModels, useAIProvider } from "@/lib/hooks/use-ai-providers";
import { getMergedNameDict } from "@/lib/hooks/use-name-entries";
import { filterDictBySourceText } from "@/lib/chapter-tools/context";
import { resolveChapterToolModel } from "@/lib/chapter-tools/stream-runner";
import { streamText } from "ai";
import { getOriginalContent } from "@/lib/hooks/use-scene-versions";

// Standard prompt template
import { DEFAULT_TRANSLATE_SYSTEM, DEFAULT_EDIT_SYSTEM } from "@/lib/chapter-tools/prompts";

interface TranslationStepLog {
  title: string;
  status: "pending" | "running" | "success" | "error";
  message?: string;
}

const STYLE_PRESETS = [
  {
    id: "standard",
    name: "Mặc định (Standard)",
    description: "Văn phong dịch tiểu thuyết chuẩn, tự nhiên.",
    rules: ""
  },
  {
    id: "tienhiep",
    name: "Tiên Hiệp / Võ Hiệp",
    description: "Cổ kính, trang nghiêm, lạm dụng Hán-Việt hợp lý (linh khí, đan dược, đạo hữu...).",
    rules: "Dịch theo văn phong Tiên Hiệp/Kiếm Hiệp cổ trang Trung Quốc. Hãy giữ đúng phong vị cổ kính, trang nghiêm. Ưu tiên các thuật ngữ Hán-Việt phổ biến trong giới tiên hiệp như: tu chân, đan điền, đan dược, linh khí, độ kiếp, ngự kiếm, đạo hữu, các cấp bậc tu luyện. Xưng hô chuẩn cổ trang (ví dụ: ta - ngươi, huynh - đệ, sư phụ - đồ nhi, tôn kính thì dùng vãn bối - tiền bối)."
  },
  {
    id: "huyenhuyen",
    name: "Huyền Huyễn / Kỳ Ảo",
    description: "Giả tưởng hoành tráng, sinh động, thuật ngữ ma pháp tây phương hoặc đông phương dị thế.",
    rules: "Dịch theo văn phong Huyền Huyễn kỳ ảo. Câu văn sinh động, hoành tráng, đầy sức tưởng tượng. Thích hợp cho bối cảnh dị thế ma pháp hoặc thế giới huyền ảo. Chú ý dịch chuẩn các thuật ngữ ma pháp, đấu khí, dị năng, chủng tộc dị giới và giữ xưng hô nhất quán dựa theo sức mạnh và vị thế."
  },
  {
    id: "dothi",
    name: "Đô Thị / Hiện Đại",
    description: "Ngôn ngữ đời thường, tự nhiên, hạn chế Hán-Việt cổ kính, dịch nghĩa danh xưng hiện đại.",
    rules: "Dịch theo văn phong Đô Thị hiện đại. Dùng từ ngữ đời thường, tự nhiên, gần gũi như đời sống hàng ngày ở Việt Nam. Tuyệt đối không lạm dụng các từ Hán-Việt quá cổ kính hay tối nghĩa (ví dụ: không dùng 'thủ cơ' mà dịch là 'điện thoại', không dùng 'kính xa' mà dịch là 'gương xe'). Xưng hô tự nhiên theo quan hệ hiện đại (tôi - bạn, anh - em, cậu - tớ)."
  },
  {
    id: "dammi_ngontinh",
    name: "Đam Mỹ / Ngôn Tình",
    description: "Mượt mà, giàu cảm xúc, chú trọng mối quan hệ tình cảm thân mật giữa các nhân vật.",
    rules: "Dịch theo văn phong tiểu thuyết lãng mạn (Đam mỹ/Ngôn tình). Chú ý câu văn mượt mà, uyển chuyển, giàu cảm xúc, nhấn mạnh tâm lý nhân vật. Chú ý dịch chuẩn xác các đại từ nhân xưng thể hiện sự thân mật, ngọt ngào hoặc đối đầu phức tạp (ví dụ: anh - em, hắn - cậu, ta - ngươi, nàng - ta, sư tôn - đệ tử) phù hợp với diễn biến tình cảm."
  }
];

export function TranslationTest({ 
  initialNovelId, 
  initialChapterId 
}: { 
  initialNovelId?: string; 
  initialChapterId?: string; 
}) {
  const providers = useApiInferenceProviders();
  const [novels, setNovels] = useState<Novel[]>([]);
  const [selectedNovelId, setSelectedNovelId] = useState<string>("none");
  const [chapters, setChapters] = useState<any[]>([]);
  const [selectedChapterId, setSelectedChapterId] = useState<string>("none");
  const [isLoadingChapter, setIsLoadingChapter] = useState(false);

  // Pipeline configuration
  const [useTwoPass, setUseTwoPass] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState("standard");
  const [customStyleRules, setCustomStyleRules] = useState("");

  // Model 1 (Translator)
  const [m1ProviderId, setM1ProviderId] = useState<string>("");
  const [m1ModelId, setM1ModelId] = useState<string>("");
  const m1Models = useAIModels(m1ProviderId);

  // Model 2 (Editor/Refiner)
  const [m2ProviderId, setM2ProviderId] = useState<string>("");
  const [m2ModelId, setM2ModelId] = useState<string>("");
  const m2Models = useAIModels(m2ProviderId);

  // Test data
  const [sourceText, setSourceText] = useState("");
  const [customGlossaryRaw, setCustomGlossaryRaw] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationStep, setTranslationStep] = useState<"idle" | "dict" | "pass1" | "pass2" | "done">("idle");
  const [logs, setLogs] = useState<TranslationStepLog[]>([]);

  // Result display
  const [streamedContent, setStreamedContent] = useState("");
  const [pass1Output, setPass1Output] = useState("");
  const [finalOutput, setFinalOutput] = useState("");
  const [usedGlossary, setUsedGlossary] = useState<Array<{ chinese: string; vietnamese: string }>>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Load novels and initialize providers
  useEffect(() => {
    db.novels.toArray().then(setNovels).catch(err => console.error(err));
  }, []);

  useEffect(() => {
    if (initialNovelId) {
      setSelectedNovelId(initialNovelId);
    }
  }, [initialNovelId]);

  async function handleLoadChapterText(chapterId: string, silent = false) {
    if (chapterId === "none") return;
    setIsLoadingChapter(true);
    const toastId = silent ? null : toast.loading("Đang tải văn bản gốc của chương...");
    try {
      const scenes = await db.scenes
        .where("[chapterId+isActive]")
        .equals([chapterId, 1])
        .toArray();

      if (scenes.length === 0) {
        throw new Error("Không tìm thấy cảnh (scene) hoạt động nào cho chương này.");
      }

      // Sort scenes by order
      const sortedScenes = scenes.sort((a, b) => a.order - b.order);
      const contents = await Promise.all(sortedScenes.map(s => getOriginalContent(s.id)));
      const joinedContent = contents.join("\n\n");

      setSourceText(joinedContent);
      if (!silent) {
        toast.success("Tải văn bản gốc thành công!", { id: toastId! });
      }
    } catch (err: any) {
      console.error(err);
      if (!silent) {
        toast.error("Lỗi khi tải chương: " + err.message, { id: toastId! });
      } else {
        toast.error("Lỗi khi tải chương: " + err.message);
      }
    } finally {
      setIsLoadingChapter(false);
    }
  }

  useEffect(() => {
    if (selectedNovelId && selectedNovelId !== "none") {
      db.chapters.where("novelId").equals(selectedNovelId).sortBy("order")
        .then(chaps => {
          setChapters(chaps);
          if (initialChapterId && chaps.some(c => c.id === initialChapterId)) {
            setSelectedChapterId(initialChapterId);
            handleLoadChapterText(initialChapterId, true);
          } else if (chaps.length > 0) {
            setSelectedChapterId(chaps[0].id);
            handleLoadChapterText(chaps[0].id, true);
          } else {
            setSelectedChapterId("none");
          }
        })
        .catch(err => console.error("Failed to load chapters:", err));
    } else {
      setChapters([]);
      setSelectedChapterId("none");
    }
  }, [selectedNovelId, initialChapterId]);

  useEffect(() => {
    if (providers && providers.length > 0) {
      const defaultProv = providers.find(p => p.id === "admin-provider") || providers[0];
      if (!m1ProviderId) setM1ProviderId(defaultProv.id);
      if (!m2ProviderId) setM2ProviderId(defaultProv.id);
    }
  }, [providers]);

  // Set default models when models list changes
  useEffect(() => {
    if (m1Models && m1Models.length > 0 && !m1ModelId) {
      setM1ModelId(m1Models[0].modelId);
    }
  }, [m1Models, m1ModelId]);

  useEffect(() => {
    if (m2Models && m2Models.length > 0 && !m2ModelId) {
      setM2ModelId(m2Models[0].modelId);
    }
  }, [m2Models, m2ModelId]);

  // Sync settings when novel changes
  useEffect(() => {
    if (selectedNovelId !== "none") {
      db.novels.get(selectedNovelId).then(novel => {
        if (novel) {
          if (novel.customTranslateMode) {
            setUseTwoPass(novel.customTranslateMode === "comprehensive");
          }
          if (novel.customTranslateProviderId) {
            setM1ProviderId(novel.customTranslateProviderId);
            if (novel.customTranslateModelId) setM1ModelId(novel.customTranslateModelId);
          }
          if (novel.customModel1ProviderId) {
            setM1ProviderId(novel.customModel1ProviderId);
            if (novel.customModel1ModelId) setM1ModelId(novel.customModel1ModelId);
          }
          if (novel.customModel2ProviderId) {
            setM2ProviderId(novel.customModel2ProviderId);
            if (novel.customModel2ModelId) setM2ModelId(novel.customModel2ModelId);
          }
          if (novel.customStylePrompt) {
            setCustomStyleRules(novel.customStylePrompt);
          }
          if (novel.customPronounPrompt) {
            setCustomGlossaryRaw(prev => {
              if (prev.includes(novel.customPronounPrompt!)) return prev;
              return prev ? prev + "\n" + novel.customPronounPrompt : novel.customPronounPrompt!;
            });
          }
          // Try to match preset
          if (novel.genre) {
            const gLower = novel.genre.toLowerCase();
            if (gLower.includes("tiên hiệp") || gLower.includes("võ hiệp")) setSelectedPresetId("tienhiep");
            else if (gLower.includes("huyền huyễn")) setSelectedPresetId("huyenhuyen");
            else if (gLower.includes("đô thị") || gLower.includes("hiện đại")) setSelectedPresetId("dothi");
            else if (gLower.includes("đam mỹ") || gLower.includes("ngôn tình")) setSelectedPresetId("dammi_ngontinh");
          }
        }
      });
    }
  }, [selectedNovelId]);

  // Parse manual glossary
  const parseManualGlossary = useCallback((raw: string): Array<{ chinese: string; vietnamese: string }> => {
    const list: Array<{ chinese: string; vietnamese: string }> = [];
    const lines = raw.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
      // support ':' '->' or '='
      const parts = trimmed.split(/[:=]|\-\>/);
      if (parts.length >= 2) {
        const cn = parts[0].trim();
        const vi = parts[1].trim();
        if (cn && vi) {
          list.push({ chinese: cn, vietnamese: vi });
        }
      }
    }
    return list;
  }, []);

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsTranslating(false);
    setTranslationStep("idle");
    setLogs(prev => [...prev, { title: "Hủy bỏ", status: "error", message: "Đã hủy bởi quản trị viên." }]);
  };

  const handleTranslate = async () => {
    if (!sourceText.trim()) {
      toast.error("Vui lòng nhập văn bản tiếng Trung cần dịch!");
      return;
    }

    if (!m1ProviderId || !m1ModelId) {
      toast.error("Vui lòng chọn mô hình dịch chính!");
      return;
    }

    if (useTwoPass && (!m2ProviderId || !m2ModelId)) {
      toast.error("Vui lòng chọn mô hình biên tập!");
      return;
    }

    setIsTranslating(true);
    setLogs([]);
    setStreamedContent("");
    setPass1Output("");
    setFinalOutput("");
    setUsedGlossary([]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // 1. Matched Dictionary Loading & Filtering
      setTranslationStep("dict");
      setLogs([{ title: "Chuẩn bị từ điển", status: "running" }]);

      let mergedDict: Array<{ chinese: string; vietnamese: string }> = [];

      // Load manual glossary
      const manualEntries = parseManualGlossary(customGlossaryRaw);
      mergedDict.push(...manualEntries);

      // Load novel dict if chosen
      if (selectedNovelId !== "none") {
        const novelDict = await getMergedNameDict(selectedNovelId);
        mergedDict.push(...novelDict);
      }

      // Deduplicate dict (manual entries take priority)
      const dictMap = new Map<string, string>();
      for (const entry of mergedDict) {
        dictMap.set(entry.chinese, entry.vietnamese);
      }
      const uniqueDict = Array.from(dictMap, ([chinese, vietnamese]) => ({ chinese, vietnamese }));

      // Filter by source text
      const filtered = filterDictBySourceText(uniqueDict, sourceText);
      setUsedGlossary(filtered);

      setLogs([
        {
          title: "Chuẩn bị từ điển",
          status: "success",
          message: `Tìm thấy ${filtered.length} từ khớp trong văn bản.`
        }
      ]);

      // Resolve Language Models
      const m1Provider = providers?.find(p => p.id === m1ProviderId);
      const m1Model = await resolveChapterToolModel(
        { providerId: m1ProviderId, modelId: m1ModelId },
        m1Provider,
        undefined
      );

      if (!m1Model) {
        throw new Error("Không thể khởi tạo mô hình dịch chính. Vui lòng kiểm tra lại cấu hình API.");
      }

      // 2. Pass 1: Translate
      setTranslationStep("pass1");
      setLogs(prev => [...prev, { title: "Dịch thô (Pass 1)", status: "running" }]);

      // Construct Prompt
      const presetRules = STYLE_PRESETS.find(p => p.id === selectedPresetId)?.rules || "";
      const customRules = customStyleRules.trim();

      let glossarySection = "";
      if (filtered.length > 0) {
        glossarySection = `\n\n# THÔNG TIN TỪ ĐIỂN TÊN RIÊNG & THUẬT NGỮ (ƯU TIÊN CAO NHẤT):
Bạn BẮT BUỘC phải dùng đúng các từ dịch dưới đây cho các từ tương ứng trong nguyên tác Trung Quốc:
${filtered.map(e => `${e.chinese} → ${e.vietnamese}`).join("\n")}`;
      }

      const systemPrompt = `${DEFAULT_TRANSLATE_SYSTEM}
      
# CHỈ THỊ VĂN PHONG & QUY TẮC BỔ SUNG:
${presetRules ? `- Preset: ${presetRules}` : ""}
${customRules ? `- Quy tắc riêng: ${customRules}` : ""}
${glossarySection}`;

      let pass1ResultText = "";
      const pass1Result = streamText({
        model: m1Model,
        system: systemPrompt,
        prompt: sourceText,
        abortSignal: controller.signal
      });

      for await (const chunk of pass1Result.textStream) {
        pass1ResultText += chunk;
        setStreamedContent(pass1ResultText);
      }

      if (controller.signal.aborted) return;

      if (!pass1ResultText.trim()) {
        throw new Error("Kết quả dịch Pass 1 rỗng. Có thể bị chặn bởi bộ lọc an toàn.");
      }

      setPass1Output(pass1ResultText);
      setLogs(prev => {
        const copy = [...prev];
        copy[copy.length - 1] = { title: "Dịch thô (Pass 1)", status: "success", message: "Đã hoàn thành dịch thô." };
        return copy;
      });

      // 3. Pass 2: Edit/Refine (if enabled)
      if (useTwoPass) {
        setTranslationStep("pass2");
        setStreamedContent("");
        setLogs(prev => [...prev, { title: "Biên tập & Làm mịn (Pass 2)", status: "running" }]);

        const m2Provider = providers?.find(p => p.id === m2ProviderId);
        const m2Model = await resolveChapterToolModel(
          { providerId: m2ProviderId, modelId: m2ModelId },
          m2Provider,
          undefined
        );

        if (!m2Model) {
          throw new Error("Không thể khởi tạo mô hình biên tập. Vui lòng kiểm tra lại cấu hình API.");
        }

        const editSystemPrompt = `${DEFAULT_EDIT_SYSTEM}
        
# THÔNG TIN BỐI CẢNH & QUY TẮC BỔ SUNG:
- Thể loại/Văn phong yêu cầu: ${STYLE_PRESETS.find(p => p.id === selectedPresetId)?.name}
- Chỉ thị văn phong đặc biệt: ${customRules || "Không có"}
${glossarySection}`;

        const editUserPrompt = `NGUYÊN TÁC TRUNG QUỐC:\n${sourceText}\n\nBẢN DỊCH THÔ CẦN BIÊN TẬP:\n${pass1ResultText}`;

        let pass2ResultText = "";
        const pass2Result = streamText({
          model: m2Model,
          system: editSystemPrompt,
          prompt: editUserPrompt,
          abortSignal: controller.signal
        });

        for await (const chunk of pass2Result.textStream) {
          pass2ResultText += chunk;
          setStreamedContent(pass2ResultText);
        }

        if (controller.signal.aborted) return;

        if (!pass2ResultText.trim()) {
          throw new Error("Kết quả biên tập Pass 2 rỗng.");
        }

        setFinalOutput(pass2ResultText);
        setLogs(prev => {
          const copy = [...prev];
          copy[copy.length - 1] = { title: "Biên tập & Làm mịn (Pass 2)", status: "success", message: "Đã hoàn thành làm mịn bản dịch." };
          return copy;
        });
      } else {
        setFinalOutput(pass1ResultText);
      }

      setTranslationStep("done");
      toast.success("Dịch thử nghiệm hoàn tất!");
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error(err);
        toast.error("Lỗi dịch thuật: " + err.message);
        setLogs(prev => [...prev, { title: "Thất bại", status: "error", message: err.message }]);
      }
    } finally {
      setIsTranslating(false);
      abortControllerRef.current = null;
    }
  };

  const copyToClipboard = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    toast.success("Đã sao chép vào clipboard!");
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Settings Column */}
      <div className="space-y-6 lg:col-span-1">
        <Card className="shadow-md border-border bg-card">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-md font-bold flex items-center gap-2">
              <SettingsIcon className="size-4 text-primary" />
              Cấu hình Dịch thử
            </CardTitle>
            <CardDescription className="text-xs">
              Chọn chương cần thử nghiệm và bắt đầu dịch.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            {/* Novel Selection (Conditional) */}
            {!initialNovelId && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1">
                  <BookOpenIcon className="size-3" />
                  Từ điển truyện gốc
                </Label>
                <Select
                  value={selectedNovelId}
                  onValueChange={setSelectedNovelId}
                  disabled={isTranslating}
                >
                  <SelectTrigger className="h-9 text-xs bg-muted/20">
                    <SelectValue placeholder="Không dùng từ điển truyện" />
                  </SelectTrigger>
                  <SelectContent className="text-xs">
                    <SelectItem value="none">-- Không dùng từ điển truyện --</SelectItem>
                    {novels.map(n => (
                      <SelectItem key={n.id} value={n.id}>{n.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Chapter Selection */}
            {selectedNovelId !== "none" && chapters.length > 0 && (
              <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
                <Label className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1">
                  <FileTextIcon className="size-3" />
                  Chương nạp văn bản gốc
                </Label>
                <Select
                  value={selectedChapterId}
                  onValueChange={(val) => {
                    setSelectedChapterId(val);
                    handleLoadChapterText(val);
                  }}
                  disabled={isTranslating || isLoadingChapter}
                >
                  <SelectTrigger className="h-9 text-xs bg-muted/20">
                    <SelectValue placeholder="Chọn chương..." />
                  </SelectTrigger>
                  <SelectContent className="text-xs">
                    <SelectItem value="none">-- Chọn chương cần nạp --</SelectItem>
                    {chapters.map(ch => (
                      <SelectItem key={ch.id} value={ch.id}>{ch.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Collapsible Advanced Configuration */}
            <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced} className="space-y-4">
              <CollapsibleTrigger asChild>
                <Button variant="outline" size="sm" className="w-full justify-between h-8 text-[11px] font-medium text-muted-foreground mt-2">
                  <span className="flex items-center gap-1.5">
                    <SettingsIcon className="size-3.5" />
                    {showAdvanced ? "Ẩn cấu hình nâng cao" : "Cấu hình Văn phong & Model"}
                  </span>
                  {showAdvanced ? <ChevronUpIcon className="size-3.5" /> : <ChevronDownIcon className="size-3.5" />}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-3 animate-in fade-in duration-200 border-t mt-3">
                {/* Step Selection */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="pipeline-mode" className="text-xs font-semibold text-muted-foreground uppercase">Chế độ dịch</Label>
                    <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                      {useTwoPass ? "Dịch + Biên tập" : "Dịch 1 bước"}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2 bg-muted/40 p-2.5 rounded-lg border">
                    <Switch
                      id="pipeline-mode"
                      checked={useTwoPass}
                      onCheckedChange={setUseTwoPass}
                      disabled={isTranslating}
                    />
                    <div className="grid gap-0.5">
                      <Label htmlFor="pipeline-mode" className="text-xs font-medium cursor-pointer">Pipeline 2 Bước (Two-Pass)</Label>
                      <p className="text-[10px] text-muted-foreground">Model 1 dịch thô → Model 2 làm mịn văn phong</p>
                    </div>
                  </div>
                </div>

                {/* Model 1: Translator */}
                <div className="space-y-2 bg-muted/20 p-3 rounded-lg border border-border/60">
                  <Label className="text-xs font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1">
                    <BotIcon className="size-3.5" />
                    Mô hình dịch thô (Model 1)
                  </Label>
                  <div className="space-y-2">
                    <Select
                      value={m1ProviderId}
                      onValueChange={(val) => {
                        setM1ProviderId(val);
                        setM1ModelId("");
                      }}
                      disabled={isTranslating}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Chọn Nhà cung cấp..." />
                      </SelectTrigger>
                      <SelectContent>
                        {providers?.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={m1ModelId}
                      onValueChange={setM1ModelId}
                      disabled={isTranslating || !m1ProviderId}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Chọn Mô hình..." />
                      </SelectTrigger>
                      <SelectContent>
                        {m1Models?.map(m => (
                          <SelectItem key={m.id} value={m.modelId}>{m.name || m.modelId}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Model 2: Editor (Conditional) */}
                {useTwoPass && (
                  <div className="space-y-2 bg-muted/20 p-3 rounded-lg border border-purple-200/50 dark:border-purple-900/30">
                    <Label className="text-xs font-bold text-purple-600 dark:text-purple-400 flex items-center gap-1">
                      <SparklesIcon className="size-3.5 text-purple-500" />
                      Mô hình biên tập (Model 2)
                    </Label>
                    <div className="space-y-2">
                      <Select
                        value={m2ProviderId}
                        onValueChange={(val) => {
                          setM2ProviderId(val);
                          setM2ModelId("");
                        }}
                        disabled={isTranslating}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Chọn Nhà cung cấp..." />
                        </SelectTrigger>
                        <SelectContent>
                          {providers?.map(p => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select
                        value={m2ModelId}
                        onValueChange={setM2ModelId}
                        disabled={isTranslating || !m2ProviderId}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Chọn Mô hình..." />
                        </SelectTrigger>
                        <SelectContent>
                          {m2Models?.map(m => (
                            <SelectItem key={m.id} value={m.modelId}>{m.name || m.modelId}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* Genre Presets */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase">Preset Văn Phong</Label>
                  <Select
                    value={selectedPresetId}
                    onValueChange={setSelectedPresetId}
                    disabled={isTranslating}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="text-xs">
                      {STYLE_PRESETS.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    {STYLE_PRESETS.find(p => p.id === selectedPresetId)?.description}
                  </p>
                </div>

                {/* Custom Rules */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase">Chỉ thị văn phong bổ sung</Label>
                  <Textarea
                    value={customStyleRules}
                    onChange={e => setCustomStyleRules(e.target.value)}
                    placeholder="Ví dụ: Xưng hô 'ta - ngươi' cho nam chính lạnh lùng, 'tôi - em' khi nói chuyện với nữ chính..."
                    className="text-xs h-20 resize-y"
                    disabled={isTranslating}
                  />
                </div>

                {/* Custom Glossary */}
                <div className="space-y-2 border-t pt-3">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1">
                    <PlusIcon className="size-4 text-emerald-500" />
                    Từ Điển Tự Định Nghĩa (Glossary)
                  </Label>
                  <Textarea
                    value={customGlossaryRaw}
                    onChange={e => setCustomGlossaryRaw(e.target.value)}
                    placeholder="林枫: Lâm Phong&#10;萧炎: Tiêu Viêm&#10;ta: tôi&#10;ngươi: anh"
                    className="text-xs font-mono h-32 resize-y"
                    disabled={isTranslating}
                  />
                  <p className="text-[9px] text-muted-foreground leading-normal">
                    Định dạng: <span className="font-mono text-foreground font-semibold">Chữ Trung: Chữ Việt</span> (mỗi dòng một từ). Có thể dùng <span className="font-mono text-foreground font-semibold">{"->"}</span> hoặc <span className="font-mono text-foreground font-semibold">=</span>.
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
      </div>

      {/* Workspace Column */}
      <div className="space-y-6 lg:col-span-2 flex flex-col min-h-[500px]">
        {/* Split editors */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
          {/* Chinese Source Text */}
          <Card className="shadow-md border-border flex flex-col">
            <CardHeader className="py-2.5 px-4 border-b flex flex-row items-center justify-between bg-muted/20">
              <CardTitle className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-1.5">
                <FileTextIcon className="size-3.5" />
                Văn bản gốc (Trung Quốc)
              </CardTitle>
              <span className="text-[10px] text-muted-foreground font-mono">
                {sourceText.length} kí tự
              </span>
            </CardHeader>
            <CardContent className="p-0 flex-1 flex">
              <textarea
                value={sourceText}
                onChange={e => setSourceText(e.target.value)}
                placeholder="Nhập hoặc dán đoạn văn Trung Quốc cần dịch thử ở đây..."
                className="w-full min-h-[300px] md:min-h-full p-4 border-0 rounded-b-xl focus:ring-0 focus-visible:outline-none bg-background resize-none text-sm leading-relaxed font-sans"
                disabled={isTranslating}
              />
            </CardContent>
          </Card>

          {/* Vietnamese Target Text */}
          <Card className="shadow-md border-border flex flex-col bg-muted/5">
            <CardHeader className="py-2.5 px-4 border-b flex flex-row items-center justify-between bg-muted/20">
              <CardTitle className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase flex items-center gap-1.5">
                <LanguagesIcon className="size-3.5 text-emerald-500" />
                Kết quả dịch (AI)
              </CardTitle>
              <div className="flex items-center gap-1.5">
                {finalOutput && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => copyToClipboard(finalOutput)}
                    title="Sao chép kết quả"
                  >
                    <CopyIcon className="size-3" />
                  </Button>
                )}
                <span className="text-[10px] text-muted-foreground font-mono">
                  {finalOutput ? finalOutput.split(/\s+/).length : 0} từ
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-4 flex-1 flex flex-col relative overflow-y-auto max-h-[500px]">
              {isTranslating && streamedContent && (
                <div className="text-sm leading-relaxed text-foreground whitespace-pre-wrap font-sans">
                  {streamedContent}
                  <span className="inline-block w-1.5 h-4 bg-emerald-500 ml-0.5 animate-pulse" />
                </div>
              )}

              {!isTranslating && finalOutput && (
                <div className="text-sm leading-relaxed text-foreground whitespace-pre-wrap font-sans">
                  {finalOutput}
                </div>
              )}

              {!streamedContent && !finalOutput && (
                <div className="flex flex-col items-center justify-center m-auto text-muted-foreground space-y-2">
                  <BotIcon className="size-8 text-muted-foreground/40" />
                  <p className="text-xs text-center">Nhấn nút "Dịch Thử Nghiệm" bên dưới để xem kết quả.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Translation Actions & Logs */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-card border p-4 rounded-xl shadow-sm">
            <div className="flex items-center gap-3">
              {isTranslating ? (
                <Button variant="destructive" onClick={handleStop} className="h-10">
                  <StopCircleIcon className="mr-1.5 size-4" />
                  Dừng Dịch
                </Button>
              ) : (
                <Button
                  onClick={handleTranslate}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-md h-10 px-5"
                  disabled={!sourceText.trim()}
                >
                  <SparklesIcon className="mr-1.5 size-4 animate-pulse text-yellow-300" />
                  Dịch Thử Nghiệm
                </Button>
              )}

              {isTranslating && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2Icon className="size-4 animate-spin text-primary" />
                  <span>
                    {translationStep === "dict" && "Đang nạp từ điển..."}
                    {translationStep === "pass1" && "Đang chạy dịch thô..."}
                    {translationStep === "pass2" && "Đang chạy làm mịn (Pass 2)..."}
                  </span>
                </div>
              )}
            </div>

            {/* Clear Button */}
            {!isTranslating && (finalOutput || sourceText) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSourceText("");
                  setFinalOutput("");
                  setPass1Output("");
                  setStreamedContent("");
                  setLogs([]);
                  setUsedGlossary([]);
                }}
              >
                <Trash2Icon className="mr-1.5 size-3.5" />
                Xóa tất cả
              </Button>
            )}
          </div>

          {/* Stepper logs and matched glossary summary */}
          {(logs.length > 0 || usedGlossary.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Logs */}
              {logs.length > 0 && (
                <Card className="shadow-sm border-border bg-card">
                  <CardHeader className="py-2.5 px-4 border-b">
                    <CardTitle className="text-xs font-bold text-muted-foreground uppercase">
                      Nhật ký Xử lý Pipeline
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 space-y-2">
                    {logs.map((log, index) => (
                      <div key={index} className="flex items-start gap-2 text-xs">
                        {log.status === "running" && <Loader2Icon className="size-3.5 animate-spin text-primary mt-0.5" />}
                        {log.status === "success" && <CheckCircle2Icon className="size-3.5 text-emerald-500 mt-0.5" />}
                        {log.status === "error" && <AlertTriangleIcon className="size-3.5 text-destructive mt-0.5" />}
                        <div>
                          <p className="font-semibold">{log.title}</p>
                          {log.message && <p className="text-muted-foreground text-[10px] mt-0.5">{log.message}</p>}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Matched glossary terms */}
              {usedGlossary.length > 0 && (
                <Card className="shadow-sm border-border bg-card">
                  <CardHeader className="py-2.5 px-4 border-b flex justify-between items-center">
                    <CardTitle className="text-xs font-bold text-muted-foreground uppercase">
                      Từ Điển Được Áp Dụng ({usedGlossary.length} mục)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-3">
                    <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto">
                      {usedGlossary.map((g, i) => (
                        <div
                          key={i}
                          className="text-[10px] bg-muted/60 border rounded px-1.5 py-0.5 flex items-center gap-1"
                          title="Từ điển khớp trong bài viết"
                        >
                          <span className="font-medium text-foreground">{g.chinese}</span>
                          <span className="text-muted-foreground/60">→</span>
                          <span className="text-emerald-700 dark:text-emerald-300 font-medium">{g.vietnamese}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
