"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LineEditor } from "@/components/ui/line-editor";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { db } from "@/lib/db";
import type { StepModelConfig, WritingAgentRole } from "@/lib/db";
import {
  getOrCreateWritingSettings,
  updateWritingSettings,
  useAIModels,
  useApiInferenceProviders,
  useWritingSettings,
} from "@/lib/hooks";
import { useDebouncedCallback } from "@/lib/hooks/use-debounce";
import { cn } from "@/lib/utils";
import { getDefaultPrompt } from "@/lib/writing/prompts";
import {
  BookOpenIcon,
  CompassIcon,
  ListTreeIcon,
  PenLineIcon,
  RotateCcwIcon,
  SearchCheckIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  SparklesIcon,
  Loader2Icon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { resolveStep } from "@/lib/ai/resolve-step";
import { generateStructured } from "@/lib/ai/structured";
import { jsonSchema } from "ai";

const SMART_WRITER_MIN_STEPS = 5;
const SMART_WRITER_MAX_STEPS = 20;

function clampSmartWriterSteps(n: number): number {
  return Math.min(
    SMART_WRITER_MAX_STEPS,
    Math.max(SMART_WRITER_MIN_STEPS, Math.round(n)),
  );
}

const AGENT_ROLES: {
  role: WritingAgentRole;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    role: "context",
    label: "Bối cảnh",
    description: "Tổng hợp bối cảnh từ chương trước",
    icon: BookOpenIcon,
  },
  {
    role: "direction",
    label: "Hướng đi",
    description: "Đề xuất hướng phát triển chương",
    icon: CompassIcon,
  },
  {
    role: "outline",
    label: "Giàn ý",
    description: "Tạo cấu trúc phân cảnh chi tiết",
    icon: ListTreeIcon,
  },
  {
    role: "writer",
    label: "Viết truyện",
    description: "Viết nội dung chương hoàn chỉnh",
    icon: PenLineIcon,
  },
  {
    role: "review",
    label: "Đánh giá",
    description: "Đánh giá chương theo 4 tiêu chí",
    icon: SearchCheckIcon,
  },
  {
    role: "rewrite",
    label: "Viết lại",
    description: "Viết lại chương dựa trên đánh giá",
    icon: PenLineIcon,
  },
];

export function StepModelPicker({
  novelId,
  role,
}: {
  novelId: string;
  role: WritingAgentRole;
}) {
  const settings = useWritingSettings(novelId);
  const modelKey = `${role}Model` as const;
  const value = settings?.[modelKey] as StepModelConfig | undefined;
  const providers = useApiInferenceProviders();
  const selectedProviderId = value?.providerId ?? "";
  const models = useAIModels(selectedProviderId || undefined);



  const handleProviderChange = async (providerId: string) => {
    await getOrCreateWritingSettings(novelId);
    if (!providerId) {
      updateWritingSettings(novelId, { [modelKey]: undefined });
      return;
    }
    updateWritingSettings(novelId, {
      [modelKey]: { providerId, modelId: "" },
    });
  };

  const handleModelChange = async (modelId: string) => {
    if (!selectedProviderId) return;
    await getOrCreateWritingSettings(novelId);
    updateWritingSettings(novelId, {
      [modelKey]: { providerId: selectedProviderId, modelId },
    });
  };

  return (
    <div className="grid gap-2 grid-cols-2">
      <div>
        <Label className="text-xs text-muted-foreground">Nhà cung cấp</Label>
        <NativeSelect
          className="mt-1 w-full"
          value={selectedProviderId}
          onChange={(e) => handleProviderChange(e.target.value)}
        >
          <NativeSelectOption value="">Mặc định (Chat)</NativeSelectOption>
          {providers?.map((p) => (
            <NativeSelectOption key={p.id} value={p.id}>
              {p.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Mô hình</Label>
        <NativeSelect
          className="mt-1 w-full"
          value={value?.modelId ?? ""}
          onChange={(e) => handleModelChange(e.target.value)}
          disabled={!selectedProviderId}
        >
          <NativeSelectOption value="">
            {selectedProviderId ? "Chọn mô hình" : "—"}
          </NativeSelectOption>
          {models?.map((m) => (
            <NativeSelectOption key={m.id} value={m.modelId}>
              {m.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
    </div>
  );
}

function PromptEditorField({
  novelId,
  value,
  isCustom,
  onSave,
  onReset,
}: {
  novelId: string;
  value: string;
  isCustom: boolean;
  onSave: (v: string) => void;
  onReset: () => void;
}) {
  const [text, setText] = useState(value);
  const [showAiDialog, setShowAiDialog] = useState(false);
  const [aiIdea, setAiIdea] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const handleAiEditPrompt = useCallback(async () => {
    if (!aiIdea.trim()) return;
    setIsGenerating(true);
    try {
      const chatSettings = await db.chatSettings.get("default");
      let model;
      if (chatSettings?.providerId && chatSettings?.modelId) {
        model = await resolveStep({ providerId: chatSettings.providerId, modelId: chatSettings.modelId });
      }
      if (!model) throw new Error("Không tìm thấy mô hình AI.");

      const promptEditSchema = jsonSchema<{
        rewrittenPrompt: string;
      }>({
        type: "object",
        properties: {
          rewrittenPrompt: {
            type: "string",
            description: "Toàn bộ nội dung System Prompt mới đã được sửa đổi và tích hợp đầy đủ ý tưởng bổ sung của người dùng mà vẫn duy trì cấu trúc XML và quy tắc chính."
          }
        },
        required: ["rewrittenPrompt"]
      });

      const { object } = await generateStructured({
        model,
        schema: promptEditSchema,
        system: `Bạn là một chuyên gia kỹ nghệ prompt (Prompt Engineer) xuất sắc. Nhiệm vụ của bạn là sửa đổi và tối ưu hóa System Prompt hiện tại để tích hợp chính xác ý tưởng/yêu cầu mới của người dùng.
Quy tắc:
1. ĐỒNG HÓA ý tưởng mới của người dùng vào prompt một cách tự nhiên và chuyên nghiệp.
2. DUY TRÌ cấu trúc prompt gốc (giữ các thẻ XML nếu có, giữ các hướng dẫn định dạng kết quả quan trọng).
3. NÂNG CAO tính rõ ràng, mạch lạc và hiệu quả của prompt.
4. KHÔNG giải thích, chỉ trả về prompt mới.`,
        prompt: `System Prompt hiện tại:\n${text}\n\nYêu cầu bổ sung/sửa đổi của người dùng:\n${aiIdea}`,
      });

      if (object.rewrittenPrompt?.trim()) {
        const newVal = object.rewrittenPrompt.trim();
        setText(newVal);
        onSave(newVal);
        setShowAiDialog(false);
        setAiIdea("");
        toast.success("Đã dùng AI tối ưu hóa Prompt thành công!");
      } else {
        toast.warning("AI không trả về prompt hợp lệ.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lỗi khi dùng AI sửa prompt");
    } finally {
      setIsGenerating(false);
    }
  }, [novelId, text, aiIdea, onSave]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">System Prompt</Label>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] text-violet-600 hover:text-violet-700 bg-violet-50 dark:bg-violet-950/20 px-2"
            onClick={() => setShowAiDialog(!showAiDialog)}
            disabled={isGenerating}
          >
            <SparklesIcon className="h-3 w-3 mr-1" />
            AI Tùy chỉnh
          </Button>
          {isCustom && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-muted-foreground"
              onClick={onReset}
            >
              <RotateCcwIcon className="h-3 w-3 mr-1" />
              Khôi phục mặc định
            </Button>
          )}
        </div>
      </div>

      {showAiDialog && (
        <div className="rounded-lg border border-violet-100 dark:border-violet-900 bg-violet-50/40 dark:bg-violet-950/10 p-3 space-y-2">
          <p className="text-[11px] font-semibold text-violet-600 dark:text-violet-400">
            🪄 Yêu cầu AI sửa System Prompt theo ý muốn
          </p>
          <textarea
            value={aiIdea}
            onChange={(e) => setAiIdea(e.target.value)}
            placeholder="Ví dụ: Bổ sung luật không viết hoa tùy tiện, viết giọng điệu cổ trang huyền huyễn u ám, tập trung miêu tả võ học chiêu thức chi tiết..."
            className="w-full h-16 rounded-md border bg-background px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-primary focus-visible:outline-none"
            disabled={isGenerating}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleAiEditPrompt}
              disabled={isGenerating || !aiIdea.trim()}
              className="h-7 text-xs bg-violet-600 hover:bg-violet-700 text-white"
            >
              {isGenerating ? (
                <>
                  <Loader2Icon className="h-3 w-3 mr-1 animate-spin" />
                  Đang sửa...
                </>
              ) : (
                "Áp dụng"
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAiDialog(false)}
              disabled={isGenerating}
              className="h-7 text-xs"
            >
              Hủy
            </Button>
          </div>
        </div>
      )}

      <LineEditor
        value={text}
        onChange={(v) => {
          setText(v);
          onSave(v);
        }}
        className="h-[300px]"
        contentFont="text-xs leading-5"
        gutterFont="text-xs leading-5"
        xmlColors
      />
      {!isCustom && (
        <p className="text-xs text-muted-foreground">
          Đây là prompt mặc định. Chỉnh sửa trực tiếp để tùy biến.
        </p>
      )}
    </div>
  );
}

export function WritingSettingsDialog({
  novelId,
  open,
  onOpenChangeAction,
  initialRole,
}: {
  novelId: string;
  open: boolean;
  onOpenChangeAction: (open: boolean) => void;
  initialRole?: WritingAgentRole;
}) {
  const settings = useWritingSettings(novelId);
  const chapterLength = settings?.chapterLength ?? 3000;
  const smartWritingMode = settings?.smartWritingMode ?? false;
  const smartWriterMaxToolSteps = settings?.smartWriterMaxToolSteps;
  const noAskingMode = settings?.noAskingMode ?? false;
  const perspective = (settings as any)?.perspective ?? "third-omniscient";
  const perspectiveCustom = (settings as any)?.perspectiveCustom ?? "";

  const handlePerspectiveChange = async (value: string) => {
    await updateWritingSettings(novelId, { perspective: value } as any);
  };

  const handlePerspectiveCustomChange = async (value: string) => {
    await updateWritingSettings(novelId, { perspectiveCustom: value } as any);
  };

  const [activeRole, setActiveRole] = useState<WritingAgentRole>("context");

  useEffect(() => {
    if (open && initialRole) {
      setActiveRole(initialRole);
    }
  }, [open, initialRole]);

  const sliderSteps = clampSmartWriterSteps(smartWriterMaxToolSteps ?? 12);

  if (open && !settings) {
    getOrCreateWritingSettings(novelId);
  }

  const debouncedPromptChange = useDebouncedCallback(
    async (role: WritingAgentRole, value: string) => {
      const key = `${role}Prompt` as const;
      const defaultPrompt = getDefaultPrompt(role);
      await updateWritingSettings(novelId, {
        [key]: value === defaultPrompt ? undefined : value,
      });
    },
    500,
  );

  const handleLengthChange = async (value: number) => {
    await updateWritingSettings(novelId, { chapterLength: value });
  };

  const handleSmartModeChange = async (checked: boolean) => {
    await updateWritingSettings(novelId, {
      smartWritingMode: checked,
      ...(checked
        ? {
            smartWriterMaxToolSteps:
              smartWriterMaxToolSteps != null
                ? clampSmartWriterSteps(smartWriterMaxToolSteps)
                : 12,
          }
        : { smartWriterMaxToolSteps: undefined }),
    });
  };

  const handleSmartMaxStepsChange = async (value: number) => {
    await updateWritingSettings(novelId, {
      smartWriterMaxToolSteps: clampSmartWriterSteps(value),
    });
  };

  const handleNoAskingChange = async (checked: boolean) => {
    await updateWritingSettings(novelId, { noAskingMode: checked });
  };

  const handleResetPrompt = async (role: WritingAgentRole) => {
    const key = `${role}Prompt` as const;
    await updateWritingSettings(novelId, { [key]: undefined });
  };

  const getPromptValue = (role: WritingAgentRole): string => {
    const key = `${role}Prompt` as const;
    const custom = settings?.[key] as string | undefined;
    return custom || getDefaultPrompt(role);
  };

  const isCustomPrompt = (role: WritingAgentRole): boolean => {
    const key = `${role}Prompt` as const;
    return !!(settings?.[key] as string | undefined);
  };

  const activeConfig = AGENT_ROLES.find((r) => r.role === activeRole)!;

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle>Cài đặt viết truyện</DialogTitle>
          <DialogDescription>
            Thiết lập hành vi pipeline và độ dài chương cũng như cấu hình AI
            từng bước.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          defaultValue="general"
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <TabsList
            variant="line"
            className="mx-6 mb-0 h-10 w-auto shrink-0 justify-start rounded-none border-b border-border bg-transparent p-0 gap-0"
          >
            <TabsTrigger
              value="general"
              className="rounded-none border-0 shadow-none data-active:shadow-none px-4"
            >
              <Settings2Icon className="size-4" />
              Chung
            </TabsTrigger>
            <TabsTrigger
              value="steps"
              className="rounded-none border-0 shadow-none data-active:shadow-none px-4"
            >
              <SlidersHorizontalIcon className="size-4" />
              Mô hình &amp; prompt
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="general"
            className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
          >
            <ScrollArea className="h-[min(70vh,calc(85vh-10rem))]">
              <div className="space-y-6 px-6 py-4 pb-6">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Độ dài chương</Label>
                  <div className="flex flex-wrap items-center gap-3">
                    <Input
                      type="number"
                      value={chapterLength}
                      onChange={(e) =>
                        handleLengthChange(Number(e.target.value) || 3000)
                      }
                      min={500}
                      max={10000}
                      step={500}
                      className="w-28"
                    />
                    <span className="text-xs text-muted-foreground">
                      từ / chương
                    </span>
                  </div>
                </div>

                <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Hành vi pipeline
                  </p>
                  <div className="flex items-start gap-3">
                    <Switch
                      id="smart-writing"
                      className="mt-0.5"
                      checked={smartWritingMode}
                      onCheckedChange={handleSmartModeChange}
                    />
                    <div className="space-y-0.5">
                      <Label
                        htmlFor="smart-writing"
                        className="text-sm cursor-pointer font-medium leading-snug"
                      >
                        Viết thông minh
                      </Label>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Tra cứu tiểu thuyết bằng công cụ, không gọi LLM bước bối
                        cảnh. Áp dụng theo cài đặt hiện tại mỗi lần chạy hoặc
                        tiếp tục pipeline.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <Switch
                      id="no-asking"
                      className="mt-0.5"
                      checked={noAskingMode}
                      onCheckedChange={handleNoAskingChange}
                    />
                    <div className="space-y-0.5">
                      <Label
                        htmlFor="no-asking"
                        className="text-sm cursor-pointer font-medium leading-snug"
                      >
                        Không hỏi lại
                      </Label>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Chạy liền tới khi đánh giá xong; tự chọn hướng theo gợi
                        ý AI. Theo cài đặt hiện tại mỗi bước pipeline.
                      </p>
                    </div>
                  </div>

                  <div
                    className={cn(
                      "space-y-3 pt-1 border-t border-border/60",
                      !smartWritingMode && "opacity-50 pointer-events-none",
                    )}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <Label className="text-sm font-medium">
                        Giới hạn bước công cụ (smart writer)
                      </Label>
                      <span className="tabular-nums text-sm font-semibold text-foreground min-w-[2ch] text-right">
                        {sliderSteps}
                      </span>
                    </div>
                    <Slider
                      min={SMART_WRITER_MIN_STEPS}
                      max={SMART_WRITER_MAX_STEPS}
                      step={1}
                      value={[sliderSteps]}
                      onValueChange={(v) => {
                        const n = v[0];
                        if (n != null) void handleSmartMaxStepsChange(n);
                      }}
                      disabled={!smartWritingMode}
                      aria-label="Giới hạn bước công cụ smart writer"
                    />
                    <p className="text-xs text-muted-foreground">
                      <span className="mr-0.5">
                        {SMART_WRITER_MIN_STEPS}–{SMART_WRITER_MAX_STEPS}
                      </span>
                      vòng gọi công cụ mỗi lần viết. Khi tắt &quot;Viết thông
                      minh&quot;, giá trị không dùng.
                    </p>
                  </div>
                </div>


              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent
            value="steps"
            className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden border-t data-[state=inactive]:hidden"
          >
            <div className="flex min-h-0 flex-1">
              <div className="w-48 shrink-0 border-r bg-muted/30">
                <div className="p-2 space-y-0.5">
                  {AGENT_ROLES.map(({ role, label, icon: Icon }) => {
                    const hasCustom = isCustomPrompt(role);
                    const hasModel = !!(settings?.[`${role}Model` as const] as
                      | StepModelConfig
                      | undefined);
                    return (
                      <button
                        key={role}
                        type="button"
                        onClick={() => setActiveRole(role)}
                        className={cn(
                          "flex items-center gap-2.5 w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
                          activeRole === role
                            ? "bg-background shadow-sm font-medium"
                            : "hover:bg-background/60 text-muted-foreground",
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1 truncate">{label}</span>
                        {(hasCustom || hasModel) && (
                          <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <ScrollArea className="flex-1 h-[min(70vh,calc(85vh-10rem))]">
                <div className="p-5 space-y-5">
                  <div>
                    <div className="flex items-center gap-2">
                      <activeConfig.icon className="h-4 w-4" />
                      <h3 className="text-sm font-medium">
                        {activeConfig.label}
                      </h3>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {activeConfig.description}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs font-medium">Mô hình AI</Label>
                    <StepModelPicker novelId={novelId} role={activeRole} />
                  </div>

                  <PromptEditorField
                    key={activeRole}
                    novelId={novelId}
                    value={getPromptValue(activeRole)}
                    isCustom={isCustomPrompt(activeRole)}
                    onSave={(v) => debouncedPromptChange.run(activeRole, v)}
                    onReset={() => void handleResetPrompt(activeRole)}
                  />
                </div>
              </ScrollArea>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
