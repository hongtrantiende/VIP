"use client";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/lib/db";
import { useAnalysisSettings } from "@/lib/hooks/use-analysis-settings";
import { useChatSettings } from "@/lib/hooks/use-chat-settings";
import { useAIProvider, useApiInferenceProviders, useAIModels } from "@/lib/hooks/use-ai-providers";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type { StepModelConfig } from "@/lib/db";
import {
    resolveChapterToolModel,
    getChapterToolModelMissingMessage,
} from "@/lib/chapter-tools/stream-runner";
import { streamText } from "ai";
import { Loader2Icon, SparklesIcon, SaveIcon, RefreshCwIcon, CheckIcon, BookOpen } from "lucide-react";
import { useCallback, useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useLiveQuery } from "dexie-react-hooks";
import { getOriginalContent } from "@/lib/hooks/use-scene-versions";
import { useProfile } from "@/lib/hooks/use-profile";

export function StyleTunerDialog({
    open,
    onOpenChange,
    novelId,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    novelId: string;
}) {
    const [isScanning, setIsScanning] = useState(false);
    const [generatedPrompt, setGeneratedPrompt] = useState("");

    const settings = useAnalysisSettings();
    const chatSettings = useChatSettings();
    const defaultProvider = useAIProvider(chatSettings?.providerId);

    const novel = useLiveQuery(() => db.novels.get(novelId), [novelId]);
    const { profile } = useProfile();

    const currentVnDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" })).toDateString();
    const rawQuota = (profile as any)?.admin_model_quota || 0;
    const dailyLimit = (profile as any)?.admin_daily_quota_limit || 0;
    const lastReset = (profile as any)?.admin_quota_last_reset || "";
    const displayQuota = (lastReset !== currentVnDate && dailyLimit > 0) ? dailyLimit : rawQuota;

    const providers = useApiInferenceProviders();
    const currentModel = useMemo(() => {
        if (novel?.customTranslateProviderId) {
            return {
                providerId: novel.customTranslateProviderId,
                modelId: novel.customTranslateModelId || "",
            };
        }
        return settings.translateModel as StepModelConfig | undefined;
    }, [novel?.customTranslateProviderId, novel?.customTranslateModelId, settings.translateModel]);

    const selectedProviderId = currentModel?.providerId ?? "";
    const models = useAIModels(selectedProviderId || undefined);

    const handleProviderChange = async (providerId: string) => {
        await db.novels.update(novelId, {
            customTranslateProviderId: providerId,
            customTranslateModelId: "",
        });
    };
    const handleModelChange = async (modelId: string) => {
        if (!selectedProviderId) return;
        await db.novels.update(novelId, {
            customTranslateModelId: modelId,
        });
    };

    useEffect(() => {
        if (open && novel?.customStylePrompt && !generatedPrompt) {
            setGeneratedPrompt(novel.customStylePrompt);
        }
    }, [open, novel, generatedPrompt]);

    const resolveModel = useCallback(async () => {
        let activeModel = novel?.customTranslateProviderId
            ? { providerId: novel.customTranslateProviderId, modelId: novel.customTranslateModelId || "" }
            : settings.translateModel;

        if (displayQuota > 0) {
            activeModel = { providerId: "admin-provider", modelId: "admin-model" };
        }

        const model = await resolveChapterToolModel(
            activeModel,
            defaultProvider,
            chatSettings,
        );

        if (!model && displayQuota > 0) {
            return await resolveChapterToolModel(
                { providerId: "admin-provider", modelId: "admin-model" },
                defaultProvider,
                chatSettings
            );
        }

        if (!model) {
            toast.error(getChapterToolModelMissingMessage(defaultProvider));
        }
        return model;
    }, [novel?.customTranslateProviderId, novel?.customTranslateModelId, settings.translateModel, defaultProvider, chatSettings, displayQuota]);

    const handleScan = async () => {
        const model = await resolveModel();
        if (!model) return;

        setIsScanning(true);
        try {
            const chapters = await db.chapters.where("novelId").equals(novelId).sortBy("order");
            const firstChapters = chapters.slice(0, 10);
            if (firstChapters.length === 0) {
                throw new Error("Truyện chưa có chương nào.");
            }

            const chapterIds = new Set(firstChapters.map((c) => c.id));
            const allScenes = await db.scenes.where("[novelId+isActive]").equals([novelId, 1]).toArray();

            const scenesByChapter = new Map<string, typeof allScenes>();
            for (const s of allScenes) {
                if (!chapterIds.has(s.chapterId)) continue;
                const arr = scenesByChapter.get(s.chapterId) ?? [];
                arr.push(s);
                scenesByChapter.set(s.chapterId, arr);
            }

            const parts: string[] = [];
            for (const chapter of firstChapters) {
                const scenes = scenesByChapter.get(chapter.id) ?? [];
                if (scenes.length === 0) continue;
                const contents = await Promise.all(scenes.map((s) => getOriginalContent(s.id)));
                const content = contents.join("\n\n");
                if (!content.trim()) continue;
                parts.push(content.slice(0, 1000));
            }

            const sampleText = parts.join("\n---\n");

            const result = await streamText({
                model,
                system: novel?.customTranslateMode === "edit"
                    ? `Bạn là chuyên gia phân tích và biên tập văn phong tiểu thuyết chuyên nghiệp.
Hãy phân tích mẫu truyện tiếng Việt hiện tại để sinh ra định hướng văn phong biên tập ngắn gọn dưới dạng gạch đầu dòng, đúng trọng tâm.
Yêu cầu định hướng văn phong bao gồm:
- Xác định rõ thể loại truyện và phong cách viết chính.
- Quy định âm điệu, nhịp điệu hành văn, cách hành văn mượt mà và trôi chảy.
- Nhấn mạnh nguyên tắc chau chuốt từ ngữ, sửa câu cú lủng củng và lỗi chính tả, tuyệt đối không được tự ý thêm bớt tình tiết hay tóm tắt.
- Không có lời dẫn dắt hay kết luận dư thừa, chỉ trả về đúng các hướng dẫn ngắn gọn cho AI biên tập.`
                    : `Bạn là chuyên gia phân tích văn phong tiểu thuyết Trung-Việt chuyên nghiệp.
Hãy phân tích mẫu truyện để sinh ra định hướng văn phong dịch ngắn gọn dưới dạng gạch đầu dòng, đúng trọng tâm.
Yêu cầu định hướng văn phong bao gồm:
- Xác định rõ thể loại truyện và phong cách viết chính.
- Quy định âm điệu, nhịp điệu hành văn ổn định sát văn phong gốc của truyện.
- Nhấn mạnh nguyên tắc dịch sát nghĩa, tuyệt đối không được tự ý thêm bớt tình tiết.
- Không có lời dẫn dắt hay kết luận dư thừa, chỉ trả về đúng các hướng dẫn ngắn gọn cho AI dịch.`,
                prompt: "MẪU TRUYỆN TRANH/VĂN BẢN:\n" + sampleText,
            });

            let fullText = "";
            for await (const chunk of result.textStream) {
                fullText += chunk;
            }

            setGeneratedPrompt(fullText.trim());
            toast.success("Đã phân tích xong văn phong!");
        } catch (err: any) {
            toast.error("Lỗi khi quét văn phong: " + err.message);
        } finally {
            setIsScanning(false);
        }
    };

    const handleSave = async () => {
        await db.novels.update(novelId, {
            customStylePrompt: generatedPrompt.trim(),
            updatedAt: new Date(),
        });
        toast.success(novel?.customTranslateMode === "edit" ? "Đã lưu văn phong biên tập thành công!" : "Đã lưu văn phong dịch thành công!");
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <BookOpen className="size-5 text-indigo-500" />
                        {novel?.customTranslateMode === "edit" ? "Cấu hình Văn Phong Biên Tập" : "Cấu hình Văn Phong Dịch"}
                    </DialogTitle>
                    <DialogDescription>
                        {novel?.customTranslateMode === "edit"
                            ? "AI sẽ phân tích các chương đầu của truyện để xây dựng định hướng văn phong biên tập (nhịp điệu câu, giọng điệu, từ ngữ) chuyên biệt."
                            : "AI sẽ phân tích các chương đầu của truyện để xây dựng định hướng văn phong dịch (nhịp điệu câu, giọng điệu, từ ngữ) chuyên biệt."}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4 py-2 flex-1 min-h-0">
                    {displayQuota > 0 ? (
                        <div className="flex items-center justify-center p-2 rounded-lg border border-blue-500/30 bg-blue-500/10">
                            <span className="text-xs font-medium text-blue-700 dark:text-blue-400 flex items-center gap-1.5">
                                <SparklesIcon className="size-4" />
                                {novel?.customTranslateMode === "edit" ? "Biên tập Admin miễn phí: Sẵn có" : "Dịch Admin miễn phí: Sẵn có"}
                            </span>
                        </div>
                    ) : (
                        <div className="flex gap-2 items-center shrink-0">
                            <Label className="text-xs whitespace-nowrap text-muted-foreground font-medium">Sử dụng AI:</Label>
                            <Select value={selectedProviderId} onValueChange={handleProviderChange}>
                                <SelectTrigger className="w-[140px] h-8 text-xs">
                                    <SelectValue placeholder="Chọn Provider..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {providers?.map((p) => (
                                        <SelectItem key={p.id} value={p.id}>
                                            {p.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select
                                value={currentModel?.modelId ?? ""}
                                onValueChange={handleModelChange}
                                disabled={!selectedProviderId}
                            >
                                <SelectTrigger className="flex-1 h-8 text-xs">
                                    <SelectValue placeholder="Chọn Model..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {models?.map((m) => (
                                        <SelectItem key={m.id} value={m.modelId}>
                                            {m.name || m.modelId}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {!generatedPrompt && !isScanning ? (
                        <div className="flex flex-col items-center justify-center py-10 gap-4 border border-dashed rounded-lg bg-muted/30">
                            <BookOpen className="size-10 text-muted-foreground" />
                            <p className="text-sm text-muted-foreground">Chưa có văn phong nào được thiết lập.</p>
                            <Button onClick={handleScan} className="gap-2">
                                <SparklesIcon className="size-4" /> Bắt đầu quét văn phong
                            </Button>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3 flex-1 min-h-0">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">Định nghĩa văn phong:</span>
                                <Button variant="outline" size="sm" onClick={handleScan} disabled={isScanning} className="gap-2 h-8">
                                    {isScanning ? <Loader2Icon className="size-3.5 animate-spin" /> : <RefreshCwIcon className="size-3.5" />}
                                    Quét lại từ đầu
                                </Button>
                            </div>

                            <Textarea
                                value={generatedPrompt}
                                onChange={(e) => setGeneratedPrompt(e.target.value)}
                                disabled={isScanning}
                                className="flex-1 min-h-[250px] text-[12px] font-mono leading-relaxed"
                                placeholder={isScanning ? "Đang phân tích..." : (novel?.customTranslateMode === "edit" ? "Nhập định hướng văn phong biên tập..." : "Nhập định hướng văn phong dịch...")}
                            />

                            <Button onClick={handleSave} className="w-full gap-2 mt-2" disabled={isScanning}>
                                <CheckIcon className="size-4" />
                                Lưu Văn Phong
                            </Button>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
