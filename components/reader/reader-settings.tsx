"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Slider } from "@/components/ui/slider";
import { useReaderPanel } from "@/lib/stores/reader-panel";
import { getProvider, listProviders } from "@/lib/tts";
import type { Voice } from "@/lib/tts/providers/types";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, KeyIcon, SettingsIcon, DownloadIcon, CheckIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export function ReaderSettings() {
  const ttsSettings = useReaderPanel((s) => s.ttsSettings);
  const updateSettings = useReaderPanel((s) => s.updateSettings);
  const selectedProvider = ttsSettings.providerId;
  const providers = listProviders();

  const [isOpen, setIsOpen] = useState(true);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [isDownloaded, setIsDownloaded] = useState(true);
  const [downloading, setDownloading] = useState(false);

  // Check if voice is downloaded (for PiperTTS only)
  useEffect(() => {
    if (selectedProvider !== "PiperTTS" || !ttsSettings.voiceId) {
      return;
    }

    let cancelled = false;
    
    (async () => {
      try {
        const response = await fetch(`/api/tts/piper?check=${ttsSettings.voiceId}`, {
          headers: {
            "x-piper-server-url": ttsSettings.providerApiKeys?.["PiperTTS"] || "http://localhost:5000",
          }
        });
        if (response.ok) {
          const data = await response.json();
          if (!cancelled) {
            setIsDownloaded(data.downloaded);
          }
        }
      } catch (err) {
        console.error("Error checking voice download status:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedProvider, ttsSettings.voiceId, ttsSettings.providerApiKeys]);

  const handleDownloadVoice = async () => {
    if (selectedProvider !== "PiperTTS" || !ttsSettings.voiceId || downloading) {
      return;
    }

    setDownloading(true);
    const toastId = toast.loading(`Đang tải giọng đọc ${ttsSettings.voiceId}...`);

    try {
      const response = await fetch(`/api/tts/piper?download=${ttsSettings.voiceId}`, {
        headers: {
          "x-piper-server-url": ttsSettings.providerApiKeys?.["PiperTTS"] || "http://localhost:5000",
        }
      });

      if (response.ok) {
        setIsDownloaded(true);
        toast.success(`Đã tải xong giọng đọc!`, { id: toastId });
      } else {
        const data = await response.json().catch(() => ({}));
        
        // Detect if hostname is production (non-local)
        const isLocal = typeof window !== "undefined" && 
          (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname.includes("192.168."));
        
        if (!isLocal) {
          const clean = ttsSettings.voiceId.replace(/^voices\//, "").replace(/^vi\//, "").replace(/\.onnx$/, "");
          const modelUrl = `https://tts-piper.pages.dev/api/model/${encodeURIComponent(clean)}.onnx`;
          const jsonUrl = `https://tts-piper.pages.dev/api/model/${encodeURIComponent(clean)}.onnx.json`;

          toast.error(
            <div className="flex flex-col gap-1 text-xs text-foreground">
              <span className="font-semibold text-amber-500">Lỗi lưu trữ đám mây (ổ đĩa Cloud bị khóa chỉ đọc).</span>
              <span>Hãy tải thủ công 2 file này về thư mục <code className="bg-muted px-1 py-0.5 rounded text-[10px] font-mono">voices/</code> trong thư mục app của bạn:</span>
              <div className="mt-2 flex flex-col gap-1.5 font-medium underline">
                <a href={modelUrl} target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-600 flex items-center gap-1">
                  1. Tải Model ({clean}.onnx)
                </a>
                <a href={jsonUrl} target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-600 flex items-center gap-1">
                  2. Tải Cấu hình ({clean}.onnx.json)
                </a>
              </div>
            </div>,
            { id: toastId, duration: 15000 }
          );
        } else {
          toast.error(data.error || `Tải giọng đọc thất bại!`, { id: toastId });
        }
      }
    } catch (err: any) {
      toast.error(`Lỗi kết nối: ${err.message || err}`, { id: toastId });
    } finally {
      setDownloading(false);
    }
  };



  // Check if selected provider requires API key
  const providerNeedsKey = (() => {
    try {
      const p = getProvider(selectedProvider);
      return !!p.requiresApiKey;
    } catch {
      return false;
    }
  })();

  // Fetch voices when provider changes
  useEffect(() => {
    if (!selectedProvider) {
      setVoices([]);
      return;
    }

    let cancelled = false;
    setLoadingVoices(true);

    (async () => {
      try {
        const provider = getProvider(selectedProvider);
        await provider.initialize();
        const v = await provider.getVoices();
        if (!cancelled) setVoices(v);
      } catch {
        if (!cancelled) setVoices([]);
      } finally {
        if (!cancelled) setLoadingVoices(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedProvider]);

  const handleProviderChange = (providerId: string) => {
    // Reset voice to first available when switching providers
    let defaultVoice = "0";
    if (providerId === "PiperTTS") {
      defaultVoice = "Ban Mai";
    } else if (providerId === "GoogleCloudTTS") {
      defaultVoice = "via";
    }
    updateSettings({ providerId, voiceId: defaultVoice });
  };

  const currentApiKey = ttsSettings.providerApiKeys?.[selectedProvider] ?? "";

  const handleApiKeyChange = (key: string) => {
    updateSettings({
      providerApiKeys: {
        ...ttsSettings.providerApiKeys,
        [selectedProvider]: key,
      },
    });
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
        <SettingsIcon className="size-3.5" />
        Cài đặt giọng đọc
        <ChevronDownIcon
          className={cn(
            "ml-auto size-3.5 transition-transform",
            isOpen && "rotate-180",
          )}
        />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="space-y-4 px-4 pb-4">
          {/* Provider selector */}
          <div className="space-y-1.5">
            <Label className="text-xs">Nhà cung cấp</Label>
            <NativeSelect
              className="w-full"
              value={selectedProvider}
              onChange={(e) => handleProviderChange(e.target.value)}
            >
              {providers.map((p) => (
                <NativeSelectOption key={p.name} value={p.name}>
                  {p.friendlyName}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          {/* Voice selector */}
          <div className="space-y-1.5">
            <Label className="text-xs">Giọng đọc</Label>
            <NativeSelect
              className="w-full"
              value={ttsSettings.voiceId}
              onChange={(e) => updateSettings({ voiceId: e.target.value })}
              disabled={loadingVoices || voices.length === 0}
            >
              {loadingVoices && (
                <NativeSelectOption value="">Đang tải...</NativeSelectOption>
              )}
              {voices.map((voice) => (
                <NativeSelectOption key={voice.id} value={String(voice.id)}>
                  {voice.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          {/* Download indicator for Piper TTS */}
          {selectedProvider === "PiperTTS" && ttsSettings.voiceId && (
            <div className="flex items-center justify-between rounded-lg border border-input/40 bg-muted/20 px-3 py-2 text-xs">
              <span className="text-muted-foreground flex items-center gap-1.5">
                {isDownloaded ? (
                  <>
                    <CheckIcon className="size-3.5 text-green-500" />
                    Sẵn sàng hoạt động
                  </>
                ) : (
                  <>
                    <DownloadIcon className="size-3.5 text-amber-500" />
                    Chưa tải về máy
                  </>
                )}
              </span>
              {!isDownloaded && (
                <button
                  type="button"
                  onClick={handleDownloadVoice}
                  disabled={downloading}
                  className={cn(
                    "flex items-center gap-1 rounded bg-primary px-2.5 py-1 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-wait"
                  )}
                >
                  {downloading ? "Đang tải..." : "Tải về (63MB)"}
                </button>
              )}
            </div>
          )}

          {/* API key (only for providers that need it) */}
          {providerNeedsKey && (
            <div className="space-y-1.5">
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {selectedProvider === "PiperTTS" ? (
                  <SettingsIcon className="size-3" />
                ) : (
                  <KeyIcon className="size-3" />
                )}
                {selectedProvider === "PiperTTS" ? "API URL" : "API Key"}
                <ChevronDownIcon
                  className={cn(
                    "size-3 transition-transform",
                    showApiKey && "rotate-180",
                  )}
                />
              </button>
              {showApiKey && (
                <Input
                  type={selectedProvider === "PiperTTS" ? "text" : "password"}
                  placeholder={
                    selectedProvider === "PiperTTS"
                      ? "Mặc định: http://localhost:5000"
                      : "Nhập API key..."
                  }
                  value={currentApiKey}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  className="h-8 text-xs"
                />
              )}
            </div>
          )}

          {/* Rate slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Tốc độ đọc</Label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {ttsSettings.rate.toFixed(2)}
              </span>
            </div>
            <Slider
              min={0.5}
              max={2.5}
              step={0.05}
              value={[ttsSettings.rate]}
              onValueChange={([v]) => updateSettings({ rate: v })}
            />
          </div>

          {/* Sentence delay slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Khoảng nghỉ giữa các câu</Label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {ttsSettings.sentenceDelay ?? 400}ms
              </span>
            </div>
            <Slider
              min={0}
              max={2000}
              step={50}
              value={[ttsSettings.sentenceDelay ?? 400]}
              onValueChange={([v]) => updateSettings({ sentenceDelay: v })}
            />
          </div>

          {/* Preload count slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Số đoạn tải trước</Label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {ttsSettings.maxPreload ?? 20} đoạn
              </span>
            </div>
            <Slider
              min={5}
              max={20}
              step={5}
              value={[ttsSettings.maxPreload ?? 20]}
              onValueChange={([v]) => updateSettings({ maxPreload: v })}
            />
          </div>

          {/* Pitch slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Độ cao giọng</Label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {ttsSettings.pitch.toFixed(2)}
              </span>
            </div>
            <Slider
              min={0.5}
              max={2}
              step={0.05}
              value={[ttsSettings.pitch]}
              onValueChange={([v]) => updateSettings({ pitch: v })}
            />
          </div>

          {/* Fluency adjust slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Điều chỉnh ngữ cảnh</Label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {ttsSettings.fluencyAdjust.toFixed(1)}
              </span>
            </div>
            <Slider
              min={0}
              max={2}
              step={0.1}
              value={[ttsSettings.fluencyAdjust]}
              onValueChange={([v]) => updateSettings({ fluencyAdjust: v })}
            />
          </div>

          {/* Highlight color */}
          <div className="space-y-1.5">
            <Label className="text-xs">Màu làm nổi bật</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={ttsSettings.highlightColor}
                onChange={(e) =>
                  updateSettings({ highlightColor: e.target.value })
                }
                className="size-7 cursor-pointer rounded border border-input bg-transparent p-0.5"
              />
              <span className="text-xs text-muted-foreground">
                {ttsSettings.highlightColor}
              </span>
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
