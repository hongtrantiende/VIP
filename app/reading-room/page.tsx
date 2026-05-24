"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    BookOpenIcon,
    CompassIcon,
    StarIcon,
    UserIcon,
    SlidersHorizontalIcon,
    SearchIcon,
    SettingsIcon,
    Trash2Icon,
    ChevronRightIcon,
    SparklesIcon,
    TrendingUpIcon,
    Volume2Icon,
    VolumeXIcon,
    BookMarkedIcon,
    Loader2Icon,
    SunIcon,
    MoonIcon,
    GlobeIcon
} from "lucide-react";
import { type Novel } from "@/lib/db";
import { useProfile } from "@/lib/hooks/use-profile";
import { toast } from "sonner";
import { sanitizeFilename, uploadCompressedInChunks } from "@/lib/utils";
import { extensionFetch, checkExtensionStatus } from "@/lib/scraper/extension-bridge";
import { nhDownloadStore } from "@/lib/nh-download-store";

const formatViews = (val?: number) => {
    if (!val) return "0";
    if (val >= 1000) {
        return (val / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    }
    return val.toString();
};

async function fetchNovelHubData(
    action: string,
    source: string,
    params: Record<string, any>,
    headers: Record<string, string> = {}
): Promise<any> {
    const queryParams = new URLSearchParams({
        action,
        source,
        ...Object.entries(params).reduce((acc, [k, v]) => ({ ...acc, [k]: String(v) }), {})
    });
    const url = `/api/novelhub?${queryParams.toString()}`;

    try {
        const res = await fetch(url, { headers });
        if (res.ok) {
            const data = await res.json();
            if (!data.error) {
                return data;
            }
        }
    } catch (e) {
        console.warn("[NovelHub Client] Direct fetch failed, trying extension fallback...", e);
    }

    const extStatus = await checkExtensionStatus();
    if (extStatus.available) {
        let targetUrl = "";
        let waitSelector = "";
        const slug = params.slug ? String(params.slug) : "";
        const page = params.page ? String(params.page) : "1";
        const q = params.q ? String(params.q) : "";
        const chapterSlug = params.chapterSlug ? String(params.chapterSlug) : "";

        if (source === "truyenfull") {
            const truyenFullBase = "https://truyenfull.today";
            if (action === "home") {
                targetUrl = truyenFullBase;
                waitSelector = ".index-intro";
            } else if (action === "search") {
                targetUrl = `${truyenFullBase}/tim-kiem/?tukhoa=${encodeURIComponent(q)}`;
                waitSelector = ".list-truyen";
            } else if (action === "story") {
                targetUrl = `${truyenFullBase}/${slug}/`;
                if (page !== "1") targetUrl += `trang-${page}/`;
                waitSelector = ".desc-text, .book";
            } else if (action === "chapter") {
                targetUrl = `${truyenFullBase}/${slug}/${chapterSlug}/`;
                waitSelector = "#chapter-c, .chapter-c, #chapter-content, .chapter-content";
            }
        } else if (source === "wikidich") {
            const wikiDichBase = "https://wikicv.net";
            if (action === "home") {
                targetUrl = wikiDichBase;
                waitSelector = ".book-item";
            } else if (action === "search") {
                targetUrl = `${wikiDichBase}/tim-kiem?q=${encodeURIComponent(q)}`;
                waitSelector = ".book-item";
            } else if (action === "story") {
                targetUrl = `${wikiDichBase}/truyen/${slug}`;
                waitSelector = ".book-desc-detail";
            } else if (action === "chapter") {
                targetUrl = `${wikiDichBase}/truyen/${slug}/${chapterSlug}`;
                waitSelector = "#bookContentBody";
            }
        } else if (source === "metruyenchu") {
            const mtcBase = "https://metruyenchu.co";
            if (action === "home") {
                targetUrl = mtcBase;
            } else if (action === "search") {
                targetUrl = mtcBase;
            } else if (action === "story") {
                targetUrl = `${mtcBase}/truyen/${slug}`;
            } else if (action === "chapter") {
                targetUrl = `${mtcBase}/truyen/${slug}/${chapterSlug}`;
            }
        }

        if (targetUrl) {
            try {
                const extRes = await extensionFetch(targetUrl, { waitSelector });
                const parseRes = await fetch("/api/novelhub", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...headers
                    },
                    body: JSON.stringify({
                        action,
                        source,
                        html: extRes.html,
                        ...params
                    })
                });

                if (parseRes.ok) {
                    const parsedData = await parseRes.json();
                    if (!parsedData.error) {
                        if (source === "wikidich" && action === "story" && parsedData.needIndexUrl) {
                            const indexExtRes = await extensionFetch(parsedData.needIndexUrl, { waitSelector: ".chapter-name" });
                            const indexParseRes = await fetch("/api/novelhub", {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json",
                                    ...headers
                                },
                                body: JSON.stringify({
                                    action: "wiki-index",
                                    source: "wikidich",
                                    html: indexExtRes.html
                                })
                            });
                            if (indexParseRes.ok) {
                                const indexParsed = await indexParseRes.json();
                                parsedData.chapters = indexParsed.chapters || [];
                            }
                        }
                        return parsedData;
                    }
                    throw new Error(parsedData.error);
                }
            } catch (err: any) {
                console.error("[NovelHub Client] Extension bypass failed:", err);
            }
        }
    }

    throw new Error("Không thể tải dữ liệu.");
}

async function uploadNovelToReadingRoom(
    source: string,
    slug: string,
    title: string,
    author: string,
    cover: string,
    description: string,
    downloadedChapters: Array<{ title: string; content: string }>
) {
    try {
        const novelId = `novelhub-${source}-${slug}`;
        
        // 1. Construct the exportData structure
        const chapters = downloadedChapters.map((ch, idx) => ({
            id: `${novelId}-ch-${idx}`,
            novelId,
            title: ch.title,
            originalTitle: ch.title,
            order: idx,
            createdAt: new Date(),
            updatedAt: new Date(),
        }));

        const scenes = downloadedChapters.map((ch, idx) => ({
            id: `${novelId}-sc-${idx}`,
            chapterId: `${novelId}-ch-${idx}`,
            novelId,
            title: ch.title,
            content: ch.content,
            order: idx,
            wordCount: ch.content.split(/\s+/).filter(Boolean).length,
            version: 1,
            versionType: "qt-convert" as any,
            isActive: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        }));

        const exportData = {
            novel: {
                id: novelId,
                title: title || "Không rõ",
                author: author || "Khuyết danh",
                description: description || "Chưa có mô tả...",
                coverImage: cover || "",
                genres: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            chapters,
            scenes,
            characters: [],
            notes: [],
            plotArcs: [],
            chapterPlans: [],
            characterArcs: [],
            writingSettings: null
        };

        // 2. Compress the JSON
        const jsonString = JSON.stringify(exportData);
        const { compress } = await import("@/lib/compression");
        const compressed = await compress(jsonString);

        // 3. Create metadata
        const metadata = {
            id: novelId,
            title: title || "Không rõ",
            author: author || "Khuyết danh",
            description: description || "Chưa có mô tả...",
            coverImage: cover || "",
            chapterCount: chapters.length,
            genres: [],
            wrongChaptersCount: 0,
        };

        // 4. Upload in chunks
        const uploadToastId = toast.loading(`Đang gửi truyện lên kho chung: "${title}"...`);
        
        await uploadCompressedInChunks(
            novelId,
            metadata,
            compressed,
            (percent) => {
                toast.loading(`Đang gửi truyện lên kho chung: "${title}" (${percent}%)`, { id: uploadToastId });
            }
        );
        
        toast.success(`Đã lưu "${title}" vào kho chung Phòng Đọc!`, { id: uploadToastId });
    } catch (err: any) {
        console.error("Lỗi khi tự động lưu lên kho chung:", err);
        toast.info(`Không thể lưu truyện vào kho chung: ${err.message || err}`);
    }
}

function ExploreSkeleton({ isDark }: { isDark: boolean }) {
    return (
        <div className="space-y-6 animate-page-enter">
            {/* Banner skeleton */}
            <div className={`relative w-full h-36 sm:h-48 md:h-56 rounded-2xl overflow-hidden border ${isDark ? "bg-zinc-900 border-zinc-800" : "bg-zinc-100 border-zinc-200"}`}>
                <div className="w-full h-full flex items-stretch gap-4 p-4">
                    <div className={`shrink-0 h-full aspect-[3/4] rounded-xl animate-pulse ${isDark ? "bg-zinc-850" : "bg-zinc-250"}`} />
                    <div className="flex-1 flex flex-col justify-center space-y-3">
                        <div className="flex gap-2">
                            <div className={`h-4 w-12 rounded animate-pulse ${isDark ? "bg-zinc-850" : "bg-zinc-250"}`} />
                            <div className={`h-4 w-10 rounded animate-pulse ${isDark ? "bg-zinc-850" : "bg-zinc-250"}`} />
                        </div>
                        <div className={`h-6 w-3/4 rounded animate-pulse ${isDark ? "bg-zinc-850" : "bg-zinc-250"}`} />
                        <div className={`h-4 w-1/2 rounded animate-pulse ${isDark ? "bg-zinc-850" : "bg-zinc-250"}`} />
                    </div>
                </div>
                {/* Shimmer overlay */}
                <div className="absolute inset-0 animate-shimmer pointer-events-none" />
            </div>

            {/* Mới cập nhật section */}
            <div className="space-y-3">
                <div className="flex justify-between items-center">
                    <div className={`h-5 w-32 rounded animate-pulse ${isDark ? "bg-zinc-850" : "bg-zinc-250"}`} />
                    <div className={`h-3 w-16 rounded animate-pulse ${isDark ? "bg-zinc-850" : "bg-zinc-250"}`} />
                </div>
                <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-none">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="shrink-0 w-28 flex flex-col gap-2 relative overflow-hidden">
                            <div className={`w-full aspect-3/4 rounded-xl animate-pulse ${isDark ? "bg-zinc-850" : "bg-zinc-250"}`} />
                            <div className={`h-3.5 w-full rounded animate-pulse ${isDark ? "bg-zinc-850" : "bg-zinc-250"}`} />
                            <div className={`h-3 w-2/3 rounded animate-pulse ${isDark ? "bg-zinc-850" : "bg-zinc-250"}`} />
                            <div className="absolute inset-0 animate-shimmer pointer-events-none" />
                        </div>
                    ))}
                </div>
            </div>

            {/* Truyện chọn lọc section */}
            <div className="space-y-3">
                <div className={`h-5 w-36 rounded animate-pulse ${isDark ? "bg-zinc-850" : "bg-zinc-250"}`} />
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="flex flex-col gap-2 relative overflow-hidden">
                            <div className={`w-full aspect-3/4 rounded-xl animate-pulse ${isDark ? "bg-zinc-850" : "bg-zinc-250"}`} />
                            <div className={`h-3 w-5/6 mx-auto rounded animate-pulse ${isDark ? "bg-zinc-850" : "bg-zinc-250"}`} />
                            <div className="absolute inset-0 animate-shimmer pointer-events-none" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function CatalogSkeleton({ isDark }: { isDark: boolean }) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 animate-page-enter">
            {Array.from({ length: 6 }).map((_, i) => (
                <div
                    key={i}
                    className={`flex gap-4 p-3 rounded-2xl border relative overflow-hidden ${isDark ? "bg-[#131416] border-zinc-800/30" : "bg-[#fffbf4] border-zinc-200"}`}
                >
                    {/* Cover shape */}
                    <div className={`shrink-0 w-16 aspect-3/4 rounded-xl animate-pulse ${isDark ? "bg-zinc-850" : "bg-zinc-250"}`} />

                    {/* Details shape */}
                    <div className="flex-1 flex flex-col justify-between py-1">
                        <div className="space-y-2">
                            {/* Pill tag */}
                            <div className={`h-4.5 w-16 rounded animate-pulse ${isDark ? "bg-zinc-850" : "bg-zinc-250"}`} />
                            {/* Title */}
                            <div className={`h-4.5 w-5/6 rounded animate-pulse ${isDark ? "bg-zinc-850" : "bg-zinc-250"}`} />
                        </div>
                        {/* Meta row */}
                        <div className="flex justify-between items-center">
                            <div className={`h-3 w-20 rounded animate-pulse ${isDark ? "bg-zinc-850" : "bg-zinc-250"}`} />
                            <div className="flex gap-2">
                                <div className={`h-3.5 w-10 rounded animate-pulse ${isDark ? "bg-zinc-850" : "bg-zinc-250"}`} />
                                <div className={`h-3.5 w-12 rounded animate-pulse ${isDark ? "bg-zinc-850" : "bg-zinc-250"}`} />
                            </div>
                        </div>
                    </div>
                    {/* Shimmer effect */}
                    <div className="absolute inset-0 animate-shimmer pointer-events-none" />
                </div>
            ))}
        </div>
    );
}

export type NovelHubView = "home" | "search" | "story" | "chapter" | "list";

export interface NovelHubState {
    view: NovelHubView;
    storySlug?: string;
    chapterSlug?: string;
    listType?: string;
    searchQuery?: string;
    page?: number;
    storyTitle?: string;
    storyCover?: string;
    storyAuthor?: string;
}

export default function StandaloneReadingRoomApp() {
    const router = useRouter();
    const { profile, loading: profileLoading, isVip } = useProfile();
    const [novels, setNovels] = useState<Novel[]>([]);
    const [loading, setLoading] = useState(true);

    // Redirect non-VIP/Admin users
    useEffect(() => {
        if (!profileLoading && !isVip) {
            toast.error("Phòng đọc dành riêng cho thành viên VIP!");
            router.push("/dashboard");
        }
    }, [profileLoading, isVip, router]);

    // UI states
    const [activeTab, setActiveTab] = useState<"library" | "explore" | "catalog" | "account" | "novelhub">("explore");
    const [librarySubTab, setLibrarySubTab] = useState<"history" | "bookmarks">("history");
    const [catalogSourceTab, setCatalogSourceTab] = useState<"all" | "truyenfull" | "metruyenchu" | "wikidich">("all");
    const [soundMuted, setSoundMuted] = useState(false);

    // NovelHub states & navigation
    const [nhState, setNhState] = useState<NovelHubState>({ view: "home" });
    const [nhHistory, setNhHistory] = useState<NovelHubState[]>([]);
    const [nhSource, setNhSource] = useState<string>("truyenfull");
    const [nhSubTab, setNhSubTab] = useState<"home" | "new_list">("home");
    const [nhQuery, setNhQuery] = useState("");
    const [nhStoryCache, setNhStoryCache] = useState<Record<string, any>>({});

    const handleNhSearch = (e: React.FormEvent) => {
        e.preventDefault();
        if (nhQuery.trim()) {
            navigateNh({ view: "search", searchQuery: nhQuery.trim() });
        }
    };

    useEffect(() => {
        const saved = localStorage.getItem("nh_source");
        if (saved) {
            setNhSource(saved);
        }
    }, []);

    const changeNhSource = (src: string) => {
        setNhSource(src);
        localStorage.setItem("nh_source", src);
        setNhSubTab("home");
        setNhState({ view: "home" });
        setNhHistory([]);
    };

    const navigateNh = (newState: NovelHubState) => {
        setNhHistory((prev) => [...prev, nhState]);
        setNhState(newState);
    };

    const navigateNhBack = () => {
        if (nhHistory.length > 0) {
            const prev = nhHistory[nhHistory.length - 1];
            setNhHistory((prevList) => prevList.slice(0, -1));
            setNhState(prev);
        } else {
            setNhState({ view: "home" });
        }
    };

    const handleLibraryItemClick = (id: string, e: React.MouseEvent) => {
        if (id.startsWith("novelhub-")) {
            e.preventDefault();
            const parts = id.split("-");
            const source = parts[1];
            const slug = parts.slice(2).join("-");
            
            let chapterSlug = "";
            let coverImage = "";
            let author = "";
            let title = "";
            try {
                const historyObj = JSON.parse(localStorage.getItem("rr_history") || "{}");
                const item = historyObj[id];
                if (item) {
                    chapterSlug = item.lastReadChapterSlug || "";
                    coverImage = item.coverImage || "";
                    author = item.author || "";
                    title = item.title || "";
                }
            } catch (err) {}

            setNhSource(source);
            localStorage.setItem("nh_source", source);
            setNhSubTab("home");
            setNhHistory([]);
            
            if (chapterSlug) {
                setNhState({
                    view: "chapter",
                    storySlug: slug,
                    chapterSlug: chapterSlug,
                    storyTitle: title,
                    storyCover: coverImage,
                    storyAuthor: author
                });
            } else {
                setNhState({ view: "story", storySlug: slug, page: 1 });
            }
            setActiveTab("novelhub");
        }
    };

    // Theme state
    const [theme, setTheme] = useState<"light" | "dark">("dark");

    // Sorting configs modal
    const [showLibrarySort, setShowLibrarySort] = useState(false);
    const [librarySortBy, setLibrarySortBy] = useState<"recent" | "new_chap" | "name">("recent");
    const [wikiDichCookie, setWikiDichCookie] = useState("");

    // Dynamic state logs
    const [historyList, setHistoryList] = useState<any[]>([]);
    const [bookmarksList, setBookmarksList] = useState<any[]>([]);

    // States for bulk downloading from bookmarks
    const [selectedBookmarkIds, setSelectedBookmarkIds] = useState<string[]>([]);
    const [bulkStatus, setBulkStatus] = useState<"idle" | "downloading" | "paused">("idle");
    const [bulkFormat, setBulkFormat] = useState<"txt" | "epub" | null>(null);
    const [bulkProgress, setBulkProgress] = useState(0);
    const [bulkCurrentBookProgress, setBulkCurrentBookProgress] = useState("");
    const [bulkSavedState, setBulkSavedState] = useState<any>(null);
    const bulkAbortedRef = useRef<boolean>(false);

    // Scan for any paused bulk downloads on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem("rr_bulk_download_state");
            if (saved) {
                const parsed = JSON.parse(saved);
                setBulkSavedState(parsed);
                setBulkStatus("paused");
                setBulkFormat(parsed.format);
                const progress = Math.round((parsed.completedChaptersCount / parsed.totalChaptersCount) * 100) || 0;
                setBulkProgress(progress);
                setBulkCurrentBookProgress(`Đang tạm dừng: ${parsed.queue[parsed.currentBookIndex]?.title || "Truyện"}`);
            }
        } catch (e) {
            console.error("Failed to load bulk download state", e);
        }
    }, []);

    // Load WikiDich search bypass cookie
    useEffect(() => {
        const savedCookie = localStorage.getItem("nh_wikidich_cookie") || "";
        setWikiDichCookie(savedCookie);
    }, []);

    const handleSaveWikiDichCookie = (val: string) => {
        setWikiDichCookie(val);
        localStorage.setItem("nh_wikidich_cookie", val.trim());
    };

    // Catalog filtering
    const [showFilters, setShowFilters] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [appliedFilters, setAppliedFilters] = useState({
        sortBy: "Mới lên chương",
        type: "", // Chuyển ngữ | Sáng tác
        gender: "", // Truyện nam | Truyện nữ
        status: "", // Còn tiếp | Hoàn thành | Tạm dừng
        chaptersRange: "", // < 300 | 300-600 | 600-1000 | > 1000
        publishDate: "", // Trong 1 tuần | Trong 1 tháng ...
        genre: "", // Tiên Hiệp | Huyền Huyễn...
        characterTrait: "",
        worldBackground: "",
        sectFlow: ""
    });

    // Temp filters for sheet selection
    const [tempFilters, setTempFilters] = useState({ ...appliedFilters });

    // Infinite scroll visibility paging
    const [visibleCount, setVisibleCount] = useState(14);

    // Admin state variables for original batch classification
    const [isAdminOpen, setIsAdminOpen] = useState(false);
    const [isClassifying, setIsClassifying] = useState(false);
    const [classifyProgress, setClassifyProgress] = useState("");

    // State restoration flag
    const [isRestored, setIsRestored] = useState(false);

    // Load theme from localStorage on mount
    useEffect(() => {
        const savedTheme = localStorage.getItem("rr_theme");
        if (savedTheme === "light" || savedTheme === "dark") {
            setTheme(savedTheme);
        }
    }, []);

    // State restoration and scroll recovery
    useEffect(() => {
        if (loading) return;
        if (isRestored) return;

        const savedTab = sessionStorage.getItem("rr_active_tab");
        const savedQuery = sessionStorage.getItem("rr_search_query");
        const savedFilters = sessionStorage.getItem("rr_applied_filters");
        const savedCount = sessionStorage.getItem("rr_visible_count");
        const savedScroll = sessionStorage.getItem("rr_scroll_y");

        if (savedTab) {
            setActiveTab(savedTab as any);
        }
        if (savedQuery) {
            setSearchQuery(savedQuery);
        }
        if (savedFilters) {
            try {
                const parsed = JSON.parse(savedFilters);
                setAppliedFilters(parsed);
                setTempFilters(parsed);
            } catch (e) { }
        }
        if (savedCount) {
            setVisibleCount(Number(savedCount));
        }

        setIsRestored(true);

        if (savedScroll) {
            const scrollY = Number(savedScroll);
            let attempts = 0;
            const scrollInterval = setInterval(() => {
                attempts++;
                window.scrollTo({
                    top: scrollY,
                    behavior: "instant" as any
                });
                if (Math.abs(window.scrollY - scrollY) < 3 || attempts >= 20) {
                    clearInterval(scrollInterval);
                }
            }, 100);
        }
    }, [loading, isRestored]);

    // Save tab to sessionStorage
    useEffect(() => {
        if (!isRestored) return;
        sessionStorage.setItem("rr_active_tab", activeTab);
    }, [activeTab, isRestored]);

    // Save search query to sessionStorage
    useEffect(() => {
        if (!isRestored) return;
        sessionStorage.setItem("rr_search_query", searchQuery);
    }, [searchQuery, isRestored]);

    // Save applied filters to sessionStorage
    useEffect(() => {
        if (!isRestored) return;
        sessionStorage.setItem("rr_applied_filters", JSON.stringify(appliedFilters));
    }, [appliedFilters, isRestored]);

    // Save visible count to sessionStorage
    useEffect(() => {
        if (!isRestored) return;
        sessionStorage.setItem("rr_visible_count", visibleCount.toString());
    }, [visibleCount, isRestored]);

    // Track scroll position on window scroll
    useEffect(() => {
        if (!isRestored) return;
        const handleScroll = () => {
            sessionStorage.setItem("rr_scroll_y", window.scrollY.toString());
        };
        window.addEventListener("scroll", handleScroll, { passive: true });
        return () => window.removeEventListener("scroll", handleScroll);
    }, [isRestored]);


    // Scroll lock on filters open
    useEffect(() => {
        if (showFilters) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "";
        }
        return () => {
            document.body.style.overflow = "";
        };
    }, [showFilters]);

    const toggleTheme = () => {
        const nextTheme = theme === "dark" ? "light" : "dark";
        setTheme(nextTheme);
        localStorage.setItem("rr_theme", nextTheme);
        toast.info(nextTheme === "dark" ? "Đã chuyển sang chế độ tối" : "Đã chuyển sang chế độ sáng");
    };

    // Load main catalogs
    useEffect(() => {
        setLoading(true);
        fetch("/api/reading-room?action=list")
            .then((res) => res.json())
            .then((data) => {
                if (data.success) {
                    setNovels(data.novels || []);
                }
            })
            .catch(() => toast.error("Không thể tải danh sách truyện."))
            .finally(() => setLoading(false));
    }, []);

    // Sync library storage
    const reloadLibrary = () => {
        try {
            const historyObj = JSON.parse(localStorage.getItem("rr_history") || "{}");
            const historyArray = Object.values(historyObj).sort((a: any, b: any) => b.updatedAt - a.updatedAt);
            setHistoryList(historyArray);

            const bookmarksObj = JSON.parse(localStorage.getItem("rr_bookmarks") || "{}");
            const bookmarksArray = Object.values(bookmarksObj).sort((a: any, b: any) => b.bookmarkedAt - a.bookmarkedAt);
            setBookmarksList(bookmarksArray);
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        reloadLibrary();
    }, [activeTab]);

    const handleClearHistoryItem = (id: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        try {
            const historyObj = JSON.parse(localStorage.getItem("rr_history") || "{}");
            delete historyObj[id];
            localStorage.setItem("rr_history", JSON.stringify(historyObj));
            reloadLibrary();
            toast.success("Đã xoá bộ truyện khỏi lịch sử đọc.");
        } catch (e) { }
    };

    const handleClearBookmarkItem = (id: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        try {
            const bookmarksObj = JSON.parse(localStorage.getItem("rr_bookmarks") || "{}");
            delete bookmarksObj[id];
            localStorage.setItem("rr_bookmarks", JSON.stringify(bookmarksObj));
            reloadLibrary();
            toast.success("Đã xóa khỏi danh sách đánh dấu.");
        } catch (e) { }
    };

    const fetchChaptersForBulk = async (slug: string, source: string, bookObj?: any) => {
        try {
            const data = await fetchNovelHubData("story", source, { slug, page: 1 });
            if (!data || data.error) {
                throw new Error(data?.error || "Không thể tải chi tiết truyện.");
            }

            if (bookObj && data.desc) {
                bookObj.desc = data.desc;
            }

            const allChapters: any[] = [...(data.chapters || [])];
            if (data.totalPages > 1) {
                const fetchPromises = [];
                for (let p = 2; p <= data.totalPages; p++) {
                    fetchPromises.push(
                        fetchNovelHubData("story", source, { slug, page: p })
                            .then((d) => d.chapters || [])
                            .catch(() => [])
                    );
                }
                const results = await Promise.all(fetchPromises);
                results.forEach((chaps) => {
                    allChapters.push(...chaps);
                });
            }
            return allChapters;
        } catch (e: any) {
            console.error("fetchChaptersForBulk error", e);
            throw e;
        }
    };

    const runBulkDownload = async (state: any) => {
        setBulkStatus("downloading");
        setBulkFormat(state.format);
        bulkAbortedRef.current = false;
        
        let {
            queue,
            currentBookIndex,
            currentBookDownloadedChapters,
            currentBookChaptersToDownload,
            currentBookChapterIndex,
            totalChaptersCount,
            completedChaptersCount,
            consecutiveErrors
        } = state;

        const storageKey = "rr_bulk_download_state";

        const saveState = (cIdx: number, downloaded: any[], chaptersList: any[], chapIdx: number, compCount: number, errCount: number) => {
            const updated = {
                format: state.format,
                queue,
                currentBookIndex: cIdx,
                currentBookDownloadedChapters: downloaded,
                currentBookChaptersToDownload: chaptersList,
                currentBookChapterIndex: chapIdx,
                totalChaptersCount,
                completedChaptersCount: compCount,
                consecutiveErrors: errCount
            };
            localStorage.setItem(storageKey, JSON.stringify(updated));
            setBulkSavedState(updated);
            const progress = Math.round((compCount / totalChaptersCount) * 100) || 0;
            setBulkProgress(progress);
        };

        try {
            for (let b = currentBookIndex; b < queue.length; b++) {
                const book = queue[b];
                setBulkCurrentBookProgress(`Chuẩn bị mục lục: "${book.title}"...`);

                // Check abort flag
                if (bulkAbortedRef.current) {
                    saveState(b, currentBookDownloadedChapters, currentBookChaptersToDownload, currentBookChapterIndex, completedChaptersCount, consecutiveErrors);
                    setBulkStatus("paused");
                    return;
                }

                if (currentBookChaptersToDownload.length === 0) {
                    try {
                        const allChapters = await fetchChaptersForBulk(book.slug, book.source, book);
                        if (allChapters.length === 0) {
                            throw new Error("Mục lục trống.");
                        }

                        totalChaptersCount = totalChaptersCount - (book.totalChapters || 100) + allChapters.length;
                        if (totalChaptersCount <= 0) totalChaptersCount = allChapters.length;

                        currentBookChapterIndex = 0;
                        currentBookDownloadedChapters = [];
                        currentBookChaptersToDownload = allChapters;
                        saveState(b, currentBookDownloadedChapters, currentBookChaptersToDownload, 0, completedChaptersCount, consecutiveErrors);
                    } catch (e: any) {
                        toast.error(`Lỗi tải truyện "${book.title}": ${e.message}`);
                        completedChaptersCount += (book.totalChapters || 100);
                        currentBookIndex = b + 1;
                        currentBookChaptersToDownload = [];
                        currentBookDownloadedChapters = [];
                        saveState(currentBookIndex, [], [], 0, completedChaptersCount, 0);
                        continue;
                    }
                }

                for (let c = currentBookChapterIndex; c < currentBookChaptersToDownload.length; c++) {
                    if (bulkAbortedRef.current) {
                        saveState(b, currentBookDownloadedChapters, currentBookChaptersToDownload, c, completedChaptersCount, consecutiveErrors);
                        setBulkStatus("paused");
                        return;
                    }

                    const chap = currentBookChaptersToDownload[c];
                    setBulkCurrentBookProgress(`[${b + 1}/${queue.length}] ${book.title} - ${chap.title}`);

                    let success = false;
                    let retries = 3;
                    let dData: any = null;

                    const getRefererUrl = (src: string, bSlug: string, cSlug?: string) => {
                        if (src === "truyenfull") {
                            return cSlug ? `https://truyenfull.today/${bSlug}/${cSlug}/` : `https://truyenfull.today/${bSlug}/`;
                        } else if (src === "metruyenchu") {
                            return cSlug ? `https://metruyenchu.co/truyen/${bSlug}/${cSlug}` : `https://metruyenchu.co/truyen/${bSlug}`;
                        } else {
                            return cSlug ? `https://wikicv.net/truyen/${bSlug}/${cSlug}` : `https://wikicv.net/truyen/${bSlug}`;
                        }
                    };

                    const refererUrl = c === 0
                        ? getRefererUrl(book.source, book.slug)
                        : getRefererUrl(book.source, book.slug, currentBookChaptersToDownload[c - 1].slug);

                    while (!success && retries > 0) {
                        try {
                            dData = await fetchNovelHubData("chapter", book.source, {
                                slug: book.slug,
                                chapterSlug: chap.slug,
                                referer: refererUrl
                            });
                            if (dData && dData.content && !dData.content.includes("Không thể tải nội dung")) {
                                success = true;
                            } else {
                                retries--;
                                if (retries > 0) await new Promise((r) => setTimeout(r, 3000));
                            }
                        } catch (e) {
                            retries--;
                            if (retries > 0) await new Promise((r) => setTimeout(r, 3000));
                        }
                    }

                    if (success && dData) {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(dData.content, "text/html");
                        const pElements = doc.querySelectorAll("p, div");
                        let textContent = "";
                        if (pElements.length > 0) {
                            const paragraphs: string[] = [];
                            pElements.forEach(el => {
                                const txt = el.textContent?.trim();
                                if (txt) paragraphs.push(txt);
                            });
                            textContent = paragraphs.join("\n\n");
                        } else {
                            textContent = (doc.body.textContent || "").trim().replace(/\n\s*\n/g, "\n\n");
                        }
                        currentBookDownloadedChapters.push({ title: chap.title, content: textContent });
                        consecutiveErrors = 0; // Reset consecutive errors
                    } else {
                        consecutiveErrors++;
                        if (consecutiveErrors >= 3) {
                            saveState(b, currentBookDownloadedChapters, currentBookChaptersToDownload, c, completedChaptersCount, consecutiveErrors);
                            setBulkStatus("paused");
                            // Required alert
                            alert(`[LỖI TẢI HÀNG LOẠT] Tải thất bại liên tục quá 3 lần!\n\nVui lòng TẮT và BẬT LẠI ứng dụng Cloudflare 1.1.1.1 (WARP) hoặc VPN để đổi IP mới, sau đó nhấn "Tiếp tục".`);
                            toast.error("Quá 3 lượt tải lỗi. Đã tạm dừng. Vui lòng bật lại 1.1.1.1 rồi tiếp tục.");
                            return;
                        }
                        currentBookDownloadedChapters.push({ title: chap.title, content: "[Lỗi: Không tải được nội dung chương này]" });
                    }

                    completedChaptersCount++;
                    saveState(b, currentBookDownloadedChapters, currentBookChaptersToDownload, c + 1, completedChaptersCount, consecutiveErrors);

                    const randomDelay = Math.floor(Math.random() * 1500) + 1500;
                    await new Promise((r) => setTimeout(r, randomDelay));
                }

                // Download book
                const format = state.format;
                if (format === "txt") {
                    let txtContent = `${book.title}\n`;
                    txtContent += `Tác giả: ${book.author || "Khuyết danh"}\n`;
                    txtContent += `Nguồn ngoài: ${book.source.toUpperCase()}\n\n`;
                    txtContent += `=========================================\n\n`;

                    currentBookDownloadedChapters.forEach((ch: any) => {
                        txtContent += `${ch.title}\n\n`;
                        txtContent += `${ch.content}\n\n`;
                        txtContent += `-----------------------------------------\n\n`;
                    });

                    const blob = new Blob([txtContent], { type: "text/plain;charset=utf-8" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${sanitizeFilename(book.title)}.txt`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } else {
                    const cleanChapters = currentBookDownloadedChapters.map((ch: any) => ({
                        title: ch.title,
                        content: ch.content.replace(/\n/g, "<br/>")
                    }));

                    let coverImageBase64: string | null = null;
                    if (book.cover) {
                        try {
                            const imgRes = await fetch(`/api/proxy-image?url=${encodeURIComponent(book.cover)}`);
                            if (imgRes.ok) {
                                const blob = await imgRes.blob();
                                const reader = new FileReader();
                                const base64Promise = new Promise<string>((resolve, reject) => {
                                    reader.onloadend = () => resolve(reader.result as string);
                                    reader.onerror = reject;
                                });
                                reader.readAsDataURL(blob);
                                coverImageBase64 = await base64Promise;
                            }
                        } catch (e) {
                            console.warn("Failed to fetch cover image base64", e);
                        }
                    }

                    const { generateEpub } = await import("@/lib/epub-generator");
                    const epubBlob = await generateEpub(
                        book.title,
                        book.author || "Khuyết danh",
                        coverImageBase64,
                        cleanChapters
                    );

                    const url = URL.createObjectURL(epubBlob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${sanitizeFilename(book.title)}.epub`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }

                toast.success(`Đã tải xong bộ: "${book.title}"!`);

                uploadNovelToReadingRoom(
                    book.source,
                    book.slug,
                    book.title,
                    book.author,
                    book.cover,
                    book.desc || book.description || "",
                    [...currentBookDownloadedChapters]
                ).catch((err) => {
                    console.error("Lỗi khi tự động tải lên kho chung (bulk):", err);
                });

                currentBookIndex = b + 1;
                currentBookChaptersToDownload = [];
                currentBookDownloadedChapters = [];
                saveState(currentBookIndex, [], [], 0, completedChaptersCount, 0);
            }

            localStorage.removeItem(storageKey);
            setBulkSavedState(null);
            setBulkStatus("idle");
            setBulkFormat(null);
            setBulkProgress(100);
            setBulkCurrentBookProgress("Đã tải xong toàn bộ truyện đã chọn!");
            setSelectedBookmarkIds([]);
            toast.success("Tải hàng loạt thành công!");
        } catch (e: any) {
            console.error("Bulk download error", e);
            toast.error(`Lỗi tải hàng loạt: ${e.message}`);
            setBulkStatus("paused");
        }
    };

    const startBulkDownload = async (format: "txt" | "epub") => {
        if (selectedBookmarkIds.length === 0) return;

        const queue = selectedBookmarkIds.map(id => {
            const parts = id.split("-");
            const source = parts[1];
            const slug = parts.slice(2).join("-");
            const book = bookmarksList.find(b => b.id === id);
            return {
                id,
                title: book?.title || "Truyện nguồn ngoài",
                author: book?.author || "Khuyết danh",
                cover: book?.coverImage || "",
                totalChapters: book?.totalChapters || 100,
                source,
                slug
            };
        });

        const totalChapters = queue.reduce((sum, b) => sum + (b.totalChapters || 100), 0);

        const initialState = {
            format,
            queue,
            currentBookIndex: 0,
            currentBookDownloadedChapters: [],
            currentBookChaptersToDownload: [],
            currentBookChapterIndex: 0,
            totalChaptersCount: totalChapters,
            completedChaptersCount: 0,
            consecutiveErrors: 0
        };

        setBulkSavedState(initialState);
        await runBulkDownload(initialState);
    };

    const pauseBulkDownload = () => {
        bulkAbortedRef.current = true;
        toast.info("Đang tạm dừng tải hàng loạt... Đang đợi tải xong chương hiện tại.");
    };

    const resumeBulkDownload = async () => {
        if (bulkSavedState) {
            await runBulkDownload(bulkSavedState);
        }
    };

    const cancelBulkDownload = () => {
        localStorage.removeItem("rr_bulk_download_state");
        setBulkSavedState(null);
        setBulkStatus("idle");
        setBulkFormat(null);
        setBulkProgress(0);
        setBulkCurrentBookProgress("");
        setSelectedBookmarkIds([]);
        toast.success("Đã hủy lượt tải hàng loạt.");
    };

    // Filter logic on catalog
    const filteredCatalogNovels = useMemo(() => {
        let list = [...novels];

        const getNovelSource = (id: string) => {
            const lower = id.toLowerCase();
            if (lower.includes("metruyenchu") || lower.includes("mtc")) return "metruyenchu";
            if (lower.includes("wikidich") || lower.includes("wikicv")) return "wikidich";
            if (lower.includes("truyenfull")) return "truyenfull";
            return "other";
        };

        // Filter by source tab
        if (catalogSourceTab !== "all") {
            list = list.filter(n => getNovelSource(n.id) === catalogSourceTab);
        }

        // Search query
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            list = list.filter(n => n.title.toLowerCase().includes(q) || n.author?.toLowerCase().includes(q));
        }

        // Apply filters state
        if (appliedFilters.type) {
            const fType = appliedFilters.type.toLowerCase();
            list = list.filter(n => {
                const typeProp = String((n as any).type || "").toLowerCase();
                if (typeProp === fType) return true;
                const hasInGenres = n.genres?.some(g => g.toLowerCase().includes(fType));
                const hasInTags = n.tags?.some(t => t.toLowerCase().includes(fType));
                return hasInGenres || hasInTags;
            });
        }
        if (appliedFilters.gender) {
            const fGender = appliedFilters.gender.toLowerCase();
            const genderBrief = fGender.includes("nam") ? "nam" : "nữ";
            list = list.filter(n => {
                const genderProp = String((n as any).gender || "").toLowerCase();
                if (genderProp === fGender || (genderProp && genderProp.includes(genderBrief))) return true;
                const hasInGenres = n.genres?.some(g => {
                    const lg = g.toLowerCase();
                    return lg.includes(fGender) || lg === genderBrief || lg.includes(genderBrief + " sinh");
                });
                const hasInTags = n.tags?.some(t => {
                    const lt = t.toLowerCase();
                    return lt.includes(fGender) || lt === genderBrief || lt.includes(genderBrief + " sinh");
                });
                return hasInGenres || hasInTags;
            });
        }
        if (appliedFilters.status) {
            const fStatus = appliedFilters.status.toLowerCase();
            const statusMap: Record<string, string[]> = {
                "còn tiếp": ["còn tiếp", "đang ra", "đang tiến hành", "ongoing"],
                "hoàn thành": ["hoàn thành", "đã hoàn thành", "trọn bộ", "completed", "full"],
                "tạm dừng": ["tạm dừng", "tạm ngưng", "paused"]
            };
            const equivalentValues = statusMap[fStatus] || [fStatus];
            list = list.filter(n => {
                const statusProp = String((n as any).status || "").toLowerCase();
                if (statusProp === fStatus || equivalentValues.includes(statusProp)) return true;
                const hasInGenres = n.genres?.some(g => {
                    const lg = g.toLowerCase();
                    return equivalentValues.some(v => lg.includes(v));
                });
                const hasInTags = n.tags?.some(t => {
                    const lt = t.toLowerCase();
                    return equivalentValues.some(v => lt.includes(v));
                });
                return hasInGenres || hasInTags;
            });
        }
        if (appliedFilters.chaptersRange) {
            list = list.filter(n => {
                const count = n.totalChapters || 0;
                if (appliedFilters.chaptersRange === "< 300") {
                    return count < 300;
                } else if (appliedFilters.chaptersRange === "300-600") {
                    return count >= 300 && count <= 600;
                } else if (appliedFilters.chaptersRange === "600-1000") {
                    return count >= 600 && count <= 1000;
                } else if (appliedFilters.chaptersRange === "> 1000") {
                    return count > 1000;
                }
                return true;
            });
        }
        if (appliedFilters.genre) {
            const fGenre = appliedFilters.genre.toLowerCase();
            list = list.filter(n =>
                n.genres?.some(g => g.toLowerCase() === fGenre) ||
                n.tags?.some(t => t.toLowerCase() === fGenre)
            );
        }
        if (appliedFilters.characterTrait) {
            const fTrait = appliedFilters.characterTrait.toLowerCase();
            list = list.filter(n =>
                String((n as any).characterTrait || "").toLowerCase() === fTrait ||
                n.genres?.some(g => g.toLowerCase() === fTrait) ||
                n.tags?.some(t => t.toLowerCase() === fTrait)
            );
        }
        if (appliedFilters.worldBackground) {
            const fBg = appliedFilters.worldBackground.toLowerCase();
            list = list.filter(n =>
                String((n as any).worldBackground || "").toLowerCase() === fBg ||
                n.genres?.some(g => g.toLowerCase() === fBg) ||
                n.tags?.some(t => t.toLowerCase() === fBg)
            );
        }
        if (appliedFilters.sectFlow) {
            const fFlow = appliedFilters.sectFlow.toLowerCase();
            list = list.filter(n =>
                String((n as any).sectFlow || "").toLowerCase() === fFlow ||
                n.genres?.some(g => g.toLowerCase() === fFlow) ||
                n.tags?.some(t => t.toLowerCase() === fFlow)
            );
        }

        // Sort options mapping
        const sortOpt = appliedFilters.sortBy;
        if (sortOpt === "Mới lên chương" || sortOpt === "Mới đăng") {
            list.sort((a, b) => {
                const timeA = typeof a.updatedAt === 'number' ? a.updatedAt : new Date((a as any).updatedAt || (a as any).createdAt || 0).getTime();
                const timeB = typeof b.updatedAt === 'number' ? b.updatedAt : new Date((b as any).updatedAt || (b as any).createdAt || 0).getTime();
                return timeB - timeA;
            });
        } else if (sortOpt === "Tên truyện") {
            list.sort((a, b) => a.title.localeCompare(b.title));
        } else if (sortOpt === "Số chương") {
            list.sort((a, b) => (b.totalChapters || 0) - (a.totalChapters || 0));
        } else {
            // Priority default sort
            list.sort((a, b) => (b.totalChapters || 0) - (a.totalChapters || 0));
        }

        return list;
    }, [novels, searchQuery, appliedFilters, catalogSourceTab]);

    // Reset visible count when filters, source tab, or search query changes
    useEffect(() => {
        if (!isRestored) return;
        setVisibleCount(14);
        sessionStorage.setItem("rr_scroll_y", "0");
    }, [appliedFilters, searchQuery, isRestored, catalogSourceTab]);


    // Infinite scroll detection on window scroll
    useEffect(() => {
        const handleScroll = () => {
            if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 300) {
                setVisibleCount((prev) => Math.min(prev + 14, filteredCatalogNovels.length));
            }
        };
        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
    }, [filteredCatalogNovels.length]);

    // Slider highlights for Explore
    const exploreBannerNovels = useMemo(() => {
        return novels.slice(0, 3);
    }, [novels]);

    // Admin/Uploader checks
    const isAdmin = true; // profile && ["nthanhnam2005@gmail.com", "thanhxnam2005@gmail.com"].includes(profile.email?.toLowerCase());

    const handleRunBatchClassification = async (all: boolean = false) => {
        if (isClassifying) return;
        setIsClassifying(true);
        setClassifyProgress("Bắt đầu phân loại hàng loạt...\nPreparing novels list...");

        try {
            const targets = [...unclassifiedNovels];
            if (targets.length === 0) {
                setClassifyProgress("Tất cả các bộ truyện đều đã được gán thể loại.");
                toast.success("Tất cả các bộ truyện đều đã được gán thể loại.");
                setIsClassifying(false);
                return;
            }

            setClassifyProgress(`Cần xử lý: ${targets.length} bộ truyện.\n`);
            let successCount = 0;
            const limit = all ? targets.length : Math.min(targets.length, 10);

            for (let i = 0; i < limit; i++) {
                const novel = targets[i];
                const currentLog = `[${i + 1}/${limit}] Đang xử lý: "${novel.title}"...\n`;
                setClassifyProgress(prev => currentLog + prev);

                try {
                    const res = await fetch(`/api/reading-room?action=batch_classify&novelId=${novel.id}`, {
                        method: "POST"
                    });
                    const cData = await res.json();
                    if (cData.success) {
                        successCount++;
                        const resultLog = `  => ✅ Thành công: ${cData.genres.join(", ")}\n`;
                        setClassifyProgress(prev => {
                            const completedLog = currentLog + resultLog;
                            if (prev.startsWith(currentLog)) {
                                return completedLog + prev.slice(currentLog.length);
                            }
                            return completedLog + prev;
                        });
                    } else {
                        const errorLog = `  => ❌ Lỗi: ${cData.error || cData.message}\n`;
                        setClassifyProgress(prev => {
                            const completedLog = currentLog + errorLog;
                            if (prev.startsWith(currentLog)) {
                                return completedLog + prev.slice(currentLog.length);
                            }
                            return completedLog + prev;
                        });
                    }
                } catch (err: any) {
                    const errorLog = `  => ❌ Lỗi kết nối: ${err.message}\n`;
                    setClassifyProgress(prev => {
                        const completedLog = currentLog + errorLog;
                        if (prev.startsWith(currentLog)) {
                            return completedLog + prev.slice(currentLog.length);
                        }
                        return completedLog + prev;
                    });
                }

                loadClassificationLists();
                await new Promise(r => setTimeout(r, 600));
            }

            setClassifyProgress(prev => `\n🎉 Hoàn thành xử lý! Đã phân loại thành công ${successCount}/${limit} truyện.\n` + prev);
            toast.success(`Đã phân loại thành công ${successCount} truyện.`);
        } catch (e: any) {
            setClassifyProgress(prev => `\nLỗi: ${e.message}\n` + prev);
        } finally {
            setIsClassifying(false);
        }
    };

    // AI Config States
    const [proxyUrl, setProxyUrl] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [model, setModel] = useState("gemini-2.5-flash-search");
    const [autoClassifyNew, setAutoClassifyNew] = useState(false);
    const [isSavingConfig, setIsSavingConfig] = useState(false);

    // Dynamic model scanner states
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [isScanningModels, setIsScanningModels] = useState(false);
    const [showModelsDropdown, setShowModelsDropdown] = useState(false);

    // Lists States
    const [unclassifiedNovels, setUnclassifiedNovels] = useState<any[]>([]);
    const [classifiedNovels, setClassifiedNovels] = useState<any[]>([]);
    const [isLoadingLists, setIsLoadingLists] = useState(false);
    const [showUnclassifiedList, setShowUnclassifiedList] = useState(false);
    const [showClassifiedList, setShowClassifiedList] = useState(false);

    const handleScanModels = async () => {
        setIsScanningModels(true);
        try {
            const res = await fetch("/api/reading-room?action=get_available_models");
            const data = await res.json();
            if (data.success) {
                setAvailableModels(data.models || []);
                setShowModelsDropdown(true);
                toast.success(`Đã quét thành công ${data.models?.length || 0} model!`);
            } else {
                toast.error("Lỗi: " + data.error);
            }
        } catch (e: any) {
            toast.error("Lỗi kết nối: " + e.message);
        } finally {
            setIsScanningModels(false);
        }
    };

    const loadClassifyConfig = async () => {
        try {
            const res = await fetch("/api/reading-room?action=get_classify_config");
            const data = await res.json();
            if (data.success) {
                setProxyUrl(data.proxyUrl || "");
                setApiKey(data.apiKey || "");
                setModel(data.model || "gemini-2.5-flash-search");
                setAutoClassifyNew(!!data.autoClassifyNew);
            }
        } catch (e) {
            console.error("Failed to load classify config", e);
        }
    };

    const loadClassificationLists = async () => {
        setIsLoadingLists(true);
        try {
            const res = await fetch("/api/reading-room?action=get_classification_lists");
            const data = await res.json();
            if (data.success) {
                setUnclassifiedNovels(data.unclassified || []);
                setClassifiedNovels(data.classified || []);
            }
        } catch (e) {
            console.error("Failed to load classification lists", e);
        } finally {
            setIsLoadingLists(false);
        }
    };

    const handleSaveConfig = async () => {
        setIsSavingConfig(true);
        try {
            const res = await fetch("/api/reading-room?action=save_classify_config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ proxyUrl, apiKey, model, autoClassifyNew })
            });
            const data = await res.json();
            if (data.success) {
                toast.success("Cấu hình AI đã lưu thành công!");
                loadClassifyConfig();
            } else {
                toast.error("Lỗi khi lưu cấu hình: " + data.error);
            }
        } catch (err: any) {
            toast.error("Lỗi: " + err.message);
        } finally {
            setIsSavingConfig(false);
        }
    };

    const handleClassifySingle = async (novelId: string) => {
        toast.info("Đang phân loại truyện...");
        try {
            const res = await fetch(`/api/reading-room?action=edit_metadata&id=${novelId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ forceAutoClassify: true })
            });
            const data = await res.json();
            if (data.success) {
                toast.success("Phân loại truyện thành công!");
                loadClassificationLists();
            } else {
                toast.error("Lỗi: " + data.error);
            }
        } catch (e: any) {
            toast.error("Lỗi: " + e.message);
        }
    };

    // Load configurations and lists when admin is active
    useEffect(() => {
        if (isAdmin) {
            loadClassifyConfig();
            loadClassificationLists();
        }
    }, [isAdmin]);

    const isDark = theme === "dark";

    if (profileLoading) {
        return (
            <div className={`min-h-screen flex items-center justify-center ${isDark ? "bg-[#0f0f12]" : "bg-[#faf5ea]"}`}>
                <div className="flex flex-col items-center gap-3">
                    <Loader2Icon className="animate-spin size-10 text-blue-500" />
                    <span className="text-sm font-semibold text-zinc-500">Đang tải thông tin...</span>
                </div>
            </div>
        );
    }

    if (!isVip) {
        return null;
    }

    return (
        <div className={`min-h-screen transition-colors duration-250 flex justify-center items-start overflow-x-hidden font-sans ${isDark ? "bg-[#0f0f12]" : "bg-[#faf5ea]"}`}>
            {/* Full-width viewport with mobile bottom nav space */}
            <div className="w-full min-h-screen relative flex flex-col pb-26 overflow-hidden px-4 md:px-8 max-w-4xl mx-auto">

                {/* Main App Content Viewport */}
                <div className="flex-1 overflow-y-auto pt-6">

                    {/* library tab */}
                    {activeTab === "library" && (
                        <div key="library" className="space-y-4 animate-page-enter">
                            {/* Library top bar */}
                            <div className="flex justify-between items-center pb-2">
                                <h1 className="text-2xl font-bold">Tủ Truyện</h1>
                                <div className="flex gap-2">
                                    <button
                                        onClick={toggleTheme}
                                        className={`p-2 rounded-full transition ${isDark ? "bg-zinc-800/40 hover:bg-zinc-850 text-white" : "bg-white hover:bg-zinc-100 text-zinc-700 shadow-sm border border-zinc-200"}`}
                                    >
                                        {isDark ? <SunIcon className="w-4 h-4" /> : <MoonIcon className="w-4 h-4" />}
                                    </button>
                                    <button onClick={() => toast.info("Tính năng tìm kiếm tủ truyện")} className={`p-2 rounded-full transition ${isDark ? "bg-zinc-800/40 hover:bg-zinc-850" : "bg-white hover:bg-zinc-100 shadow-sm border border-zinc-200"}`}>
                                        <SearchIcon className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => setShowLibrarySort(!showLibrarySort)} className={`p-2 rounded-full transition ${isDark ? "bg-zinc-800/40 hover:bg-zinc-805" : "bg-white hover:bg-zinc-100 shadow-sm border border-zinc-200"}`}>
                                        <SettingsIcon className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            {/* Sub-tabs selector */}
                            <div className={`flex border-b text-sm font-semibold ${isDark ? "border-zinc-800" : "border-zinc-200"}`}>
                                <button
                                    className={`flex-1 pb-3 text-center transition-colors ${librarySubTab === "history" ? "text-blue-500 border-b-2 border-blue-500" : isDark ? "text-zinc-500" : "text-zinc-400"}`}
                                    onClick={() => setLibrarySubTab("history")}
                                >
                                    Lịch sử
                                </button>
                                <button
                                    className={`flex-1 pb-3 text-center transition-colors ${librarySubTab === "bookmarks" ? "text-blue-500 border-b-2 border-blue-500" : isDark ? "text-zinc-500" : "text-zinc-400"}`}
                                    onClick={() => setLibrarySubTab("bookmarks")}
                                >
                                    Đánh dấu
                                </button>
                            </div>

                            {/* Library lists rendering */}
                            {librarySubTab === "history" ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {historyList.length === 0 ? (
                                        <div className="col-span-full text-center py-16 text-zinc-500 text-sm font-medium">Chưa có lịch sử đọc truyện nào.</div>
                                    ) : (
                                        historyList.map((item) => (
                                            <div
                                                key={item.id}
                                                className={`flex gap-3 items-center p-3 rounded-xl border transition ${isDark
                                                    ? "bg-[#131416] border-zinc-800/50 hover:border-zinc-700"
                                                    : "bg-[#fffbf4] border-zinc-200 shadow-sm hover:border-zinc-300"
                                                    }`}
                                            >
                                                <Link href={`/reader/${item.id}`} onClick={(e) => handleLibraryItemClick(item.id, e)} className="shrink-0 w-12 aspect-3/4 rounded-lg bg-zinc-500/10 overflow-hidden relative">
                                                    {item.coverImage ? (
                                                        <img src={item.coverImage} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                                    ) : (
                                                        <div className="w-full h-full bg-zinc-300 dark:bg-zinc-800 flex items-center justify-center text-[10px] text-zinc-500 font-bold p-1 text-center line-clamp-2">{item.title}</div>
                                                    )}
                                                </Link>
                                                <Link href={`/reader/${item.id}`} onClick={(e) => handleLibraryItemClick(item.id, e)} className="flex-1 min-w-0">
                                                    <h3 className="text-sm font-bold truncate">{item.title}</h3>
                                                    <p className="text-xs text-blue-500 font-semibold mt-0.5">Đã đọc: {item.lastReadChapterTitle || `Chương ${item.lastReadChapterIdx + 1}`}</p>
                                                    <p className="text-[10px] text-zinc-500 mt-0.5">Cập nhật: {new Date(item.updatedAt).toLocaleDateString()}</p>
                                                </Link>
                                                <button onClick={() => setSoundMuted(!soundMuted)} className="p-2 text-zinc-400 hover:text-zinc-650">
                                                    {soundMuted ? <VolumeXIcon className="w-4 h-4" /> : <Volume2Icon className="w-4 h-4" />}
                                                </button>
                                                <button onClick={(e) => handleClearHistoryItem(item.id, e)} className="p-2 text-zinc-400 hover:text-red-500">
                                                    <Trash2Icon className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {/* Panel Tải hàng loạt */}
                                    {bookmarksList.filter(item => item.id.startsWith("novelhub-")).length > 0 && (
                                        <div className={`p-4 rounded-xl border space-y-3 transition-colors ${
                                            isDark ? "bg-[#161b22]/40 border-amber-500/20" : "bg-amber-500/5 border-amber-500/10 shadow-sm"
                                        }`}>
                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                                <div>
                                                    <h3 className="text-xs font-bold text-amber-500 flex items-center gap-1.5">
                                                        📦 Tải Hàng Loạt Nguồn Ngoài ({selectedBookmarkIds.length} truyện đã chọn)
                                                    </h3>
                                                    <p className="text-[10px] text-zinc-500 mt-1">
                                                        Chọn các truyện trong danh sách Đánh dấu dưới đây để tải hàng loạt file TXT/EPUB sạch lỗi.
                                                    </p>
                                                </div>
                                                <div className="flex gap-2 shrink-0 justify-center sm:justify-start">
                                                    {bulkStatus === "idle" && (
                                                        <>
                                                            <button
                                                                disabled={selectedBookmarkIds.length === 0}
                                                                onClick={() => startBulkDownload("txt")}
                                                                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition ${
                                                                    selectedBookmarkIds.length === 0
                                                                        ? "opacity-50 cursor-not-allowed text-zinc-400"
                                                                        : isDark
                                                                            ? "bg-zinc-800 hover:bg-zinc-750 text-white border-zinc-700"
                                                                            : "bg-white hover:bg-zinc-50 text-zinc-850 border-zinc-200 shadow-xs"
                                                                }`}
                                                            >
                                                                Tải TXT loạt
                                                            </button>
                                                            <button
                                                                disabled={selectedBookmarkIds.length === 0}
                                                                onClick={() => startBulkDownload("epub")}
                                                                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition ${
                                                                    selectedBookmarkIds.length === 0
                                                                        ? "opacity-50 cursor-not-allowed text-zinc-400"
                                                                        : isDark
                                                                            ? "bg-zinc-800 hover:bg-zinc-750 text-white border-zinc-700"
                                                                            : "bg-white hover:bg-zinc-50 text-zinc-850 border-zinc-200 shadow-xs"
                                                                }`}
                                                            >
                                                                Tải EPUB loạt
                                                            </button>
                                                        </>
                                                    )}
                                                    {bulkStatus === "downloading" && (
                                                        <button
                                                            onClick={pauseBulkDownload}
                                                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border flex items-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/30 active:scale-95 transition-all`}
                                                        >
                                                            <Loader2Icon className="w-3.5 h-3.5 animate-spin" />
                                                            Tạm dừng
                                                        </button>
                                                    )}
                                                    {bulkStatus === "paused" && (
                                                        <>
                                                            <button
                                                                onClick={resumeBulkDownload}
                                                                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30 active:scale-95 transition-all`}
                                                            >
                                                                Tiếp tục
                                                            </button>
                                                            <button
                                                                onClick={cancelBulkDownload}
                                                                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-855 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white active:scale-95 transition-all`}
                                                            >
                                                                Hủy bỏ
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>

                                            {bulkStatus !== "idle" && (
                                                <div className="w-full space-y-1.5">
                                                    <div className="flex justify-between text-[10px] text-zinc-550 font-semibold">
                                                        <span className="truncate max-w-[85%]">{bulkCurrentBookProgress}</span>
                                                        <span>{bulkProgress}%</span>
                                                    </div>
                                                    <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                                                        <div className="bg-amber-500 h-full rounded-full transition-all duration-300" style={{ width: `${bulkProgress}%` }} />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {bookmarksList.length === 0 ? (
                                            <div className="col-span-full text-center py-16 text-zinc-500 text-sm font-medium">Chưa có truyện đánh dấu.</div>
                                        ) : (
                                            bookmarksList.map((item) => (
                                                <div
                                                    key={item.id}
                                                    className={`flex gap-3 items-center p-3 rounded-xl border transition ${isDark
                                                        ? "bg-[#131416] border-zinc-800/50 hover:border-zinc-700"
                                                        : "bg-[#fffbf4] border-zinc-200 shadow-sm hover:border-zinc-300"
                                                        }`}
                                                >
                                                    {item.id.startsWith("novelhub-") && (
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedBookmarkIds.includes(item.id)}
                                                            onChange={(e) => {
                                                                if (e.target.checked) {
                                                                    setSelectedBookmarkIds(prev => [...prev, item.id]);
                                                                } else {
                                                                    setSelectedBookmarkIds(prev => prev.filter(id => id !== item.id));
                                                                }
                                                            }}
                                                            onClick={(e) => e.stopPropagation()}
                                                            className={`w-4 h-4 rounded border text-blue-500 focus:ring-0 focus:ring-offset-0 cursor-pointer shrink-0 ${
                                                                isDark ? "bg-[#1d1e22] border-zinc-800" : "bg-white border-zinc-300"
                                                            }`}
                                                        />
                                                    )}
                                                    <Link href={`/reader/${item.id}`} onClick={(e) => handleLibraryItemClick(item.id, e)} className="shrink-0 w-12 aspect-3/4 rounded-lg bg-zinc-500/10 overflow-hidden relative">
                                                        {item.coverImage ? (
                                                            <img src={item.coverImage} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                                        ) : (
                                                            <div className="w-full h-full bg-zinc-300 dark:bg-zinc-800 flex items-center justify-center text-[10px] text-zinc-550 font-bold p-1 text-center line-clamp-2">{item.title}</div>
                                                        )}
                                                    </Link>
                                                    <Link href={`/reader/${item.id}`} onClick={(e) => handleLibraryItemClick(item.id, e)} className="flex-1 min-w-0">
                                                        <h3 className="text-sm font-bold truncate">{item.title}</h3>
                                                        <p className="text-xs text-zinc-400 mt-0.5">Tác giả: {item.author || "Khuyết danh"}</p>
                                                        <p className="text-[10px] text-zinc-500 mt-0.5">Số chương: {item.totalChapters || 0}</p>
                                                    </Link>
                                                    <button onClick={(e) => handleClearBookmarkItem(item.id, e)} className="p-2 text-zinc-400 hover:text-red-505">
                                                        <Trash2Icon className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* explore tab */}
                    {activeTab === "explore" && (
                        <div key="explore" className="space-y-6 animate-page-enter">
                            {/* Explore Top bar */}
                            <div className="flex justify-between items-center pb-1">
                                <div className={`flex gap-1.5 items-center font-bold text-sm border px-3 py-1 rounded-full ${isDark ? "bg-zinc-800/30 border-zinc-800 text-zinc-300" : "bg-white border-zinc-200 text-zinc-700 shadow-sm"}`}>
                                    <span>Tất cả</span>
                                    <span className="text-[10px] text-zinc-400 font-normal">▼</span>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={toggleTheme}
                                        className={`p-2 rounded-full transition ${isDark ? "bg-zinc-800/40 hover:bg-zinc-850 text-white" : "bg-white hover:bg-zinc-100 text-zinc-700 shadow-sm border border-zinc-200"}`}
                                    >
                                        {isDark ? <SunIcon className="w-4 h-4" /> : <MoonIcon className="w-4 h-4" />}
                                    </button>
                                    <button onClick={() => setActiveTab("catalog")} className={`p-2 rounded-full transition ${isDark ? "bg-zinc-800/40 hover:bg-zinc-805" : "bg-white hover:bg-zinc-100 shadow-sm border border-zinc-200"}`}>
                                        <SearchIcon className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => { setActiveTab("catalog"); setShowFilters(true); }} className={`p-2 rounded-full transition ${isDark ? "bg-zinc-800/40 hover:bg-zinc-805" : "bg-white hover:bg-zinc-100 shadow-sm border border-zinc-200"}`}>
                                        <SlidersHorizontalIcon className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            {loading ? (
                                <ExploreSkeleton isDark={isDark} />
                            ) : (
                                <>
                                    {/* Slider rotating banners */}
                                    <div className={`relative w-full h-36 sm:h-48 md:h-56 rounded-2xl overflow-hidden shadow-lg border ${isDark ? "bg-zinc-900 border-zinc-800" : "bg-zinc-100 border-zinc-200"}`}>
                                        {exploreBannerNovels.length > 0 ? (
                                            <div className="relative w-full h-full flex items-stretch gap-4 overflow-hidden group">
                                                {/* Blurred background image cover */}
                                                <img src={exploreBannerNovels[0].coverImage} className="absolute inset-0 w-full h-full object-cover filter blur-md opacity-35 scale-105 select-none pointer-events-none" referrerPolicy="no-referrer" />
                                                <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/85 to-black/65" />

                                                {/* Sharp portrait cover foreground */}
                                                <div className="relative shrink-0 h-full aspect-[3/4] overflow-hidden border-r border-white/10 shadow-md">
                                                    {exploreBannerNovels[0].coverImage ? (
                                                        <img src={exploreBannerNovels[0].coverImage} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                                    ) : (
                                                        <div className="w-full h-full bg-zinc-700 flex items-center justify-center text-[8px] text-white p-0.5 text-center font-bold">{exploreBannerNovels[0].title}</div>
                                                    )}
                                                </div>

                                                {/* Details */}
                                                <div className="relative flex-1 min-w-0 flex flex-col justify-center py-3 pr-4 pl-1 text-white">
                                                    <div className="flex gap-1.5 items-center mb-1.5">
                                                        <span className="bg-blue-500/95 text-[8px] font-extrabold px-1.5 py-0.5 rounded w-max uppercase tracking-wider shadow-sm text-white">NỔI BẬT</span>
                                                        <span className="bg-emerald-500 text-[8px] font-extrabold px-1.5 py-0.5 rounded w-max uppercase tracking-wider shadow-sm text-white">NEW</span>
                                                    </div>
                                                    <h2 className="text-sm md:text-lg font-extrabold truncate drop-shadow-sm leading-snug">{exploreBannerNovels[0].title}</h2>
                                                    <p className="text-[10px] md:text-xs text-zinc-300 font-medium truncate mt-0.5">{exploreBannerNovels[0].author || "Khuyết danh"}</p>
                                                    {exploreBannerNovels[0].description && (
                                                        <p className="text-[9px] text-zinc-400 mt-1 lines-clamp-2 leading-relaxed hidden sm:block">
                                                            {exploreBannerNovels[0].description.slice(0, 110) + (exploreBannerNovels[0].description.length > 110 ? "..." : "")}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-zinc-550 text-xs font-semibold">Gợi ý truyện đề cử</div>
                                        )}
                                    </div>

                                    {/* Section: Mới nhất */}
                                    <div className="space-y-2.5">
                                        <div className="flex justify-between items-center">
                                            <h2 className="text-base font-bold flex items-center gap-1.5"><SparklesIcon className="w-4 h-4 text-orange-500" /> Mới cập nhật</h2>
                                            <button onClick={() => setActiveTab("catalog")} className="text-[11px] font-bold text-zinc-400 hover:text-zinc-600 flex items-center">Xem thêm <ChevronRightIcon className="w-3.5 h-3.5" /></button>
                                        </div>
                                        <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-none snap-x">
                                            {novels.slice(0, 8).map(novel => (
                                                <Link key={novel.id} href={`/reader/${novel.id}`} className="snap-start shrink-0 w-28 flex flex-col gap-1.5">
                                                    <div className="w-full aspect-3/4 rounded-xl overflow-hidden relative shadow-md bg-zinc-800/10">
                                                        {novel.coverImage ? (
                                                            <img src={novel.coverImage} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                                        ) : (
                                                            <div className="w-full h-full flex items-center justify-center p-2 bg-gradient-to-br from-zinc-200 to-zinc-300 dark:from-zinc-700 dark:to-zinc-800 text-[10px] text-center font-bold">{novel.title}</div>
                                                        )}
                                                    </div>
                                                    <p className="text-xs font-bold line-clamp-2 h-8 leading-tight mt-0.5">{novel.title}</p>
                                                </Link>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Section: Đề cử */}
                                    <div className="space-y-2.5">
                                        <h2 className="text-base font-bold flex items-center gap-1.5"><TrendingUpIcon className="w-4 h-4 text-blue-500" /> Truyện chọn lọc</h2>
                                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                                            {novels.slice(3, 9).map(novel => (
                                                <Link key={novel.id} href={`/reader/${novel.id}`} className="flex flex-col gap-1.5 text-center">
                                                    <div className="w-full aspect-3/4 rounded-xl overflow-hidden relative shadow-md bg-zinc-550/10">
                                                        {novel.coverImage ? (
                                                            <img src={novel.coverImage} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                                        ) : (
                                                            <div className="w-full h-full flex items-center justify-center p-2 bg-zinc-300 dark:bg-zinc-800 text-[10px] font-bold">{novel.title}</div>
                                                        )}
                                                    </div>
                                                    <p className="text-[11px] font-bold truncate px-0.5">{novel.title}</p>
                                                </Link>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* catalog tab (Middle button navigation click) */}
                    {activeTab === "catalog" && (
                        <div key="catalog" className="space-y-4 animate-page-enter pb-8">
                            {/* Catalog Page Header matching Picture 1 */}
                            <div className="flex justify-between items-center pb-1">
                                <h1 className="text-lg font-bold tracking-tight">Danh Sách Truyện</h1>
                                <div className="flex gap-2">
                                    <button
                                        onClick={toggleTheme}
                                        className={`p-2 rounded-full transition ${isDark ? "bg-zinc-800/40 hover:bg-zinc-850 text-white" : "bg-white hover:bg-zinc-100 text-zinc-700 shadow-sm border border-zinc-200"}`}
                                    >
                                        {isDark ? <SunIcon className="w-4 h-4" /> : <MoonIcon className="w-4 h-4" />}
                                    </button>
                                    <button
                                        className={`p-2 rounded-full border transition ${showFilters ? "text-blue-505 bg-blue-500/10 border-blue-500" : isDark ? "bg-zinc-800/40 border-transparent hover:bg-zinc-805" : "bg-white border-zinc-200 hover:bg-zinc-100 shadow-sm"}`}
                                        onClick={() => {
                                            setTempFilters({ ...appliedFilters });
                                            setShowFilters(!showFilters);
                                        }}
                                    >
                                        <SlidersHorizontalIcon className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            {/* Searching bar overlay */}
                            <div className="relative">
                                <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                                <input
                                    type="text"
                                    placeholder="Tìm truyện, tác giả..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className={`w-full pl-9 pr-4 py-2.5 text-xs rounded-xl border focus:outline-none focus:border-zinc-500 placeholder-zinc-500 font-medium transition ${isDark
                                        ? "bg-[#131416] border-zinc-800 text-[#f1f1f5]"
                                        : "bg-[#fffbf4] border-zinc-200 text-[#110c08] shadow-sm"
                                        }`}
                                />
                            </div>

                            {/* Source Tabs: Kho tổng, TruyenFull, MTC, WikiDich */}
                            <div className="flex gap-2 text-xs font-bold pb-1 overflow-x-auto scrollbar-none">
                                {[
                                    { id: "all", label: "Kho tổng" },
                                    { id: "truyenfull", label: "Truyện Full" },
                                    { id: "metruyenchu", label: "Mê Truyện Chữ" },
                                    { id: "wikidich", label: "WikiDịch" }
                                ].map((tab) => {
                                    const isActive = catalogSourceTab === tab.id;
                                    return (
                                        <button
                                            key={tab.id}
                                            onClick={() => setCatalogSourceTab(tab.id as any)}
                                            className={`px-4 py-2 rounded-full border text-[11px] font-bold transition-all duration-300 ${
                                                isActive
                                                    ? isDark
                                                        ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20"
                                                        : "bg-blue-500 border-blue-500 text-white shadow-md shadow-blue-500/10"
                                                    : isDark
                                                        ? "bg-[#161719] border-zinc-800/80 text-zinc-405 hover:text-white hover:border-zinc-700"
                                                        : "bg-white border-zinc-250 text-zinc-655 hover:text-zinc-900 hover:border-zinc-350 shadow-sm"
                                            }`}
                                        >
                                            {tab.label}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* List cards matching Picture 1 exactly */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                                {loading ? (
                                    <CatalogSkeleton isDark={isDark} />
                                ) : filteredCatalogNovels.length === 0 ? (
                                    <div className="col-span-full text-center py-20 text-zinc-500 text-sm font-medium">Không tìm thấy truyện nào phù hợp.</div>
                                ) : (
                                    filteredCatalogNovels.slice(0, visibleCount).map((novel) => {
                                        let displayTag = novel.id.toUpperCase();
                                        if (novel.id.startsWith("novelhub-truyenfull-")) {
                                            const slug = novel.id.substring("novelhub-truyenfull-".length);
                                            displayTag = `TF-${slug.toUpperCase()}`;
                                        } else if (novel.id.startsWith("novelhub-metruyenchu-")) {
                                            const slug = novel.id.substring("novelhub-metruyenchu-".length);
                                            displayTag = `MTC-${slug.toUpperCase()}`;
                                        } else if (novel.id.startsWith("novelhub-wikidich-")) {
                                            const slug = novel.id.substring("novelhub-wikidich-".length);
                                            displayTag = `WD-${slug.toUpperCase()}`;
                                        } else if (novel.id.startsWith("mottruyen-")) {
                                            displayTag = `MT-${novel.id.replace("mottruyen-", "").toUpperCase()}`;
                                        }
                                        if (displayTag.length > 25) {
                                            displayTag = displayTag.substring(0, 22) + "...";
                                        }

                                        return (
                                            <Link
                                                key={novel.id}
                                                href={`/reader/${novel.id}`}
                                                className={`flex gap-4 p-3 rounded-2xl border transition ${isDark
                                                    ? "bg-[#131416] border-zinc-800/30 hover:border-zinc-700"
                                                    : "bg-[#fffbf4] border-zinc-200 hover:border-zinc-300 shadow-sm"
                                                    }`}
                                            >
                                                {/* Cover */}
                                                <div className="shrink-0 w-16 aspect-3/4 rounded-xl overflow-hidden bg-zinc-500/10 relative shadow-sm border border-zinc-300 dark:border-zinc-800">
                                                    {novel.coverImage ? (
                                                        <img src={novel.coverImage} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                                    ) : (
                                                        <div className="w-full h-full bg-zinc-300 dark:bg-zinc-800 flex items-center justify-center text-[10px] text-zinc-550 font-bold p-1 text-center line-clamp-2">{novel.title}</div>
                                                    )}
                                                </div>

                                                {/* Details matching layout of Picture 1 */}
                                                <div className="flex-1 min-w-0 flex flex-col justify-between">
                                                    <div>
                                                        {/* HasTag Pill header matching Picture 1 */}
                                                        <div className="flex gap-1.5 flex-wrap">
                                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm text-blue-500 bg-blue-500/10 border border-blue-500/20">
                                                                {displayTag}
                                                            </span>
                                                        </div>

                                                        {/* Title */}
                                                        <h3 className={`text-xs sm:text-sm font-bold mt-1 leading-tight line-clamp-2 ${isDark ? "text-white" : "text-zinc-900"}`}>{novel.title}</h3>
                                                    </div>

                                                    {/* Rating/Meta row */}
                                                    <div className="flex flex-col gap-1.5 mt-2">
                                                        <div className="flex justify-between items-center text-[10px]">
                                                            <span className="font-semibold text-zinc-500 truncate max-w-[120px]">{novel.author || "Khuyết danh"}</span>
                                                            <div className="flex gap-2 items-center font-bold text-zinc-450">
                                                                <span className="flex items-center gap-0.5 text-amber-500">★ 5.0 <span className="text-[9px] font-medium text-zinc-500">({(novel as any).reviewCount ?? 0})</span></span>
                                                                <span className="flex items-center gap-0.5">👁️ {formatViews((novel as any).viewsCount)}</span>
                                                                <span className="flex items-center gap-0.5">📖 {novel.totalChapters || (novel as any).chapterCount || 0}</span>
                                                            </div>
                                                        </div>
                                                        {Number((novel as any).wrongChaptersCount) > 0 && (
                                                            <div className="flex items-center gap-1 text-[9px] font-bold text-red-500 bg-red-500/10 dark:bg-red-500/5 px-2 py-0.5 rounded border border-red-500/20 w-fit">
                                                                <span>⚠️ Lỗi chương: {(novel as any).wrongChaptersCount} ch</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </Link>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    )}

                    {/* account tab */}
                    {activeTab === "account" && (
                        <div key="account" className="max-w-md mx-auto space-y-4 animate-page-enter">
                            {/* Profile card */}
                            <div className={`p-5 rounded-2xl border text-center flex flex-col items-center transition ${isDark ? "bg-[#131416] border-zinc-800" : "bg-[#fffbf4] border-zinc-200 shadow-sm"}`}>
                                <div className="w-14 h-14 bg-zinc-800 p-3 rounded-full border border-blue-500/20 text-blue-500 flex items-center justify-center text-lg font-bold mb-3 shadow-[0_0_15px_rgba(59,130,246,0.1)]">
                                    <UserIcon className="w-6 h-6" />
                                </div>
                                <h2 className="text-sm font-bold truncate max-w-full">{profile?.email || "Độc Giả Thuyết Thư Các"}</h2>
                                <p className="text-[10px] font-bold text-blue-500 bg-blue-900/10 border border-blue-900/20 px-2 py-0.5 rounded mt-1">
                                    {isAdmin ? "ADMINISTRATOR" : "VIP MEMBER"}
                                </p>
                            </div>

                            {/* AI admin tools (Original page classification action) */}
                            {isAdmin && (
                                <div className={`p-4 rounded-xl border transition ${isDark ? "bg-[#131416] border-zinc-800" : "bg-[#fffbf4] border-zinc-200 shadow-sm"}`}>
                                    <button
                                        className="w-full flex justify-between items-center text-xs font-bold"
                                        onClick={() => setIsAdminOpen(!isAdminOpen)}
                                    >
                                        <span>🛠 CÔNG CỤ ADMIN</span>
                                        <span>{isAdminOpen ? "▲" : "▼"}</span>
                                    </button>

                                    {isAdminOpen && (
                                        <div className={`mt-3 pt-3 border-t space-y-4 ${isDark ? "border-zinc-800" : "border-zinc-200"}`}>
                                            {/* AI Configuration Section */}
                                            <div className="space-y-2 border-b pb-3 border-zinc-800/60 dark:border-zinc-850">
                                                <h4 className="text-[11px] uppercase tracking-wider font-extrabold text-blue-500">Cấu hình AI Phân Loại</h4>

                                                <div className="space-y-1">
                                                    <label className="text-[9px] font-bold text-zinc-400">Proxy API URL</label>
                                                    <input
                                                        type="text"
                                                        value={proxyUrl}
                                                        onChange={(e) => setProxyUrl(e.target.value)}
                                                        placeholder="https://api.openai.com/v1"
                                                        autoComplete="off"
                                                        name="reading-room-proxy-url"
                                                        id="reading-room-proxy-url"
                                                        className={`w-full px-2.5 py-1.5 text-xs rounded border focus:outline-none focus:border-blue-500 placeholder-zinc-655 font-medium transition ${isDark ? "bg-[#1d1e22] border-zinc-855 text-[#f1f1f5]" : "bg-white border-zinc-300 text-[#110c08]"}`}
                                                    />
                                                </div>

                                                <div className="space-y-1">
                                                    <label className="text-[9px] font-bold text-zinc-400">API Key</label>
                                                    <input
                                                        type="password"
                                                        value={apiKey}
                                                        onChange={(e) => setApiKey(e.target.value)}
                                                        placeholder="Nhập API Key hoặc giữ nguyên"
                                                        autoComplete="new-password"
                                                        name="reading-room-api-key"
                                                        id="reading-room-api-key"
                                                        className={`w-full px-2.5 py-1.5 text-xs rounded border focus:outline-none focus:border-blue-550 placeholder-zinc-655 font-medium transition ${isDark ? "bg-[#1d1e22] border-zinc-855 text-[#f1f1f5]" : "bg-white border-zinc-300 text-[#110c08]"}`}
                                                    />
                                                </div>

                                                <div className="flex items-center space-x-2 pt-1 pb-1">
                                                    <input
                                                        type="checkbox"
                                                        id="autoClassifyNewCheckbox"
                                                        checked={autoClassifyNew}
                                                        onChange={(e) => setAutoClassifyNew(e.target.checked)}
                                                        className={`w-3.5 h-3.5 rounded border text-blue-550 focus:ring-0 focus:ring-offset-0 transition cursor-pointer ${isDark ? "bg-[#1d1e22] border-zinc-800" : "bg-white border-zinc-300"}`}
                                                    />
                                                    <label htmlFor="autoClassifyNewCheckbox" className={`text-[10px] font-bold select-none cursor-pointer ${isDark ? "text-zinc-300 hover:text-zinc-200" : "text-zinc-600 hover:text-zinc-700"}`}>
                                                        Tự động phân loại khi có truyện mới
                                                    </label>
                                                </div>

                                                <div className="space-y-1">
                                                    <div className="flex justify-between items-center">
                                                        <label className="text-[9px] font-bold text-zinc-400">AI Model</label>
                                                        <button
                                                            disabled={isScanningModels}
                                                            type="button"
                                                            onClick={handleScanModels}
                                                            className="text-[9px] font-bold text-blue-500 hover:text-blue-400 disabled:opacity-60 transition"
                                                        >
                                                            {isScanningModels ? "Đang quét..." : "🔍 Quét Model API"}
                                                        </button>
                                                    </div>
                                                    <div className="relative">
                                                        <input
                                                            type="text"
                                                            value={model}
                                                            onChange={(e) => setModel(e.target.value)}
                                                            placeholder="gemini-2.5-flash-search"
                                                            className={`w-full px-2.5 py-1.5 text-xs rounded border focus:outline-none focus:border-blue-555 placeholder-zinc-655 font-medium transition ${isDark ? "bg-[#1d1e22] border-zinc-855 text-[#f1f1f5]" : "bg-white border-zinc-300 text-[#110c08]"}`}
                                                        />
                                                        {showModelsDropdown && availableModels.length > 0 && (
                                                            <div className={`absolute top-full left-0 right-0 z-50 mt-1 max-h-36 overflow-y-auto rounded border shadow-lg text-[10px] font-medium p-1.5 divide-y ${isDark ? "bg-[#1d1e22] border-zinc-800 divide-zinc-800 text-zinc-350" : "bg-white border-zinc-250 divide-zinc-200 text-zinc-700"}`}>
                                                                <div className="flex justify-between items-center pb-1 mb-1 shrink-0">
                                                                    <span className="font-bold text-[8px] uppercase text-zinc-550">Chọn model phát hiện</span>
                                                                    <button type="button" onClick={() => setShowModelsDropdown(false)} className="text-red-500 font-bold hover:underline">Đóng</button>
                                                                </div>
                                                                <div className="space-y-0.5 pt-1">
                                                                    {availableModels.map((m) => (
                                                                        <button
                                                                            key={m}
                                                                            type="button"
                                                                            onClick={() => {
                                                                                setModel(m);
                                                                                setShowModelsDropdown(false);
                                                                                toast.info(`Đã chọn: ${m}`);
                                                                            }}
                                                                            className={`w-full text-left p-1.5 hover:bg-zinc-800/10 dark:hover:bg-zinc-800 rounded transition truncate ${model === m ? "text-blue-500 font-bold" : ""}`}
                                                                        >
                                                                            {m}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                <button
                                                    disabled={isSavingConfig}
                                                    onClick={handleSaveConfig}
                                                    className="w-full mt-1.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-[10px] font-bold rounded transition text-white"
                                                >
                                                    {isSavingConfig ? "Đang Lưu..." : "Lưu Cấu Hình AI"}
                                                </button>
                                            </div>

                                            {/* Batch Classification Action */}
                                            <div className="space-y-2 border-b pb-3 border-zinc-800/60 dark:border-zinc-850">
                                                <h4 className="text-[11px] uppercase tracking-wider font-extrabold text-blue-500">Phân Loại Hàng Loạt</h4>
                                                <p className="text-[10px] text-zinc-550">AI sẽ tự động quét mô tả và nguồn các truyện chưa có thể loại để gán tự động.</p>
                                                <div className="flex gap-2">
                                                    <button
                                                        disabled={isClassifying}
                                                        onClick={() => handleRunBatchClassification(false)}
                                                        className="flex-1 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-60 text-[10px] font-bold rounded-lg transition text-white"
                                                    >
                                                        {isClassifying ? "Đang Chạy..." : "Quét 10 Truyện"}
                                                    </button>
                                                    <button
                                                        disabled={isClassifying}
                                                        onClick={() => handleRunBatchClassification(true)}
                                                        className="flex-1 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-60 text-[10px] font-bold rounded-lg transition text-white"
                                                    >
                                                        {isClassifying ? "Đang Chạy..." : "Quét Tất Cả"}
                                                    </button>
                                                </div>
                                                {classifyProgress && (
                                                    <div className="p-2.5 bg-zinc-950 rounded text-[9px] text-[#2cbe4e] font-mono break-all leading-normal whitespace-pre-wrap max-h-60 overflow-y-auto">{classifyProgress}</div>
                                                )}
                                            </div>

                                            {/* Novel Classification Lists */}
                                            <div className="space-y-2.5">
                                                <div className="flex justify-between items-center text-xs font-bold">
                                                    <span className="text-[11px] uppercase tracking-wider font-extrabold text-blue-500">Danh Sách Phân Loại</span>
                                                    <button onClick={loadClassificationLists} className="text-[10px] text-blue-500 hover:underline">Tải lại</button>
                                                </div>

                                                {isLoadingLists ? (
                                                    <div className="py-4 text-center text-[10px] text-zinc-550 font-medium">Đang tải danh sách...</div>
                                                ) : (
                                                    <div className="space-y-2">
                                                        {/* Unclassified Toggle */}
                                                        <div>
                                                            <button
                                                                onClick={(e) => { e.preventDefault(); setShowUnclassifiedList(!showUnclassifiedList); }}
                                                                className={`w-full flex justify-between items-center px-3 py-2 rounded text-xs font-bold transition ${isDark ? "bg-[#18191e] hover:bg-zinc-800" : "bg-white hover:bg-zinc-100 shadow-sm border border-zinc-200"}`}
                                                            >
                                                                <span>Cần phân loại ({unclassifiedNovels.length})</span>
                                                                <span>{showUnclassifiedList ? "▲" : "▼"}</span>
                                                            </button>
                                                            {showUnclassifiedList && (
                                                                <div className={`mt-1.5 p-2 rounded border space-y-1.5 max-h-48 overflow-y-auto ${isDark ? "bg-[#101114] border-zinc-850" : "bg-white border-zinc-250"}`}>
                                                                    {unclassifiedNovels.length === 0 ? (
                                                                        <div className="text-center py-4 text-[10px] text-zinc-505">Không có truyện nào thiếu thể loại.</div>
                                                                    ) : (
                                                                        unclassifiedNovels.map((n) => (
                                                                            <div key={n.id} className="flex justify-between items-center gap-2 text-[10px] py-1 border-b last:border-0 border-zinc-800/40">
                                                                                <div className="min-w-0 flex-1">
                                                                                    <p className="font-bold truncate">{n.title}</p>
                                                                                    <p className="text-[9px] text-zinc-500 truncate">{n.author || "Khuyết danh"} • {n.uploaderName || ""}</p>
                                                                                </div>
                                                                                <button
                                                                                    onClick={() => handleClassifySingle(n.id)}
                                                                                    className="shrink-0 px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-[9px] font-bold"
                                                                                >
                                                                                    Phân Loại
                                                                                </button>
                                                                            </div>
                                                                        ))
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* Classified Toggle */}
                                                        <div>
                                                            <button
                                                                onClick={(e) => { e.preventDefault(); setShowClassifiedList(!showClassifiedList); }}
                                                                className={`w-full flex justify-between items-center px-3 py-2 rounded text-xs font-bold transition ${isDark ? "bg-[#18191e] hover:bg-zinc-800" : "bg-white hover:bg-zinc-100 shadow-sm border border-zinc-200"}`}
                                                            >
                                                                <span>Đã phân loại ({classifiedNovels.length})</span>
                                                                <span>{showClassifiedList ? "▲" : "▼"}</span>
                                                            </button>
                                                            {showClassifiedList && (
                                                                <div className={`mt-1.5 p-2 rounded border space-y-1.5 max-h-48 overflow-y-auto ${isDark ? "bg-[#101114] border-zinc-850" : "bg-white border-zinc-250"}`}>
                                                                    {classifiedNovels.length === 0 ? (
                                                                        <div className="text-center py-4 text-[10px] text-zinc-505">Chưa có truyện nào được phân loại.</div>
                                                                    ) : (
                                                                        classifiedNovels.map((n) => (
                                                                            <div key={n.id} className="text-[10px] py-1 border-b last:border-0 border-zinc-800/40">
                                                                                <div className="flex justify-between items-start gap-1">
                                                                                    <p className="font-bold truncate flex-1">{n.title}</p>
                                                                                    <span className="text-[8px] text-zinc-500 shrink-0">{n.uploaderName || ""}</span>
                                                                                </div>
                                                                                {n.genres && n.genres.length > 0 && (
                                                                                    <div className="flex gap-1 flex-wrap mt-0.5">
                                                                                        {n.genres.map((g: string, i: number) => (
                                                                                            <span key={i} className="text-[8px] px-1 bg-zinc-850 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 rounded-sm">{g}</span>
                                                                                        ))}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        ))
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Standard links */}
                            <div className={`rounded-xl border overflow-hidden divide-y text-xs font-semibold ${isDark ? "bg-[#131416] border-zinc-800 divide-zinc-800" : "bg-[#fffbf4] border-zinc-200 divide-zinc-200 shadow-sm"}`}>
                                <button onClick={() => toast.success("Đang sử dụng phiên bản 2.1 standalone")} className="w-full flex justify-between items-center p-3.5 hover:bg-zinc-850/10 text-left transition">
                                    <span>Phiên bản hiện tại</span>
                                    <span className="text-[10px] font-bold text-zinc-550">v2.1</span>
                                </button>
                            </div>
                        </div>
                    )}

                    {/* novelhub tab */}
                    {activeTab === "novelhub" && (
                        <div key="novelhub" className="space-y-6 animate-page-enter pb-16">
                            {/* Navbar: Select source, back buttons, search */}
                            <div className="flex flex-col gap-4">
                                <div className="flex justify-between items-center pb-1">
                                    <div className="flex items-center gap-3">
                                        {nhHistory.length > 0 && (
                                            <button 
                                                onClick={navigateNhBack}
                                                className={`p-2 rounded-full border transition ${
                                                    isDark 
                                                        ? "bg-zinc-800/40 border-transparent hover:bg-zinc-800 text-zinc-300" 
                                                        : "bg-white border-zinc-200 hover:bg-zinc-50 text-zinc-700 shadow-sm"
                                                }`}
                                                title="Quay lại"
                                            >
                                                ◀ Quay lại
                                            </button>
                                        )}
                                        <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
                                            <GlobeIcon className="w-5 h-5 text-blue-500 animate-pulse" />
                                            <span>Nguồn Ngoài (Scraper)</span>
                                        </h1>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={toggleTheme}
                                            className={`p-2 rounded-full transition ${isDark ? "bg-zinc-800/40 hover:bg-zinc-850 text-white" : "bg-white hover:bg-zinc-100 text-zinc-700 shadow-sm border border-zinc-200"}`}
                                        >
                                            {isDark ? <SunIcon className="w-4 h-4" /> : <MoonIcon className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </div>

                                <div className="flex flex-col sm:flex-row gap-3">
                                    <div className={`flex gap-1 p-1 rounded-xl border text-xs font-bold uppercase tracking-wider ${
                                        isDark ? "bg-[#131416] border-zinc-800" : "bg-zinc-100/50 border-zinc-200 shadow-sm bg-white"
                                    }`}>
                                        <button 
                                            onClick={() => changeNhSource("truyenfull")} 
                                            className={`px-3 py-1.5 rounded-lg transition-colors ${
                                                nhSource === "truyenfull" 
                                                    ? "bg-blue-600 text-white shadow-sm" 
                                                    : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                                            }`}
                                        >
                                            Truyện Full
                                        </button>
                                        <button 
                                            onClick={() => changeNhSource("metruyenchu")} 
                                            className={`px-3 py-1.5 rounded-lg transition-colors ${
                                                nhSource === "metruyenchu" 
                                                    ? "bg-blue-600 text-white shadow-sm" 
                                                    : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                                            }`}
                                        >
                                            Mê Truyện Chữ
                                        </button>
                                        <button 
                                            onClick={() => changeNhSource("wikidich")} 
                                            className={`px-3 py-1.5 rounded-lg transition-colors ${
                                                nhSource === "wikidich" 
                                                    ? "bg-blue-600 text-white shadow-sm" 
                                                    : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                                            }`}
                                        >
                                            Wiki Dịch
                                        </button>
                                    </div>

                                    <form onSubmit={handleNhSearch} className="flex-1 relative">
                                        <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-550" />
                                        <input
                                            type="text"
                                            placeholder="Tìm truyện nguồn ngoài..."
                                            value={nhQuery}
                                            onChange={(e) => setNhQuery(e.target.value)}
                                            className={`w-full pl-9 pr-4 py-2.5 text-xs rounded-xl border focus:outline-none focus:border-zinc-500 placeholder-zinc-500 font-medium transition ${
                                                isDark
                                                    ? "bg-[#131416] border-zinc-800 text-[#f1f1f5]"
                                                    : "bg-white border-zinc-200 text-[#110c08] shadow-sm"
                                            }`}
                                        />
                                    </form>
                                </div>
                            </div>

                            {/* NovelHub Sub-views */}
                            {nhState.view === "home" && (
                                <div className="space-y-4">
                                    {/* Sub-tab selection bar when source is Truyen Full or Metruyenchu */}
                                    {(nhSource === "truyenfull" || nhSource === "metruyenchu") && (
                                        <div className={`flex border-b text-xs font-bold ${
                                            isDark ? "border-zinc-800" : "border-zinc-200"
                                        }`}>
                                            <button
                                                onClick={() => setNhSubTab("home")}
                                                className={`pb-2.5 px-4 transition-colors relative ${
                                                    nhSubTab === "home"
                                                        ? "text-blue-500 border-b-2 border-blue-500"
                                                        : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                                                }`}
                                            >
                                                Khám Phá
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setNhSubTab("new_list");
                                                    // Reset page back to 1 when changing subtabs
                                                    setNhState(prev => ({ ...prev, page: 1 }));
                                                }}
                                                className={`pb-2.5 px-4 transition-colors relative ${
                                                    nhSubTab === "new_list"
                                                        ? "text-blue-500 border-b-2 border-blue-500"
                                                        : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                                                }`}
                                            >
                                                Truyện Mới
                                            </button>
                                        </div>
                                    )}

                                    {/* Sub-view rendering */}
                                    {nhSubTab === "home" || (nhSource !== "truyenfull" && nhSource !== "metruyenchu") ? (
                                        <NovelHubHomeView 
                                            nhSource={nhSource}
                                            navigateNh={navigateNh}
                                            setNhSubTab={setNhSubTab}
                                            isDark={isDark}
                                        />
                                    ) : (
                                        <NovelHubStoryListView 
                                            nhSource={nhSource}
                                            listType="truyen-moi"
                                            page={nhState.page || 1}
                                            navigateNh={navigateNh}
                                            setNhState={setNhState}
                                            isDark={isDark}
                                        />
                                    )}
                                </div>
                            )}
                            {nhState.view === "search" && (
                                <NovelHubSearchView 
                                    nhSource={nhSource}
                                    searchQuery={nhState.searchQuery || ""}
                                    navigateNh={navigateNh}
                                    isDark={isDark}
                                />
                            )}
                            {nhState.view === "story" && (
                                <NovelHubStoryDetailsView 
                                    key={`${nhSource}-${nhState.storySlug || ""}-${nhState.page || 1}`}
                                    nhSource={nhSource}
                                    storySlug={nhState.storySlug || ""}
                                    page={nhState.page || 1}
                                    navigateNh={navigateNh}
                                    setNhState={setNhState}
                                    isDark={isDark}
                                    nhStoryCache={nhStoryCache}
                                    setNhStoryCache={setNhStoryCache}
                                />
                            )}
                            {nhState.view === "chapter" && (
                                <NovelHubChapterView 
                                    nhSource={nhSource}
                                    storySlug={nhState.storySlug || ""}
                                    chapterSlug={nhState.chapterSlug || ""}
                                    storyTitle={nhState.storyTitle}
                                    storyCover={nhState.storyCover}
                                    storyAuthor={nhState.storyAuthor}
                                    navigateNhBack={navigateNhBack}
                                    setNhState={setNhState}
                                    isDark={isDark}
                                />
                            )}
                            {nhState.view === "list" && (
                                <NovelHubStoryListView 
                                    nhSource={nhSource}
                                    listType={nhState.listType || ""}
                                    page={nhState.page || 1}
                                    navigateNh={navigateNh}
                                    setNhState={setNhState}
                                    isDark={isDark}
                                />
                            )}
                        </div>
                    )}

                    {/* Sticky/Fixed bottom footer bar style spanning full viewport width */}
                    <nav className={`fixed bottom-0 left-0 right-0 h-16 border-t flex items-center justify-around px-2 z-45 max-w-lg mx-auto sm:rounded-t-2xl shadow-xl transition ${isDark
                        ? "bg-[#131416] border-zinc-800/80"
                        : "bg-[#fffbf4] border-zinc-200/80 backdrop-blur-md"
                        }`}>
                        <button
                            onClick={() => setActiveTab("library")}
                            className={`flex flex-col items-center gap-1 transition ${activeTab === "library" ? "text-blue-500" : "text-zinc-550 hover:text-zinc-400"}`}
                        >
                            <BookMarkedIcon className="w-5 h-5" />
                            <span className="text-[9px] font-bold">Tủ Truyện</span>
                        </button>

                        <button
                            onClick={() => setActiveTab("explore")}
                            className={`flex flex-col items-center gap-1 transition ${activeTab === "explore" ? "text-blue-500" : "text-zinc-550 hover:text-zinc-400"}`}
                        >
                            <CompassIcon className="w-5 h-5" />
                            <span className="text-[9px] font-bold">Khám Phá</span>
                        </button>

                        <button
                            onClick={() => setActiveTab("catalog")}
                            className={`flex flex-col items-center gap-1 transition ${activeTab === "catalog" ? "text-blue-500" : "text-zinc-550 hover:text-zinc-400"}`}
                        >
                            <BookOpenIcon className="w-5 h-5" />
                            <span className="text-[9px] font-bold">Danh sách truyện</span>
                        </button>

                        <button
                            onClick={() => setActiveTab("novelhub")}
                            className={`flex flex-col items-center gap-1 transition ${activeTab === "novelhub" ? "text-blue-500" : "text-zinc-550 hover:text-zinc-400"}`}
                        >
                            <GlobeIcon className="w-5 h-5" />
                            <span className="text-[9px] font-bold">Nguồn Ngoài</span>
                        </button>

                        <button
                            onClick={() => setActiveTab("account")}
                            className={`flex flex-col items-center gap-1 transition ${activeTab === "account" ? "text-blue-500" : "text-zinc-550 hover:text-zinc-400"}`}
                        >
                            <UserIcon className="w-5 h-5" />
                            <span className="text-[9px] font-bold">Tài Khoản</span>
                        </button>
                    </nav>

                    {/* SORTING Library Drawer Sheet Overlay */}
                    {showLibrarySort && (
                        <div className="fixed inset-0 bg-black/60 z-50 flex items-end">
                            <div className={`w-full rounded-t-2xl p-5 border-t space-y-4 animate-in slide-in-from-bottom duration-250 max-w-lg mx-auto ${isDark ? "bg-[#131416] border-zinc-800" : "bg-[#fffbf4] border-zinc-200"}`}>
                                <div className="flex justify-between items-center pb-1">
                                    <h3 className="text-sm font-bold">Sắp xếp tủ truyện</h3>
                                    <button onClick={() => setShowLibrarySort(false)} className={`text-xs font-bold px-2 py-0.5 rounded ${isDark ? "text-zinc-400 bg-zinc-800/40" : "text-zinc-600 bg-zinc-1e0"}`}>Đóng</button>
                                </div>

                                <div className="space-y-3">
                                    <div>
                                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">Lịch sử</p>
                                        <div className="grid grid-cols-3 gap-2">
                                            {["Chương mới", "Mới đọc", "Tên truyện"].map(opt => (
                                                <button
                                                    key={opt}
                                                    onClick={() => { setLibrarySortBy(opt === "Mới đọc" ? "recent" : opt === "Chương mới" ? "new_chap" : "name"); setShowLibrarySort(false); }}
                                                    className={`py-1.5 text-[10px] font-bold rounded-lg border transition ${librarySortBy === (opt === "Mới đọc" ? "recent" : opt === "Chương mới" ? "new_chap" : "name")
                                                        ? "bg-blue-600 border-blue-500 text-white"
                                                        : isDark
                                                            ? "border-zinc-800 bg-zinc-900/50 text-zinc-405"
                                                            : "border-zinc-200 bg-zinc-50 text-zinc-600"
                                                        }`}
                                                >
                                                    {opt}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="pt-3 border-t border-zinc-200/50 dark:border-zinc-800/50">
                                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">WikiDich Cookie (Bypass tìm kiếm)</p>
                                        <div className="space-y-2">
                                            <input
                                                type="text"
                                                placeholder="Dán giá trị cookie 'express.sid' vào đây..."
                                                value={wikiDichCookie}
                                                onChange={(e) => handleSaveWikiDichCookie(e.target.value)}
                                                className={`w-full px-3 py-2 text-xs rounded-lg border focus:outline-none placeholder-zinc-500 transition ${
                                                    isDark
                                                        ? "bg-[#1d1e22] border-zinc-800 text-white focus:border-zinc-700"
                                                        : "bg-white border-zinc-200 text-zinc-800 focus:border-zinc-300 shadow-inner"
                                                }`}
                                            />
                                            <p className="text-[9px] text-zinc-500 leading-relaxed">
                                                * Hướng dẫn: Đăng nhập vào <strong>wikicv.net</strong> trên trình duyệt này &gt; F12 &gt; Application &gt; Cookies &gt; copy giá trị của <strong>express.sid</strong> rồi dán vào đây để tìm kiếm trực tiếp ổn định 100%.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ADVANCED Catalog filters sheet matching Picture 2, 3, 4, 5 */}
                    {showFilters && (
                        <div className="fixed inset-0 bg-black/70 z-55 flex flex-col justify-end">
                            {/* Closing background click */}
                            <div className="flex-1" onClick={() => setShowFilters(false)} />

                            <div className={`w-full max-h-[85dvh] rounded-t-3xl border-t flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300 max-w-lg mx-auto ${isDark ? "bg-[#131416] border-zinc-800 text-[#f1f1f5]" : "bg-[#fffbf4] border-zinc-200 text-[#110c08]"
                                }`}>

                                {/* Sticky Header */}
                                <div className={`flex justify-between items-center px-5 py-4 border-b shrink-0 ${isDark ? "border-zinc-850 bg-[#131416]" : "border-zinc-150 bg-[#fffbf4]"}`}>
                                    <h3 className="text-sm font-extrabold tracking-wide">Bộ Lọc Tìm Kiếm</h3>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setTempFilters({
                                                sortBy: "Mới lên chương",
                                                type: "",
                                                gender: "",
                                                status: "",
                                                chaptersRange: "",
                                                publishDate: "",
                                                genre: "",
                                                characterTrait: "",
                                                worldBackground: "",
                                                sectFlow: ""
                                            })}
                                            className={`text-[11px] font-extrabold px-2.5 py-1 rounded-lg transition ${isDark ? "text-zinc-400 hover:text-white bg-zinc-800/40" : "text-zinc-650 hover:text-black bg-zinc-100"}`}
                                        >
                                            Đặt lại
                                        </button>
                                        <button onClick={() => setShowFilters(false)} className={`text-[11px] font-extrabold px-2.5 py-1 rounded-lg ${isDark ? "text-zinc-400 bg-zinc-800/60" : "text-zinc-650 bg-zinc-100"}`}>Đóng</button>
                                    </div>
                                </div>

                                {/* Scrollable Middle Container */}
                                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 pb-8">
                                    {/* Section: Sắp xếp */}
                                    <div className="space-y-2">
                                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Sắp xếp</p>
                                        <div className="flex flex-wrap gap-1.5 font-sans">
                                            {[
                                                "Mới lên chương", "Mới đăng", "Lượt đọc", "Lượt đọc tuần",
                                                "Lượt đề cử", "Lượt đề cử tuần", "Lượt bình luận", "Lượt bình luận tuần",
                                                "Lượt đánh dấu", "Lượt đánh giá", "Điểm đánh giá", "Số chương",
                                                "Lượt mở khóa", "Tên truyện"
                                            ].map(opt => (
                                                <button
                                                    key={opt}
                                                    onClick={() => setTempFilters({ ...tempFilters, sortBy: opt })}
                                                    className={`px-3 py-1.5 rounded-full text-[10px] font-semibold border transition ${tempFilters.sortBy === opt
                                                        ? isDark
                                                            ? "bg-white text-black border-white"
                                                            : "bg-black text-white border-black"
                                                        : isDark
                                                            ? "border-zinc-800 bg-[#26262b]/30 text-zinc-400"
                                                            : "border-zinc-200 bg-zinc-100/50 text-zinc-600"
                                                        }`}
                                                >
                                                    {opt}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Section: Loại */}
                                    <div className="space-y-2">
                                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Loại</p>
                                        <div className="flex gap-2">
                                            {["Chuyển ngữ", "Sáng tác"].map(opt => (
                                                <button
                                                    key={opt}
                                                    onClick={() => setTempFilters({ ...tempFilters, type: tempFilters.type === opt ? "" : opt })}
                                                    className={`px-4 py-1.5 rounded-full text-[10px] font-bold border transition ${tempFilters.type === opt
                                                        ? isDark
                                                            ? "bg-white text-black border-white"
                                                            : "bg-black text-white border-black"
                                                        : isDark
                                                            ? "border-zinc-800 bg-[#26262b]/30 text-zinc-400"
                                                            : "border-zinc-200 bg-zinc-100/50 text-zinc-600"
                                                        }`}
                                                >
                                                    {opt}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Section: Giới tính */}
                                    <div className="space-y-2">
                                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Giới tính</p>
                                        <div className="flex gap-2">
                                            {["Truyện nam", "Truyện nữ"].map(opt => (
                                                <button
                                                    key={opt}
                                                    onClick={() => setTempFilters({ ...tempFilters, gender: tempFilters.gender === opt ? "" : opt })}
                                                    className={`px-4 py-1.5 rounded-full text-[10px] font-bold border transition ${tempFilters.gender === opt
                                                        ? isDark
                                                            ? "bg-white text-black border-white"
                                                            : "bg-black text-white border-black"
                                                        : isDark
                                                            ? "border-zinc-800 bg-[#26262b]/30 text-zinc-400"
                                                            : "border-zinc-200 bg-zinc-100/50 text-zinc-600"
                                                        }`}
                                                >
                                                    {opt}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Section: Tình trạng */}
                                    <div className="space-y-2">
                                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Tình trạng</p>
                                        <div className="flex gap-2">
                                            {["Còn tiếp", "Hoàn thành", "Tạm dừng"].map(opt => (
                                                <button
                                                    key={opt}
                                                    onClick={() => setTempFilters({ ...tempFilters, status: tempFilters.status === opt ? "" : opt })}
                                                    className={`px-4 py-1.5 rounded-full text-[10px] font-bold border transition ${tempFilters.status === opt
                                                        ? isDark
                                                            ? "bg-white text-black border-white"
                                                            : "bg-black text-white border-black"
                                                        : isDark
                                                            ? "border-zinc-800 bg-[#26262b]/30 text-zinc-405"
                                                            : "border-zinc-200 bg-zinc-100/50 text-zinc-600"
                                                        }`}
                                                >
                                                    {opt}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Section: Số chương */}
                                    <div className="space-y-2">
                                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Số chương</p>
                                        <div className="flex gap-1.5">
                                            {["< 300", "300-600", "600-1000", "> 1000"].map(opt => (
                                                <button
                                                    key={opt}
                                                    onClick={() => setTempFilters({ ...tempFilters, chaptersRange: tempFilters.chaptersRange === opt ? "" : opt })}
                                                    className={`px-3 py-1.5 rounded-full text-[10px] font-bold border transition ${tempFilters.chaptersRange === opt
                                                        ? isDark
                                                            ? "bg-white text-black border-white"
                                                            : "bg-black text-white border-black"
                                                        : isDark
                                                            ? "border-zinc-800 bg-[#26262b]/30 text-zinc-400"
                                                            : "border-zinc-200 bg-zinc-100/50 text-zinc-600"
                                                        }`}
                                                >
                                                    {opt}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Section: Thể loại */}
                                    <div className="space-y-2">
                                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Thể loại</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {[
                                                "Tiên Hiệp", "Huyền Huyễn", "Khoa Huyễn", "Võng Du", "Đô Thị",
                                                "Đồng Nhân", "Dã Sử", "Cạnh Kỹ", "Kiếm Hiệp", "Kỳ Ảo",
                                                "Huyền Nghi", "Võ Hiệp", "Cung Đấu", "Gia Đấu", "Trinh Thám",
                                                "Mạt Thế", "Lịch Sử", "Quân Sự", "Light Novel", "Hiện Đại Ngôn Tình",
                                                "Huyền Huyễn Ngôn Tình", "Tiên Hiệp Kỳ Duyên", "Cổ Đại Ngôn Tình"
                                            ].map(opt => (
                                                <button
                                                    key={opt}
                                                    onClick={() => setTempFilters({ ...tempFilters, genre: tempFilters.genre === opt ? "" : opt })}
                                                    className={`px-3 py-1.5 rounded-full text-[10px] font-medium border transition ${tempFilters.genre === opt
                                                        ? isDark
                                                            ? "bg-white text-black border-white"
                                                            : "bg-black text-white border-black"
                                                        : isDark
                                                            ? "border-zinc-800 bg-[#26262b]/30 text-zinc-405"
                                                            : "border-zinc-200 bg-zinc-100/50 text-zinc-600"
                                                        }`}
                                                >
                                                    {opt}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Section: Tính cách */}
                                    <div className="space-y-2">
                                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Tính cách</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {[
                                                "Sát Phạt", "Cơ Trí", "Vô Sỉ", "Văn Nhã", "Mãng Phu",
                                                "Nhẹ Nhàng", "Hài Hước", "Lạnh Lùng", "Nhiệt Huyết"
                                            ].map(opt => (
                                                <button
                                                    key={opt}
                                                    onClick={() => setTempFilters({ ...tempFilters, characterTrait: tempFilters.characterTrait === opt ? "" : opt })}
                                                    className={`px-3 py-1.5 rounded-full text-[10px] font-medium border transition ${tempFilters.characterTrait === opt
                                                        ? isDark
                                                            ? "bg-white text-black border-white"
                                                            : "bg-black text-white border-black"
                                                        : isDark
                                                            ? "border-zinc-800 bg-[#26262b]/30 text-zinc-405"
                                                            : "border-zinc-200 bg-zinc-100/50 text-zinc-600"
                                                        }`}
                                                >
                                                    {opt}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Section: Bối cảnh */}
                                    <div className="space-y-2">
                                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Bối cảnh</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {[
                                                "Chư Thiên Vạn Giới", "Vô Hạn Lưu", "Đông Phương Huyền Huyễn",
                                                "Tây Phương Kỳ Ảo", "Hiện Đại Tu Chân", "Hư Nghĩ Võng Du",
                                                "Thời Không Xuyên Toa", "Đô Thị Dị Năng", "Đô Thị Sinh Hoạt",
                                                "Học Đường", "Vương Triều Tranh Bá"
                                            ].map(opt => (
                                                <button
                                                    key={opt}
                                                    onClick={() => setTempFilters({ ...tempFilters, worldBackground: tempFilters.worldBackground === opt ? "" : opt })}
                                                    className={`px-3 py-1.5 rounded-full text-[10px] font-medium border transition ${tempFilters.worldBackground === opt
                                                        ? isDark
                                                            ? "bg-white text-black border-white"
                                                            : "bg-black text-white border-black"
                                                        : isDark
                                                            ? "border-zinc-800 bg-[#26262b]/30 text-zinc-405"
                                                            : "border-zinc-200 bg-zinc-100/50 text-zinc-600"
                                                        }`}
                                                >
                                                    {opt}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Section: Lưu phái */}
                                    <div className="space-y-2">
                                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Lưu phái</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {[
                                                "Hệ Thống", "Xuyên Không", "Trọng Sinh", "Vô Địch",
                                                "Đầu Cơ", "Ngu Nhạc Minh Tinh", "Ngự Thú", "Điền Viên",
                                                "Bác Sĩ", "Học Hối", "Sau Màn", "Khoái Xuyên",
                                                "Nữ Phụ", "Sảng Văn", "Ngôn Tình", "Nữ Cường"
                                            ].map(opt => (
                                                <button
                                                    key={opt}
                                                    onClick={() => setTempFilters({ ...tempFilters, sectFlow: tempFilters.sectFlow === opt ? "" : opt })}
                                                    className={`px-3 py-1.5 rounded-full text-[10px] font-medium border transition ${tempFilters.sectFlow === opt
                                                        ? isDark
                                                            ? "bg-white text-black border-white"
                                                            : "bg-black text-white border-black"
                                                        : isDark
                                                            ? "border-zinc-800 bg-[#26262b]/30 text-zinc-405"
                                                            : "border-zinc-200 bg-zinc-100/50 text-zinc-600"
                                                        }`}
                                                >
                                                    {opt}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* Sticky Footer */}
                                <div className={`px-5 py-3.5 border-t shrink-0 ${isDark ? "border-zinc-850 bg-[#131416]" : "border-zinc-150 bg-[#fffbf4]"}`}>
                                    <button
                                        onClick={() => {
                                            setAppliedFilters(tempFilters);
                                            setShowFilters(false);
                                            toast.success("Đã áp dụng các lớp lọc!");
                                        }}
                                        className={`w-full flex items-center justify-center gap-2 py-3 active:scale-[0.99] transition text-sm font-extrabold rounded-2xl tracking-wide border ${isDark
                                            ? "bg-white text-black hover:bg-zinc-100 border-white"
                                            : "bg-black hover:bg-zinc-900 text-white border-black shadow-sm"
                                            }`}
                                    >
                                        <BookOpenIcon className="w-4 h-4 text-blue-500 animate-pulse" />
                                        <span>Gửi</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ==========================================
// NOVELHUB WEB SCRAPER SUB-COMPONENTS
// ==========================================

function NovelHubHomeView({
    nhSource,
    navigateNh,
    setNhSubTab,
    isDark
}: {
    nhSource: string;
    navigateNh: (s: any) => void;
    setNhSubTab: (s: "home" | "new_list") => void;
    isDark: boolean;
}) {
    const [data, setData] = useState<any>({ hotStories: [], newUpdates: [] });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        const savedCookie = localStorage.getItem("nh_wikidich_cookie") || "";
        const headers: Record<string, string> = {};
        if (nhSource === "wikidich" && savedCookie) {
            headers["x-wikidich-cookie"] = savedCookie;
        }
        fetchNovelHubData("home", nhSource, {}, headers)
            .then((d) => {
                setData(d);
            })
            .catch((err) => {
                console.error(err);
                toast.error("Không thể tải dữ liệu.");
            })
            .finally(() => setLoading(false));
    }, [nhSource]);

    if (loading) {
        return (
            <div className="flex flex-col justify-center items-center h-48 space-y-4 w-full">
                <Loader2Icon className="w-8 h-8 animate-spin text-blue-500" />
                <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-zinc-500">Đang tải...</div>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-page-enter">
            {data.hotStories?.length > 0 && (
                <section className="space-y-4">
                    <h2 className="text-base font-bold flex items-center gap-1.5">🔥 Truyện Phổ Biến</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                        {data.hotStories.map((s: any, idx: number) => (
                            <div
                                key={idx}
                                onClick={() => navigateNh({ view: "story", storySlug: s.slug })}
                                className={`group flex flex-col gap-2 cursor-pointer p-2 rounded-xl border transition ${
                                    isDark
                                        ? "bg-[#131416] border-zinc-800/40 hover:border-zinc-700"
                                        : "bg-[#fffbf4] border-zinc-200 hover:border-zinc-300 shadow-sm"
                                }`}
                            >
                                <div className="aspect-[3/4] overflow-hidden bg-zinc-550/10 rounded-lg shadow-sm border border-zinc-300 dark:border-zinc-800">
                                    {s.cover ? (
                                        <img
                                            src={s.cover}
                                            alt={s.title}
                                            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                                            referrerPolicy="no-referrer"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-zinc-400">📖</div>
                                    )}
                                </div>
                                <h3 className="font-bold text-xs line-clamp-2 leading-tight h-8" title={s.title}>
                                    {s.title}
                                </h3>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {data.newUpdates?.length > 0 && (
                <section className="space-y-4">
                    <h2 className="text-base font-bold flex items-center gap-1.5">⚡ Vừa Cập Nhật</h2>
                    <div
                        className={`border rounded-2xl p-4 divide-y ${
                            isDark
                                ? "bg-[#131416] border-zinc-800 divide-zinc-800"
                                : "bg-[#fffbf4] border-zinc-200 divide-zinc-200 shadow-sm"
                        }`}
                    >
                        {data.newUpdates.map((s: any, idx: number) => (
                            <div key={idx} className="flex justify-between items-center py-3 gap-3 first:pt-0 last:pb-0">
                                <div
                                    onClick={() => navigateNh({ view: "story", storySlug: s.slug })}
                                    className="font-bold text-xs hover:text-blue-500 transition cursor-pointer truncate flex-1"
                                >
                                    {s.title}
                                </div>
                                <button
                                    onClick={() =>
                                        navigateNh({
                                            view: "chapter",
                                            storySlug: s.slug,
                                            chapterSlug: s.latestChapterSlug
                                        })
                                    }
                                    className="text-[10px] text-blue-500 hover:underline font-semibold shrink-0"
                                >
                                    {s.latestChapter}
                                </button>
                            </div>
                        ))}
                    </div>
                    <div className="flex justify-center pt-2">
                        <button
                            onClick={() => {
                                if (nhSource === "truyenfull") {
                                    setNhSubTab("new_list");
                                } else {
                                    navigateNh({
                                        view: "list",
                                        listType: "chuong-moi"
                                    });
                                }
                            }}
                            className={`px-6 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition ${
                                isDark
                                    ? "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:bg-zinc-800"
                                    : "border-zinc-200 bg-white text-zinc-650 hover:bg-zinc-50"
                            }`}
                        >
                            Xem tất cả
                        </button>
                    </div>
                </section>
            )}
        </div>
    );
}

function NovelHubSearchView({
    nhSource,
    searchQuery,
    navigateNh,
    isDark
}: {
    nhSource: string;
    searchQuery: string;
    navigateNh: (s: any) => void;
    isDark: boolean;
}) {
    const [results, setResults] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        const savedCookie = localStorage.getItem("nh_wikidich_cookie") || "";
        const headers: Record<string, string> = {};
        if (nhSource === "wikidich" && savedCookie) {
            headers["x-wikidich-cookie"] = savedCookie;
        }
        fetchNovelHubData("search", nhSource, { q: searchQuery }, headers)
            .then((d) => {
                setResults(d.results || []);
            })
            .catch((err) => {
                console.error(err);
                toast.error("Tìm kiếm thất bại.");
            })
            .finally(() => setLoading(false));
    }, [searchQuery, nhSource]);

    if (loading) {
        return (
            <div className="flex flex-col justify-center items-center h-48 space-y-4 w-full">
                <Loader2Icon className="w-8 h-8 animate-spin text-blue-500" />
                <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-zinc-500">Đang tìm kiếm...</div>
            </div>
        );
    }

    return (
        <div className="space-y-4 animate-page-enter">
            <h2 className="text-sm font-bold text-zinc-500">Kết quả cho: "{searchQuery}"</h2>
            <div
                className={`border rounded-2xl p-4 divide-y ${
                    isDark
                        ? "bg-[#131416] border-zinc-800 divide-zinc-800"
                        : "bg-[#fffbf4] border-zinc-200 divide-zinc-200 shadow-sm"
                }`}
            >
                {results.length === 0 ? (
                    <div className="text-center py-8 text-zinc-500 text-xs">Không tìm thấy truyện nào.</div>
                ) : (
                    results.map((r: any, idx: number) => (
                        <div key={idx} className="flex justify-between items-center py-3.5 gap-4 first:pt-0 last:pb-0">
                            <div
                                onClick={() => navigateNh({ view: "story", storySlug: r.slug })}
                                className="flex-1 min-w-0 cursor-pointer group"
                            >
                                <h3 className="font-bold text-xs group-hover:text-blue-500 transition truncate">{r.title}</h3>
                                <p className="text-[10px] text-zinc-500 mt-0.5">Tác giả: {r.author || "Khuyết danh"}</p>
                            </div>
                            <div className="text-[10px] font-semibold text-blue-500 shrink-0">{r.latestChapter}</div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

function NovelHubStoryDetailsView({
    nhSource,
    storySlug,
    page = 1,
    navigateNh,
    setNhState,
    isDark,
    nhStoryCache,
    setNhStoryCache
}: {
    nhSource: string;
    storySlug: string;
    page: number;
    navigateNh: (s: any) => void;
    setNhState: any;
    isDark: boolean;
    nhStoryCache: Record<string, any>;
    setNhStoryCache: React.Dispatch<React.SetStateAction<Record<string, any>>>;
}) {
    const cacheKey = `${nhSource}-${storySlug}-${page}`;
    const [story, setStory] = useState<any>(() => nhStoryCache[cacheKey] || null);
    const [loading, setLoading] = useState(!nhStoryCache[cacheKey]);
    const [downloading, setDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);

    const [downloadStatus, setDownloadStatus] = useState<"idle" | "downloading" | "paused">("idle");
    const [savedDownloadState, setSavedDownloadState] = useState<any>(null);
    const isAbortedRef = useRef<boolean>(false);

    const { isVip } = useProfile();
    const [downloadingFormat, setDownloadingFormat] = useState<"txt" | "epub" | null>(null);

    // Scan for any paused/partially finished downloads in IndexedDB
    useEffect(() => {
        if (!storySlug || !nhSource) return;
        let cancelled = false;
        (async () => {
            try {
                const parsed = await nhDownloadStore.get(nhSource, storySlug);
                if (cancelled) return;
                if (parsed) {
                    setSavedDownloadState(parsed);
                    setDownloadStatus("paused");
                    setDownloadingFormat(parsed.format);
                    const progressPercent = Math.round((parsed.currentIndex / parsed.chaptersToDownload.length) * 100);
                    setDownloadProgress(progressPercent);
                } else {
                    setSavedDownloadState(null);
                    setDownloadStatus("idle");
                }
            } catch (e) {
                console.error("Failed to load saved download state", e);
            }
        })();
        return () => { cancelled = true; };
    }, [storySlug, nhSource]);

    // Không giới hạn lượt tải VIP nên không cần đếm lượt

    const [isBookmarked, setIsBookmarked] = useState(false);

    useEffect(() => {
        if (!story) return;
        try {
            const bookmarks = JSON.parse(localStorage.getItem("rr_bookmarks") || "{}");
            const bookmarkId = `novelhub-${nhSource}-${storySlug}`;
            setIsBookmarked(!!bookmarks[bookmarkId]);
        } catch (e) { }
    }, [story, nhSource, storySlug]);

    const toggleBookmark = () => {
        if (!story) return;
        try {
            const bookmarks = JSON.parse(localStorage.getItem("rr_bookmarks") || "{}");
            const bookmarkId = `novelhub-${nhSource}-${storySlug}`;
            if (bookmarks[bookmarkId]) {
                delete bookmarks[bookmarkId];
                setIsBookmarked(false);
                toast.success("Đã xoá khỏi Tủ Truyện");
            } else {
                bookmarks[bookmarkId] = {
                    id: bookmarkId,
                    title: story.title,
                    coverImage: story.cover || "",
                    author: story.author || "Khuyết danh",
                    genres: [],
                    bookmarkedAt: Date.now(),
                    totalChapters: story.chapters?.length || 0
                };
                setIsBookmarked(true);
                toast.success("Đã thêm vào Tủ Truyện");
            }
            localStorage.setItem("rr_bookmarks", JSON.stringify(bookmarks));
        } catch (e) {
            console.error("Lỗi cập nhật đánh dấu", e);
        }
    };

    useEffect(() => {
        if (nhStoryCache[cacheKey]) {
            setStory(nhStoryCache[cacheKey]);
            setLoading(false);
            return;
        }

        setLoading(true);
        const savedCookie = localStorage.getItem("nh_wikidich_cookie") || "";
        const headers: Record<string, string> = {};
        if (nhSource === "wikidich" && savedCookie) {
            headers["x-wikidich-cookie"] = savedCookie;
        }
        fetchNovelHubData("story", nhSource, { slug: storySlug, page }, headers)
            .then((d) => {
                setStory(d);
                setNhStoryCache((prev) => ({
                    ...prev,
                    [cacheKey]: d
                }));
            })
            .catch((err) => {
                console.error(err);
                toast.error("Không thể tải thông tin truyện.");
            })
            .finally(() => setLoading(false));
    }, [storySlug, page, nhSource, cacheKey, nhStoryCache, setNhStoryCache]);

    const fetchAllChapters = async () => {
        if (!story) return [];
        if (story.totalPages <= 1) {
            return story.chapters || [];
        }
        
        const toastId = toast.loading("Đang chuẩn bị mục lục truyện...");
        try {
            const allChapters: any[] = [...(story.chapters || [])];
            const savedCookie = localStorage.getItem("nh_wikidich_cookie") || "";
            const headers: Record<string, string> = {};
            if (nhSource === "wikidich" && savedCookie) {
                headers["x-wikidich-cookie"] = savedCookie;
            }
            const fetchPromises = [];
            for (let p = 2; p <= story.totalPages; p++) {
                fetchPromises.push(
                    fetchNovelHubData("story", nhSource, { slug: storySlug, page: p }, headers)
                        .then((d) => d.chapters || [])
                        .catch(() => [])
                );
            }
            
            const results = await Promise.all(fetchPromises);
            results.forEach((chaps) => {
                allChapters.push(...chaps);
            });
            
            toast.dismiss(toastId);
            return allChapters;
        } catch (e) {
            toast.error("Không thể tải toàn bộ mục lục truyện.");
            toast.dismiss(toastId);
            return story.chapters || [];
        }
    };

    const handleDownload = async (format: "txt" | "epub", isResume = false) => {
        if (!story) {
            toast.error("Dữ liệu truyện chưa được tải xong.");
            return;
        }
        if (!isVip) {
            toast.error("Chỉ tài khoản VIP mới được phép tải truyện.");
            return;
        }

        // Không giới hạn số lượng tải từ nguồn ngoài

        setDownloading(true);
        setDownloadStatus("downloading");
        setDownloadingFormat(format);
        isAbortedRef.current = false;

        let chaptersToDownload: any[] = [];
        let downloadedChapters: { title: string; content: string }[] = [];
        let startIndex = 0;
        let didPause = false;

        const toastId = toast.loading(isResume ? `Đang tiếp tục tải bản ${format.toUpperCase()}...` : `Đang chuẩn bị tải truyện bản ${format.toUpperCase()}...`);

        try {
            if (isResume && savedDownloadState) {
                chaptersToDownload = savedDownloadState.chaptersToDownload;
                downloadedChapters = savedDownloadState.downloadedChapters || [];
                startIndex = savedDownloadState.currentIndex || 0;
            } else {
                chaptersToDownload = await fetchAllChapters();
                if (chaptersToDownload.length === 0) {
                    throw new Error("Không tìm thấy mục lục chương.");
                }
                const initialState = {
                    storySlug,
                    nhSource,
                    format,
                    storyTitle: story.title,
                    storyAuthor: story.author,
                    storyCover: story.cover,
                    storyDesc: story.desc,
                    downloadedChapters: [],
                    chaptersToDownload,
                    currentIndex: 0,
                    timestamp: Date.now()
                };
                await nhDownloadStore.set(nhSource, storySlug, initialState);
            }

            let successCount = downloadedChapters.filter(ch => !ch.content.includes("[Lỗi:")).length;
            didPause = false;

            for (let i = startIndex; i < chaptersToDownload.length; i++) {
                if (isAbortedRef.current) {
                    const currentState = {
                        storySlug,
                        nhSource,
                        format,
                        storyTitle: story.title,
                        storyAuthor: story.author,
                        storyCover: story.cover,
                        storyDesc: story.desc,
                        downloadedChapters,
                        chaptersToDownload,
                        currentIndex: i,
                        timestamp: Date.now()
                    };
                    await nhDownloadStore.set(nhSource, storySlug, currentState);
                    setSavedDownloadState(currentState);
                    didPause = true;
                    toast.dismiss(toastId);
                    toast.success(`Đã tạm dừng. Tải được ${i}/${chaptersToDownload.length} chương.`);
                    return;
                }

                const c = chaptersToDownload[i];
                let success = false;
                let retries = 3;
                let dData: any = null;

                const getRefererUrlSingle = (src: string, bSlug: string, cSlug?: string) => {
                    if (src === "truyenfull") {
                        return cSlug ? `https://truyenfull.today/${bSlug}/${cSlug}/` : `https://truyenfull.today/${bSlug}/`;
                    } else if (src === "metruyenchu") {
                        return cSlug ? `https://metruyenchu.co/truyen/${bSlug}/${cSlug}` : `https://metruyenchu.co/truyen/${bSlug}`;
                    } else {
                        return cSlug ? `https://wikicv.net/truyen/${bSlug}/${cSlug}` : `https://wikicv.net/truyen/${bSlug}`;
                    }
                };

                const refererUrl = i === 0
                    ? getRefererUrlSingle(nhSource, storySlug)
                    : getRefererUrlSingle(nhSource, storySlug, chaptersToDownload[i - 1].slug);

                const savedCookie = localStorage.getItem("nh_wikidich_cookie") || "";
                const headers: Record<string, string> = {};
                if (nhSource === "wikidich" && savedCookie) {
                    headers["x-wikidich-cookie"] = savedCookie;
                }
                while (!success && retries > 0) {
                    try {
                        dData = await fetchNovelHubData("chapter", nhSource, {
                            slug: storySlug,
                            chapterSlug: c.slug,
                            referer: refererUrl
                        }, headers);
                        if (dData && dData.content && !dData.content.includes("Không thể tải nội dung")) {
                            success = true;
                        } else {
                            retries--;
                            if (retries > 0) await new Promise((r) => setTimeout(r, 3000));
                        }
                    } catch (e) {
                        retries--;
                        if (retries > 0) await new Promise((r) => setTimeout(r, 3000));
                    }
                }

                if (success && dData) {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(dData.content, "text/html");
                    const pElements = doc.querySelectorAll("p, div");
                    let textContent = "";
                    if (pElements.length > 0) {
                        const paragraphs: string[] = [];
                        pElements.forEach(el => {
                            const txt = el.textContent?.trim();
                            if (txt) paragraphs.push(txt);
                        });
                        textContent = paragraphs.join("\n\n");
                    } else {
                        textContent = (doc.body.textContent || "").trim().replace(/\n\s*\n/g, "\n\n");
                    }
                    successCount++;
                    downloadedChapters.push({ title: c.title, content: textContent });
                } else {
                    const currentState = {
                        storySlug,
                        nhSource,
                        format,
                        storyTitle: story.title,
                        storyAuthor: story.author,
                        storyCover: story.cover,
                        storyDesc: story.desc,
                        downloadedChapters,
                        chaptersToDownload,
                        currentIndex: i,
                        timestamp: Date.now()
                    };
                    await nhDownloadStore.set(nhSource, storySlug, currentState);
                    setSavedDownloadState(currentState);
                    didPause = true;
                    toast.dismiss(toastId);
                    toast.error(`Tải chương "${c.title}" thất bại. Đã tự động tạm dừng và lưu tiến trình.`);
                    return;
                }

                const progressPercent = Math.round(((i + 1) / chaptersToDownload.length) * 100);
                setDownloadProgress(progressPercent);
                toast.loading(`Đang tải nội dung chương (${i + 1}/${chaptersToDownload.length})...`, { id: toastId });

                const currentState = {
                    storySlug,
                    nhSource,
                    format,
                    storyTitle: story.title,
                    storyAuthor: story.author,
                    storyCover: story.cover,
                    storyDesc: story.desc,
                    downloadedChapters,
                    chaptersToDownload,
                    currentIndex: i + 1,
                    timestamp: Date.now()
                };
                await nhDownloadStore.set(nhSource, storySlug, currentState);
                setSavedDownloadState(currentState);

                const randomDelay = Math.floor(Math.random() * 1500) + 1500;
                await new Promise((r) => setTimeout(r, randomDelay));
            }

            if (successCount === 0) {
                throw new Error("Không tải được chương nào!");
            }

            if (format === "txt") {
                let txtContent = `${story.title}\n`;
                txtContent += `Tác giả: ${story.author || "Khuyết danh"}\n`;
                txtContent += `Nguồn ngoài: ${nhSource.toUpperCase()}\n`;
                txtContent += `Giới thiệu:\n${story.desc ? story.desc.replace(/<[^>]*>/g, "") : ""}\n\n`;
                txtContent += `=========================================\n\n`;

                downloadedChapters.forEach((ch) => {
                    txtContent += `${ch.title}\n\n`;
                    txtContent += `${ch.content}\n\n`;
                    txtContent += `-----------------------------------------\n\n`;
                });

                const blob = new Blob([txtContent], { type: "text/plain;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${sanitizeFilename(story.title)}.txt`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } else {
                const cleanChapters = downloadedChapters.map((ch) => ({
                    title: ch.title,
                    content: ch.content.replace(/\n/g, "<br/>")
                }));

                let coverImageBase64: string | null = null;
                if (story.cover) {
                    try {
                        const imgRes = await fetch(`/api/proxy-image?url=${encodeURIComponent(story.cover)}`);
                        if (imgRes.ok) {
                            const blob = await imgRes.blob();
                            const reader = new FileReader();
                            const base64Promise = new Promise<string>((resolve, reject) => {
                                reader.onloadend = () => resolve(reader.result as string);
                                reader.onerror = reject;
                            });
                            reader.readAsDataURL(blob);
                            coverImageBase64 = await base64Promise;
                        }
                    } catch (e) {
                        console.warn("Failed to fetch cover image as base64", e);
                    }
                }

                const { generateEpub } = await import("@/lib/epub-generator");
                const epubBlob = await generateEpub(
                    story.title,
                    story.author || "Khuyết danh",
                    coverImageBase64,
                    cleanChapters
                );

                const url = URL.createObjectURL(epubBlob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${sanitizeFilename(story.title)}.epub`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }

            await nhDownloadStore.remove(nhSource, storySlug);
            setSavedDownloadState(null);
            setDownloadStatus("idle");
            setDownloadingFormat(null);
            toast.success("Tải truyện thành công!", { id: toastId });

            uploadNovelToReadingRoom(
                nhSource,
                storySlug,
                story.title,
                story.author,
                story.cover,
                story.desc || "",
                [...downloadedChapters]
            ).catch((err) => {
                console.error("Lỗi khi tự động tải lên kho chung (single):", err);
            });
        } catch (err: any) {
            console.error("Lỗi khi tải truyện:", err);
            toast.error(`Tải truyện thất bại: ${err.message || err}`, { id: toastId });
        } finally {
            setDownloading(false);
            if (isAbortedRef.current || didPause) {
                setDownloadStatus("paused");
            } else {
                setDownloadStatus("idle");
                setDownloadingFormat(null);
            }
        }
    };

    const handlePauseDownload = () => {
        isAbortedRef.current = true;
        toast.info("Đang tạm dừng tiến trình... Vui lòng đợi chương hiện tại tải xong.");
    };

    const handleCancelDownload = async () => {
        await nhDownloadStore.remove(nhSource, storySlug);
        setSavedDownloadState(null);
        setDownloadStatus("idle");
        setDownloadingFormat(null);
        setDownloadProgress(0);
        toast.success("Đã hủy lượt tải dở dang.");
    };

    if (loading) {
        return (
            <div className="flex flex-col justify-center items-center h-48 space-y-4 w-full">
                <Loader2Icon className="w-8 h-8 animate-spin text-blue-500" />
                <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-zinc-550">Đang tải chi tiết...</div>
            </div>
        );
    }

    if (!story || story.error) {
        return <div className="text-center text-zinc-500 py-12 text-xs">Không tìm thấy truyện.</div>;
    }

    return (
        <div className="space-y-6 animate-page-enter">
            <div
                className={`p-4 rounded-2xl border flex flex-col sm:flex-row gap-4 transition ${
                    isDark ? "bg-[#131416] border-zinc-800/60" : "bg-[#fffbf4] border-zinc-200 shadow-sm"
                }`}
            >
                <div className="w-24 aspect-[3/4] shrink-0 bg-zinc-500/10 rounded-lg overflow-hidden border border-zinc-350 dark:border-zinc-800 mx-auto sm:mx-0">
                    {story.cover ? (
                        <img src={story.cover} alt={story.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-400">📖</div>
                    )}
                </div>
                <div className="flex-1 min-w-0 flex flex-col justify-between text-center sm:text-left">
                    <div>
                        <h1 className="font-extrabold text-sm sm:text-base leading-snug">{story.title}</h1>
                        <p className="text-xs text-zinc-500 mt-1 font-semibold">Tác giả: {story.author}</p>
                        {story.desc && (
                            <div
                                className="text-zinc-600 dark:text-zinc-400 text-[11px] leading-relaxed line-clamp-3 mt-2 text-justify select-text"
                                dangerouslySetInnerHTML={{ __html: story.desc }}
                            />
                        )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 justify-center sm:justify-start">
                        <button
                            onClick={toggleBookmark}
                            className={`px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition ${
                                isBookmarked
                                    ? isDark
                                        ? "bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30"
                                        : "bg-red-50 hover:bg-red-100 text-red-600 border border-red-200"
                                    : isDark
                                        ? "bg-zinc-800 hover:bg-zinc-750 text-zinc-350 border border-zinc-700"
                                        : "bg-white hover:bg-zinc-50 text-zinc-700 border border-zinc-200 shadow-sm"
                            }`}
                        >
                            {isBookmarked ? "Xóa khỏi Tủ Truyện" : "Lưu vào Tủ Truyện"}
                        </button>
                    </div>
                </div>
            </div>

            {/* VIP Download Box */}
            {isVip && (
                <div className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 transition-colors ${
                    isDark ? "bg-[#161b22]/40 border-amber-500/20" : "bg-amber-500/5 border-amber-500/10 shadow-sm"
                }`}>
                    <div className="space-y-1 text-left flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 justify-center sm:justify-start">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border max-w-max uppercase tracking-wider ${
                                isDark ? "bg-amber-500/10 text-amber-400 border-amber-500/30" : "bg-amber-100 text-amber-800 border-amber-200"
                            }`}>
                                VIP Download
                            </span>
                            {downloadStatus === "idle" && (
                                <span className={`text-[10px] font-medium ${isDark ? "text-zinc-400" : "text-zinc-550"}`}>
                                    Lượt tải hôm nay: <span className="font-extrabold text-amber-500">Không giới hạn</span>
                                </span>
                            )}
                            {downloadStatus === "downloading" && (
                                <span className={`text-[10px] font-medium text-blue-500 animate-pulse`}>
                                    Đang tiến hành tải: {downloadProgress}%
                                </span>
                            )}
                            {downloadStatus === "paused" && (
                                <span className={`text-[10px] font-bold text-amber-500`}>
                                    Đã tạm dừng tải
                                </span>
                            )}
                        </div>
                        
                        {downloadStatus === "idle" && (
                            <p className="text-[11px] text-zinc-500">Tải toàn bộ bộ truyện về máy dưới dạng tệp văn bản TXT hoặc sách điện tử EPUB sạch lỗi.</p>
                        )}
                        {downloadStatus === "downloading" && (
                            <div className="w-full space-y-1.5 pr-4">
                                <div className="flex justify-between text-[10px] text-zinc-500 font-semibold">
                                    <span>Đang tải dở dang bản {downloadingFormat?.toUpperCase()}...</span>
                                    <span>{downloadProgress}%</span>
                                </div>
                                <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                                    <div className="bg-amber-500 h-full rounded-full transition-all duration-300" style={{ width: `${downloadProgress}%` }} />
                                </div>
                            </div>
                        )}
                        {downloadStatus === "paused" && (
                            <p className="text-[11px] text-zinc-500">
                                Đã cào được <span className="font-bold text-amber-500">{savedDownloadState?.currentIndex || 0}/{savedDownloadState?.chaptersToDownload?.length || 0}</span> chương bản <span className="font-bold uppercase">{downloadingFormat}</span>. Bạn có thể tiếp tục tải tiếp hoặc hủy để tải lại.
                            </p>
                        )}
                    </div>
                    <div className="flex gap-2 shrink-0 justify-center sm:justify-start">
                        {downloadStatus === "idle" && (
                            <>
                                <button
                                    onClick={() => handleDownload("txt")}
                                    disabled={downloading}
                                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 active:scale-95 transition-all ${
                                        isDark 
                                            ? "bg-zinc-800 hover:bg-zinc-750 text-white border-zinc-700" 
                                            : "bg-white hover:bg-zinc-50 text-zinc-850 border-zinc-200 shadow-xs"
                                    }`}
                                >
                                    Tải TXT
                                </button>
                                <button
                                    onClick={() => handleDownload("epub")}
                                    disabled={downloading}
                                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 active:scale-95 transition-all ${
                                        isDark 
                                            ? "bg-zinc-800 hover:bg-zinc-750 text-white border-zinc-700" 
                                            : "bg-white hover:bg-zinc-50 text-zinc-850 border-zinc-200 shadow-xs"
                                    }`}
                                >
                                    Tải EPUB
                                </button>
                            </>
                        )}
                        {downloadStatus === "downloading" && (
                            <button
                                onClick={handlePauseDownload}
                                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 active:scale-95 transition-all ${
                                    isDark 
                                        ? "bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/30" 
                                        : "bg-red-50 hover:bg-red-100 text-red-600 border-red-200"
                                }`}
                            >
                                <Loader2Icon className="w-3.5 h-3.5 animate-spin" />
                                Tạm dừng
                            </button>
                        )}
                        {downloadStatus === "paused" && (
                            <>
                                <button
                                    onClick={() => handleDownload(downloadingFormat || "txt", true)}
                                    disabled={downloading}
                                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 active:scale-95 transition-all ${
                                        isDark 
                                            ? "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30" 
                                            : "bg-emerald-50 hover:bg-emerald-100 text-emerald-600 border-emerald-200"
                                    }`}
                                >
                                    Tiếp tục tải
                                </button>
                                <button
                                    onClick={handleCancelDownload}
                                    disabled={downloading}
                                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 active:scale-95 transition-all ${
                                        isDark 
                                            ? "bg-zinc-800 hover:bg-zinc-750 text-white border-zinc-700" 
                                            : "bg-white hover:bg-zinc-50 text-zinc-850 border-zinc-200 shadow-xs"
                                    }`}
                                >
                                    Hủy tải dở
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}

            <div className="space-y-3">
                <h3 className="text-xs uppercase tracking-wider font-extrabold text-zinc-500">Danh Sách Chương</h3>
                {story.chapters && story.chapters.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                        {story.chapters.map((c: any, i: number) => (
                            <div
                                key={i}
                                onClick={() => navigateNh({ 
                                    view: "chapter", 
                                    storySlug, 
                                    chapterSlug: c.slug,
                                    storyTitle: story.title,
                                    storyCover: story.cover,
                                    storyAuthor: story.author
                                })}
                                className={`py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-xs hover:text-blue-500 cursor-pointer truncate transition font-medium`}
                            >
                                {c.title}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center text-zinc-500 text-xs py-8">Không có chương nào.</div>
                )}

                {story.totalPages > 1 && (
                    <div className="flex flex-wrap justify-center gap-1.5 pt-4">
                        {Array.from({ length: story.totalPages }, (_, i) => {
                            const p = i + 1;
                            if (p === 1 || p === story.totalPages || Math.abs(p - page) <= 2) {
                                return (
                                    <button
                                        key={p}
                                        onClick={() => setNhState((prev: any) => ({ ...prev, page: p }))}
                                        className={`w-7 h-7 flex items-center justify-center rounded text-[10px] font-bold border transition ${
                                            p === page
                                                ? "bg-blue-600 border-blue-500 text-white"
                                                : isDark
                                                    ? "border-zinc-850 bg-zinc-900/50 text-zinc-400 hover:bg-zinc-800"
                                                    : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                                        }`}
                                    >
                                        {p}
                                    </button>
                                );
                            }
                            if (p === 2 || p === story.totalPages - 1) {
                                return (
                                    <span key={p} className="text-zinc-500 self-center">
                                        ...
                                    </span>
                                );
                            }
                            return null;
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

function NovelHubChapterView({
    nhSource,
    storySlug,
    chapterSlug,
    storyTitle,
    storyCover,
    storyAuthor,
    navigateNhBack,
    setNhState,
    isDark
}: {
    nhSource: string;
    storySlug: string;
    chapterSlug: string;
    storyTitle?: string;
    storyCover?: string;
    storyAuthor?: string;
    navigateNhBack: () => void;
    setNhState: any;
    isDark: boolean;
}) {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [fontSize, setFontSize] = useState(16);
    const [fontFamily, setFontFamily] = useState("font-serif");

    // Load saved font family from localStorage
    useEffect(() => {
        const savedFamily = localStorage.getItem("rr_font_family");
        if (savedFamily) setFontFamily(savedFamily);
    }, []);

    const updateFontFamily = (newFamily: string) => {
        setFontFamily(newFamily);
        localStorage.setItem("rr_font_family", newFamily);
    };

    useEffect(() => {
        setLoading(true);
        const savedCookie = localStorage.getItem("nh_wikidich_cookie") || "";
        const headers: Record<string, string> = {};
        if (nhSource === "wikidich" && savedCookie) {
            headers["x-wikidich-cookie"] = savedCookie;
        }
        fetchNovelHubData("chapter", nhSource, { slug: storySlug, chapterSlug }, headers)
            .then((d) => {
                setData(d);
                window.scrollTo({ top: 0, behavior: "instant" as any });

                // Save to local reading history
                try {
                    const historyStr = localStorage.getItem("rr_history") || "{}";
                    const history = JSON.parse(historyStr);
                    const historyId = `novelhub-${nhSource}-${storySlug}`;
                    
                    history[historyId] = {
                        id: historyId,
                        title: d.storyTitle || storyTitle || "Truyện Nguồn Ngoài",
                        coverImage: storyCover || "",
                        author: storyAuthor || "Khuyết danh",
                        genres: [],
                        lastReadChapterIdx: 0,
                        lastReadChapterTitle: d.title || "Chương mới nhất",
                        lastReadChapterSlug: chapterSlug,
                        totalChapters: 0,
                        updatedAt: Date.now()
                    };
                    localStorage.setItem("rr_history", JSON.stringify(history));
                } catch (e) {
                    console.error("Lỗi lưu lịch sử", e);
                }
            })
            .catch((err) => {
                console.error(err);
                toast.error("Không thể tải nội dung chương.");
            })
            .finally(() => setLoading(false));
    }, [storySlug, chapterSlug, nhSource]);

    const handleDownloadSingleTxt = () => {
        if (!data || !data.content) return;
        const parser = new DOMParser();
        const doc = parser.parseFromString(data.content, "text/html");
        
        const pElements = doc.querySelectorAll("p, div");
        let textContent = "";
        if (pElements.length > 0) {
            const paragraphs: string[] = [];
            pElements.forEach(el => {
                const txt = el.textContent?.trim();
                if (txt) paragraphs.push(txt);
            });
            textContent = paragraphs.join("\n\n");
        } else {
            textContent = (doc.body.textContent || "").trim().replace(/\n\s*\n/g, "\n\n");
        }

        const fullText = `${data.storyTitle || "Truyện"}\n${data.title || "Chương"}\n\n${textContent}`;

        const blob = new Blob([fullText], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${data.storyTitle || "Truyen"} - ${data.title || "Chuong"}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success("Đã tải chương dạng TXT!");
    };

    if (loading) {
        return (
            <div className="flex flex-col justify-center items-center h-48 space-y-4 w-full">
                <Loader2Icon className="w-8 h-8 animate-spin text-blue-500" />
                <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-zinc-550">Đang tải chương...</div>
            </div>
        );
    }

    if (!data || data.error) {
        return (
            <div className="text-center py-12 space-y-4">
                <div className="text-zinc-500 text-xs">Lỗi tải chương. Vui lòng thử lại.</div>
                <button onClick={navigateNhBack} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold">
                    Quay lại
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-page-enter">
            <style dangerouslySetInnerHTML={{ __html: `
                .nh-chapter-content p, 
                .nh-chapter-content div {
                    margin-bottom: 0.8rem !important;
                    line-height: 1.8 !important;
                }
                .nh-chapter-content br {
                    margin-bottom: 0.5rem !important;
                    display: block;
                    content: "";
                }
            `}} />
            {/* Header toolbar */}
            <div className="flex justify-between items-center pb-2 border-b border-zinc-200 dark:border-zinc-800">
                <button
                    onClick={navigateNhBack}
                    className="text-[10px] font-bold tracking-wider text-blue-500 uppercase flex items-center gap-1.5"
                >
                    ◀ Quay lại
                </button>
                <div className="flex gap-2 items-center">
                    <button
                        onClick={handleDownloadSingleTxt}
                        className={`px-2.5 py-1 rounded text-[9px] font-bold border transition ${
                            isDark
                                ? "border-zinc-850 hover:bg-zinc-800 text-zinc-350"
                                : "border-zinc-200 hover:bg-zinc-50 text-zinc-650 bg-white"
                        }`}
                    >
                        Tải TXT
                    </button>
                    {/* Font family selection dropdown */}
                    <select
                        value={fontFamily}
                        onChange={(e) => updateFontFamily(e.target.value)}
                        className={`px-2 py-1 text-[10px] font-bold rounded border h-7 focus:outline-none transition ${
                            isDark
                                ? "bg-zinc-900 border-zinc-700 text-white"
                                : "bg-white border-zinc-300 text-zinc-800"
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
                    <div className="flex border border-zinc-300 dark:border-zinc-700 rounded overflow-hidden">
                        <button
                            onClick={() => setFontSize((f) => Math.max(12, f - 2))}
                            className="px-2.5 py-0.5 bg-white dark:bg-zinc-950 text-xs font-bold border-r border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                        >
                            A-
                        </button>
                        <button
                            onClick={() => setFontSize((f) => Math.min(28, f + 2))}
                            className="px-2.5 py-0.5 bg-white dark:bg-zinc-950 text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                        >
                            A+
                        </button>
                    </div>
                </div>
            </div>

            {/* Chapter header */}
            <div className="text-center space-y-2">
                <h1 className="text-base font-bold text-zinc-550">{data.storyTitle}</h1>
                <h2 className="text-lg font-extrabold leading-snug">{data.title}</h2>
            </div>

            {/* Content text */}
            <div
                className={`select-text whitespace-pre-wrap leading-relaxed text-justify px-1 dark:text-zinc-200 nh-chapter-content ${fontFamily}`}
                style={{ fontSize: `${fontSize}px` }}
                dangerouslySetInnerHTML={{ __html: data.content }}
            />

            {/* Footer prev/next chapter */}
            <div className="flex justify-between items-center pt-6 border-t border-zinc-200 dark:border-zinc-800">
                <button
                    disabled={!data.prevSlug}
                    onClick={() => setNhState((prev: any) => ({ ...prev, chapterSlug: data.prevSlug }))}
                    className={`px-4 py-2 rounded-xl text-xs font-bold border transition ${
                        !data.prevSlug
                            ? "opacity-30 cursor-not-allowed border-transparent text-zinc-500"
                            : isDark
                                ? "border-zinc-850 bg-zinc-900/50 text-zinc-350 hover:bg-zinc-800"
                                : "border-zinc-200 bg-white text-zinc-650 hover:bg-zinc-50 shadow-sm"
                    }`}
                >
                    ◀ Chương trước
                </button>
                <button
                    disabled={!data.nextSlug}
                    onClick={() => setNhState((prev: any) => ({ ...prev, chapterSlug: data.nextSlug }))}
                    className={`px-4 py-2 rounded-xl text-xs font-bold border transition ${
                        !data.nextSlug
                            ? "opacity-30 cursor-not-allowed border-transparent text-zinc-500"
                            : isDark
                                ? "border-zinc-850 bg-zinc-900/50 text-zinc-350 hover:bg-zinc-800"
                                : "border-zinc-200 bg-white text-zinc-650 hover:bg-zinc-50 shadow-sm"
                    }`}
                >
                    Chương sau ▶
                </button>
            </div>
        </div>
    );
}

function NovelHubStoryListView({
    nhSource,
    listType,
    page = 1,
    navigateNh,
    setNhState,
    isDark
}: {
    nhSource: string;
    listType: string;
    page: number;
    navigateNh: (s: any) => void;
    setNhState: any;
    isDark: boolean;
}) {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        const savedCookie = localStorage.getItem("nh_wikidich_cookie") || "";
        const headers: Record<string, string> = {};
        if (nhSource === "wikidich" && savedCookie) {
            headers["x-wikidich-cookie"] = savedCookie;
        }
        fetchNovelHubData("list", nhSource, { type: listType, page }, headers)
            .then((d) => {
                setData(d);
            })
            .catch((err) => {
                console.error(err);
                toast.error("Không thể tải danh sách truyện.");
            })
            .finally(() => setLoading(false));
    }, [listType, page, nhSource]);

    if (loading) {
        return (
            <div className="flex flex-col justify-center items-center h-48 space-y-4 w-full">
                <Loader2Icon className="w-8 h-8 animate-spin text-blue-500" />
                <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-zinc-550">Đang tải danh sách...</div>
            </div>
        );
    }

    if (!data || data.error) {
        return <div className="text-center text-zinc-550 py-12 text-xs">Không tìm thấy danh sách.</div>;
    }

    return (
        <div className="space-y-4 animate-page-enter">
            <h2 className="text-sm font-bold text-zinc-550">{data.title || "Danh sách"}</h2>
            <div
                className={`border rounded-2xl p-4 divide-y ${
                    isDark
                        ? "bg-[#131416] border-zinc-800 divide-zinc-800"
                        : "bg-[#fffbf4] border-zinc-200 divide-zinc-200 shadow-sm"
                }`}
            >
                {!data.results || data.results.length === 0 ? (
                    <div className="text-center py-8 text-zinc-500 text-xs">Không tìm thấy truyện nào.</div>
                ) : (
                    data.results.map((r: any, idx: number) => (
                        <div
                            key={idx}
                            onClick={() => navigateNh({ view: "story", storySlug: r.slug })}
                            className="flex gap-4 py-3.5 first:pt-0 last:pb-0 cursor-pointer group"
                        >
                            {/* Cover Image */}
                            <div className="shrink-0 w-14 aspect-[3/4] bg-zinc-500/10 rounded-lg overflow-hidden border border-zinc-300 dark:border-zinc-800 shadow-sm">
                                {r.cover ? (
                                    <img
                                        src={r.cover}
                                        alt={r.title}
                                        className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                                        referrerPolicy="no-referrer"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-zinc-400 text-xs">📖</div>
                                )}
                            </div>

                            {/* Details */}
                            <div className="flex-1 min-w-0 flex flex-col justify-between">
                                <div>
                                    <h3 className="font-bold text-xs group-hover:text-blue-500 transition leading-snug line-clamp-1">
                                        {r.title}
                                    </h3>
                                    <p className="text-[10px] text-zinc-500 mt-0.5 font-semibold">Tác giả: {r.author || "Khuyết danh"}</p>
                                    {r.desc && (
                                        <p className="text-[10px] text-zinc-600 dark:text-zinc-400 mt-1.5 line-clamp-2 leading-relaxed text-justify">
                                            {r.desc}
                                        </p>
                                    )}
                                </div>
                                <div className="text-[10px] font-semibold text-blue-500 mt-1 flex justify-between items-center">
                                    <span>Chương mới nhất: {r.latestChapter}</span>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {data.totalPages > 1 && (
                <div className="flex flex-wrap justify-center gap-1.5 pt-4">
                    {Array.from({ length: data.totalPages }, (_, i) => {
                        const p = i + 1;
                        if (p === 1 || p === data.totalPages || Math.abs(p - page) <= 2) {
                            return (
                                <button
                                    key={p}
                                    onClick={() => setNhState((prev: any) => ({ ...prev, page: p }))}
                                    className={`w-7 h-7 flex items-center justify-center rounded text-[10px] font-bold border transition ${
                                        p === page
                                            ? "bg-blue-600 border-blue-500 text-white"
                                            : isDark
                                                ? "border-zinc-850 bg-zinc-900/50 text-zinc-405 hover:bg-zinc-800"
                                                : "border-zinc-200 bg-white text-zinc-650 hover:bg-zinc-50"
                                    }`}
                                >
                                    {p}
                                </button>
                            );
                        }
                        if (p === 2 || p === data.totalPages - 1) {
                            return (
                                <span key={p} className="text-zinc-500 self-center">
                                    ...
                                </span>
                            );
                        }
                        return null;
                    })}
                </div>
            )}
        </div>
    );
}
