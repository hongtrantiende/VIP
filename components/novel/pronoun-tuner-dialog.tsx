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
import { Loader2Icon, SparklesIcon, SaveIcon, RefreshCwIcon, CheckIcon, Users } from "lucide-react";
import { useCallback, useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useLiveQuery } from "dexie-react-hooks";
import { getOriginalContent } from "@/lib/hooks/use-scene-versions";
import { useProfile } from "@/lib/hooks/use-profile";

export function PronounTunerDialog({
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
        if (open && novel?.customPronounPrompt && !generatedPrompt) {
            setGeneratedPrompt(novel.customPronounPrompt);
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
                    ? `Bạn là chuyên gia phân tích ngữ cảnh và xưng hô tiểu thuyết chuyên nghiệp.
Hãy phân tích mối quan hệ nhân vật chính và ngữ cảnh truyện tiếng Việt hiện tại để sinh ra quy tắc xưng hô ngắn gọn dưới dạng gạch đầu dòng, đúng trọng tâm.
Yêu cầu quy tắc xưng hô bao gồm:
- Quy định đại từ nhân xưng chuẩn xác, nhất quán giữa các nhân vật chính phụ dựa trên quan hệ và vai vế trong câu chuyện.
- Xác định sắc thái bối cảnh truyện (tiên hiệp, đô thị, ngôn tình...) để giữ xưng hô ổn định phù hợp bối cảnh đó.
- Nhấn mạnh tính nhất quán và nghiêm cấm thêm bớt tình tiết khi biên tập xưng hô.
- Không có lời dẫn dắt hay kết luận dư thừa, chỉ trả về các gạch đầu dòng quy tắc ngắn gọn cho AI biên tập.`
                    : `Bạn là chuyên gia phân tích ngữ cảnh và xưng hô tiểu thuyết Trung-Việt chuyên nghiệp.
Hãy phân tích mối quan hệ nhân vật chính và ngữ cảnh truyện để sinh ra quy tắc xưng hô ngắn gọn dưới dạng gạch đầu dòng, đúng trọng tâm.
Yêu cầu quy tắc xưng hô bao gồm:
- Quy định đại từ nhân xưng chuẩn xác, nhất quán giữa các nhân vật chính phụ dựa trên quan hệ và vai vế.
- Xác định sắc thái bối cảnh truyện (tiên hiệp, đô thị, hệ thống...) để giữ xưng hô ổn định phù hợp bối cảnh đó.
- Nhấn mạnh tính nhất quán và nghiêm cấm thêm bớt khi dịch xưng hô.
- Không có lời dẫn dắt hay kết luận dư thừa, chỉ trả về các gạch đầu dòng quy tắc ngắn gọn cho AI dịch.`,
                prompt: "MẪU TRUYỆN TRANH/VĂN BẢN:\n" + sampleText,
            });

            let fullText = "";
            for await (const chunk of result.textStream) {
                fullText += chunk;
            }

            setGeneratedPrompt(fullText.trim());
            toast.success("Đã phân tích xong xưng hô!");
        } catch (err: any) {
            toast.error("Lỗi khi quét xưng hô: " + err.message);
        } finally {
            setIsScanning(false);
        }
    };

    const handleSave = async () => {
        await db.novels.update(novelId, {
            customPronounPrompt: generatedPrompt.trim(),
            updatedAt: new Date(),
        });
        toast.success("Đã lưu quy tắc xưng hô thành công!");
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Users className="size-5 text-purple-500" />
                        Cấu hình Quy Tắc Xưng Hô & Bối Cảnh
                    </DialogTitle>
                    <DialogDescription>
                        AI sẽ phân tích các chương đầu của truyện để trích xuất quy tắc xưng hô (ngôi kể, đại từ vai vế) và ngữ cảnh của truyện.
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
                            <Users className="size-10 text-muted-foreground" />
                            <p className="text-sm text-muted-foreground">Chưa có quy tắc xưng hô nào được thiết lập.</p>
                            <Button onClick={handleScan} className="gap-2">
                                <SparklesIcon className="size-4" /> Bắt đầu quét xưng hô & bối cảnh
                            </Button>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3 flex-1 min-h-0">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">Quy tắc xưng hô:</span>
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
                                placeholder={isScanning ? "Đang phân tích..." : "Nhập quy tắc xưng hô & bối cảnh (VD: A xưng Ta gọi B là Ngưởi)..."}
                            />

                            <Button onClick={handleSave} className="w-full gap-2 mt-2" disabled={isScanning}>
                                <CheckIcon className="size-4" />
                                Lưu Xưng Hô
                            </Button>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
