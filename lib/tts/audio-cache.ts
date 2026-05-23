import { md5 } from "./text-utils";

/**
 * Build a cache key from the text, voice id, rate and pitch.
 * Uses MD5 so the key is always a fixed-length hex string.
 */
function cacheKey(
  text: string,
  voiceId: number | string,
  rate: number,
  pitch: number,
): string {
  return md5(`${text}${voiceId}${rate}${pitch}`);
}

/**
 * In-memory audio blob cache keyed by `MD5(text + voiceId + rate + pitch)`.
 *
 * Prevents re-fetching when the user revisits a sentence and deduplicates
 * concurrent requests for the same audio via a pending-promise map.
 */
export class AudioCache {
  private cache = new Map<string, Blob>();
  private pending = new Map<string, Promise<Blob>>();

  /**
   * Return a cached blob, or `undefined` if not cached.
   */
  get(
    text: string,
    voiceId: number | string,
    rate = 1,
    pitch = 1,
  ): Blob | undefined {
    return this.cache.get(cacheKey(text, voiceId, rate, pitch));
  }

  /**
   * Return true if the audio is already cached or currently being fetched.
   */
  has(
    text: string,
    voiceId: number | string,
    rate = 1,
    pitch = 1,
  ): boolean {
    const key = cacheKey(text, voiceId, rate, pitch);
    return this.cache.has(key) || this.pending.has(key);
  }

  /**
   * Return a cached blob if available, otherwise call `fetchFn` to produce
   * one. Concurrent calls for the same key share a single in-flight promise
   * so the provider is only called once.
   */
  async getOrFetch(
    text: string,
    voiceId: number | string,
    rate: number,
    pitch: number,
    fetchFn: () => Promise<Blob>,
  ): Promise<Blob> {
    const key = cacheKey(text, voiceId, rate, pitch);

    // 1. Already cached
    const cached = this.cache.get(key);
    if (cached) return cached;

    // 2. Another caller is already fetching this exact key — piggy-back
    const inflight = this.pending.get(key);
    if (inflight) {
      const blob = await inflight;
      // After the shared promise resolves the blob lives in `this.cache`
      return blob;
    }

    // 3. Fetch, caching the promise so concurrent callers share it
    const promise = fetchFn().then(
      (blob) => {
        this.cache.set(key, blob);
        this.pending.delete(key);
        return blob;
      },
      (err) => {
        this.pending.delete(key);
        throw err;
      },
    );

    this.pending.set(key, promise);
    return promise;
  }

  /** Remove a single entry from the cache (e.g. before a retry). */
  invalidate(
    text: string,
    voiceId: number | string,
    rate = 1,
    pitch = 1,
  ): void {
    const key = cacheKey(text, voiceId, rate, pitch);
    this.cache.delete(key);
    this.pending.delete(key);
  }

  /** Drop all cached blobs and cancel tracking of pending fetches. */
  clear(): void {
    this.cache.clear();
    this.pending.clear();
  }
}
