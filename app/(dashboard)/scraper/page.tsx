"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { detectAdapter } from "@/lib/scraper/adapters";
import { extensionFetch, checkExtensionStatus, getExtensionId, setExtensionId } from "@/lib/scraper/extension-bridge";
import { serverAnalyzeNovel } from "@/lib/scraper/server-scraper-client";
import { useScraperQueueStore } from "@/lib/stores/scraper-queue";
import { SettingsIcon, BookIcon, PauseIcon, PlayIcon, TrashIcon, DownloadIcon, CheckCircleIcon, GlobeIcon, ZapIcon, LoaderIcon } from "lucide-react";

/** URLs that can be fetched server-side (no extension needed) */
const SERVER_FETCH_DOMAINS = [
  "chomered.com",
  "welove-gourmet.com",
  "metruyenchu.com.vn"
];

function isServerFetchable(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return SERVER_FETCH_DOMAINS.some(d => hostname === d || hostname.endsWith("." + d));
  } catch {
    return false;
  }
}

export default function ScraperLibraryPage() {
  const [url, setUrl] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const jobs = useScraperQueueStore((s) => s.jobs);
  const pauseJob = useScraperQueueStore((s) => s.pauseJob);
  const resumeJob = useScraperQueueStore((s) => s.resumeJob);
  const cancelJob = useScraperQueueStore((s) => s.cancelJob);
  const clearDone = useScraperQueueStore((s) => s.clearDone);

  const [extId, setExtId] = useState("");
  const [extVersion, setExtVersion] = useState<string | null>(null);

  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isShowingChapters, setIsShowingChapters] = useState(false);
  const [scrapedNovelInfo, setScrapedNovelInfo] = useState<any>(null);
  const [scannedCount, setScannedCount] = useState(0);
  const [chapterDelay, setChapterDelay] = useState(7);
  const [currentAdapter, setCurrentAdapter] = useState<any>(null);

  useEffect(() => {
    setExtId(getExtensionId());
    checkExtensionStatus().then((res) => {
      if (res.available) setExtVersion(res.version);
    });
  }, []);

  const handleSaveExtId = () => {
    setExtensionId(extId.trim());
    checkExtensionStatus().then((res) => {
      if (res.available) {
         setExtVersion(res.version);
         toast.success("Đã kết nối Extension!");
      } else {
         setExtVersion(null);
         toast.error("Không thể kết nối Extension!");
      }
    });
  };

  const handleAdd = async () => {
    if (!url.trim()) return;
    setIsAdding(true);
    try {
      // ── Server-side fetch for supported sites (no extension needed) ──
      if (isServerFetchable(url)) {
        toast.info("⚡ Đang tải bằng Server (không cần Extension)...");
        const novelInfo = await serverAnalyzeNovel(url);
        if (novelInfo.chapters.length === 0) throw new Error("Không tìm thấy chương nào");

        // Convert to adapter-compatible format
        const adapterInfo = {
          title: novelInfo.title,
          author: novelInfo.author,
          description: novelInfo.description,
          coverImage: novelInfo.coverImage,
          chapters: novelInfo.chapters.map((ch, i) => ({
            title: ch.title,
            url: ch.url,
            order: i,
          })),
        };

        setScrapedNovelInfo(adapterInfo);
        // Create a minimal "server" adapter for the queue
        setCurrentAdapter({ name: "Server", urlPattern: /.*/ });
        setChapterDelay(2); // Server fetch is faster, less delay needed
        setIsShowingChapters(false);
        setIsConfirmOpen(true);
        toast.success(`⚡ Server: Tìm thấy ${novelInfo.chapters.length} chương!`);
        return;
      }

      // ── Extension-based fetch (existing behavior) ──
      const adapter = detectAdapter(url);
      if (!adapter) throw new Error("Không tìm thấy adapter cho URL này");

      const { html, timedOut } = await extensionFetch(url);
      if (timedOut) throw new Error("Timeout khi lấy thông tin truyện");

      setScannedCount(0);
      const novelInfo = await adapter.getNovelInfo(html, url, (count) => {
        setScannedCount(count);
      });
      if (novelInfo.chapters.length === 0) throw new Error("Không tìm thấy chương nào");

      setScrapedNovelInfo(novelInfo);
      setCurrentAdapter(adapter);
      setChapterDelay(7);
      setIsShowingChapters(false);
      setIsConfirmOpen(true);
    } catch (error: any) {
      toast.error(error.message || "Có lỗi xảy ra");
    } finally {
      setIsAdding(false);
    }
  };

  const confirmAdd = async () => {
    if (!scrapedNovelInfo || !currentAdapter) return;
    setIsConfirmOpen(false);
    try {
      let novelId;
      const existingNovel = await db.novels.where("sourceUrl").equals(url).first();
      if (existingNovel) {
        novelId = existingNovel.id;
      } else {
        novelId = crypto.randomUUID();
        const now = new Date();
        await db.novels.add({
          id: novelId,
          title: scrapedNovelInfo.title,
          description: scrapedNovelInfo.description || "",
          coverImage: scrapedNovelInfo.coverImage,
          sourceUrl: url,
          createdAt: now,
          updatedAt: now,
        });
      }

      useScraperQueueStore.getState().addJob(
        novelId, 
        scrapedNovelInfo.title, 
        url, 
        scrapedNovelInfo.chapters, 
        chapterDelay * 1000, 
        scrapedNovelInfo.coverImage,
        currentAdapter?.name
      );
      setUrl("");
      toast.success("Đã thêm truyện vào thư viện tải!");
    } catch (err: any) {
      toast.error(err.message || "Có lỗi khi thêm truyện");
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Thư viện tải truyện</h1>
          <p className="text-sm text-muted-foreground mt-1">Dán URL để thêm truyện mới vào danh sách tải tự động.</p>
        </div>
        
        <div className="flex w-full md:w-auto items-center gap-2">
          <Input 
            className="w-full md:w-[300px]" 
            placeholder="https://truyen..." 
            value={url} 
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAdd()}
          />
          <Button onClick={handleAdd} disabled={isAdding || !url.trim()} className="min-w-[140px]">
            {isAdding ? <LoaderIcon className="w-4 h-4 animate-spin mr-2" /> : (isServerFetchable(url) ? <ZapIcon className="w-4 h-4 mr-2" /> : <DownloadIcon className="w-4 h-4 mr-2" />)}
            {isAdding ? (scannedCount > 0 ? `Đã quét: ${scannedCount}` : "⚡ Đang tải...") : (isServerFetchable(url) ? "⚡ Tải nhanh" : "Thêm")}
          </Button>
          
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline"><SettingsIcon className="w-4 h-4 mr-2" /> Hỗ trợ & Cài đặt</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Cài đặt & Hỗ trợ Scraper</DialogTitle>
              </DialogHeader>
              <Tabs defaultValue="settings" className="w-full mt-2">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="settings">Tiện ích kết nối</TabsTrigger>
                  <TabsTrigger value="guides">Web hỗ trợ & Hướng dẫn</TabsTrigger>
                </TabsList>
                
                <TabsContent value="settings" className="space-y-4 py-4">
                  <div className="space-y-4">
                    <Label>Cấu hình kết nối Extension</Label>
                    
                    {extVersion ? (
                       <div className="flex flex-col gap-3">
                         <div className="flex items-center justify-between bg-green-50 dark:bg-green-950/20 p-3 rounded-lg border border-green-200 dark:border-green-800">
                           <p className="text-sm text-green-600 dark:text-green-400 font-medium">✅ Đã kết nối thành công (v{extVersion})</p>
                           <Button variant="outline" size="sm" className="h-8" onClick={() => { setExtId(""); setExtVersion(null); setExtensionId(""); }}>Đổi ID khác</Button>
                         </div>
                       </div>
                    ) : (
                       <div className="flex flex-col gap-2">
                         <div className="flex gap-2">
                           <Input value={extId} onChange={e => setExtId(e.target.value)} placeholder="Nhập Extension ID..." />
                           <Button onClick={handleSaveExtId}>Lưu</Button>
                         </div>
                         <div className="flex flex-col gap-2 mt-2 bg-muted/30 p-4 rounded-lg border">
                            <p className="text-sm font-semibold text-red-500">Trạng thái: Chưa kết nối Extension</p>
                            <ol className="list-inside list-decimal text-xs text-muted-foreground space-y-1.5 mt-1">
                              <li>Tải và giải nén extension bản PC bên dưới.</li>
                              <li>Mở <code className="bg-muted px-1 rounded">chrome://extensions</code>, bật <b>Developer mode</b>.</li>
                              <li>Chọn <b>Load unpacked</b> &rarr; Trỏ tới thư mục vừa giải nén.</li>
                              <li>Copy ID của extension dán vào ô bên trên và nhấn Lưu.</li>
                            </ol>
                         </div>
                       </div>
                    )}

                    <div className="border-t pt-4 mt-2">
                      <Button variant="secondary" className="w-full sm:w-auto" asChild>
                        <a href="/novel-studio-connector-pc.zip?v=6.0" download>
                          <DownloadIcon className="mr-2 w-4 h-4" />
                          Tải Extension v6.0 (.zip)
                        </a>
                      </Button>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="guides" className="space-y-4 py-4 max-h-[60vh] overflow-y-auto pr-2">
                  <div className="space-y-3">
                    <Label className="text-xs font-bold text-muted-foreground uppercase">⚡ Tải nhanh (Không cần Extension)</Label>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" className="border-blue-200 bg-blue-50 dark:bg-blue-950/20" asChild>
                        <a href="https://chomered.com" target="_blank" rel="noreferrer"><ZapIcon className="mr-1.5 w-3 h-3 text-blue-500"/> Chomered</a>
                      </Button>
                      <Button variant="outline" size="sm" className="border-blue-200 bg-blue-50 dark:bg-blue-950/20" asChild>
                        <a href="https://welove-gourmet.com" target="_blank" rel="noreferrer"><ZapIcon className="mr-1.5 w-3 h-3 text-blue-500"/> Welove-gourmet</a>
                      </Button>
                      <Button variant="outline" size="sm" className="border-blue-200 bg-blue-50 dark:bg-blue-950/20" asChild>
                        <a href="https://metruyenchu.com.vn" target="_blank" rel="noreferrer"><ZapIcon className="mr-1.5 w-3 h-3 text-blue-500"/> MeTruyenChu.vn</a>
                      </Button>
                      <Button variant="outline" size="sm" className="border-blue-200 bg-blue-50 dark:bg-blue-950/20" asChild>
                        <a href="https://www.piaotia.com/" target="_blank" rel="noreferrer"><ZapIcon className="mr-1.5 w-3 h-3 text-green-600"/> PiaoTian</a>
                      </Button>
                      <Button variant="outline" size="sm" className="border-blue-200 bg-blue-50 dark:bg-blue-950/20" asChild>
                        <a href="https://www.jjwxc.net/" target="_blank" rel="noreferrer"><ZapIcon className="mr-1.5 w-3 h-3 text-purple-600"/> Jjwxc</a>
                      </Button>
                      <Button variant="outline" size="sm" className="border-blue-200 bg-blue-50 dark:bg-blue-950/20" asChild>
                        <a href="https://www.guihualianpian.cn/" target="_blank" rel="noreferrer"><ZapIcon className="mr-1.5 w-3 h-3 text-orange-600"/> Guihua</a>
                      </Button>
                      <Button variant="outline" size="sm" className="border-blue-200 bg-blue-50 dark:bg-blue-950/20" asChild>
                        <a href="https://www.timotxt.com/" target="_blank" rel="noreferrer"><ZapIcon className="mr-1.5 w-3 h-3 text-indigo-600"/> Timotxt</a>
                      </Button>
                    </div>
                    <Label className="text-xs font-bold text-muted-foreground uppercase mt-4">Web Việt (Cần Extension)</Label>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <a href="https://sangtacviet.com" target="_blank" rel="noreferrer"><GlobeIcon className="mr-1.5 w-3 h-3 text-blue-500"/> SangTacViet</a>
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <a href="https://xtruyen.vn" target="_blank" rel="noreferrer"><GlobeIcon className="mr-1.5 w-3 h-3 text-orange-500"/> XTruyen</a>
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3 mt-4">
                    <Label className="text-xs font-bold text-muted-foreground uppercase">Truy cập nhanh (Web Trung)</Label>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" asChild><a href="https://uukanshu.cc/quanben/" target="_blank" rel="noreferrer"><GlobeIcon className="mr-1.5 w-3 h-3 text-red-500"/> Uukanshu</a></Button>
                      <Button variant="outline" size="sm" asChild><a href="https://www.69shuba.com/" target="_blank" rel="noreferrer"><GlobeIcon className="mr-1.5 w-3 h-3 text-green-700"/> 69Shu</a></Button>
                      <Button variant="outline" size="sm" asChild><a href="https://www.cuoceng.com/" target="_blank" rel="noreferrer"><GlobeIcon className="mr-1.5 w-3 h-3 text-indigo-600"/> CuoCeng</a></Button>
                      <Button variant="outline" size="sm" asChild><a href="https://www.69shuba.tw/" target="_blank" rel="noreferrer"><GlobeIcon className="mr-1.5 w-3 h-3 text-emerald-600"/> 69Shu.TW</a></Button>
                      <Button variant="outline" size="sm" asChild><a href="https://czbooks.net/" target="_blank" rel="noreferrer"><GlobeIcon className="mr-1.5 w-3 h-3 text-blue-600"/> Czbooks</a></Button>
                      <Button variant="outline" size="sm" asChild><a href="https://www.po18.tw/" target="_blank" rel="noreferrer"><GlobeIcon className="mr-1.5 w-3 h-3 text-pink-500"/> PO18</a></Button>
                      <Button variant="outline" size="sm" asChild><a href="https://fanqienovel.com/" target="_blank" rel="noreferrer"><GlobeIcon className="mr-1.5 w-3 h-3 text-red-600"/> Fanqie</a></Button>
                      <Button variant="outline" size="sm" asChild><a href="https://book.qq.com/" target="_blank" rel="noreferrer"><GlobeIcon className="mr-1.5 w-3 h-3 text-blue-400"/> BookQQ</a></Button>
                      <Button variant="outline" size="sm" asChild><a href="https://www.popo.tw/" target="_blank" rel="noreferrer"><GlobeIcon className="mr-1.5 w-3 h-3 text-pink-400"/> POPO</a></Button>
                    </div>
                  </div>

                  <div className="mt-6 space-y-3 border-t pt-4">
                    <Label className="text-xs font-bold text-muted-foreground uppercase">Hướng dẫn quét</Label>
                    <div className="space-y-4 bg-muted/20 p-4 rounded-lg border text-sm">
                      <div>
                        <p className="font-semibold text-orange-600">XTruyen.vn (Khuyên dùng)</p>
                        <p className="text-muted-foreground text-xs mt-1">Dán link truyện vào ô tải, hệ thống sẽ tự động quét toàn bộ danh sách chương và tiến hành tải.</p>
                      </div>
                      <div className="border-t border-muted-foreground/10 pt-2">
                        <p className="font-semibold text-blue-600">SangTacViet.com</p>
                        <p className="text-muted-foreground text-xs mt-1">Do cơ chế bảo vệ của trang, bạn cần giữ một tab SangTacViet mở trên trình duyệt thì extension mới có thể gửi dữ liệu về app một cách liền mạch.</p>
                      </div>
                      <div className="border-t border-muted-foreground/10 pt-2">
                        <p className="font-semibold text-green-600">Web Trung (Uukanshu, Piaotia...)</p>
                        <p className="text-muted-foreground text-xs mt-1">Chỉ cần dán link trang chủ của truyện, ứng dụng sẽ tự tìm kiếm và lấy tất cả các chương rất nhanh chóng.</p>
                      </div>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex justify-between items-center mb-4 mt-8">
         <h2 className="text-xl font-semibold">Đang tải & Hoàn thành</h2>
         {Object.values(jobs).length > 0 && (
           <Button variant="ghost" size="sm" onClick={clearDone} className="text-muted-foreground">
             Xóa lịch sử hoàn thành
           </Button>
         )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {Object.values(jobs).length === 0 ? (
          <div className="col-span-full py-20 text-center text-muted-foreground bg-muted/20 rounded-xl border border-dashed">
             <BookIcon className="w-12 h-12 mx-auto mb-4 opacity-20" />
             <p>Chưa có truyện nào trong thư viện tải.</p>
             <p className="text-xs mt-1">Hãy dán URL truyện ở trên để bắt đầu.</p>
          </div>
        ) : (
          Object.values(jobs).map(job => (
            <Card key={job.id} className="overflow-hidden flex flex-col h-full hover:shadow-md transition-all group border-muted/60">
               <div className="relative w-full aspect-[3/4] bg-muted/20 flex items-center justify-center overflow-hidden">
                 {job.coverImage ? (
                   <img src={job.coverImage} alt={job.title} className="w-full h-full object-cover transition-transform group-hover:scale-105" referrerPolicy="no-referrer" />
                 ) : (
                   <BookIcon className="w-12 h-12 text-muted-foreground/20" />
                 )}
                 
                 <div className="absolute top-2 right-2 flex gap-1">
                    <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-sm shadow-sm backdrop-blur-md ${job.status === 'error' ? 'bg-destructive/90 text-destructive-foreground' : job.status === 'done' ? 'bg-green-500/90 text-white' : job.status === 'paused' ? 'bg-muted/90 text-foreground' : 'bg-primary/90 text-primary-foreground'}`}>
                      {job.status === 'error' ? 'Lỗi' : job.status === 'done' ? 'Hoàn thành' : job.status === 'paused' ? 'Tạm dừng' : 'Đang tải'}
                    </span>
                 </div>
               </div>
               
               <div className="p-3 flex-1 flex flex-col">
                 <h3 className="font-bold text-sm line-clamp-2 leading-snug mb-1" title={job.title}>{job.title}</h3>
                 <p className="text-xs text-muted-foreground truncate mb-3">{job.adapter.name}</p>
                 
                 <div className="mt-auto space-y-2">
                   <div className="flex items-center justify-between text-xs">
                     <span className="font-medium text-primary">{job.progress.completed} <span className="text-muted-foreground font-normal">/ {job.progress.total} chương</span></span>
                   </div>
                   <Progress value={(job.progress.completed / (job.progress.total || 1)) * 100} className="h-1.5 bg-muted/50" />
                   
                   <div className="flex items-center justify-between pt-1">
                      <div className="flex-1 overflow-hidden pr-2">
                         {job.status === 'scraping' ? (
                           <p className="text-[10px] text-muted-foreground line-clamp-1 break-all" title={job.progress.current}>
                             {job.progress.current || "Đang kết nối..."}
                           </p>
                         ) : job.error ? (
                           <p className="text-[10px] text-destructive line-clamp-1" title={job.error}>
                             {job.error}
                           </p>
                         ) : null}
                      </div>
                      
                      <div className="flex gap-0.5 shrink-0">
                        {job.status === "scraping" && (
                           <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full hover:bg-primary/10 hover:text-primary" onClick={() => pauseJob(job.id)}><PauseIcon className="w-3.5 h-3.5" /></Button>
                        )}
                        {job.status === "paused" && (
                           <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full hover:bg-primary/10 hover:text-primary" onClick={() => resumeJob(job.id)}><PlayIcon className="w-3.5 h-3.5" /></Button>
                        )}
                        {job.status === "error" && (
                           <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full text-destructive hover:bg-destructive/10" onClick={() => resumeJob(job.id)}><PlayIcon className="w-3.5 h-3.5" /></Button>
                        )}
                        {(job.status !== "done") && (
                           <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full text-destructive hover:bg-destructive/10" onClick={() => cancelJob(job.id)}><TrashIcon className="w-3.5 h-3.5" /></Button>
                        )}
                        {job.status === "done" && (
                           <CheckCircleIcon className="w-5 h-5 text-green-500 mr-1" />
                        )}
                      </div>
                   </div>
                 </div>
               </div>
            </Card>
          ))
        )}
      </div>
      <Dialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isShowingChapters ? "Danh sách chương" : "Xác nhận tải truyện"}</DialogTitle>
          </DialogHeader>
          {scrapedNovelInfo && (
            isShowingChapters ? (
              <div className="py-2">
                <div className="max-h-[50vh] overflow-y-auto border rounded-md divide-y">
                  {scrapedNovelInfo.chapters.map((ch: any, idx: number) => (
                    <div key={idx} className="p-2 px-3 text-sm flex gap-3 hover:bg-muted/50">
                      <span className="text-muted-foreground w-8 shrink-0">{idx + 1}.</span>
                      <span className="line-clamp-1">{ch.title}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between items-center mt-4">
                  <p className="text-sm text-muted-foreground">Tổng cộng: <strong>{scrapedNovelInfo.chapters.length}</strong> chương</p>
                  <Button variant="outline" onClick={() => setIsShowingChapters(false)}>Quay lại</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 py-2">
                 <div className="flex gap-3 bg-muted/20 p-3 rounded-lg border items-center">
                   {scrapedNovelInfo.coverImage ? (
                      <img src={scrapedNovelInfo.coverImage} alt={scrapedNovelInfo.title} className="w-14 h-20 object-cover rounded shadow-sm bg-muted shrink-0" referrerPolicy="no-referrer" />
                   ) : (
                      <div className="w-14 h-20 rounded bg-muted/50 flex items-center justify-center shrink-0">
                        <BookIcon className="w-6 h-6 text-muted-foreground/30" />
                      </div>
                   )}
                   <div className="flex-1">
                      <h3 className="font-bold line-clamp-2 text-sm">{scrapedNovelInfo.title}</h3>
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-sm text-muted-foreground">Đã quét được: <strong className="text-foreground">{scrapedNovelInfo.chapters.length}</strong> chương</p>
                        <Button variant="secondary" size="sm" onClick={() => setIsShowingChapters(true)}>Xem danh sách</Button>
                      </div>
                   </div>
                 </div>

                 <div className="space-y-2 mt-4">
                    <Label>Thời gian chờ mỗi chương (giây)</Label>
                    <Input type="number" min={0} value={chapterDelay} onChange={e => setChapterDelay(Number(e.target.value))} />
                    <p className="text-xs text-muted-foreground">Mặc định là 7 giây để tránh bị website chặn IP.</p>
                 </div>

                 {currentAdapter?.name === "STV" && (
                   <div className="bg-orange-50 dark:bg-orange-950/20 text-orange-600 dark:text-orange-400 p-3 rounded-md text-sm border border-orange-200 dark:border-orange-900 mt-2">
                     <p className="font-bold mb-1 flex items-center gap-1.5"><GlobeIcon className="w-4 h-4" /> Lưu ý với SangTacViet</p>
                     <p className="leading-relaxed">Bạn cần mở tab web SangTacViet ở trình duyệt, <b>bấm vào chương 1</b> để trang load nội dung ra, sau đó mới quay lại app ấn <b>Bắt đầu tải</b>.</p>
                   </div>
                 )}
                 {currentAdapter?.name === "Fanqie" && (
                   <div className="bg-orange-50 dark:bg-orange-950/20 text-orange-600 dark:text-orange-400 p-3 rounded-md text-sm border border-orange-200 dark:border-orange-900 mt-2">
                     <p className="font-bold mb-1 flex items-center gap-1.5"><GlobeIcon className="w-4 h-4" /> Lưu ý với Fanqie</p>
                     <p className="leading-relaxed">Extension sẽ tự động mở tab Fanqie để lấy nội dung. <b>Nếu gặp lỗi bị chặn (trắng trang)</b>, vui lòng ấn vào Chương 1 trên tab vừa mở, giải capcha nếu có, sau đó extension sẽ tự động cày tiếp!</p>
                   </div>
                 )}
                 
                 <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
                   <Button variant="ghost" onClick={() => setIsConfirmOpen(false)}>Hủy</Button>
                   <Button onClick={confirmAdd}>Bắt đầu tải</Button>
                 </div>
              </div>
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
