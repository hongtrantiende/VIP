/**
 * nhDownloadStore — IndexedDB-backed storage for NovelHub download states.
 *
 * Replaces localStorage usage for `rr_download_state_*` keys.
 * LocalStorage has a hard ~5 MB per-origin quota, which is easily exceeded
 * when caching hundreds of downloaded chapters. IndexedDB has no practical
 * per-entry size limit and handles large payloads correctly.
 */

import { db } from "./db";
import type { NhDownloadState } from "./db";

/** Build the composite primary key for a download state entry. */
const makeId = (nhSource: string, storySlug: string): string =>
  `${nhSource}_${storySlug}`;

export const nhDownloadStore = {
  /**
   * Load a saved download state from IndexedDB.
   * Returns `null` when no state exists for the given novel.
   */
  async get(
    nhSource: string,
    storySlug: string
  ): Promise<NhDownloadState | null> {
    try {
      const result = await db.nhDownloadStates.get(makeId(nhSource, storySlug));
      return result ?? null;
    } catch (err) {
      console.error("[nhDownloadStore] get() failed:", err);
      return null;
    }
  },

  /**
   * Persist (upsert) a download state snapshot.
   * Overwrites any previous entry for the same novel.
   */
  async set(
    nhSource: string,
    storySlug: string,
    state: Omit<NhDownloadState, "id">
  ): Promise<void> {
    try {
      await db.nhDownloadStates.put({
        ...state,
        id: makeId(nhSource, storySlug),
        nhSource,
        storySlug,
      });
    } catch (err) {
      console.error("[nhDownloadStore] set() failed:", err);
    }
  },

  /**
   * Delete the download state for a novel (called on successful completion
   * or when the user explicitly cancels the download).
   */
  async remove(nhSource: string, storySlug: string): Promise<void> {
    try {
      await db.nhDownloadStates.delete(makeId(nhSource, storySlug));
    } catch (err) {
      console.error("[nhDownloadStore] remove() failed:", err);
    }
  },

  /**
   * Remove all stale entries older than `maxAgeMs` milliseconds.
   * Useful to clean up orphaned states from aborted sessions.
   * Default: 7 days.
   */
  async pruneOld(maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    try {
      const cutoff = Date.now() - maxAgeMs;
      // IndexedDB range query on the `timestamp` index
      await db.nhDownloadStates
        .where("timestamp")
        .below(cutoff)
        .delete();
    } catch (err) {
      console.error("[nhDownloadStore] pruneOld() failed:", err);
    }
  },
};
