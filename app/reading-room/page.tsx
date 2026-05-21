"use client";

import { useEffect, useState, useMemo } from "react";
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
    MoonIcon
} from "lucide-react";
import { type Novel } from "@/lib/db";
import { useProfile } from "@/lib/hooks/use-profile";
import { toast } from "sonner";

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
    const [activeTab, setActiveTab] = useState<"library" | "explore" | "catalog" | "account">("explore");
    const [librarySubTab, setLibrarySubTab] = useState<"history" | "bookmarks">("history");
    const [soundMuted, setSoundMuted] = useState(false);

    // Theme state
    const [theme, setTheme] = useState<"light" | "dark">("dark");

    // Sorting configs modal
    const [showLibrarySort, setShowLibrarySort] = useState(false);
    const [librarySortBy, setLibrarySortBy] = useState<"recent" | "new_chap" | "name">("recent");

    // Dynamic state logs
    const [historyList, setHistoryList] = useState<any[]>([]);
    const [bookmarksList, setBookmarksList] = useState<any[]>([]);

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

    // Filter logic on catalog
    const filteredCatalogNovels = useMemo(() => {
        let list = [...novels];

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
    }, [novels, searchQuery, appliedFilters]);

    // Reset visible count when filters or search query changes
    useEffect(() => {
        if (!isRestored) return;
        setVisibleCount(14);
        sessionStorage.setItem("rr_scroll_y", "0");
    }, [appliedFilters, searchQuery, isRestored]);


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
        <div className={`min-h-screen transition-colors duration-250 flex justify-center items-start overflow-x-hidden font-sans ${isDark ? "bg-[#0f0f12]" : "bg-[#f1f1f5]"}`}>
            {/* Full-width viewport with mobile bottom nav space */}
            <div className="w-full min-h-screen relative flex flex-col pb-26 overflow-hidden px-4 md:px-8 max-w-4xl mx-auto">

                {/* Main App Content Viewport */}
                <div className="flex-1 overflow-y-auto pt-6">

                    {/* library tab */}
                    {activeTab === "library" && (
                        <div className="space-y-4 animate-in fade-in duration-300">
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
                                                <Link href={`/reader/${item.id}`} className="shrink-0 w-12 aspect-3/4 rounded-lg bg-zinc-500/10 overflow-hidden relative">
                                                    {item.coverImage ? (
                                                        <img src={item.coverImage} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                                    ) : (
                                                        <div className="w-full h-full bg-zinc-300 dark:bg-zinc-800 flex items-center justify-center text-[10px] text-zinc-500 font-bold p-1 text-center line-clamp-2">{item.title}</div>
                                                    )}
                                                </Link>
                                                <Link href={`/reader/${item.id}`} className="flex-1 min-w-0">
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
                                                <Link href={`/reader/${item.id}`} className="shrink-0 w-12 aspect-3/4 rounded-lg bg-zinc-500/10 overflow-hidden relative">
                                                    {item.coverImage ? (
                                                        <img src={item.coverImage} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                                    ) : (
                                                        <div className="w-full h-full bg-zinc-300 dark:bg-zinc-800 flex items-center justify-center text-[10px] text-zinc-550 font-bold p-1 text-center line-clamp-2">{item.title}</div>
                                                    )}
                                                </Link>
                                                <Link href={`/reader/${item.id}`} className="flex-1 min-w-0">
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
                            )}
                        </div>
                    )}

                    {/* explore tab */}
                    {activeTab === "explore" && (
                        <div className="space-y-6 animate-in fade-in duration-300">
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
                        </div>
                    )}

                    {/* catalog tab (Middle button navigation click) */}
                    {activeTab === "catalog" && (
                        <div className="space-y-4 animate-in fade-in duration-300 pb-8">
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

                            {/* List cards matching Picture 1 exactly */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                                {loading ? (
                                    <div className="col-span-full py-20 flex justify-center items-center"><Loader2Icon className="w-6 h-6 text-blue-555 animate-spin" /></div>
                                ) : filteredCatalogNovels.length === 0 ? (
                                    <div className="col-span-full text-center py-20 text-zinc-500 text-sm font-medium">Không tìm thấy truyện nào phù hợp.</div>
                                ) : (
                                    filteredCatalogNovels.slice(0, visibleCount).map((novel) => {
                                        const displayTag = novel.id.startsWith("mottruyen-")
                                            ? `MT-${novel.id.replace("mottruyen-", "")}`
                                            : novel.id.toUpperCase();

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
                                                    <div className="flex justify-between items-center mt-2">
                                                        <span className="text-[10px] font-semibold text-zinc-500 truncate max-w-[120px]">{novel.author || "Khuyết danh"}</span>
                                                        <div className="flex gap-2 items-center text-[10px] font-bold text-zinc-400">
                                                            <span className="flex items-center text-amber-500">★ 5.0</span>
                                                            <span className="flex items-center">📖 {novel.totalChapters || 483}</span>
                                                        </div>
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
                        <div className="max-w-md mx-auto space-y-4 animate-in fade-in duration-350">
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
