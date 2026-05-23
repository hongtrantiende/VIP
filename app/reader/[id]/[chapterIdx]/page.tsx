"use client";

import { useEffect, useState, use, useRef } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon, ListIcon, SunIcon, MoonIcon, Volume2Icon } from "lucide-react";
import Link from "next/link";
import { useReaderPanel } from "@/lib/stores/reader-panel";
import { SentenceRenderer } from "@/components/reader/sentence-renderer";
import { ReaderPanel } from "@/components/reader/reader-panel";
import { ObfuscatedText } from "@/components/reader/obfuscated-text";
import { toast } from "sonner";
import { tokenizeSentences } from "@/lib/tts";

const UNWANTED_PATTERNS = [
    "Bạn đang xem văn bản gốc chưa dịch, có thể kéo xuống cuối trang để chọn bản dịch.",
    "Mời bạn đọc tiếp tại",
    "Chúc bạn đọc truyện vui vẻ",
    "Hãy ủng hộ tác giả bằng cách",
];

const cleanContent = (text: string) => {
    let cleaned = text;
    UNWANTED_PATTERNS.forEach(pattern => {
        cleaned = cleaned.replace(new RegExp(pattern, "gi"), "");
    });
    return cleaned.trim();
};

export default function StandaloneChapterReaderPage(props: { params: Promise<{ id: string, chapterIdx: string }> }) {
    const params = use(props.params);
    const novelId = params.id;
    const chapterOrder = params.chapterIdx;
    const currentOrder = Number(chapterOrder);
    const router = useRouter();

    const [chapter, setChapter] = useState<{ id: string, title: string, order: number } | null>(null);
    const [scenes, setScenes] = useState<{ id: string, content: string, version: number, activeSceneId?: string }[]>([]);
    const [nextChapterData, setNextChapterData] = useState<{
        chapter: { id: string, title: string, order: number },
        scenes: { id: string, content: string, version: number }[]
    } | null>(null);

    const nextChapterDataRef = useRef(nextChapterData);
    nextChapterDataRef.current = nextChapterData;

    const [totalChapters, setTotalChapters] = useState(0);
    const [novelTitle, setNovelTitle] = useState("");

    const novelTitleRef = useRef(novelTitle);
    novelTitleRef.current = novelTitle;

    const totalChaptersRef = useRef(totalChapters);
    totalChaptersRef.current = totalChapters;
    const isReaderOpen = useReaderPanel((s) => s.isOpen);
    const isReaderPlaying = useReaderPanel((s) => s.isPlaying);
    const toggleReader = useReaderPanel((s) => s.toggle);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [fontSize, setFontSize] = useState(18);
    const [fontFamily, setFontFamily] = useState("font-serif");

    // Theme state
    const [theme, setTheme] = useState<"light" | "dark">("light");
    const isDark = theme === "dark";

    // Load settings from localStorage on mount
    useEffect(() => {
        const savedSize = localStorage.getItem("rr_font_size");
        const savedFamily = localStorage.getItem("rr_font_family");
        const savedTheme = localStorage.getItem("rr_theme");
        if (savedSize) setFontSize(parseInt(savedSize));
        if (savedFamily) setFontFamily(savedFamily);
        if (savedTheme === "light" || savedTheme === "dark") {
            setTheme(savedTheme);
        }
    }, []);

    // Save settings when changed
    const updateFontSize = (newSize: number) => {
        const val = Math.max(14, Math.min(32, newSize));
        setFontSize(val);
        localStorage.setItem("rr_font_size", val.toString());
    };

    const updateFontFamily = (newFamily: string) => {
        setFontFamily(newFamily);
        localStorage.setItem("rr_font_family", newFamily);
    };

    const toggleTheme = () => {
        const nextTheme = theme === "dark" ? "light" : "dark";
        setTheme(nextTheme);
        localStorage.setItem("rr_theme", nextTheme);
        toast.info(nextTheme === "dark" ? "Đã chuyển sang chế độ tối" : "Đã chuyển sang chế độ sáng");
    };

    useEffect(() => {
        const targetOrder = Number(chapterOrder);
        const preloaded = nextChapterDataRef.current;

        // If we already preloaded this chapter, use it immediately
        if (preloaded && preloaded.chapter.order === targetOrder) {
            setChapter(preloaded.chapter);
            setScenes(preloaded.scenes);
            setError("");
            setLoading(false);

            // Save to local reading history
            try {
                const historyStr = localStorage.getItem("rr_history") || "{}";
                const history = JSON.parse(historyStr);
                history[novelId] = {
                    id: novelId,
                    title: novelTitleRef.current || history[novelId]?.title || "Truyện Không Tên",
                    coverImage: history[novelId]?.coverImage || "",
                    author: history[novelId]?.author || "",
                    genres: history[novelId]?.genres || [],
                    lastReadChapterIdx: targetOrder,
                    lastReadChapterTitle: preloaded.chapter.title || `Chương ${targetOrder + 1}`,
                    totalChapters: totalChaptersRef.current || history[novelId]?.totalChapters || 0,
                    updatedAt: Date.now()
                };
                localStorage.setItem("rr_history", JSON.stringify(history));
            } catch (e) {
                console.error("Lỗi lưu lịch sử", e);
            }

            // Clear nextChapterData after applying it
            setNextChapterData(null);
            return;
        }

        setLoading(true);
        fetch(`/api/reading-room?action=chapter&id=${novelId}&idx=${chapterOrder}`)
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    setChapter(data.chapter);
                    setScenes(data.scenes || []);
                    if (data.totalChapters) setTotalChapters(data.totalChapters);
                    if (data.novelTitle) setNovelTitle(data.novelTitle);
                    setError("");

                    // Save to local reading history
                    try {
                        const historyStr = localStorage.getItem("rr_history") || "{}";
                        const history = JSON.parse(historyStr);
                        history[novelId] = {
                            id: novelId,
                            title: data.novelTitle || history[novelId]?.title || "Truyện Không Tên",
                            coverImage: history[novelId]?.coverImage || "",
                            author: history[novelId]?.author || "",
                            genres: history[novelId]?.genres || [],
                            lastReadChapterIdx: currentOrder,
                            lastReadChapterTitle: data.chapter.title || `Chương ${currentOrder + 1}`,
                            totalChapters: data.totalChapters || history[novelId]?.totalChapters || 0,
                            updatedAt: Date.now()
                        };
                        localStorage.setItem("rr_history", JSON.stringify(history));
                    } catch (e) {
                        console.error("Lỗi lưu lịch sử", e);
                    }
                } else {
                    setError(data.error || "Không tìm thấy chương.");
                }
            })
            .catch(() => setError("Lỗi kết nối."))
            .finally(() => setLoading(false));
    }, [novelId, chapterOrder, currentOrder]);

    // Sync store whenever the chapter changes
    useEffect(() => {
        if (novelId && novelTitle && totalChapters > 0) {
            useReaderPanel.getState().setNovelContext({
                novelId,
                novelTitle,
                totalChapters,
                chapterIndex: currentOrder,
            });
        }
    }, [novelId, novelTitle, totalChapters, currentOrder]);

    // Keep chapter title in sync
    useEffect(() => {
        if (chapter?.title) {
            useReaderPanel.getState().setChapterTitle(chapter.title);
        }
    }, [chapter?.title]);

    // Background preload of the next chapter and its starting audio
    useEffect(() => {
        if (loading || !chapter || totalChapters === 0 || currentOrder >= totalChapters - 1) {
            return;
        }

        const nextOrder = currentOrder + 1;

        // Skip if already preloaded
        if (nextChapterData && nextChapterData.chapter.order === nextOrder) {
            return;
        }

        const controller = new AbortController();

        (async () => {
            try {
                const res = await fetch(`/api/reading-room?action=chapter&id=${novelId}&idx=${nextOrder}`, {
                    signal: controller.signal
                });
                const data = await res.json();
                if (data.success && data.chapter && data.scenes) {
                    setNextChapterData({
                        chapter: data.chapter,
                        scenes: data.scenes
                    });

                    // Tokenize sentences to preload voice audio in the background
                    const displayScenes = (data.scenes || [])
                        .map((s: any) => cleanContent(s.content))
                        .filter((text: string) => text.length > 0);

                    const sentences = tokenizeSentences(displayScenes.join('\n\n'));
                    
                    // Preload the sentences through the player
                    const p = useReaderPanel.getState().getPlayerInstance();
                    if (p) {
                        p.preloadSentences(sentences);
                    }
                }
            } catch (err: any) {
                if (err.name !== "AbortError") {
                    console.error("Lỗi tải trước chương tiếp theo:", err);
                }
            }
        })();

        return () => {
            controller.abort();
        };
    }, [novelId, currentOrder, loading, chapter, totalChapters, nextChapterData]);

    if (loading && !chapter) {
        return (
            <div key="loading" className={`min-h-screen transition-colors duration-250 flex justify-center items-center animate-page-enter ${isDark ? "bg-[#0f0f12] text-[#f1f1f5]" : "bg-[#faf5ea] text-[#2c2c2e]"}`}>
                <div className={`w-full max-w-lg min-h-screen flex flex-col justify-center items-center gap-2 transition-colors duration-250 ${isDark ? "bg-[#131416] text-zinc-400" : "bg-[#fffbf4] text-[#f1f1f5] border-x border-zinc-200"}`}>
                    <Loader2Icon className="w-8 h-8 text-blue-500 animate-spin" />
                    <p className="text-xs">Đang tải nội dung chương...</p>
                </div>
            </div>
        );
    }

    if (error && !chapter) {
        return (
            <div key="error" className={`min-h-screen transition-colors duration-250 flex justify-center items-center animate-page-enter ${isDark ? "bg-[#0f0f12] text-[#f1f1f5]" : "bg-[#faf5ea] text-[#2c2c2e]"}`}>
                <div className={`w-full max-w-lg min-h-screen flex flex-col justify-center items-center px-6 text-center transition-colors duration-250 ${isDark ? "bg-[#131416] text-zinc-400" : "bg-[#fffbf4] text-[#f1f1f5] border-x border-zinc-200"}`}>
                    <h1 className="text-base font-bold mb-2">Lỗi Tải Chương</h1>
                    <p className="text-xs text-zinc-550 mb-6">{error}</p>
                    <Link href={`/reader/${novelId}`} className={`px-4 py-2 text-xs rounded-xl transition ${isDark ? "bg-zinc-800 hover:bg-zinc-700 text-white" : "bg-zinc-200 hover:bg-zinc-300 text-zinc-800"}`}>Quay lại Mục Lục</Link>
                </div>
            </div>
        );
    }

    const displayScenes = scenes
        .map(s => cleanContent(s.content))
        .filter(text => text.length > 0);

    const rawTitle = chapter?.title || "Không Tên";
    const rawTitleLower = rawTitle.toLowerCase();
    const hasExistingPrefix = rawTitleLower.startsWith("chương ") || rawTitleLower.startsWith("chương") || rawTitleLower.startsWith("đệ ") || rawTitleLower.startsWith("第") || rawTitleLower.match(/^[0-9]+:/);

    const displayTitle = (loading && !nextChapterData)
        ? "Đang tải chương mới..."
        : (hasExistingPrefix ? rawTitle : `Chương ${currentOrder + 1}: ${rawTitle}`);

    return (
        <div key={`chapter-${chapterOrder}`} className={`min-h-screen transition-colors duration-250 flex justify-center items-start overflow-x-hidden font-sans border-0 animate-page-enter ${isDark ? "bg-[#0f0f12] text-[#f1f1f5]" : "bg-[#faf5ea] text-[#2c2c2e]"
            }`}>
            {/* Dynamic Full Screen Content Container */}
            <div className="w-full min-h-screen relative flex flex-col pb-20 max-w-4xl mx-auto px-4 md:px-8">

                {/* Navbar top control panel */}
                <div className={`sticky top-0 z-40 backdrop-blur border-b py-3 flex items-center justify-between transition-colors ${isDark ? "bg-[#131416]/90 border-zinc-850" : "bg-[#fffbf4]/90 border-zinc-200"
                    }`}>
                    <Link href={`/reader/${novelId}`} className={`transition flex items-center text-xs font-bold ${isDark ? "text-zinc-400 hover:text-white" : "text-zinc-650 hover:text-black"
                        }`}>
                        <ArrowLeftIcon className="w-4 h-4 mr-2" />
                        <span>Mục lục</span>
                    </Link>

                    <div className="flex gap-2.5 items-center">
                        {/* Clear Toggle theme button */}
                        <button
                            onClick={toggleTheme}
                            className={`p-1.5 rounded-lg transition ${isDark ? "hover:bg-zinc-800 text-white" : "hover:bg-zinc-200 text-zinc-800"
                                }`}
                        >
                            {isDark ? <SunIcon className="w-4 h-4" /> : <MoonIcon className="w-4 h-4" />}
                        </button>

                        {/* Font size selectors */}
                        <div className={`flex gap-0.5 items-center p-0.5 rounded-lg border h-7 select-none text-[10px] ${isDark ? "bg-[#131416] border-[#38383e]" : "bg-[#fffbf4] border-zinc-200"
                            }`}>
                            <button className="h-6 w-6 text-xs font-bold hover:text-rose-500" onClick={() => updateFontSize(fontSize - 1)}>A-</button>
                            <span className={`w-5 text-center tabular-nums font-bold ${isDark ? "text-zinc-400" : "text-zinc-600"}`}>{fontSize}</span>
                            <button className="h-6 w-6 text-xs font-bold hover:text-rose-500" onClick={() => updateFontSize(fontSize + 1)}>A+</button>
                        </div>

                        {/* Font family selection controls */}
                        <select
                            value={fontFamily}
                            onChange={(e) => updateFontFamily(e.target.value)}
                            className={`px-2 py-1 text-[10px] font-bold rounded-lg border h-7 focus:outline-none transition ${isDark
                                ? "bg-[#131416] border-[#38383e] text-white"
                                : "bg-[#fffbf4] border-zinc-200 text-zinc-800"
                                }`}
                        >
                            <option value="font-serif">Serif (Playfair)</option>
                            <option value="font-bookerly">Bookerly</option>
                            <option value="font-literata">Literata</option>
                            <option value="font-lora">Lora</option>
                            <option value="font-palatino">Palatino</option>
                            <option value="font-times">Times New Roman</option>
                            <option value="font-sans">Sans-serif</option>
                            <option value="font-mono">Monospace</option>
                        </select>

                        {/* Đọc truyện button */}
                        <button
                            onClick={toggleReader}
                            className={`px-2.5 py-1 text-[10px] font-bold rounded-lg border h-7 flex items-center gap-1 focus:outline-none transition ${isReaderPlaying
                                    ? !isReaderOpen
                                        ? "bg-[#f97316]/15 border-orange-500 text-orange-600 dark:text-orange-400 animate-pulse"
                                        : "bg-zinc-700/35 border-zinc-650"
                                    : isDark
                                        ? "bg-[#131416] border-[#38383e] text-white hover:bg-zinc-800"
                                        : "bg-[#fffbf4] border-zinc-200 text-zinc-800 hover:bg-[#fffbf4]"
                                }`}
                            title="Đọc truyện (TTS)"
                        >
                            <Volume2Icon className="w-3.5 h-3.5" />
                            <span>Đọc truyện</span>
                        </button>
                    </div>
                </div>

                {/* Main scrollable reading paper */}
                <div className="flex-1 overflow-y-auto py-6">
                    <h1 className={`text-lg sm:text-xl font-extrabold text-center mb-8 leading-snug font-heading ${isDark ? "text-zinc-100" : "text-zinc-900"
                        }`}>
                        {displayTitle}
                    </h1>

                    {/* Prose body area */}
                    <div
                        className={`leading-relaxed whitespace-pre-wrap select-none p-1 transition-colors ${isDark ? "text-zinc-300" : "text-zinc-800"
                            } ${fontFamily}`}
                        style={{ fontSize: `${fontSize}px` }}
                    >
                        {loading ? (
                            <div className="flex flex-col gap-4 py-16 items-center justify-center animate-pulse">
                                <Loader2Icon className="w-8 h-8 text-blue-500 animate-spin" />
                                <p className="text-xs text-muted-foreground">Đang tải nội dung chương mới...</p>
                            </div>
                        ) : isReaderOpen ? (
                            <div className="prose prose-sm max-w-none dark:prose-invert">
                                <SentenceRenderer content={displayScenes.join('\n\n')} />
                            </div>
                        ) : (
                            displayScenes.map((text, idx) => (
                                <div key={idx} className="mb-6">
                                    {text.split('\n').map(l => l.trim()).filter(l => l.length > 0).map((line, i) => (
                                        <p key={i} className="mb-4 text-justify">
                                            <ObfuscatedText text={line} />
                                        </p>
                                    ))}
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Bottom floating button navigator */}
                <div className={`fixed bottom-0 left-0 right-0 h-16 border-t flex items-center justify-between px-6 z-40 max-w-lg mx-auto sm:rounded-t-2xl shadow-xl transition-colors ${isDark ? "bg-[#131416] border-zinc-850" : "bg-[#fffbf4] border-[#d2c2ad]/30"
                    }`}>
                    {currentOrder <= 0 ? (
                        <button
                            disabled
                            className={`px-4 py-2 disabled:opacity-30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${isDark ? "hover:bg-zinc-800 text-zinc-300" : "hover:bg-zinc-100 text-zinc-800"}`}
                        >
                            <ChevronLeftIcon className="w-4 h-4" />
                            <span>Chương trước</span>
                        </button>
                    ) : (
                        <Link
                            href={`/reader/${novelId}/${currentOrder - 1}`}
                            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${isDark ? "hover:bg-zinc-800 text-zinc-300" : "hover:bg-zinc-100 text-zinc-800"}`}
                        >
                            <ChevronLeftIcon className="w-4 h-4" />
                            <span>Chương trước</span>
                        </Link>
                    )}

                    {totalChapters > 0 && currentOrder >= totalChapters - 1 ? (
                        <button
                            disabled
                            className={`px-4 py-2 disabled:opacity-30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${isDark ? "hover:bg-zinc-800 text-zinc-300" : "hover:bg-zinc-100 text-zinc-800"}`}
                        >
                            <span>Sau</span>
                            <ChevronRightIcon className="w-4 h-4" />
                        </button>
                    ) : (
                        <Link
                            href={`/reader/${novelId}/${currentOrder + 1}`}
                            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${isDark ? "hover:bg-zinc-800 text-zinc-300" : "hover:bg-zinc-100 text-zinc-800"}`}
                        >
                            <span>Sau</span>
                            <ChevronRightIcon className="w-4 h-4" />
                        </Link>
                    )}
                </div>

            </div>
            <ReaderPanel />
        </div>
    );
}

// Loader wrapper shim
function Loader2Icon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
    );
}
