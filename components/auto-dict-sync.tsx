"use client";

import { useEffect } from "react";
import { db, DICT_GENRES, DICT_TYPES, type DictSource } from "@/lib/db";
import { appendToDictSource, saveDictSource } from "@/lib/hooks/use-dict-entries";

const ALL_SOURCES: DictSource[] = [];
for (const g of DICT_GENRES) {
  for (const t of DICT_TYPES) {
    if (g === "core" && t !== "vietphrase" && t !== "phienam") continue;
    ALL_SOURCES.push(`${g}_${t}` as DictSource);
  }
}

export function AutoDictSync() {
  useEffect(() => {
    let mounted = true;

    const syncDicts = async () => {
      try {
        const lastSyncStr = localStorage.getItem("last_dict_sync");
        const now = Date.now();
        
        // Chỉ tự động sync 1 lần mỗi 12 tiếng để tránh lag server Supabase
        if (lastSyncStr) {
          const lastSync = parseInt(lastSyncStr, 10);
          if (now - lastSync < 12 * 60 * 60 * 1000) {
            return; // Đã sync gần đây
          }
        }

        // Không bắt buộc đăng nhập để nhận từ điển chung
        
        const params = new URLSearchParams({ action: 'download-all-dicts' });
        const res = await fetch(`/api/dict/cloud-storage?${params.toString()}`, { method: 'POST' });
        if (!res.ok) return;
        
        const data = await res.json();
        if (!data.success || !data.dicts) return;

        const allDicts: Record<string, string> = data.dicts;

        for (const [source, text] of Object.entries(allDicts)) {
          if (!mounted) return;
          if (source === "core_vietphrase") continue;

          const clean = text.startsWith("\uFEFF") ? text.slice(1) : text;
          if (!clean || clean.trim().length === 0) continue;

          // Fast path: nếu local rỗng, dùng saveDictSource (instant put, không cần merge)
          const localCached = await db.dictCache.get(source as DictSource);
          const localHasData = localCached?.rawText && localCached.rawText.trim().length > 0;

          if (!localHasData) {
            await saveDictSource(source as DictSource, clean);
          } else {
            // Merge path: chỉ khi local đã có data
            const entries = clean
              .split(/\r?\n/)
              .map((line) => {
                const idx = line.indexOf("=");
                if (idx < 1) return null;
                return {
                  chinese: line.slice(0, idx).trim(),
                  vietnamese: line.slice(idx + 1).trim(),
                };
              })
              .filter((e) => e !== null);

            if (entries.length > 0) {
              await appendToDictSource(source as DictSource, entries);
            }
          }
          
          // Yield to main thread giữa mỗi source
          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        // Tải thêm từ điển Cộng Đồng (những từ mới mà mọi người vừa thêm chưa gộp vào gốc)
        try {
          const commParams = new URLSearchParams({ action: 'download-community-dicts' });
          const commRes = await fetch(`/api/dict/cloud-storage?${commParams.toString()}`, { method: 'POST' });
          if (commRes.ok) {
            const commData = await commRes.json();
            if (commData.success && commData.dicts) {
              const allCommDicts: Record<string, string> = commData.dicts;
              for (const [genre, text] of Object.entries(allCommDicts)) {
                if (!mounted) return;
                const clean = text.startsWith("\uFEFF") ? text.slice(1) : text;
                if (!clean || clean.trim().length === 0) continue;
                
                const source = `${genre}_names` as DictSource; // Gộp vào names của thể loại đó
                const entries = clean
                  .split(/\r?\n/)
                  .map((line) => {
                    const idx = line.indexOf("=");
                    if (idx < 1) return null;
                    return {
                      chinese: line.slice(0, idx).trim(),
                      vietnamese: line.slice(idx + 1).trim(),
                    };
                  })
                  .filter((e) => e !== null);

                if (entries.length > 0) {
                  await appendToDictSource(source, entries);
                }
              }
            }
          }
        } catch (e) {
          console.error("Lỗi khi tải từ điển cộng đồng ngầm:", e);
        }

        // Đánh dấu đã sync
        localStorage.setItem("last_dict_sync", now.toString());
        console.log("[AutoDictSync] Đã tải xong từ điển từ server.");
      } catch (err) {
        console.error("[AutoDictSync] Lỗi khi đồng bộ từ điển ngầm:", err);
      }
    };

    // Chờ 8 giây sau khi load trang xong mới bắt đầu tải ngầm
    // (tăng từ 5s lên 8s để đảm bảo DictInitializer xong trước)
    const timeout = setTimeout(() => {
      syncDicts();
    }, 8000);

    return () => {
      mounted = false;
      clearTimeout(timeout);
    };
  }, []);

  return null; // Không hiển thị giao diện
}
