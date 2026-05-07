"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { AnalysisModelPicker } from "@/components/analysis-model-picker";
import { 
  extensionFetch, 
  checkExtensionStatus, 
  getGeneratorExtensionId, 
  setGeneratorExtensionId 
} from "@/lib/scraper/extension-bridge";
import { useApiInferenceProviders, useAIModels } from "@/lib/hooks";
import { getModel } from "@/lib/ai/provider";
import { generateText } from "ai";
import { 
  Loader2Icon, CopyIcon, Wand2Icon, GlobeIcon, SparklesIcon, 
  ShieldCheckIcon, ShieldAlertIcon, Settings2Icon, DownloadIcon,
  ChevronRightIcon, BookOpenIcon, ListIcon, FileTextIcon, CheckCircle2Icon,
  Code2Icon, LayersIcon, ArrowRightCircleIcon
} from "lucide-react";
import { toast } from "sonner";

export default function ScraperGeneratorPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  
  // Data state
  const [mainHtml, setMainHtml] = useState("");
  const [novelData, setNovelData] = useState<any>(null);
  const [chapters, setChapters] = useState<any[]>([]);
  const [tocInfo, setTocInfo] = useState<any>(null);
  const [sampleChapterData, setSampleChapterData] = useState<any>(null);
  const [finalPrompt, setFinalPrompt] = useState("");
  
  // Extension status state
  const [extStatus, setExtStatus] = useState<{ available: boolean; version: string | null }>({ available: false, version: null });
  const [extId, setExtId] = useState("");
  const [showExtConfig, setShowExtConfig] = useState(false);

  // AI Selection state
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const providers = useApiInferenceProviders();
  const models = useAIModels(selectedProviderId || undefined);

  useEffect(() => {
    const check = async () => {
      const currentId = getGeneratorExtensionId();
      const status = await checkExtensionStatus(currentId);
      setExtStatus(status);
      setExtId(currentId);
    };
    check();
  }, []);

  const handleUpdateExtId = () => {
    setGeneratorExtensionId(extId);
    toast.success("Đã cập nhật ID cho Generator.");
    setTimeout(async () => {
      const status = await checkExtensionStatus(extId);
      setExtStatus(status);
    }, 1000);
  };

  const scanMainPage = async (targetUrl: string, isAppend = false) => {
    if (!extId) return toast.error("Vui lòng nhập Extension ID cho Generator.");
    setLoading(true);
    try {
      const res = await extensionFetch(targetUrl, { extensionId: extId });
      if (!isAppend) setMainHtml(res.html);
      
      const doc = new DOMParser().parseFromString(res.html, "text/html");
      
      // Basic info (only on first scan)
      if (!isAppend) {
        const coverEl = doc.querySelector("img[itemprop='image'], .book3d img, .cover img");
        const title = coverEl?.getAttribute("alt")?.trim() || doc.querySelector("h1, h2, title")?.textContent?.trim() || "Không rõ";
        const author = doc.body.innerText.match(/(tác giả|author|tac gia):\s*([^|\n<]+)/i)?.[2]?.trim() || "Không rõ";
        const cover = coverEl?.getAttribute("src") || "";
        setNovelData({ title, author, cover: cover ? new URL(cover, targetUrl).toString() : "" });
      }

      // 1. Identify TOC area (Less aggressive)
      // We don't remove junk anymore to avoid losing real chapters

      // 2. Detect chapter links (Relaxed heuristic)
      const links = doc.querySelectorAll("a[href]");
      let detectedChapters = Array.from(links)
        .map(a => {
          try {
            const href = a.getAttribute("href");
            return { 
              title: a.textContent?.trim() || "", 
              url: href ? new URL(href, targetUrl).toString() : "" 
            };
          } catch (e) {
            return { title: "", url: "" };
          }
        })
        .filter(a => {
          if (!a.title || !a.url || !a.url.startsWith("http")) return false;
          if (a.url.includes("facebook.com") || a.url.includes("twitter.com") || a.url === targetUrl) return false;
          
          // LOẠI BỎ CÁC LINK ĐIỀU HƯỚNG (TRƯỚC/TIẾP)
          const navRegex = /trước|tiếp|sau|quay lại|next|prev|index|home|trang chủ/i;
          if (navRegex.test(a.title)) return false;

          // Chấp nhận link có số chương rõ rệt
          const chapterRegex = /chương\s*\d+|chapter\s*\d+|quyển\s*\d+|tập\s*\d+|ch\s*\d+|\d+/i;
          return chapterRegex.test(a.title);
        });

      // FALLBACK: If nothing found, take all links with text > 2 chars
      if (detectedChapters.length === 0) {
        detectedChapters = Array.from(links)
          .map(a => ({ 
            title: a.textContent?.trim() || "", 
            url: new URL(a.getAttribute("href")!, targetUrl).toString() 
          }))
          .filter(a => a.title.length > 2 && !a.url.includes("javascript:"));
      }

      // 3. Find Pagination & TOC Link
      let nextUrl: string | null = null;
      let nextClickSelector: string | null = null;
      let tocUrl: string | null = null;
      const candidates: any[] = [];

      let candidateIndex = 1;
      // Tìm cả link <a> và nút bấm <button>, <li> để xử lý Tab chuyển chương
      const potentialNextLinks = doc.querySelectorAll("ul.pagination a, .pagination a, a[rel='next'], a[href], button, li[class*='tab'], div[class*='tab']");
      
      for (const el of Array.from(potentialNextLinks)) {
        const text = el.textContent?.trim() || "";
        const href = el.getAttribute("href");
        const isButton = el.tagName === "BUTTON" || el.getAttribute("role") === "button";

        // Collect candidates (links/buttons with numbers or keywords)
        if ((href || isButton) && (/\d+|tiếp|sau|mục lục|danh sách|>|»|next|tab|chương/i.test(text))) {
          try {
            const abs = href ? new URL(href, targetUrl).toString() : null;
            if (abs && abs.startsWith("http") && !candidates.find(c => c.url === abs)) {
              candidates.push({ title: text || "Link " + candidateIndex++, url: abs });
            } else if (isButton || !href) {
              // Nếu là nút bấm (Tab chuyển chương), lưu selector để click
              const sel = el.id ? `#${el.id}` : el.className ? `.${el.className.trim().split(/\s+/)[0]}` : null;
              if (sel && !candidates.find(c => c.selector === sel)) {
                candidates.push({ title: "Nút: " + text, selector: sel });
              }
            }
          } catch(e) {}
        }

        // Dò tìm link "Xem tất cả chương" hoặc "Mục lục"
        if (href && /mục lục|danh sách chương|tất cả chương|full list/i.test(text) && !isAppend) {
          tocUrl = new URL(href, targetUrl).toString();
        }

        // Dò tìm nút "Trang sau" (Auto-pick)
        if (el.matches("ul.pagination li.active + li a, .pagination .next a, a[rel='next']") || 
            /trang sau|next|chuong sau|>|»/i.test(text)) {
          
          if (href && href.startsWith("http")) {
            nextUrl = new URL(href, targetUrl).toString();
          } else if (href && !href.startsWith("javascript") && !href.startsWith("#")) {
            nextUrl = new URL(href, targetUrl).toString();
          } else {
            nextClickSelector = el.id ? `#${el.id}` : el.className ? `.${el.className.trim().split(/\s+/)[0]}` : null;
          }
        }
      }

      if (isAppend) {
        setChapters(prev => [...prev, ...detectedChapters]);
      } else {
        setChapters(detectedChapters);
      }

      // Find the best TOC HTML fragment for display
      let bestDiv: Element | null = doc.querySelector(".list-chapter, #list-chapter, .chapters, .index-container");
      if (!bestDiv) {
        let maxLinks = 0;
        doc.querySelectorAll("div, ul, section").forEach(el => {
          const cCount = el.querySelectorAll("a").length;
          if (cCount > maxLinks) { maxLinks = cCount; bestDiv = el; }
        });
      }

      setTocInfo({
        count: isAppend ? chapters.length + detectedChapters.length : detectedChapters.length,
        nextUrl,
        nextClickSelector,
        tocUrl,
        candidates: candidates.slice(0, 15),
        type: nextUrl || nextClickSelector ? "Nhiều trang (Phân trang)" : "Full (1 trang)",
        html: bestDiv?.outerHTML || "Mã nguồn trang mục lục"
      });

      // TỰ ĐỘNG CHUYỂN HƯỚNG NẾU THẤY MỤC LỤC VÀ TRANG HIỆN TẠI KHÔNG CÓ CHƯƠNG
      if (tocUrl && detectedChapters.length < 5 && !isAppend) {
        toast.info("Đang tự động chuyển đến trang Mục lục...");
        setUrl(tocUrl);
        scanMainPage(tocUrl);
      }

      if (!isAppend) setActiveTab("toc");
      toast.success(isAppend ? `Đã lấy thêm ${detectedChapters.length} chương!` : "Đã quét trang chủ!");
      
      return { nextUrl, nextClickSelector, count: detectedChapters.length };
    } catch (err: any) {
      toast.error(err.message);
      return { nextUrl: null, nextClickSelector: null, count: 0 };
    } finally {
      setLoading(false);
    }
  };

  const autoScanAllPages = async () => {
    if (!url) return toast.error("Cần nhập URL trước");
    setLoading(true);
    let currentUrl = url;
    let totalAdded = 0;
    
    try {
      toast.info("Bắt đầu quét toàn bộ mục lục... Hãy giữ trình duyệt mở.");
      // Quét trang đầu tiên
      let result = await scanMainPage(currentUrl, false);
      totalAdded += result.count;

      // Vòng lặp tự động quét các trang tiếp theo
      while (result.nextUrl && totalAdded < 5000) { // Giới hạn 5000 chương để tránh treo
        toast.info(`Đang quét trang tiếp theo... (Tổng cộng: ${totalAdded} chương)`);
        result = await scanMainPage(result.nextUrl, true);
        totalAdded += result.count;
        if (result.count === 0) break; // Dừng nếu trang sau không có thêm chương
        await new Promise(r => setTimeout(r, 1000)); // Nghỉ 1s để tránh bị chặn
      }
      toast.success(`Hoàn tất! Đã lấy được tổng cộng ${totalAdded} chương.`);
    } catch (e: any) {
      toast.error("Lỗi quét tự động: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const analyzeTocWithAI = async () => {
    if (!mainHtml) return toast.error("Cần quét trang chủ trước");
    if (!selectedModelId) return toast.error("Vui lòng chọn Model AI trước");
    
    setLoading(true);
    try {
      // Tìm provider đầy đủ từ danh sách (bao gồm cả API Key và Base URL)
      const provider = providers?.find(p => p.id === selectedProviderId);
      if (!provider) throw new Error("Vui lòng chọn Nhà cung cấp AI.");
      if (!selectedModelId) throw new Error("Vui lòng chọn Model AI.");
      
      const model = await getModel(provider, selectedModelId);
      const { text } = await generateText({
        model,
        prompt: `Tôi đang làm scraper cho truyện. Đây là HTML trang chủ: ${mainHtml.slice(0, 15000)}\n\nHãy tìm danh sách chương hoặc link dẫn đến mục lục. Trả về định dạng JSON: { "selector": "css selector vung chua link chuong", "tocUrl": "link den trang muc luc neu co", "reason": "tai sao" }`,
      });

      const result = JSON.parse(text.match(/\{.*\}/s)?.[0] || "{}");
      if (result.tocUrl) {
        toast.info("AI tìm thấy link mục lục: " + result.tocUrl);
        setUrl(result.tocUrl);
        scanMainPage(result.tocUrl);
      } else if (result.selector) {
        toast.success("AI tìm thấy selector: " + result.selector);
        // Quét lại với selector cụ thể
        const doc = new DOMParser().parseFromString(mainHtml, "text/html");
        const links = doc.querySelectorAll(result.selector + " a");
        const detected = Array.from(links).map(a => {
          try {
            const href = a.getAttribute("href");
            return { 
              title: a.textContent?.trim() || "", 
              url: href ? new URL(href, url).toString() : "" 
            };
          } catch(e) { return { title: "", url: "" }; }
        }).filter(a => a.url.startsWith("http"));
        setChapters(detected);
      } else {
        toast.warning("AI không tìm thấy cấu trúc mục lục rõ ràng.");
      }
    } catch (err: any) {
      toast.error("AI phân tích lỗi: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const scanSampleChapter = async (chapterUrl: string) => {
    setLoading(true);
    setActiveTab("chapter");
    try {
      const res = await extensionFetch(chapterUrl, { extensionId: extId });
      const doc = new DOMParser().parseFromString(res.html, "text/html");
      
      let bestSel = "";
      let maxP = 0;
      doc.querySelectorAll("div, article, section").forEach(el => {
        const pCount = el.querySelectorAll("p").length;
        if (pCount > maxP) {
          maxP = pCount;
          bestSel = el.id ? `#${el.id}` : el.className ? `.${el.className.split(" ")[0]}` : "div";
        }
      });

      setSampleChapterData({
        url: chapterUrl,
        selector: bestSel,
        pCount: maxP,
        html: res.html
      });

      toast.success("Đã lấy được nội dung chương mẫu!");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const generateAIAnalysis = async () => {
    if (!novelData || !sampleChapterData) return toast.error("Cần quét đủ 3 bước");
    setLoading(true);
    try {
      const provider = providers?.find(p => p.id === selectedProviderId);
      const model = await getModel(provider!, selectedModelId);
      const { text } = await generateText({
        model,
        system: "Bạn là chuyên gia Scraper. Hãy viết một SiteAdapter chi tiết.",
        prompt: `TRUYỆN: ${novelData.title}\nMỤC LỤC: ${tocInfo.type}\nHTML MỤC LỤC: ${tocInfo.html.slice(0, 5000)}\nSELECTOR CHƯƠNG: ${sampleChapterData.selector}\nHTML CHƯƠNG: ${sampleChapterData.html.slice(0, 10000)}`,
      });
      setFinalPrompt(text);
      toast.success("AI đã hoàn thành!");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container max-w-6xl py-10 space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Phân tích Scraper 3 Giai Đoạn</h1>
          <p className="text-muted-foreground text-sm italic">Hỗ trợ nhận diện Phân trang & Loại bỏ chương mới cập nhật gây nhiễu.</p>
        </div>
        <div className="flex items-center gap-2">
          {extStatus.available ? <Badge className="bg-emerald-500/10 text-emerald-600"><ShieldCheckIcon className="size-3 mr-1" /> Connected</Badge> : <Badge variant="destructive">Offline</Badge>}
          <Button variant="ghost" size="icon-sm" onClick={() => setShowExtConfig(!showExtConfig)}><Settings2Icon className="size-4" /></Button>
        </div>
      </div>

      {showExtConfig && (
        <Card className="bg-muted/30 border-dashed animate-in fade-in zoom-in-95">
          <CardContent className="pt-6 space-y-4">
            <div className="flex gap-2 justify-center">
              <Input placeholder="Extension ID" value={extId} onChange={e => setExtId(e.target.value)} className="max-w-xs" />
              <Button onClick={handleUpdateExtId} size="sm">Kết nối</Button>
            </div>
            <div className="flex justify-center border-t pt-4">
              <Button variant="outline" size="sm" asChild className="bg-primary/5 border-primary/20 hover:bg-primary/10">
                <a href="/novel-studio-shield.zip" download>
                  <DownloadIcon className="size-4 mr-2 text-primary" />
                  Tải Extension Shield (Bản v1.3 - Auto Scroll)
                </a>
              </Button>
            </div>
            <p className="text-[10px] text-center text-muted-foreground italic">Cài đặt bản v1.3 để hỗ trợ tự động cuộn trang (Lazy Load).</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
        <Card className="md:col-span-8 border-primary/20 shadow-xl shadow-primary/5">
          <CardContent className="pt-6 flex gap-4">
            <Input placeholder="Dán link mục lục (Trang 1)..." value={url} onChange={e => setUrl(e.target.value)} className="h-11 flex-1" />
            <div className="flex gap-2">
              <Button onClick={() => scanMainPage(url)} disabled={loading} className="h-11 px-6">
                {loading ? <Loader2Icon className="animate-spin mr-2" /> : <GlobeIcon className="mr-2" />}
                Quét trang này
              </Button>
              <Button onClick={autoScanAllPages} disabled={loading} className="h-11 px-6 bg-orange-600 hover:bg-orange-700">
                <ArrowRightCircleIcon className="mr-2" />
                Quét Toàn Bộ
              </Button>
            </div>
          </CardContent>
        </Card>
        
        <div className="md:col-span-4 space-y-1">
          <p className="text-[10px] font-medium text-muted-foreground ml-1">AI Hỗ trợ tìm chương (Tùy chọn)</p>
          <div className="flex gap-2">
            <NativeSelect value={selectedProviderId} onChange={e => setSelectedProviderId(e.target.value)} className="h-11 text-xs flex-1">
              <NativeSelectOption value="">Chọn AI...</NativeSelectOption>
              {providers?.map(p => <NativeSelectOption key={p.id} value={p.id}>{p.name}</NativeSelectOption>)}
            </NativeSelect>
            <NativeSelect value={selectedModelId} onChange={e => setSelectedModelId(e.target.value)} className="h-11 text-xs flex-1">
              <NativeSelectOption value="">Chọn Model...</NativeSelectOption>
              {models?.map(m => <NativeSelectOption key={m.id} value={m.id}>{m.name}</NativeSelectOption>)}
            </NativeSelect>
          </div>
        </div>
      </div>

      {novelData && (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 h-12 bg-muted/50 p-1">
            <TabsTrigger value="overview">1. Trang chủ</TabsTrigger>
            <TabsTrigger value="toc">2. Mục lục ({chapters.length})</TabsTrigger>
            <TabsTrigger value="chapter">3. Nội dung</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="grid gap-6 md:grid-cols-3">
            <Card className="md:col-span-1">
              <CardContent className="pt-6 space-y-4">
                {novelData.cover && <img src={novelData.cover} className="w-full rounded shadow-md" />}
                <p className="font-bold text-lg">{novelData.title}</p>
                <p className="text-sm text-muted-foreground">{novelData.author}</p>
                {tocInfo && <Badge variant="secondary">{tocInfo.type}</Badge>}
              </CardContent>
            </Card>
            <Card className="md:col-span-2">
              <CardHeader><CardTitle className="text-sm">HTML Trang chủ</CardTitle></CardHeader>
              <CardContent><Textarea value={mainHtml} readOnly className="h-[400px] font-mono text-[10px] bg-muted/20" /></CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="toc" className="grid gap-6 md:grid-cols-3">
            <Card className="md:col-span-1">
              <CardHeader>
                <CardTitle className="text-sm flex justify-between items-center">
                  Danh sách chương
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" className="h-7 text-[10px] bg-purple-600 hover:bg-purple-700 text-white" onClick={analyzeTocWithAI} disabled={loading}>
                      <Wand2Icon className="size-3 mr-1" /> AI Phân tích
                    </Button>
                    {tocInfo?.tocUrl && (
                      <Button size="sm" variant="default" className="h-7 text-[10px] bg-blue-600 hover:bg-blue-700" onClick={() => { setUrl(tocInfo.tocUrl); scanMainPage(tocInfo.tocUrl); }}>
                        <ArrowRightCircleIcon className="size-3 mr-1" /> Tới trang Mục lục
                      </Button>
                    )}
                    {tocInfo?.nextUrl && (
                      <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => scanMainPage(tocInfo.nextUrl, true)} disabled={loading}>
                        <ArrowRightCircleIcon className="size-3 mr-1" /> Quét trang tiếp
                      </Button>
                    )}
                    {tocInfo?.nextClickSelector && !tocInfo?.nextUrl && (
                      <Button size="sm" variant="outline" className="h-7 text-[10px] border-orange-500 text-orange-600 hover:bg-orange-50" 
                        onClick={async () => {
                          setLoading(true);
                          try {
                            const res = await extensionFetch(url, { extensionId: extId, clickSelector: tocInfo.nextClickSelector });
                            const doc = new DOMParser().parseFromString(res.html, "text/html");
                            // Logic tương tự scanMainPage nhưng dùng HTML mới từ việc click
                            // Để đơn giản, tôi sẽ gọi lại hàm scan với flag click
                            scanMainPage(url, true); 
                          } catch (e: any) { toast.error(e.message); }
                          finally { setLoading(false); }
                        }} disabled={loading}>
                        <ArrowRightCircleIcon className="size-3 mr-1" /> Click để tải thêm
                      </Button>
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-[500px] overflow-auto space-y-1">
                  {chapters.map((ch, i) => (
                    <div key={i} className="flex items-center justify-between p-1.5 rounded hover:bg-primary/5 border text-[10px]">
                      <span className="truncate flex-1 mr-2">{ch.title}</span>
                      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[9px]" onClick={() => scanSampleChapter(ch.url)} disabled={loading}>Xem</Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card className="md:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground flex items-center">
                  <LayersIcon className="size-3 mr-2" /> Các link chuyển tiếp tiềm năng (Thử nếu tự động sai)
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {tocInfo?.candidates?.map((c: any, i: number) => (
                  <Button key={i} variant="secondary" size="sm" className={`h-7 text-[9px] ${c.selector ? "bg-orange-500/10 text-orange-600 border-orange-200" : "bg-blue-500/10 text-blue-600"}`}
                    onClick={async () => { 
                      if (c.url) {
                        setUrl(c.url); scanMainPage(c.url); 
                      } else if (c.selector) {
                        setLoading(true);
                        try {
                          const res = await extensionFetch(url, { extensionId: extId, clickSelector: c.selector });
                          scanMainPage(url, true); // Quét lại và cộng dồn
                        } catch(e: any) { toast.error(e.message); }
                        finally { setLoading(false); }
                      }
                    }}>
                    {c.title}
                  </Button>
                )) || <p className="text-[10px] italic">Không tìm thấy link nghi vấn.</p>}
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader><CardTitle className="text-sm">HTML Vùng chứa Mục lục</CardTitle></CardHeader>
              <CardContent><Textarea value={tocInfo?.html || ""} readOnly className="h-[500px] font-mono text-[10px] bg-muted/20" /></CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="chapter" className="grid gap-6 md:grid-cols-2">
            {!sampleChapterData ? (
              <div className="col-span-2 h-40 flex items-center justify-center border-2 border-dashed rounded-xl text-muted-foreground italic">Hãy chọn 1 chương ở Tab Mục lục...</div>
            ) : (
              <>
                <Card>
                  <CardHeader><CardTitle className="text-sm">Kết quả Phân tích</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                      <p className="text-xs font-bold text-emerald-600">Content Selector:</p>
                      <code className="text-lg font-mono text-primary">{sampleChapterData.selector}</code>
                      <p className="text-[10px] text-muted-foreground mt-1">Mật độ: {sampleChapterData.pCount} thẻ p.</p>
                    </div>
                    <div className="space-y-2 pt-4 border-t">
                      <Label className="text-[10px] font-bold">AI GENERATION</Label>
                      <NativeSelect value={selectedProviderId} onChange={e => setSelectedProviderId(e.target.value)}>
                        <NativeSelectOption value="">Chọn Nhà cung cấp...</NativeSelectOption>
                        {providers?.map(p => <NativeSelectOption key={p.id} value={p.id}>{p.name}</NativeSelectOption>)}
                      </NativeSelect>
                      <NativeSelect value={selectedModelId} onChange={e => setSelectedModelId(e.target.value)} disabled={!selectedProviderId}>
                        <NativeSelectOption value="">Chọn Model...</NativeSelectOption>
                        {models?.map(m => <NativeSelectOption key={m.id} value={m.modelId}>{m.name}</NativeSelectOption>)}
                      </NativeSelect>
                      <Button className="w-full mt-2" onClick={generateAIAnalysis} disabled={loading || !selectedModelId}>
                        {loading ? <Loader2Icon className="animate-spin mr-2" /> : <SparklesIcon className="mr-2" />} Tạo Prompt
                      </Button>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-sm">HTML Chương</CardTitle></CardHeader>
                  <CardContent><Textarea value={sampleChapterData.html} readOnly className="h-[400px] font-mono text-[10px] bg-muted/20" /></CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>
      )}

      {finalPrompt && (
        <Card className="border-emerald-500/50 shadow-2xl animate-in zoom-in-95">
          <CardHeader className="bg-emerald-500/5"><CardTitle className="text-emerald-500">KẾT QUẢ PROMPT</CardTitle></CardHeader>
          <CardContent className="relative">
            <Textarea value={finalPrompt} readOnly className="h-[500px] font-mono text-sm p-6" />
            <Button className="absolute top-10 right-10" size="sm" onClick={() => { navigator.clipboard.writeText(finalPrompt); toast.success("Đã copy!"); }}><CopyIcon className="size-4 mr-2" /> Copy</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
