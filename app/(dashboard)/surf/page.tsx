"use client";

import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRightIcon, RefreshCcwIcon, SaveIcon } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { db } from "@/lib/db";

export default function SurfPage() {
    const [urlInput, setUrlInput] = useState("https://www.uukanshu.com/");
    const [currentUrl, setCurrentUrl] = useState("https://www.uukanshu.com/");
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [scrapedData, setScrapedData] = useState<{ title: string; content: string; actualUrl: string } | null>(null);

    const handleGo = (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        let finalUrl = urlInput.trim();
        if (!finalUrl.startsWith("http://") && !finalUrl.startsWith("https://")) {
            finalUrl = "https://" + finalUrl;
        }
        setCurrentUrl(finalUrl);
        setUrlInput(finalUrl);
    };

    useEffect(() => {
        const handleMessage = (e: MessageEvent) => {
            if (e.data && e.data.type === 'SURF_NAVIGATED') {
                const { title, content, actualUrl } = e.data;
                setUrlInput(actualUrl); // Update address bar
                
                // If it looks like a chapter (has enough content)
                if (content && content.length > 500) {
                    setScrapedData({ title, content, actualUrl });
                    toast.success("Phát hiện chương truyện!");
                } else {
                    setScrapedData(null);
                }
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, []);

    const proxyUrl = currentUrl ? `/api/surf-proxy?url=${encodeURIComponent(currentUrl)}` : "about:blank";

    return (
        <div className="flex h-full w-full bg-background overflow-hidden">
            <div className="flex-1 flex flex-col min-w-0 border-r">
                <div className="h-14 border-b flex items-center px-4 gap-2 bg-muted/30">
                    <form onSubmit={handleGo} className="flex-1 flex gap-2">
                        <Input 
                            value={urlInput}
                            onChange={(e) => setUrlInput(e.target.value)}
                            placeholder="Nhập link truyện tiếng Trung (VD: https://www.uukanshu.com)..."
                            className="bg-background font-mono text-sm"
                        />
                        <Button type="submit" variant="secondary" size="icon">
                            <ArrowRightIcon className="size-4" />
                        </Button>
                    </form>
                    <Button variant="ghost" size="icon" onClick={() => iframeRef.current && (iframeRef.current.src = iframeRef.current.src)}>
                        <RefreshCcwIcon className="size-4" />
                    </Button>
                </div>
                
                <div className="flex-1 relative bg-white">
                    {currentUrl ? (
                        <iframe 
                            ref={iframeRef}
                            src={proxyUrl} 
                            className="w-full h-full border-none"
                            sandbox="allow-same-origin allow-scripts allow-forms"
                        />
                    ) : (
                        <div className="flex items-center justify-center h-full text-muted-foreground">
                            Nhập URL để bắt đầu lướt web
                        </div>
                    )}
                </div>
            </div>

            <div className="w-[400px] flex flex-col bg-muted/10 shrink-0">
                <div className="h-14 border-b flex items-center px-4 font-semibold">
                    Dữ liệu bóc tách
                </div>
                <ScrollArea className="flex-1 p-4">
                    {scrapedData ? (
                        <div className="space-y-4">
                            <div className="font-bold text-lg text-primary">{scrapedData.title}</div>
                            <div className="text-xs text-muted-foreground break-all">{scrapedData.actualUrl}</div>
                            <div className="p-3 bg-muted rounded-md text-sm whitespace-pre-wrap font-serif leading-relaxed max-h-[50vh] overflow-y-auto">
                                {scrapedData.content.replace(/<[^>]*>?/gm, '\n').replace(/\n\s*\n/g, '\n\n')}
                            </div>
                            
                            <Button className="w-full gap-2 mt-4" size="lg">
                                <SaveIcon className="size-4" />
                                Lưu vào truyện (Tính năng đang Dev)
                            </Button>
                        </div>
                    ) : (
                        <div className="text-center text-muted-foreground text-sm mt-10">
                            Chưa phát hiện chương truyện.<br/><br/>
                            Hãy lướt web và bấm vào một chương truyện, nội dung sẽ tự động hiện ở đây!
                        </div>
                    )}
                </ScrollArea>
            </div>
        </div>
    );
}
