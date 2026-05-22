"use client";

import { useEffect } from "react";
import { db } from "@/lib/db";
import { countWords } from "@/lib/utils";

export function WordCountHealer() {
  useEffect(() => {
    // Chờ 3 giây sau khi tải trang để tránh gây nghẽn UI ban đầu
    const timer = setTimeout(async () => {
      try {
        const doneFlag = localStorage.getItem("word_count_recalc_cjk_v1");
        if (doneFlag === "true") {
          return;
        }

        console.log("[WordCountHealer] Đang khởi chạy tiến trình quét lại số từ tiếng Trung (one-time)...");

        // Lấy tất cả scenes từ IndexedDB
        const allScenes = await db.scenes.toArray();
        const toUpdate: { id: string; wordCount: number }[] = [];

        for (const scene of allScenes) {
          if (!scene.content) continue;
          
          const correctCount = countWords(scene.content);
          if (scene.wordCount !== correctCount) {
            toUpdate.push({ id: scene.id, wordCount: correctCount });
          }
        }

        if (toUpdate.length > 0) {
          console.log(`[WordCountHealer] Phát hiện ${toUpdate.length} phân cảnh có số từ không khớp. Đang cập nhật...`);
          
          // Thực hiện transaction cập nhật đồng loạt
          await db.transaction("rw", db.scenes, async () => {
            for (const item of toUpdate) {
              await db.scenes.update(item.id, {
                wordCount: item.wordCount,
              });
            }
          });
          
          console.log(`[WordCountHealer] Đã khôi phục thành công số từ chuẩn cho ${toUpdate.length} phân cảnh.`);
        } else {
          console.log("[WordCountHealer] Tất cả số từ đều đã chuẩn xác. Không cần cập nhật.");
        }

        // Đặt cờ đã hoàn thành vào localStorage để lần sau không quét lại nữa
        localStorage.setItem("word_count_recalc_cjk_v1", "true");
      } catch (err) {
        console.error("[WordCountHealer] Lỗi khi tự động tính toán lại số từ:", err);
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  return null;
}
