"use client";

import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { TrashIcon, RefreshCwIcon, ExternalLinkIcon, EyeIcon, BookIcon, LoaderIcon, LibraryIcon } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { useScraperQueueStore, ScraperJob } from "@/lib/stores/scraper-queue";
import { extensionFetch } from "@/lib/scraper/extension-bridge";
import { detectAdapter } from "@/lib/scraper/adapters";
import { serverAnalyzeNovel } from "@/lib/scraper/server-scraper-client";

interface JobDetailsModalProps {
  jobId: string | null;
  onClose: () => void;
}

export function JobDetailsModal({ jobId, onClose }: JobDetailsModalProps) {
  const [chapters, setChapters] = useState<any[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRescanning, setIsRescanning] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [viewingChapter, setViewingChapter] = useState<{title: string, content: string} | null>(null);
  const activeChapterRef = React.useRef<HTMLDivElement>(null);

  const job = useScraperQueueStore(s => jobId ? s.jobs[jobId] : null);
  const cancelJob = useScraperQueueStore(s => s.cancelJob);
  const addJob = useScraperQueueStore(s => s.addJob);

  useEffect(() => {
    if (jobId) {
      loadChapters();
      setShowConfirmDelete(false);
      setViewingChapter(null);
    }
  }, [jobId]);

  useEffect(() => {
    // Scroll to the active chapter (first pending or last done) when chapters update
    if (activeChapterRef.current) {
      activeChapterRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [chapters.length, job?.chaptersToScrape.length]);

  const loadChapters = async () => {
    if (!jobId) return;
    const chaps = await db.chapters.where("novelId").equals(jobId).sortBy("order");
    
    // Fetch word counts for each chapter
    const scenes = await db.scenes.where("novelId").equals(jobId).toArray();
    const wordCountMap = new Map();
    scenes.forEach(s => {
      if (s.isActive === 1) {
        wordCountMap.set(s.chapterId, s.wordCount || 0);
      }
    });

    const chapsWithWords = chaps.map(c => ({
      ...c,
      wordCount: wordCountMap.get(c.id) || 0
    }));

    setChapters(chapsWithWords);
  };

  const handleViewChapter = async (chapterId: string, title: string) => {
    const scenes = await db.scenes.where("chapterId").equals(chapterId).toArray();
    const activeScene = scenes.find(s => s.isActive === 1);
    if (activeScene) {
      setViewingChapter({ title, content: activeScene.content });
    } else {
      toast.error("Không tìm thấy nội dung chương này.");
    }
  };

  const handleDelete = () => {
    if (!jobId) return;
    cancelJob(jobId);
    toast.success("Đã xóa truyện khỏi thư viện tải.");
    onClose();
  };

  const handleRescan = async () => {
    if (!job) return;
    setIsRescanning(true);
    toast.info("Đang quét cập nhật danh sách chương...");
    try {
      let novelInfo;
      const isServer = job.adapter.name === "Server";
      
      if (isServer) {
        novelInfo = await serverAnalyzeNovel(job.url);
      } else {
        const adapter = detectAdapter(job.url);
        if (!adapter) throw new Error("Không tìm thấy adapter cho URL này");
        const res = await extensionFetch(job.url, {
          waitSelector: adapter.novelWaitSelector,
          reuseTab: adapter.name === "STV" || adapter.name === "69书吧" || adapter.name === "Fanqie Novel" 
        });
        novelInfo = await adapter.getNovelInfo(res.html, job.url, () => {});
      }

      if (novelInfo.chapters.length === 0) throw new Error("Không tìm thấy chương nào trên trang web.");

      // Lấy danh sách tên gốc của các chương đã tải từ db.scenes (version 0 là bản gốc chưa dịch)
      const existingScenes = await db.scenes.where("novelId").equals(job.id).filter(s => s.version === 0).toArray();
      // Bỏ qua các cảnh rác (orphaned scenes) không còn nằm trong db.chapters
      const validChapterIds = new Set(chapters.map(c => c.id));
      const validExistingScenes = existingScenes.filter(s => validChapterIds.has(s.chapterId));
      
      // Sắp xếp các cảnh theo thứ tự chương
      const chapterOrderMap = new Map(chapters.map(c => [c.id, c.order]));
      validExistingScenes.sort((a, b) => (chapterOrderMap.get(a.chapterId) || 0) - (chapterOrderMap.get(b.chapterId) || 0));

      // Tìm điểm neo (anchor) trong danh sách chương trên web
      let anchorIndex = -1;
      // Tìm ngược từ 20 chương tải gần nhất để đề phòng web đổi tên chương cuối
      for (let i = validExistingScenes.length - 1; i >= Math.max(0, validExistingScenes.length - 20); i--) {
        const sceneTitle = validExistingScenes[i].title.toLowerCase().trim();
        // Tìm vị trí của chương này trên web
        // Tìm ngược từ dưới lên để lấy vị trí mới nhất (tránh trùng lặp tên)
        for (let j = novelInfo.chapters.length - 1; j >= 0; j--) {
          if (novelInfo.chapters[j].title.toLowerCase().trim() === sceneTitle) {
            anchorIndex = j;
            break;
          }
        }
        if (anchorIndex !== -1) break;
      }

      // Nếu không tìm thấy điểm neo nào, lùi về dùng số lượng đếm
      if (anchorIndex === -1) {
         anchorIndex = chapters.length - 1;
      }

      // Cắt lấy toàn bộ các chương SAU điểm neo
      let rawNewChapters = novelInfo.chapters.slice(anchorIndex + 1);

      const pendingTitles = new Set(job.chaptersToScrape.map(c => c.title.toLowerCase().trim()));
      
      const newChapters = rawNewChapters.filter((ch: any) => 
        !pendingTitles.has(ch.title.toLowerCase().trim())
      ).map((ch: any, i: number) => ({
        title: ch.title as string,
        url: ch.url as string,
        order: chapters.length + job.chaptersToScrape.length + i,
      }));

      if (newChapters.length === 0) {
        toast.success("Không có chương mới nào để cập nhật.");
      } else {
        useScraperQueueStore.setState((state) => {
          const j = state.jobs[job.id];
          if (!j) return state;
          return {
            jobs: {
              ...state.jobs,
              [job.id]: {
                ...j,
                chaptersToScrape: [...j.chaptersToScrape, ...newChapters],
                progress: {
                  ...j.progress,
                  total: j.progress.total + newChapters.length
                },
                status: "pending", // resume downloading
                error: undefined,
              }
            }
          };
        });
        toast.success(`Đã thêm ${newChapters.length} chương mới vào hàng đợi tải.`);
        useScraperQueueStore.getState().processQueue(); // trigger start
        onClose();
      }
    } catch (e: any) {
      toast.error(e.message || "Lỗi khi quét cập nhật.");
    } finally {
      setIsRescanning(false);
    }
  };

  if (!job) return null;

  return (
    <Dialog open={!!jobId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex gap-4 items-start">
            {job.coverImage ? (
              <img src={job.coverImage} alt="Cover" className="w-16 h-24 object-cover rounded shadow-sm bg-muted shrink-0" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-16 h-24 rounded bg-muted/50 flex items-center justify-center shrink-0">
                <BookIcon className="w-6 h-6 text-muted-foreground/30" />
              </div>
            )}
            <div className="flex-1 min-w-0 pr-6 text-left">
              <DialogTitle className="line-clamp-2 leading-snug">{job.title}</DialogTitle>
              <DialogDescription className="mt-2 flex items-center gap-2">
                <Badge variant={job.status === 'done' ? 'secondary' : job.status === 'error' ? 'destructive' : job.status === 'paused' ? 'outline' : 'default'}>
                  {job.status === 'error' ? 'Lỗi' : job.status === 'done' ? 'Hoàn thành' : job.status === 'paused' ? 'Tạm dừng' : 'Đang tải'}
                </Badge>
                <a href={job.url} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline inline-flex items-center">
                  Link gốc <ExternalLinkIcon className="w-3 h-3 ml-1" />
                </a>
                <Link href={`/novels/${job.id}`} className="text-xs text-primary hover:underline inline-flex items-center ml-2">
                  <LibraryIcon className="w-3 h-3 mr-1" /> Tới thư viện
                </Link>
              </DialogDescription>
              
              <div className="mt-3">
                <Progress value={(job.progress.completed / (job.progress.total || 1)) * 100} className="h-2" />
                <p className="text-xs text-muted-foreground mt-1">
                  Đã tải {job.progress.completed} / {job.progress.total} chương
                </p>
              </div>
            </div>
          </div>
        </DialogHeader>

        {viewingChapter ? (
          <div className="flex-1 flex flex-col min-h-0 mt-4 border rounded-md overflow-hidden">
            <div className="bg-muted px-4 py-2 flex justify-between items-center border-b">
              <h3 className="font-semibold text-sm truncate pr-4">{viewingChapter.title}</h3>
              <Button size="sm" variant="ghost" onClick={() => setViewingChapter(null)}>Đóng nội dung</Button>
            </div>
            <ScrollArea className="flex-1 p-4 bg-background">
               <div dangerouslySetInnerHTML={{__html: viewingChapter.content}} className="text-sm prose prose-sm max-w-none dark:prose-invert" />
            </ScrollArea>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 mt-4 overflow-hidden">
            <h3 className="font-semibold text-sm mb-2 shrink-0">Danh sách chương:</h3>
            <ScrollArea className="flex-1 border rounded-md min-h-0 overflow-y-auto">
              {chapters.length === 0 && job.chaptersToScrape.length === 0 && (
                <div className="p-4 text-center text-sm text-muted-foreground">Không có chương nào.</div>
              )}
              {/* Đã tải */}
              {chapters.map((ch, idx) => (
                <div key={`done-${ch.id}`} className="grid grid-cols-[24px_1fr_auto_32px] items-center gap-2 p-2 px-3 text-sm hover:bg-muted/50 group border-b">
                  <span className="text-muted-foreground text-xs text-center">{idx + 1}.</span>
                  <span className="truncate" title={ch.title}>{ch.title}</span>
                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">{ch.wordCount} chữ</span>
                  <Button size="icon" variant="ghost" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity ml-auto" onClick={() => handleViewChapter(ch.id, ch.title)} title="Xem trước nội dung">
                    <EyeIcon className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              {/* Chờ tải */}
              {job.chaptersToScrape.map((ch, idx) => (
                <div key={`pending-${idx}`} ref={idx === 0 ? activeChapterRef : null} className={`grid grid-cols-[24px_1fr] items-center gap-2 p-2 px-3 text-sm text-muted-foreground hover:bg-muted/50 border-b ${idx === 0 ? 'bg-primary/5 font-medium text-foreground' : ''}`}>
                   <span className="text-xs text-center">{idx === 0 ? '🔄' : '⏳'}</span>
                   <span className="truncate opacity-70 italic" title={ch.title}>{ch.title} (chờ tải)</span>
                </div>
              ))}
            </ScrollArea>
          </div>
        )}

        <div className="flex justify-between items-center mt-4 pt-4 border-t shrink-0">
          {showConfirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-destructive">Chắc chắn xóa khỏi thư viện tải?</span>
              <Button variant="destructive" size="sm" onClick={handleDelete}>Xóa ngay</Button>
              <Button variant="outline" size="sm" onClick={() => setShowConfirmDelete(false)}>Hủy</Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive hover:text-white" onClick={() => setShowConfirmDelete(true)}>
              <TrashIcon className="w-4 h-4 mr-2" /> Xóa truyện này
            </Button>
          )}

          <div className="flex gap-2">
            {job.status !== "scraping" && (
               <Button variant="secondary" size="sm" onClick={handleRescan} disabled={isRescanning}>
                 {isRescanning ? <LoaderIcon className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCwIcon className="w-4 h-4 mr-2" />}
                 Quét lại / Cập nhật
               </Button>
            )}
            <Button variant="outline" size="sm" onClick={onClose}>Đóng</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
