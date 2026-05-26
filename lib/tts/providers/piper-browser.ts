/**
 * PiperBrowserTTS — Chạy Piper TTS trực tiếp trong trình duyệt qua ONNX Runtime Web.
 *
 * Dùng @huggingface/transformers (đã có trong project) với model Vietnamese TTS.
 * Model được tự động tải + cache trong browser (OPFS) lần đầu, các lần sau dùng cache.
 *
 * Ưu điểm:
 *   - Không cần server Piper cục bộ
 *   - Hoạt động hoàn toàn trên Cloudflare
 *   - Chất lượng giọng Piper gốc (VITS architecture)
 *   - Model được cache tự động trong OPFS → chỉ tải lần đầu
 *
 * Model mặc định: Xenova/mms-tts-vie (Vietnamese MMS-TTS ~50MB)
 */

import { registerProvider } from "./registry";
import type { PlaybackOptions, TTSOptions, TTSProvider, Voice } from "./types";

// ─── Danh sách model Vietnamese TTS tương thích transformers.js ────────────
const BROWSER_VOICES: Voice[] = [
  {
    id: "Xenova/mms-tts-vie",
    name: "MMS Tiếng Việt (Phổ thông)",
    fullName: "MMS TTS vie — Facebook (VITS, ~50MB)",
  },
];

// ─── WAV encoder helper ────────────────────────────────────────────────────

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const length = samples.length;
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);

  const write = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  // RIFF header
  write(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);         // chunk size
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, 1, true);          // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byteRate
  view.setUint16(32, 2, true);          // blockAlign
  view.setUint16(34, 16, true);         // bitsPerSample
  write(36, "data");
  view.setUint32(40, length * 2, true);

  // PCM float32 → int16
  let offset = 44;
  for (let i = 0; i < length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return buffer;
}

// ─── Provider ─────────────────────────────────────────────────────────────

export class PiperBrowserTTS implements TTSProvider {
  readonly id = "piper-browser";
  readonly name = "PiperBrowserTTS";
  readonly friendlyName = "Piper (Trình duyệt / ONNX)";

  /**
   * isDirectOnly = false → dùng fetchAudio() + audio cache pipeline.
   * Synthesis trả về WAV blob, được cache trong AudioCache.
   */
  readonly isDirectOnly = false;

  private modelId = "Xenova/mms-tts-vie";
  private rate = 1.0;
  private pitch = 1.0;
  private isInitialized = false;

  // Singleton pipeline — tải model 1 lần, dùng lại mãi
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipeline: any = null;
  private pipelineLoading: Promise<void> | null = null;

  // ─── Initialize ────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;
    // Pipeline sẽ được lazy-load khi fetchAudio() lần đầu được gọi
  }

  // ─── Voices ────────────────────────────────────────────────────────────

  async getVoices(): Promise<Voice[]> {
    return BROWSER_VOICES;
  }

  // ─── fetchAudio ────────────────────────────────────────────────────────

  /**
   * Tổng hợp giọng nói từ text bằng ONNX model chạy trong trình duyệt.
   * Kết quả được AudioCache của player lưu lại để không cần tổng hợp lại.
   */
  async fetchAudio(text: string, options?: TTSOptions): Promise<Blob> {
    if (!text || text.trim().length === 0) {
      throw new Error("Text is required");
    }

    if (typeof window === "undefined") {
      throw new Error("PiperBrowserTTS chỉ chạy được trong môi trường trình duyệt.");
    }

    // Lazy-load pipeline (tải model lần đầu)
    await this.ensurePipeline();

    if (!this.pipeline) {
      throw new Error("Không thể khởi tạo pipeline TTS. Vui lòng thử lại.");
    }

    try {
      // Gọi inference với @huggingface/transformers
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const output: any = await this.pipeline(text, {
        // Một số model VITS hỗ trợ speaker_id
        speaker_id: 0,
      });

      if (!output || !output.audio) {
        throw new Error("Model không trả về audio data.");
      }

      // output.audio là Float32Array, output.sampling_rate là sample rate
      const pcm: Float32Array = output.audio instanceof Float32Array
        ? output.audio
        : new Float32Array(output.audio);
      const sampleRate: number = output.sampling_rate ?? 16000;

      // Encode thành WAV blob
      const wavBuffer = encodeWav(pcm, sampleRate);
      return new Blob([wavBuffer], { type: "audio/wav" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Piper Browser TTS lỗi: ${msg}`);
    }
  }

  // ─── Pipeline lazy-load ────────────────────────────────────────────────

  private async ensurePipeline(): Promise<void> {
    if (this.pipeline) return;

    // Tránh load song song nhiều lần
    if (this.pipelineLoading) {
      await this.pipelineLoading;
      return;
    }

    this.pipelineLoading = (async () => {
      try {
        // Dynamic import để tránh load thư viện lớn khi không cần
        const { pipeline, env } = await import("@huggingface/transformers");

        // Cho phép tải model từ HuggingFace Hub + cache trong OPFS
        env.allowRemoteModels = true;
        env.useBrowserCache = true;

        console.log(`[PiperBrowserTTS] Đang tải model ${this.modelId}...`);

        this.pipeline = await pipeline("text-to-speech", this.modelId, {
          // Chạy trên WASM (CPU) để tương thích mọi trình duyệt
          // Nếu muốn nhanh hơn trên Chrome/Edge có thể dùng 'webgpu'
          device: "wasm",
        });

        console.log("[PiperBrowserTTS] Model đã sẵn sàng.");
      } catch (err) {
        this.pipelineLoading = null;
        console.error("[PiperBrowserTTS] Không thể tải model:", err);
        throw err;
      }
    })();

    await this.pipelineLoading;
  }

  // ─── Setters ──────────────────────────────────────────────────────────

  setVoice(voice: number | string): void {
    const newModel = String(voice);
    if (newModel !== this.modelId) {
      this.modelId = newModel;
      // Reset pipeline khi đổi model
      this.pipeline = null;
      this.pipelineLoading = null;
    }
  }

  setRate(rate: number): void {
    this.rate = rate;
  }

  setPitch(pitch: number): void {
    this.pitch = pitch;
  }

  getPlaybackOptions(): PlaybackOptions {
    // Dùng playbackRate để điều chỉnh tốc độ thay vì tổng hợp lại
    return { playbackRate: this.rate, preservesPitch: false };
  }
}

registerProvider("PiperBrowserTTS", PiperBrowserTTS, "Piper (Trình duyệt ONNX)");
