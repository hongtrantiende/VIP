import { registerProvider } from "./registry";
import type { PlaybackOptions, TTSOptions, TTSProvider, Voice } from "./types";

// Curated list of 18 high-quality Vietnamese voices hosted on tts-piper.pages.dev
const STATIC_PIPER_VOICES: Voice[] = [
  { id: "Ban Mai", name: "Ban Mai", fullName: "Ban Mai (Giọng laoto)" },
  { id: "Chiếu Thành", name: "Chiêu Thanh", fullName: "Chiêu Thanh (Giọng laoto)" },
  { id: "Duy Oryx", name: "Duy Oryx", fullName: "Duy Oryx (Giọng laoto)" },
  { id: "Lạc Phi", name: "Lạc Phi", fullName: "Lạc Phi (Giọng laoto)" },
  { id: "Mai Phương", name: "Mai Phương", fullName: "Mai Phương (Giọng laoto)" },
  { id: "Minh Khang", name: "Minh Khang", fullName: "Minh Khang (Giọng laoto)" },
  { id: "Minh Quang", name: "Minh Quang", fullName: "Minh Quang (Giọng laoto)" },
  { id: "Mạnh Dũng", name: "Mạnh Dũng", fullName: "Mạnh Dũng (Giọng laoto)" },
  { id: "Mỹ Tâm", name: "Mỹ Tâm", fullName: "Mỹ Tâm (Giọng laoto)" },
  { id: "Mỹ Tâm Real", name: "Mỹ Tâm Real", fullName: "Mỹ Tâm Real (Giọng laoto)" },
  { id: "Ngọc Huyền (mới)", name: "Ngọc Huyền (mới)", fullName: "Ngọc Huyền mới (Giọng laoto)" },
  { id: "Ngọc Ngạn", name: "Ngọc Ngạn", fullName: "Ngọc Ngạn (Giọng laoto)" },
  { id: "Phương Trang", name: "Phương Trang", fullName: "Phương Trang (Giọng laoto)" },
  { id: "Thanh Phương Viettel", name: "Thanh Phương Viettel", fullName: "Thanh Phương Viettel (Giọng laoto)" },
  { id: "Thiện Tâm", name: "Thiện Tâm", fullName: "Thiện Tâm (Giọng laoto)" },
  { id: "Trấn Thành", name: "Trấn Thành", fullName: "Trấn Thành (Giọng laoto)" },
  { id: "Tài An", name: "Tài An", fullName: "Tài An (Giọng laoto)" },
  { id: "Việt Thảo", name: "Việt Thảo", fullName: "Việt Thảo (Giọng laoto)" },
];

export class PiperTTS implements TTSProvider {
  readonly id = "piper-tts";
  readonly name = "PiperTTS";
  readonly friendlyName = "TTS Lão Tổ (Piper)";

  // Repurpose requiresApiKey to obtain the target API URL for the local server
  readonly requiresApiKey = true;

  private voice: number | string = "Ban Mai";
  private rate = 1.0;
  private pitch = 1.0;
  private apiUrl = "http://localhost:5000";
  private isInitialized = false;
  private isConfigured = false;

  private isLocalUrl(url: string): boolean {
    try {
      const u = new URL(url);
      return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname.startsWith("192.168.") || u.hostname.startsWith("10.");
    } catch {
      return url.includes("localhost") || url.includes("127.0.0.1") || url.includes("192.168.");
    }
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;
  }

  async getVoices(): Promise<Voice[]> {
    const list = [...STATIC_PIPER_VOICES];
    const isBrowser = typeof window !== "undefined";

    if (isBrowser && this.isConfigured) {
      try {
        const response = await fetch(`${this.apiUrl}/voices`, {
          method: "GET",
          headers: {
            "Accept": "application/json"
          }
        });

        if (response.ok) {
          const data = await response.json();
          if (data && typeof data === "object") {
            let serverVoices: Voice[] = [];
            
            if (Array.isArray(data)) {
              serverVoices = data.map((v: any, index: number) => {
                const name = typeof v === "string" ? v : v.name || v.id || `Voice ${index}`;
                return {
                  id: typeof v === "string" ? v : v.id || name,
                  name: name,
                  fullName: `Piper - ${name}`,
                };
              });
            } else {
              const keys = Object.keys(data);
              serverVoices = keys.map((key) => {
                const info = data[key];
                const name = info?.name || key;
                return {
                  id: key,
                  name: name,
                  fullName: `Piper - ${name}`,
                };
              });
            }

            // Add server voices that are not already in the static list
            for (const sv of serverVoices) {
              const exists = list.some(
                (v) =>
                  v.id === sv.id ||
                  v.name.toLowerCase() === sv.name.toLowerCase()
              );
              if (!exists) {
                list.push(sv);
              }
            }
            return list;
          }
        }
      } catch (e) {
        console.warn("[PiperTTS] Direct client-side voices fetch failed:", e);
        if (this.isLocalUrl(this.apiUrl)) {
          // Local server is not running, stop trying to use Next.js proxy to avoid console errors
          return list;
        }
      }
    }

    if (this.isConfigured) {
      try {
        const response = await fetch("/api/tts/piper", {
          method: "GET",
          headers: {
            "x-piper-server-url": this.apiUrl || "http://localhost:5000",
          },
        });

        if (response.ok) {
          const data = await response.json();
          if (data && typeof data === "object") {
            let serverVoices: Voice[] = [];
            
            if (Array.isArray(data)) {
              serverVoices = data.map((v: any, index: number) => {
                const name = typeof v === "string" ? v : v.name || v.id || `Voice ${index}`;
                return {
                  id: typeof v === "string" ? v : v.id || name,
                  name: name,
                  fullName: `Piper - ${name}`,
                };
              });
            } else {
              const keys = Object.keys(data);
              serverVoices = keys.map((key) => {
                const info = data[key];
                const name = info?.name || key;
                return {
                  id: key,
                  name: name,
                  fullName: `Piper - ${name}`,
                };
              });
            }

            // Add server voices that are not already in the static list
            for (const sv of serverVoices) {
              const exists = list.some(
                (v) =>
                  v.id === sv.id ||
                  v.name.toLowerCase() === sv.name.toLowerCase()
              );
              if (!exists) {
                list.push(sv);
              }
            }
          }
        }
      } catch (e) {
        console.warn("[PiperTTS] Failed to fetch dynamic voices list from local server:", e);
      }
    }

    return list;
  }

  setApiKey(apiKey: string): void {
    // Treat the API key field in settings as the server URL
    if (apiKey && apiKey.trim().length > 0) {
      this.apiUrl = apiKey.trim();
      this.isConfigured = true;
    } else {
      this.apiUrl = "http://localhost:5000";
      this.isConfigured = false;
    }
  }

  async fetchAudio(text: string, options?: TTSOptions): Promise<Blob> {
    if (!text || text.trim().length === 0) {
      throw new Error("Text is required");
    }

    const voiceId = options?.voice ?? this.voice;
    const rate = options?.rate ?? this.rate;
    const lengthScale = rate ? 1.0 / rate : 1.0;

    const isBrowser = typeof window !== "undefined";
    if (isBrowser && this.isConfigured) {
      try {
        let cleanVoice = String(voiceId).replace(/^voices\//, "").replace(/^vi\//, "").replace(/\.onnx$/, "");
        const response = await fetch(`${this.apiUrl}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text,
            voice: `voices/${cleanVoice}`,
            length_scale: lengthScale,
          }),
        });

        if (response.ok) {
          return response.blob();
        }
        console.warn("[PiperTTS] Direct client-side synthesis failed, falling back to Next.js proxy...");
      } catch (err) {
        console.warn("[PiperTTS] Direct client-side synthesis error:", err);
        if (this.isLocalUrl(this.apiUrl)) {
          throw new Error(`Không thể kết nối đến máy chủ Piper cục bộ tại ${this.apiUrl}. Hãy chắc chắn rằng bạn đã khởi động server Piper.`);
        }
      }
    }

    const response = await fetch("/api/tts/piper", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-piper-server-url": this.apiUrl || "http://localhost:5000",
      },
      body: JSON.stringify({
        text,
        voice: voiceId,
        rate,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to fetch audio from Piper server (${response.statusText})`);
    }

    return response.blob();
  }

  setVoice(voice: number | string): void {
    this.voice = voice;
  }

  setRate(rate: number): void {
    this.rate = rate;
  }

  setPitch(pitch: number): void {
    this.pitch = pitch;
  }

  getPlaybackOptions(): PlaybackOptions {
    // Pitch adjustment in neural models is handled on client player
    return { playbackRate: 1.0, preservesPitch: true };
  }
}

registerProvider("PiperTTS", PiperTTS, "TTS Lão Tổ (Piper)");
