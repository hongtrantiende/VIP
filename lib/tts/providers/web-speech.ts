/**
 * WebSpeechTTS — TTS provider dùng Web Speech API tích hợp sẵn trong trình duyệt.
 *
 * Ưu điểm:
 *   - Hoàn toàn client-side, không cần server
 *   - Miễn phí, không cần API key
 *   - Hoạt động trên Cloudflare và mọi môi trường hosting
 *
 * Nhược điểm:
 *   - Chất lượng giọng phụ thuộc vào hệ điều hành/trình duyệt
 *   - Chrome/Edge có giọng "Google tiếng Việt" khá tốt
 *   - Không hỗ trợ preload audio (isDirectOnly = true)
 */

import { registerProvider } from "./registry";
import type { PlaybackOptions, TTSOptions, TTSProvider, Voice } from "./types";

export class WebSpeechTTS implements TTSProvider {
  readonly id = "web-speech";
  readonly name = "WebSpeechTTS";
  readonly friendlyName = "Trình duyệt (Web Speech API)";

  /**
   * isDirectOnly = true: player sẽ gọi speakDirect() thay vì fetchAudio().
   * Giống GeminiTTS — không đi qua blob/audio cache.
   */
  readonly isDirectOnly = true;

  private voiceName = "auto";
  private rate = 1.0;
  private pitch = 1.0;
  private isInitialized = false;

  // ─── Initialize ────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (typeof window === "undefined") return;

    // getVoices() thường trả về rỗng ngay khi load — cần đợi onvoiceschanged
    await this.waitForVoices();
    this.isInitialized = true;
  }

  private waitForVoices(timeoutMs = 3000): Promise<void> {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) { resolve(); return; }

      if (window.speechSynthesis.getVoices().length > 0) { resolve(); return; }

      const timer = setTimeout(resolve, timeoutMs);
      window.speechSynthesis.onvoiceschanged = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  // ─── Voices ────────────────────────────────────────────────────────────────

  async getVoices(): Promise<Voice[]> {
    if (typeof window === "undefined") return [];

    const all = window.speechSynthesis.getVoices();

    // Ưu tiên giọng tiếng Việt lên đầu danh sách
    const vi = all.filter((v) => v.lang.startsWith("vi"));
    const other = all.filter((v) => !v.lang.startsWith("vi"));

    const result: Voice[] = [
      {
        id: "auto",
        name: "Tự động (tiếng Việt)",
        fullName: "Tự động chọn giọng tiếng Việt",
      },
    ];

    for (const v of [...vi, ...other]) {
      result.push({
        id: v.name,
        name: `${v.name}`,
        fullName: `${v.name} [${v.lang}]`,
      });
    }

    return result;
  }

  // ─── fetchAudio — không dùng cho isDirectOnly ────────────────────────────

  /**
   * Web Speech API không sản xuất audio blob.
   * Hàm này không bao giờ được player gọi vì isDirectOnly = true
   * (player dùng speakDirect() thay thế). Giữ lại để thỏa mãn interface.
   */
  async fetchAudio(_text: string, _options?: TTSOptions): Promise<Blob> {
    return new Blob([], { type: "audio/wav" });
  }

  // ─── speakDirect — được player gọi trực tiếp ─────────────────────────────

  /**
   * Đọc text bằng SpeechSynthesisUtterance.
   * Promise resolve khi utterance.onend hoặc khi bị cancel (stop/pause).
   */
  async speakDirect(text: string, options?: TTSOptions): Promise<void> {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      throw new Error(
        "Web Speech API không được hỗ trợ trên trình duyệt hoặc môi trường này."
      );
    }

    return new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);

      // ── Chọn giọng ────────────────────────────────────────────────────────
      const voiceId = String(options?.voice ?? this.voiceName);
      const allVoices = window.speechSynthesis.getVoices();

      if (voiceId && voiceId !== "auto") {
        const found = allVoices.find((v) => v.name === voiceId);
        if (found) utterance.voice = found;
      } else {
        // Auto: ưu tiên giọng tiếng Việt (Chrome/Edge có "Google tiếng Việt")
        const vietVoice =
          allVoices.find((v) => v.lang === "vi-VN") ??
          allVoices.find((v) => v.lang.startsWith("vi"));
        if (vietVoice) utterance.voice = vietVoice;
      }

      // ── Rate & Pitch ───────────────────────────────────────────────────────
      // Web Speech rate range: 0.1 – 10; pitch: 0 – 2
      utterance.rate = Math.max(0.1, Math.min((options?.rate ?? this.rate) * 1.0, 10));
      utterance.pitch = Math.max(0, Math.min(options?.pitch ?? this.pitch, 2));

      // ── Events ────────────────────────────────────────────────────────────
      utterance.onend = () => resolve();

      utterance.onerror = (event) => {
        // "canceled" / "interrupted" xảy ra khi user bấm dừng — không phải lỗi
        if (event.error === "canceled" || event.error === "interrupted") {
          resolve();
        } else {
          reject(new Error(`Web Speech lỗi: ${event.error}`));
        }
      };

      window.speechSynthesis.speak(utterance);
    });
  }

  // ─── stop — được player gọi khi dừng/tạm dừng ───────────────────────────

  stop(): void {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  // ─── Setters ──────────────────────────────────────────────────────────────

  setVoice(voice: number | string): void {
    this.voiceName = String(voice);
  }

  setRate(rate: number): void {
    this.rate = rate;
  }

  setPitch(pitch: number): void {
    this.pitch = pitch;
  }

  getPlaybackOptions(): PlaybackOptions {
    return { playbackRate: 1.0, preservesPitch: true };
  }
}

registerProvider("WebSpeechTTS", WebSpeechTTS, "Trình duyệt (Web Speech)");
