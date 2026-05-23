import { registerProvider } from "./registry";
import type { PlaybackOptions, TTSOptions, TTSProvider, Voice } from "./types";

const PROXY_URL =
  "/api/tts/google-free?voice={voice}&rate={rate}&pitch={pitch}";

/** Maps voice index (1-6) to the Google Cloud voice code. */
const VOICE_CODES = [null, "via", "vib", "vic", "vid", "vie", "vif"] as const;

/**
 * POST with timeout. Rejects if the request takes longer than `ms`.
 */
async function fetchPostWithTimeout(
  url: string,
  body: Record<string, unknown>,
  ms = 8_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.statusText}`);
    }
    return response;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Fetch timeout");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Google Cloud TTS provider using the keyless Google Speech API v2 via a local Next.js proxy.
 *
 * Supports early ending (trimming trailing silence via `getCutTime()`).
 */
export class GoogleCloudTTS implements TTSProvider {
  readonly id = "googlecloud";
  readonly name = "GoogleCloudTTS";
  readonly friendlyName = "Google Cloud TTS";

  private voice: number | string = 0;
  private rate = 1.0;
  private pitch = 1.0;
  private isInitialized = false;

  constructor() {}

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;
  }

  async getVoices(): Promise<Voice[]> {
    return [
      {
        id: "via",
        name: "Google Nữ 1 (via)",
        fullName: "Giọng Google Nữ 1 (via)",
        serverId: "google:1",
      },
      {
        id: "vic",
        name: "Google Nữ 2 (vic)",
        fullName: "Giọng Google Nữ 2 (vic)",
        serverId: "google:3",
      },
      {
        id: "vie",
        name: "Google Nữ 3 (vie)",
        fullName: "Giọng Google Nữ 3 (vie)",
        serverId: "google:5",
      },
      {
        id: "vib",
        name: "Google Nam 1 (vib)",
        fullName: "Giọng Google Nam 1 (vib)",
        serverId: "google:2",
      },
      {
        id: "vid",
        name: "Google Nam 2 (vid)",
        fullName: "Giọng Google Nam 2 (vid)",
        serverId: "google:4",
      },
      {
        id: "vif",
        name: "Google Nam 3 (vif)",
        fullName: "Giọng Google Nam 3 (vif)",
        serverId: "google:6",
      },
    ];
  }

  private resolveVoice(voiceId: number | string): { realVoice: string; serverVoiceId: string } {
    const defaultVoice = "via";
    const defaultServerVoice = "google:1";

    const codeMapping: Record<string, { realVoice: string; serverVoiceId: string }> = {
      via: { realVoice: "via", serverVoiceId: "google:1" },
      vib: { realVoice: "vib", serverVoiceId: "google:2" },
      vic: { realVoice: "vic", serverVoiceId: "google:3" },
      vid: { realVoice: "vid", serverVoiceId: "google:4" },
      vie: { realVoice: "vie", serverVoiceId: "google:5" },
      vif: { realVoice: "vif", serverVoiceId: "google:6" },
    };

    if (typeof voiceId === "string") {
      if (codeMapping[voiceId]) {
        return codeMapping[voiceId];
      }
      if (voiceId.startsWith("google:")) {
        const numPart = voiceId.split(":")[1];
        const idx = parseInt(numPart, 10);
        if (idx >= 1 && idx <= 6) {
          const code = VOICE_CODES[idx] ?? defaultVoice;
          return { realVoice: code, serverVoiceId: voiceId };
        }
      }
    }

    const voiceIndex = typeof voiceId === "number" ? voiceId : parseInt(voiceId, 10);
    if (!isNaN(voiceIndex) && voiceIndex >= 0 && voiceIndex < 6) {
      const indexMapping = [1, 3, 5, 2, 4, 6];
      const codeIndex = indexMapping[voiceIndex] ?? 1;
      const code = VOICE_CODES[codeIndex] ?? defaultVoice;
      const serverId = `google:${codeIndex}`;
      return { realVoice: code, serverVoiceId: serverId };
    }

    return { realVoice: defaultVoice, serverVoiceId: defaultServerVoice };
  }

  getCutTime(text: string): number {
    const baseFactor = 0.015;
    const wordCount = text.split(/\s+/).length - 1;
    const cutTime = Math.min(0.4, baseFactor * wordCount);
    return Math.max(cutTime, 0) / this.rate;
  }

  async fetchAudio(text: string, options?: TTSOptions): Promise<Blob> {
    return this.fetchAudioWithProxy(text, options);
  }

  // ---------------------------------------------------------------------------
  // Proxy API using local Next.js proxy
  // ---------------------------------------------------------------------------

  private async fetchAudioWithProxy(
    text: string,
    options?: TTSOptions,
  ): Promise<Blob> {
    if (!text || text.trim().length === 0) {
      throw new Error("Text is required");
    }

    const voiceId = options?.voice ?? this.voice;
    const { serverVoiceId } = this.resolveVoice(voiceId);
    const rate = options?.rate ?? this.rate;
    const pitch = options?.pitch ?? this.pitch;

    const url = PROXY_URL.replace("{voice}", serverVoiceId)
      .replace("{rate}", String(rate))
      .replace("{pitch}", String(pitch));

    const response = await fetchPostWithTimeout(url, { text });
    return response.blob();
  }

  getPlaybackOptions(): PlaybackOptions {
    return { playbackRate: 1.0, preservesPitch: true };
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
}

registerProvider("GoogleCloudTTS", GoogleCloudTTS, "Google Cloud TTS");
