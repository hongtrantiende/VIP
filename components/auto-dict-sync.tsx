"use client";

import { useEffect } from "react";
import { DICT_GENRES, DICT_TYPES, type DictSource } from "@/lib/db";
import { appendToDictSource } from "@/lib/hooks/use-dict-entries";

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
        const total = Object.keys(allDicts).length;
        let processedCount = 0;

        for (const [source, text] of Object.entries(allDicts)) {
          if (!mounted) return;
          if (source === "core_vietphrase") continue;

          const clean = text.startsWith("\uFEFF") ? text.slice(1) : text;
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
            await appendToDictSource(source as any, entries);
          }
          
          processedCount++;
          await new Promise((resolve) => setTimeout(resolve, 50)); // Yield to main thread
        }

        // Đánh dấu đã sync
        localStorage.setItem("last_dict_sync", now.toString());
        console.log("[AutoDictSync] Đã tải xong từ điển từ server.");
      } catch (err) {
        console.error("[AutoDictSync] Lỗi khi đồng bộ từ điển ngầm:", err);
      }
    };

    // Chờ 5 giây sau khi load trang xong mới bắt đầu tải ngầm để không làm chậm lúc khởi động
    const timeout = setTimeout(() => {
      syncDicts();
    }, 5000);

    return () => {
      mounted = false;
      clearTimeout(timeout);
    };
  }, []);

  return null; // Không hiển thị giao diện
}
