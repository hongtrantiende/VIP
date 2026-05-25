import { AudioCache } from "./audio-cache";
import { FluentnessAdjuster } from "./fluency-adjuster";
import { getProvider } from "./providers/registry";
import type { Sentence, TTSProvider } from "./providers/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlayerCallbacks {
  /** Fired when a sentence begins being fetched/prepared. */
  onSentenceStart?: (index: number) => void;
  /** Fired when audio actually starts playing (after fetch completes). */
  onAudioPlay?: () => void;
  /** Fired when play state changes (playing, paused, stopped). */
  onPlayStateChange?: (state: PlayState) => void;
  /** Fired when playback is stopped (by user or internally). */
  onStop?: () => void;
  /** Fired after the last sentence finishes. */
  onFinish?: () => void;
  /** Fired on any playback / fetch error. */
  onError?: (error: unknown) => void;
}

export type PlayState = "idle" | "playing" | "paused" | "stopped";

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

/**
 * Sentence-by-sentence TTS playback engine.
 *
 * Uses a plain `<audio>` element with blob URLs (no AudioContext complexity).
 * Integrates {@link AudioCache} for deduplication / preloading and
 * {@link FluentnessAdjuster} for contextual rate/pitch modulation.
 *
 * This is a plain TypeScript class — framework-agnostic. The UI layer
 * communicates via the {@link PlayerCallbacks} interface.
 */
export class Player {
  // -- Dependencies --------------------------------------------------------
  private provider: TTSProvider | null = null;
  private cache = new AudioCache();
  private adjuster = new FluentnessAdjuster();

  // -- Playback state ------------------------------------------------------
  private audioElement: HTMLAudioElement | null = null;
  private currentBlobUrl: string | null = null;
  private sentences: Sentence[] = [];
  private _currentIndex = 0;
  private _state: PlayState = "idle";
  private earlyEndingTimer: ReturnType<typeof setTimeout> | null = null;

  // -- Config --------------------------------------------------------------
  private voiceId: number | string = 0;
  private rate = 1.0;
  private pitch = 1.0;
  private sentenceDelay = 400;
  private maxPreload = 2;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_BASE_DELAY_MS = 600;

  // -- Concurrency guard ---------------------------------------------------
  // Incremented on every cancel/jump so in-flight async ops can self-abort.
  private playbackGeneration = 0;

  // -- Retry state ---------------------------------------------------------
  private sentenceRetryCount = 0;

  // -- Callbacks -----------------------------------------------------------
  private callbacks: PlayerCallbacks = {};

  // ========================================================================
  // Public API
  // ========================================================================

  /** Current play state. */
  get state(): PlayState {
    return this._state;
  }

  /** Index of the sentence currently playing (or about to play). */
  get currentIndex(): number {
    return this._currentIndex;
  }

  /** Total number of sentences loaded. */
  get sentenceCount(): number {
    return this.sentences.length;
  }

  /** Register event callbacks. */
  setCallbacks(cb: PlayerCallbacks): void {
    this.callbacks = cb;
  }

  // -- Provider / voice / rate / pitch -------------------------------------

  /** Switch the active TTS provider by registered name. Clears the cache. */
  setProvider(name: string): void {
    this.provider = getProvider(name);
    this.cache.clear();
  }

  /** Set the provider instance directly (useful if already instantiated). */
  setProviderInstance(provider: TTSProvider): void {
    this.provider = provider;
    this.cache.clear();
  }

  setVoice(voice: number | string): void {
    this.voiceId = voice;
    this.provider?.setVoice(voice);
    this.cache.clear();
  }

  setRate(rate: number): void {
    this.rate = Math.max(0.5, Math.min(rate, 5));
    this.provider?.setRate(this.rate);
    this.cache.clear();
  }

  setPitch(pitch: number): void {
    this.pitch = Math.max(0.5, Math.min(pitch, 2));
    this.provider?.setPitch(this.pitch);
    this.cache.clear();
  }

  /** Set the fluency adjuster effectiveness (0-2). */
  setFluencyEffectiveness(value: number): void {
    this.adjuster.effectiveness = Math.max(0, Math.min(value, 2));
  }

  /** Set the delay between sentences in milliseconds. */
  setSentenceDelay(delayMs: number): void {
    this.sentenceDelay = Math.max(0, Math.min(delayMs, 5000));
  }

  /** Set the maximum number of sentences to preload. */
  setMaxPreload(count: number): void {
    this.maxPreload = Math.max(0, count);
  }

  private isSentenceCachedOrFetching(sentence: Sentence): boolean {
    const adjusted = this.adjuster.getAdjustmentFor(sentence.originalText, {
      voice: this.voiceId,
      rate: this.rate,
      pitch: this.pitch,
    });
    const effectiveRate = adjusted.rate ?? this.rate;
    const effectivePitch = adjusted.pitch ?? this.pitch;
    
    return this.cache.has(sentence.text, this.voiceId, effectiveRate, effectivePitch);
  }

  async preloadSentences(sentences: Sentence[]): Promise<void> {
    if (!this.provider || this.maxPreload <= 0) return;
    
    const limit = Math.min(sentences.length, this.maxPreload);
    const gen = this.playbackGeneration;

    for (let i = 0; i < limit; i++) {
      const sentence = sentences[i];
      if (!sentence) continue;
      
      // If already cached or fetching, trigger/reuse instantly without staggering delay
      if (this.isSentenceCachedOrFetching(sentence)) {
        this.fetchAudioForSentence(sentence).catch(() => {});
        continue;
      }
      
      // Stagger fetches to avoid overwhelming the proxy backend
      await this.delay(80);
      if (gen !== this.playbackGeneration) return;

      this.fetchAudioForSentence(sentence).catch(() => {
        // Swallowed
      });
    }
  }

  // -- Transport controls --------------------------------------------------

  /**
   * Begin sentence-by-sentence playback.
   *
   * @param sentences - The full sentence list.
   * @param startIndex - Index to start from (default 0).
   */
  start(sentences: Sentence[], startIndex = 0): void {
    if (!this.provider) {
      throw new Error("No TTS provider set. Call setProvider() first.");
    }

    this.sentences = sentences;
    this._currentIndex = startIndex;
    this.sentenceRetryCount = 0;
    this.setState("playing");
    this.preBufferAndPlay();
  }

  /**
   * Pre-buffer the first few sentences before starting playback.
   * This ensures there's no loading pause on the first sentence and
   * subsequent sentences are already cached for seamless listening.
   */
  private async preBufferAndPlay(): Promise<void> {
    const gen = this.playbackGeneration;

    // Direct-only providers (e.g. WebSpeech) don't need pre-buffering
    if (!this.provider?.isDirectOnly && this.maxPreload > 0) {
      const bufferCount = Math.min(3, this.maxPreload, this.sentences.length - this._currentIndex);
      const fetches: Promise<Blob>[] = [];

      for (let i = 0; i < bufferCount; i++) {
        const sentence = this.sentences[this._currentIndex + i];
        if (sentence) {
          fetches.push(this.fetchAudioForSentence(sentence));
        }
      }

      // Wait for at least the first sentence to be ready (with 8s timeout)
      if (fetches.length > 0) {
        await Promise.race([
          fetches[0].catch(() => {}),
          this.delay(8000),
        ]);
      }

      // Abort if user cancelled/jumped during pre-buffer
      if (gen !== this.playbackGeneration || this._state !== "playing") return;
    }

    this.playCurrentSentence();
  }

  /** Stop playback and reset to the current index. */
  stop(): void {
    this.cancelCurrentPlayback();
    if (this.provider?.isDirectOnly && "stop" in this.provider) {
      (this.provider as unknown as { stop(): void }).stop();
    }
    this.setState("stopped");
    this.callbacks.onStop?.();
  }

  /** Pause the currently playing audio. */
  pause(): void {
    if (this._state !== "playing") return;
    this.audioElement?.pause();
    if (this.provider?.isDirectOnly && "stop" in this.provider) {
      (this.provider as unknown as { stop(): void }).stop();
    }
    this.clearEarlyEndingTimer();
    this.setState("paused");
  }

  /** Resume from a paused state. */
  resume(): void {
    if (this._state !== "paused") return;
    if (this.audioElement && this.audioElement.src) {
      this.setState("playing");
      this.audioElement.play().catch((err) => this.handleError(err));
    } else {
      // No audio element to resume — restart from current index
      this.setState("playing");
      this.playCurrentSentence();
    }
  }

  /** Jump to a specific sentence index. Restarts playback if playing. */
  jumpTo(index: number): void {
    if (index < 0 || index >= this.sentences.length) return;

    const wasPlaying = this._state === "playing";
    this.cancelCurrentPlayback();
    this._currentIndex = index;
    this.sentenceRetryCount = 0;

    if (wasPlaying) {
      this.setState("playing");
      this.playCurrentSentence();
    } else {
      this.callbacks.onSentenceStart?.(index);
    }
  }

  /** Clean up all resources. Call when unmounting. */
  destroy(): void {
    this.cancelCurrentPlayback();
    this.cache.clear();
    this.sentences = [];
    this.provider = null;
    this._state = "idle";
  }

  // ========================================================================
  // Internal playback loop
  // ========================================================================

  private async playCurrentSentence(): Promise<void> {
    if (this._state !== "playing") return;

    // Snapshot generation — if it changes while we're awaiting, this
    // invocation is stale and must abort to prevent concurrent playback.
    const gen = this.playbackGeneration;
    const stale = () => gen !== this.playbackGeneration;

    const sentence = this.sentences[this._currentIndex];
    if (!sentence) {
      // Past the end — finished
      this.setState("stopped");
      this.callbacks.onFinish?.();
      return;
    }

    this.callbacks.onSentenceStart?.(this._currentIndex);

    // Direct-only providers (e.g. BrowserTTS) handle playback internally
    if (this.provider!.isDirectOnly && "speakDirect" in this.provider!) {
      try {
        this.callbacks.onAudioPlay?.();
        const adjusted = this.adjuster.getAdjustmentFor(sentence.originalText, {
          voice: this.voiceId,
          rate: this.rate,
          pitch: this.pitch,
        });
        await (
          this.provider as unknown as {
            speakDirect(text: string, options?: unknown): Promise<void>;
          }
        ).speakDirect(sentence.originalText, adjusted);
        if (stale() || this._state !== "playing") return;
        this.advanceToNext();
      } catch (err) {
        if (!stale()) this.handleError(err);
      }
      return;
    }

    // Fetch-and-play path with retry + exponential backoff
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      if (stale() || this._state !== "playing") return;

      if (attempt > 0) {
        const adjusted = this.adjuster.getAdjustmentFor(sentence.originalText, {
          voice: this.voiceId,
          rate: this.rate,
          pitch: this.pitch,
        });
        this.cache.invalidate(
          sentence.text,
          this.voiceId,
          adjusted.rate ?? this.rate,
          adjusted.pitch ?? this.pitch,
        );
        await this.delay(this.RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1));
        if (stale() || this._state !== "playing") return;
        console.warn(
          `[TTS Player] Retrying sentence ${this._currentIndex} (attempt ${attempt}/${this.MAX_RETRIES})`,
        );
      }

      try {
        this.preloadAhead();
        const blob = await this.fetchAudioForSentence(sentence);
        if (stale() || this._state !== "playing") return;
        await this.playBlob(blob, sentence);
        if (stale()) return;
        this.sentenceRetryCount = 0;
        return;
      } catch (err) {
        if (stale()) return;
        if (attempt < this.MAX_RETRIES) continue;

        // All retries exhausted — skip sentence instead of halting playback
        console.error(
          `[TTS Player] Sentence ${this._currentIndex} failed after ${this.MAX_RETRIES} retries, skipping.`,
          err,
        );
        this.sentenceRetryCount = 0;
        if (this._state === "playing") {
          this.advanceToNext();
        }
      }
    }
  }

  /**
   * Fetch (or retrieve from cache) audio for a single sentence,
   * applying fluency adjustments.
   */
  private fetchAudioForSentence(sentence: Sentence): Promise<Blob> {
    const provider = this.provider!;
    const adjusted = this.adjuster.getAdjustmentFor(sentence.originalText, {
      voice: this.voiceId,
      rate: this.rate,
      pitch: this.pitch,
    });

    const effectiveRate = adjusted.rate ?? this.rate;
    const effectivePitch = adjusted.pitch ?? this.pitch;

    return this.cache.getOrFetch(
      sentence.text,
      this.voiceId,
      effectiveRate,
      effectivePitch,
      () => provider.fetchAudio(sentence.originalText, adjusted),
    );
  }

  /**
   * Play an audio blob through the `<audio>` element and wait for it to
   * finish (or be cut short by `getCutTime`).
   */
  private playBlob(blob: Blob, sentence: Sentence): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.revokeBlobUrl();

      const url = URL.createObjectURL(blob);
      this.currentBlobUrl = url;

      const audio = new Audio(url);
      this.audioElement = audio;

      // Apply provider-specific playback options
      const playbackOpts = this.provider?.getPlaybackOptions?.();
      if (playbackOpts) {
        if (playbackOpts.playbackRate != null) {
          audio.playbackRate = playbackOpts.playbackRate;
        }
        if (playbackOpts.preservesPitch != null) {
          audio.preservesPitch = playbackOpts.preservesPitch;
        }
      }

      const onEnded = () => {
        cleanup();
        this.advanceToNext();
        resolve();
      };

      const onError = (e: Event) => {
        cleanup();
        reject(
          new Error(
            `Audio playback error: ${(e as ErrorEvent).message ?? "unknown"}`,
          ),
        );
      };

      const cleanup = () => {
        this.clearEarlyEndingTimer();
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onError);
      };

      audio.addEventListener("ended", onEnded);
      audio.addEventListener("error", onError);

      audio
        .play()
        .then(() => {
          this.callbacks.onAudioPlay?.();
          // Set up early ending if the provider supports getCutTime
          if (this.provider?.getCutTime) {
            const cutTime = this.provider.getCutTime(sentence.text);
            const duration = audio.duration;
            if (cutTime > 0.05 && duration > cutTime) {
              const playable = (duration - cutTime) * 1000;
              this.earlyEndingTimer = setTimeout(() => {
                cleanup();
                audio.pause();
                this.advanceToNext();
                resolve();
              }, playable);
            }
          }
        })
        .catch((err) => {
          cleanup();
          reject(err);
        });
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Move index forward and play the next sentence. */
  private advanceToNext(): void {
    this.revokeBlobUrl();
    this._currentIndex++;
    // Capture generation NOW so that if cancelCurrentPlayback() fires between
    // here and the setTimeout callback, the stale check will abort this chain.
    const gen = this.playbackGeneration;
    // Delay before playing next sentence
    setTimeout(() => {
      if (gen !== this.playbackGeneration) return;
      this.playCurrentSentence();
    }, this.sentenceDelay);
  }

  // ========================================================================
  // Preloading
  // ========================================================================

  private async preloadAhead(): Promise<void> {
    if (!this.provider || this.maxPreload <= 0) return;

    // Use only playbackGeneration (incremented on cancel/jump) — we no longer
    // cancel preload loops when a new sentence starts, allowing the preload
    // to accumulate a proper buffer ahead of playback.
    const gen = this.playbackGeneration;

    const start = this._currentIndex + 1;
    const end = Math.min(start + this.maxPreload, this.sentences.length);

    for (let i = start; i < end; i++) {
      const sentence = this.sentences[i];
      if (!sentence) continue;

      // Skip already cached or in-flight fetches — no stagger delay needed
      if (this.isSentenceCachedOrFetching(sentence)) {
        continue;
      }

      // Stagger fetches to avoid rate limits and connection congestion
      await this.delay(80);
      if (this._state !== "playing" || gen !== this.playbackGeneration) return;

      this.fetchAudioForSentence(sentence).catch(() => {
        // Preload failure is non-fatal
      });
    }
  }

  // ========================================================================
  // Helpers
  // ========================================================================

  private setState(state: PlayState): void {
    this._state = state;
    this.callbacks.onPlayStateChange?.(state);
  }

  private handleError(err: unknown): void {
    // Don't report errors after user-initiated stop
    if (this._state === "stopped") return;
    console.error("[TTS Player]", err);
    this.cancelCurrentPlayback();
    this.setState("stopped");
    this.callbacks.onError?.(err);
  }

  private cancelCurrentPlayback(): void {
    this.playbackGeneration++;
    this.clearEarlyEndingTimer();
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.removeAttribute("src");
      this.audioElement = null;
    }
    this.revokeBlobUrl();
  }

  private revokeBlobUrl(): void {
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
      this.currentBlobUrl = null;
    }
  }

  private clearEarlyEndingTimer(): void {
    if (this.earlyEndingTimer != null) {
      clearTimeout(this.earlyEndingTimer);
      this.earlyEndingTimer = null;
    }
  }
}
