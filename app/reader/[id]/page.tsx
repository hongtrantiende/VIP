"use client";

import { useEffect, useState, useMemo, useRef, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import {
    ArrowLeftIcon,
    BookOpenIcon,
    LockIcon,
    UnlockIcon,
    SearchIcon,
    PencilIcon,
    CheckIcon,
    Loader2Icon,
    XIcon,
    Trash2Icon,
    PlusIcon,
    SunIcon,
    MoonIcon
} from "lucide-react";
import Link from "next/link";
import { type Novel } from "@/lib/db";
import { useProfile } from "@/lib/hooks/use-profile";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { ReadingRoomInteractions } from "@/components/reading-room/interactions";

const CHAPTER_PAGE_SIZE = 50;

export default function StandaloneReaderNovelDetailsPage(props: { params: Promise<{ id: string }> }) {
    const params = use(props.params);
    const novelId = params.id;
    const router = useRouter();

    const [novel, setNovel] = useState<Novel | null>(null);
    const [chapters, setChapters] = useState<{ id: string, title: string, order: number, isLocked?: boolean }[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const { profile } = useProfile();

    const [visibleChapters, setVisibleChapters] = useState(CHAPTER_PAGE_SIZE);
    const [chapterSearch, setChapterSearch] = useState("");

    // Detail UI Sub-tabs
    const [activeSubTab, setActiveSubTab] = useState<"intro" | "reviews" | "comments" | "chapters">("intro");

    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [newTitle, setNewTitle] = useState("");
    const [isSavingTitle, setIsSavingTitle] = useState(false);

    const [isEditingDesc, setIsEditingDesc] = useState(false);
    const [newDesc, setNewDesc] = useState("");
    const [isSavingDesc, setIsSavingDesc] = useState(false);

    // Theme state
    const [theme, setTheme] = useState<"light" | "dark">("light");



    // Infinite scroll for chapters
    const observer = useRef<IntersectionObserver | null>(null);
    const lastChapterRef = useCallback((node: HTMLDivElement | null) => {
        if (loading) return;
        if (observer.current) observer.current.disconnect();

        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && visibleChapters < filteredChapters.length) {
                setVisibleChapters(prev => prev + CHAPTER_PAGE_SIZE);
            }
        });

        if (node) observer.current.observe(node);
    }, [loading, visibleChapters, chapters.length, chapterSearch]);

    // Load theme on mount
    useEffect(() => {
        const savedTheme = localStorage.getItem("rr_theme");
        if (savedTheme === "light" || savedTheme === "dark") {
            setTheme(savedTheme);
        }
    }, []);

    const toggleTheme = () => {
        const nextTheme = theme === "dark" ? "light" : "dark";
        setTheme(nextTheme);
        localStorage.setItem("rr_theme", nextTheme);
        toast.info(nextTheme === "dark" ? "Đã chuyển sang chế độ tối" : "Đã chuyển sang chế độ sáng");
    };

    const filteredChapters = useMemo(() => {
        if (!chapterSearch.trim()) return chapters;
        const q = chapterSearch.toLowerCase().trim();
        return chapters.filter(ch => ch.title?.toLowerCase().includes(q) || String(ch.order + 1).includes(q));
    }, [chapters, chapterSearch]);

    const displayedChapters = useMemo(() => {
        return filteredChapters.slice(0, visibleChapters);
    }, [filteredChapters, visibleChapters]);

    useEffect(() => {
        setVisibleChapters(CHAPTER_PAGE_SIZE);
    }, [chapterSearch]);

    useEffect(() => {
        setLoading(true);
        fetch(`/api/reading-room?action=novel_data&id=${novelId}`)
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    setNovel(data.novel);
                    setChapters(data.chapters || []);

                    // Save to local reading history
                    try {
                        const historyStr = localStorage.getItem("rr_history") || "{}";
                        const history = JSON.parse(historyStr);
                        history[novelId] = {
                            id: novelId,
                            title: data.novel.title,
                            coverImage: data.novel.coverImage,
                            author: data.novel.author,
                            genres: data.novel.genres,
                            lastReadChapterIdx: history[novelId]?.lastReadChapterIdx ?? 0,
                            lastReadChapterTitle: history[novelId]?.lastReadChapterTitle ?? (data.chapters?.[0]?.title || "Chương 1"),
                            totalChapters: data.chapters?.length || 0,
                            updatedAt: Date.now()
                        };
                        localStorage.setItem("rr_history", JSON.stringify(history));
                    } catch (e) {
                        console.error("Lỗi lưu lịch sử", e);
                    }
                } else {
                    setError(data.error || "Không tìm thấy truyện.");
                }
            })
            .catch(() => setError("Lỗi kết nối."))
            .finally(() => setLoading(false));
    }, [novelId]);

    // Bookmarks logic
    const [isBookmarked, setIsBookmarked] = useState(false);
    useEffect(() => {
        try {
            const bookmarks = JSON.parse(localStorage.getItem("rr_bookmarks") || "{}");
            setIsBookmarked(!!bookmarks[novelId]);
        } catch (e) { }
    }, [novelId]);

    const toggleBookmark = () => {
        if (!novel) return;
        try {
            const bookmarks = JSON.parse(localStorage.getItem("rr_bookmarks") || "{}");
            if (bookmarks[novelId]) {
                delete bookmarks[novelId];
                setIsBookmarked(false);
                toast.success("Đã xoá khỏi Đánh dấu");
            } else {
                bookmarks[novelId] = {
                    id: novelId,
                    title: novel.title,
                    coverImage: novel.coverImage || "",
                    author: novel.author || "",
                    genres: novel.genres || [],
                    bookmarkedAt: Date.now(),
                    totalChapters: chapters.length
                };
                setIsBookmarked(true);
                toast.success("Đã thêm vào Đánh dấu");
            }
            localStorage.setItem("rr_bookmarks", JSON.stringify(bookmarks));
        } catch (e) {
            console.error("Lỗi cập nhật đánh dấu", e);
        }
    };

    if (loading) {
        const isDark = theme === "dark";
        return (
            <div className={`min-h-screen flex justify-center items-start overflow-x-hidden font-sans ${isDark ? "bg-[#0f0f12] text-[#f1f1f5]" : "bg-[#faf5ea] text-[#110c08]"}`}>
                <div className="w-full min-h-screen relative flex flex-col pb-20 overflow-hidden max-w-4xl mx-auto px-4 md:px-8">
                    {/* Header skeleton */}
                    <div className="flex justify-between items-center py-4 bg-transparent">
                        <div className={`w-8 h-8 rounded-full animate-pulse ${isDark ? "bg-zinc-800" : "bg-zinc-200"}`} />
                        <div className="flex gap-2">
                            <div className={`w-8 h-8 rounded-full animate-pulse ${isDark ? "bg-zinc-800" : "bg-zinc-200"}`} />
                        </div>
                    </div>

                    {/* Book Detail section skeleton */}
                    <div className={`relative pt-4 pb-6 px-5 rounded-2xl border overflow-hidden animate-pulse ${isDark ? "bg-[#131416]/60 border-zinc-850" : "bg-[#fffbf4]/80 border-zinc-200 shadow-sm"}`}>
                        <div className="relative flex flex-col sm:flex-row gap-5 items-center sm:items-start">
                            {/* Cover skeleton */}
                            <div className={`shrink-0 w-28 aspect-3/4 rounded-xl animate-pulse ${isDark ? "bg-zinc-800" : "bg-zinc-200"}`} />
                            <div className="flex-1 w-full space-y-3 mt-2 sm:mt-0">
                                <div className={`h-4 w-20 rounded animate-pulse ${isDark ? "bg-zinc-800" : "bg-zinc-200"}`} />
                                <div className={`h-6 w-3/4 rounded animate-pulse ${isDark ? "bg-zinc-800" : "bg-zinc-200"}`} />
                                <div className={`h-4 w-1/2 rounded animate-pulse ${isDark ? "bg-zinc-800" : "bg-zinc-200"}`} />
                                <div className="flex gap-3 pt-2">
                                    <div className={`h-4 w-12 rounded animate-pulse ${isDark ? "bg-zinc-800" : "bg-zinc-200"}`} />
                                    <div className={`h-4 w-16 rounded animate-pulse ${isDark ? "bg-zinc-800" : "bg-zinc-200"}`} />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Action buttons skeleton */}
                    <div className="grid grid-cols-2 gap-3 mt-6">
                        <div className={`h-11 rounded-xl animate-pulse ${isDark ? "bg-zinc-800" : "bg-zinc-200"}`} />
                        <div className={`h-11 rounded-xl animate-pulse ${isDark ? "bg-zinc-800" : "bg-zinc-200"}`} />
                    </div>

                    {/* Tabs indicator skeleton */}
                    <div className={`flex border-b mt-8 ${isDark ? "border-zinc-800" : "border-zinc-200"}`}>
                        <div className={`h-9 w-24 animate-pulse relative -bottom-px border-b-2 ${isDark ? "border-blue-500 bg-zinc-900/30" : "border-blue-500 bg-zinc-100/50"}`} />
                        <div className="h-9 w-24 ml-2" />
                    </div>

                    {/* Description or Chapters list skeleton */}
                    <div className="mt-6 space-y-3">
                        <div className={`h-4 w-full rounded animate-pulse ${isDark ? "bg-zinc-800" : "bg-zinc-200"}`} />
                        <div className={`h-4 w-full rounded animate-pulse ${isDark ? "bg-zinc-800" : "bg-zinc-200"}`} />
                        <div className={`h-4 w-5/6 rounded animate-pulse ${isDark ? "bg-zinc-800" : "bg-zinc-200"}`} />
                        <div className={`h-4 w-3/4 rounded animate-pulse ${isDark ? "bg-zinc-800" : "bg-zinc-200"}`} />
                    </div>

                    {/* Chapters Grid Skeleton */}
                    <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className={`p-4 rounded-xl border animate-pulse flex justify-between items-center ${isDark ? "bg-[#131416]/60 border-zinc-850" : "bg-[#fffbf4] border-zinc-200"}`}>
                                <div className="space-y-1.5 flex-1 mr-4">
                                    <div className={`h-4 w-32 rounded animate-pulse ${isDark ? "bg-zinc-800" : "bg-zinc-200"}`} />
                                    <div className={`h-3 w-16 rounded animate-pulse ${isDark ? "bg-zinc-800" : "bg-zinc-200"}`} />
                                </div>
                                <div className={`w-4 h-4 rounded animate-pulse ${isDark ? "bg-zinc-800" : "bg-zinc-200"}`} />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    if (error || !novel) {
        return (
            <div className="min-h-screen bg-[#0f0f12] flex flex-col justify-center items-center px-6 text-center text-[#f1f1f5]">
                <h1 className="text-lg font-bold mb-2">Lỗi tải dữ liệu</h1>
                <p className="text-xs text-zinc-550 mb-6">{error}</p>
                <button onClick={() => router.push("/reading-room")} className="px-5 py-2.5 bg-zinc-800 text-xs font-bold rounded-xl text-white">Quay lại Phòng Đọc</button>
            </div>
        );
    }

    const isAdmin = profile && ["nthanhnam2005@gmail.com", "thanhxnam2005@gmail.com"].includes(profile.email?.toLowerCase());
    const isUploader = profile && (isAdmin || (novel as any).uploaderId === profile.id);

    const handleSaveTitle = async () => {
        if (!newTitle.trim() || newTitle === novel.title) {
            setIsEditingTitle(false);
            return;
        }
        setIsSavingTitle(true);
        try {
            const res = await fetch(`/api/reading-room?action=edit_metadata&novelId=${novelId}`, {
                method: 'POST',
                body: JSON.stringify({ newTitle: newTitle.trim() })
            });
            const data = await res.json();
            if (data.success) {
                setNovel({ ...novel, title: newTitle.trim() });
                toast.success('Đã cập nhật tiêu đề thành công');
                setIsEditingTitle(false);
            } else {
                toast.error(data.error || 'Có lỗi xảy ra');
            }
        } catch (err: any) {
            toast.error(err.message || 'Có lỗi xảy ra');
        } finally {
            setIsSavingTitle(false);
        }
    };

    const handleSaveDesc = async () => {
        setIsSavingDesc(true);
        try {
            const res = await fetch(`/api/reading-room?action=edit_metadata&novelId=${novelId}`, {
                method: 'POST',
                body: JSON.stringify({ newDescription: newDesc.trim() })
            });
            const data = await res.json();
            if (data.success) {
                setNovel({ ...novel, description: newDesc.trim() });
                toast.success('Đã cập nhật giới thiệu thành công');
                setIsEditingDesc(false);
            } else {
                toast.error(data.error || 'Có lỗi xảy ra');
            }
        } catch (err: any) {
            toast.error(err.message || 'Có lỗi xảy ra');
        } finally {
            setIsSavingDesc(false);
        }
    };

    const handleToggleLock = async (idx: number, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        try {
            const res = await fetch(`/api/reading-room?action=toggle_chapter_lock&novelId=${novelId}&idx=${idx}`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                setChapters(prev => prev.map((ch, i) => i === idx ? { ...ch, isLocked: data.isLocked } : ch));
                toast.success(data.isLocked ? "Đã khóa chương" : "Đã mở khóa chương");
            } else {
                toast.error(data.error || 'Lỗi khóa chương');
            }
        } catch (err: any) {
            toast.error(err.message || 'Lỗi');
        }
    };

    const handleDeleteNovel = async () => {
        if (!confirm("Bạn có chắc chắn muốn xoá truyện này khỏi Phòng Đọc không?")) return;
        try {
            const res = await fetch(`/api/reading-room?action=delete&novelId=${novelId}`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                toast.success("Đã xoá truyện thành công!");
                router.push("/reading-room");
            } else {
                toast.error(data.error || "Xoá truyện thất bại.");
            }
        } catch (err: any) {
            toast.error("Lỗi: " + err.message);
        }
    };

    const isDark = theme === "dark";

    return (
        <div className={`min-h-screen transition-colors duration-250 flex justify-center items-start overflow-x-hidden font-sans ${isDark ? "bg-[#0f0f12] text-[#f1f1f5]" : "bg-[#faf5ea] text-[#110c08]"}`}>
            {/* Full viewport scale layout on PC */}
            <div className="w-full min-h-screen relative flex flex-col pb-20 overflow-hidden max-w-4xl mx-auto px-4 md:px-8">

                {/* Back & Title Header Row */}
                <div className="flex justify-between items-center py-4 bg-transparent z-40">
                    <button onClick={() => router.push("/reading-room")} className={`p-2 rounded-full transition ${isDark ? "text-white hover:bg-zinc-800/30" : "text-zinc-700 hover:bg-zinc-200/50"}`}>
                        <ArrowLeftIcon className="w-5 h-5" />
                    </button>

                    <div className="flex gap-2 items-center">
                        <button
                            onClick={toggleTheme}
                            className={`p-2 rounded-full transition ${isDark ? "bg-zinc-800/40 hover:bg-zinc-850 text-white" : "bg-white hover:bg-zinc-100 text-zinc-700 shadow-sm border border-zinc-200"}`}
                        >
                            {isDark ? <SunIcon className="w-4.5 h-4.5" /> : <MoonIcon className="w-4.5 h-4.5" />}
                        </button>
                        {isUploader && (
                            <button onClick={handleDeleteNovel} className="p-2 text-red-500 hover:bg-red-950/20 rounded-full">
                                <Trash2Icon className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                </div>

                {/* Blurred Cover Header area matching screenshots */}
                <div className={`relative pt-4 pb-6 px-5 rounded-2xl border overflow-hidden transition ${isDark ? "bg-[#131416]/60 border-zinc-850" : "bg-[#fffbf4]/80 border-zinc-200 shadow-sm"
                    }`}>
                    {/* Blur bg wrapper */}
                    {novel.coverImage && isDark && (
                        <div
                            className="absolute inset-0 bg-cover bg-center filter blur-3xl opacity-20 select-none pointer-events-none scale-110"
                            style={{ backgroundImage: `url(${novel.coverImage})` }}
                        />
                    )}

                    <div className="relative flex flex-col sm:flex-row gap-5 items-center sm:items-start z-10">
                        {/* Cover Image */}
                        <div className={`shrink-0 w-28 aspect-3/4 rounded-xl overflow-hidden shadow-md border ${isDark ? "bg-zinc-850 border-zinc-800" : "bg-zinc-100 border-zinc-200"
                            }`}>
                            {novel.coverImage ? (
                                <img src={novel.coverImage} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                                <div className="w-full h-full bg-zinc-805 flex items-center justify-center p-2 text-center text-[10px] font-bold text-zinc-400">{novel.title}</div>
                            )}
                        </div>

                        {/* Metadata Details */}
                        <div className="flex-1 min-w-0 text-center sm:text-left">
                            <div className="flex gap-1.5 flex-wrap mb-1 justify-center sm:justify-start">
                                {novel.genres?.[0] && (
                                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded border max-w-max uppercase tracking-wider block ${isDark ? "bg-sky-550/10 text-sky-400 border-sky-405/20" : "bg-sky-50 text-sky-655 border-sky-100"
                                        }`}>
                                        {novel.genres[0]}
                                    </span>
                                )}
                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded border max-w-max uppercase tracking-wider block ${isDark ? "bg-zinc-800 text-zinc-400 border-zinc-700/50" : "bg-zinc-100 text-zinc-500 border-zinc-200 shadow-sm"
                                    }`}>
                                    {novel.id.startsWith("mottruyen-") ? `MT-${novel.id.replace("mottruyen-", "")}` : novel.id.toUpperCase()}
                                </span>
                            </div>

                            {/* Title with edit mode support */}
                            {isEditingTitle ? (
                                <div className="flex items-center gap-1.5 mt-1 justify-center sm:justify-start">
                                    <Input
                                        value={newTitle}
                                        onChange={e => setNewTitle(e.target.value)}
                                        className="h-8 text-xs bg-zinc-900 max-w-xs"
                                        disabled={isSavingTitle}
                                    />
                                    <button onClick={handleSaveTitle} disabled={isSavingTitle} className="p-1.5 bg-blue-600 rounded text-white flex items-center justify-center"><CheckIcon className="w-4 h-4" /></button>
                                    <button onClick={() => setIsEditingTitle(false)} className="p-1.5 bg-zinc-800 rounded text-zinc-400 flex items-center justify-center"><XIcon className="w-4 h-4" /></button>
                                </div>
                            ) : (
                                <h1 className="text-base sm:text-lg font-extrabold mt-1 leading-tight flex items-center justify-center sm:justify-start gap-2">
                                    <span className={isDark ? "text-white" : "text-zinc-900"}>{novel.title}</span>
                                    {isUploader && (
                                        <button onClick={() => { setNewTitle(novel.title); setIsEditingTitle(true); }} className="text-zinc-500 hover:text-zinc-200">
                                            <PencilIcon className="w-4 h-4" />
                                        </button>
                                    )}
                                </h1>
                            )}

                            {/* Author */}
                            <p className="text-xs text-zinc-400 font-semibold mt-1">Tác giả: {novel.author || "Khuyết danh"}</p>

                            {/* Rating Stars row */}
                            <div className="flex items-center justify-center sm:justify-start gap-1.5 mt-2">
                                <span className={`text-[10px] font-semibold ${isDark ? "text-zinc-300" : "text-zinc-600"}`}>5.0 (2 đánh giá)</span>
                                <div className="flex gap-0.5 text-amber-500 text-xs">★★★★★</div>
                            </div>

                            {/* Actions block */}
                            <div className="flex gap-2.5 mt-4 justify-center sm:justify-start">
                                <Link
                                    href={`/reader/${novel.id}/0`}
                                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 active:scale-95 transition text-xs font-bold rounded-full text-white flex items-center gap-1.5"
                                >
                                    <BookOpenIcon className="w-4 h-4" /> Đọc truyện
                                </Link>
                                <button
                                    onClick={toggleBookmark}
                                    className={`px-4 py-2 text-xs font-bold rounded-full flex items-center gap-1.5 border transition ${isBookmarked
                                        ? isDark
                                            ? "bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/30"
                                            : "bg-red-50 hover:bg-red-100 text-red-655 border-red-200"
                                        : isDark
                                            ? "bg-transparent text-zinc-300 border-zinc-800 hover:bg-zinc-900"
                                            : "bg-transparent text-zinc-600 border-zinc-300 hover:bg-zinc-100"
                                        }`}
                                >
                                    {isBookmarked ? (
                                        <XIcon className="w-4 h-4" />
                                    ) : (
                                        <PlusIcon className="w-4 h-4" />
                                    )}
                                    <span>{isBookmarked ? "Xóa khỏi Tủ Truyện" : "Thêm vào Tủ Truyện"}</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Sub Tab selection header bar matching screenshots */}
                <div className={`flex border-b text-xs font-bold text-center mt-5 transition-colors ${isDark ? "border-zinc-850 bg-[#131416]/50" : "border-zinc-200 bg-zinc-100/50"
                    }`}>
                    {[
                        { id: "intro", label: "Giới Thiệu" },
                        { id: "reviews", label: "Đánh Giá" },
                        { id: "comments", label: "Bình Luận" },
                        { id: "chapters", label: "D.S Chương" }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            className={`flex-1 py-3 transition-colors relative ${activeSubTab === tab.id ? isDark ? "text-white" : "text-zinc-900" : "text-zinc-500"}`}
                            onClick={() => setActiveSubTab(tab.id as any)}
                        >
                            <span>{tab.label}</span>
                            {activeSubTab === tab.id && <span className={`absolute bottom-0 left-1/4 right-1/4 h-0.5 rounded-full ${isDark ? "bg-white" : "bg-black"}`} />}
                        </button>
                    ))}
                </div>

                {/* Sub tab content area */}
                <div className="flex-1 overflow-y-auto py-5 space-y-4">

                    {activeSubTab === "intro" && (
                        <div className="space-y-4 animate-in fade-in duration-200">
                            {/* stats card row */}
                            <div className={`grid grid-cols-3 gap-1 py-3.5 rounded-xl border text-center select-none ${isDark ? "bg-[#131416] border-zinc-850" : "bg-[#fffbf4] border-zinc-200 shadow-sm"
                                }`}>
                                <div>
                                    <p className="text-base font-extrabold">3</p>
                                    <p className="text-[10px] text-zinc-500 font-bold uppercase mt-0.5">Chương/Tuần</p>
                                </div>
                                <div className={`border-x ${isDark ? "border-zinc-850" : "border-zinc-200"}`}>
                                    <p className="text-base font-extrabold">{chapters.length}</p>
                                    <p className="text-[10px] text-zinc-500 font-bold uppercase mt-0.5">Chương - Còn tiếp</p>
                                </div>
                                <div>
                                    <p className="text-base font-extrabold">1,2K</p>
                                    <p className="text-[10px] text-zinc-500 font-bold uppercase mt-0.5">Lượt đọc</p>
                                </div>
                            </div>

                            {/* Intro text */}
                            <div className={`p-4.5 rounded-xl border transition ${isDark ? "bg-[#131416]/50 border-zinc-850/50" : "bg-[#fffbf4] border-zinc-200 shadow-sm"
                                }`}>
                                <div className="flex justify-between items-center mb-2">
                                    <h3 className="text-xs font-bold uppercase tracking-wider">Thông điệp truyện</h3>
                                    {isUploader && !isEditingDesc && (
                                        <button onClick={() => { setNewDesc(novel.description || ""); setIsEditingDesc(true); }} className="text-[10px] font-bold text-zinc-400">Chỉnh sửa</button>
                                    )}
                                </div>

                                {isEditingDesc ? (
                                    <div className="space-y-2">
                                        <textarea
                                            value={newDesc}
                                            onChange={e => setNewDesc(e.target.value)}
                                            className="w-full text-xs min-h-[120px] p-2.5 bg-zinc-900 border border-zinc-800 rounded outline-none"
                                        />
                                        <div className="flex gap-2 justify-end">
                                            <button onClick={() => setIsEditingDesc(false)} className="px-2.5 py-1 text-[10px] font-bold bg-zinc-800 rounded">Hủy</button>
                                            <button onClick={handleSaveDesc} disabled={isSavingDesc} className="px-2.5 py-1 text-[10px] font-bold bg-blue-600 rounded text-white flex items-center justify-center">
                                                {isSavingDesc && <Loader2Icon className="w-3 h-3 mr-1 animate-spin" />} Lưu
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <p className={`text-xs leading-relaxed whitespace-pre-wrap ${isDark ? "text-zinc-300" : "text-zinc-700"}`}>
                                        {novel.description || "Không có lời giới thiệu nào phù hợp."}
                                    </p>
                                )}
                            </div>

                            {/* Genres dynamic tags */}
                            <div className="space-y-2">
                                <h3 className="text-[11px] font-extrabold text-zinc-500 uppercase tracking-widest">Thể loại</h3>
                                <div className="flex flex-wrap gap-1.5">
                                    {novel.genres?.map(g => (
                                        <span key={g} className={`px-3 py-1 rounded-lg text-[9px] font-bold border ${isDark ? "bg-zinc-850 text-zinc-300 border-zinc-800" : "bg-white text-zinc-700 border-zinc-200 shadow-sm"
                                            }`}>{g.toUpperCase()}</span>
                                    ))}
                                </div>
                            </div>

                            {/* Nhãn labels */}
                            <div className="space-y-2">
                                <h3 className="text-[11px] font-extrabold text-zinc-500 uppercase tracking-widest">Nhãn</h3>
                                <div className="flex flex-wrap gap-1.5">
                                    {["VÕ SĨ", "ĐÔNG PHƯƠNG HUYỀN HUYỄN", "VÔ ĐỊCH"].map(tag => (
                                        <span key={tag} className={`px-3 py-1 rounded-lg text-[9px] font-semibold border ${isDark ? "bg-zinc-900 text-zinc-400 border-zinc-800/40" : "bg-zinc-100 text-zinc-500 border-zinc-200"
                                            }`}>{tag}</span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeSubTab === "comments" && (
                        <div className="py-2.5 animate-in fade-in duration-200">
                            {/* Render Interaction panel */}
                            <ReadingRoomInteractions novelId={novel.id} />
                        </div>
                    )}

                    {activeSubTab === "reviews" && (
                        <div className="py-8 text-center text-zinc-550 text-xs italic font-medium animate-in fade-in duration-200">
                            Chưa có nhận xét chi tiết nào cho bộ truyện này.
                        </div>
                    )}

                    {activeSubTab === "chapters" && (
                        <div className="space-y-3.5 animate-in fade-in duration-200">
                            {/* Chapter filter search */}
                            <div className="relative">
                                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                                <input
                                    placeholder="Đi tới chương, số thứ tự..."
                                    value={chapterSearch}
                                    onChange={e => setChapterSearch(e.target.value)}
                                    className={`w-full pl-9 pr-3 py-2 rounded-xl border text-xs outline-none transition ${isDark
                                        ? "bg-zinc-850/50 border-zinc-800 text-white placeholder-zinc-500"
                                        : "bg-white border-zinc-200 text-zinc-900 placeholder-zinc-400 shadow-sm"
                                        }`}
                                />
                            </div>

                            {/* Table of chapters list */}
                            <div className={`divide-y max-h-[300px] overflow-y-auto pr-1 ${isDark ? "divide-zinc-850/50" : "divide-zinc-200/50"}`}>
                                {filteredChapters.length === 0 ? (
                                    <p className="py-10 text-center text-zinc-550 text-xs italic justify-center">Không tìm thấy chương nào.</p>
                                ) : (
                                    displayedChapters.map((ch, idx) => {
                                        const realIdx = chapters.findIndex(c => c.id === ch.id);
                                        return (
                                            <div
                                                key={ch.id}
                                                ref={idx === displayedChapters.length - 1 ? lastChapterRef : null}
                                                className="flex justify-between items-center py-2.5 px-1 group"
                                            >
                                                <Link href={`/reader/${novel.id}/${realIdx}`} className={`flex-1 text-xs font-bold truncate flex items-center gap-1.5 transition-colors ${isDark ? "text-zinc-300 hover:text-blue-500" : "text-zinc-700 hover:text-blue-600"
                                                    }`}>
                                                    {ch.isLocked && <LockIcon className="w-3.5 h-3.5 text-red-500" />}
                                                    <span>{ch.title || `Chương ${realIdx + 1}`}</span>
                                                </Link>
                                                <div className="flex gap-2 items-center">
                                                    {isUploader && (
                                                        <button onClick={(e) => handleToggleLock(realIdx, e)} className="p-1 hover:bg-zinc-800 rounded">
                                                            {ch.isLocked ? <UnlockIcon className="w-3.5 h-3.5 text-emerald-605" /> : <LockIcon className="w-3.5 h-3.5 text-zinc-500" />}
                                                        </button>
                                                    )}
                                                    <span className="text-[10px] text-zinc-500 font-mono">#{realIdx + 1}</span>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Floating detail sticky bottom bar overlay matching screenshots */}
                <div className={`fixed bottom-0 left-0 right-0 h-16 border-t flex items-center justify-between px-4 z-40 shadow-xl max-w-lg mx-auto sm:rounded-t-2xl transition ${isDark ? "bg-[#131416] border-zinc-850" : "bg-[#fffbf4] border-zinc-200"
                    }`}>
                    <div className="min-w-0 pr-3">
                        <p className={`text-[11px] font-extrabold truncate max-w-[185px] ${isDark ? "text-white" : "text-zinc-950"}`}>{novel.title}</p>
                        <p className="text-[9px] text-[#52525b] font-bold mt-0.5">{novel.genres?.[0] || "Huyền Huyễn"}</p>
                    </div>

                    <div className="flex gap-2">
                        <Link
                            href={`/reader/${novel.id}/0`}
                            className={`px-5 py-2 rounded-full border text-[11px] font-extrabold active:scale-95 transition ${isDark
                                ? "bg-black hover:bg-zinc-950 text-white border-zinc-800"
                                : "bg-black hover:bg-zinc-950 text-white border-black"
                                }`}
                        >
                            Đọc
                        </Link>
                        <button
                            onClick={toggleBookmark}
                            className={`w-9 h-9 rounded-full flex items-center justify-center border transition ${isBookmarked
                                ? "bg-blue-600 border-blue-500 text-white"
                                : isDark
                                    ? "border-zinc-800 text-zinc-400 hover:bg-zinc-850"
                                    : "border-zinc-300 text-zinc-650 hover:bg-zinc-100"
                                }`}
                        >
                            <PlusIcon className="w-4 h-4" />
                        </button>
                    </div>
                </div>

            </div>
        </div >
    );
}
