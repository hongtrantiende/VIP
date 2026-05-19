"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { BookOpenIcon, SearchIcon, XIcon, Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReadingRoomMetadata } from "@/lib/google-drive-admin-v2";

const PAGE_SIZE = 9;

export default function ReadingRoomPage() {
    const [novels, setNovels] = useState<ReadingRoomMetadata[] | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [activeGenre, setActiveGenre] = useState<string>("all");
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const router = useRouter();

    // Observer for infinite scroll
    const observer = useRef<IntersectionObserver | null>(null);
    const lastElementRef = useCallback((node: HTMLDivElement | null) => {
        if (novels === null) return;
        if (observer.current) observer.current.disconnect();

        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting) {
                setVisibleCount(prev => prev + PAGE_SIZE);
            }
        });

        if (node) observer.current.observe(node);
    }, [novels]);

    useEffect(() => {
        fetch('/api/reading-room?action=list')
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    setNovels(data.novels);
                } else {
                    setNovels([]);
                }
            })
            .catch(() => setNovels([]));
    }, []);

    function formatDate(ts: number) {
        return new Date(ts).toLocaleDateString("vi-VN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        });
    }

    const allGenres = useMemo(() => {
        if (!novels) return [];
        const genresSet = new Set<string>();
        novels.forEach(n => {
            if (n.genres && Array.isArray(n.genres)) {
                n.genres.forEach(g => genresSet.add(g));
            }
        });
        return Array.from(genresSet).sort();
    }, [novels]);

    const filteredNovels = useMemo(() => {
        if (!novels) return null;
        let res = novels;

        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            res = res.filter(n => n.title.toLowerCase().includes(q));
        }

        if (activeGenre !== "all") {
            res = res.filter(n => n.genres && n.genres.includes(activeGenre));
        }

        return res;
    }, [novels, searchQuery, activeGenre]);

    const displayedNovels = useMemo(() => {
        if (!filteredNovels) return [];
        return filteredNovels.slice(0, visibleCount);
    }, [filteredNovels, visibleCount]);

    const hasMore = filteredNovels ? visibleCount < filteredNovels.length : false;

    // Reset visible count when search or genre changes
    useEffect(() => {
        setVisibleCount(PAGE_SIZE);
    }, [searchQuery, activeGenre]);

    if (novels === null || filteredNovels === null) {
        return (
            <main className="mx-auto w-full max-w-6xl px-6 py-8">
                <div className="mb-6">
                    <Skeleton className="h-8 w-48" />
                    <Skeleton className="mt-2 h-4 w-72" />
                </div>
                <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {Array.from({ length: 10 }).map((_, i) => (
                        <div key={i} className="animate-pulse">
                            <div className="aspect-3/4 w-full rounded-lg bg-muted" />
                            <div className="mt-2 space-y-1.5 px-0.5">
                                <div className="h-3 w-4/5 rounded bg-muted" />
                                <div className="h-2.5 w-3/5 rounded bg-muted" />
                            </div>
                        </div>
                    ))}
                </div>
            </main>
        );
    }

    return (
        <main className="mx-auto w-full max-w-6xl px-6 py-8">
            <div className="mb-8 border-b pb-6">
                <h1 className="font-heading text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-primary/10">
                        <BookOpenIcon className="w-8 h-8" />
                    </div>
                    Phòng Đọc Cộng Đồng
                </h1>
                <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
                    Nơi chia sẻ và đọc truyện được tải lên bởi các thành viên. Khám phá kho truyện phong phú, đa dạng thể loại.
                </p>
            </div>

            {novels.length > 0 && (
                <div className="mb-6 flex flex-wrap gap-3 items-center">
                    <div className="relative w-full sm:w-72">
                        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder="Tìm kiếm truyện trong Phòng Đọc..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-8 pr-8"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery("")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                            >
                                <XIcon className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                    {allGenres.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            <Badge
                                variant={activeGenre === "all" ? "default" : "outline"}
                                className="cursor-pointer px-3 py-1 rounded-full transition-all"
                                onClick={() => setActiveGenre("all")}
                            >
                                Tất Cả
                            </Badge>
                            {allGenres.map(genre => (
                                <Badge
                                    key={genre}
                                    variant={activeGenre === genre ? "default" : "outline"}
                                    className="cursor-pointer px-3 py-1 rounded-full transition-all"
                                    onClick={() => setActiveGenre(genre)}
                                >
                                    {genre}
                                </Badge>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {filteredNovels.length === 0 ? (
                <div className="text-center py-20 bg-muted/20 rounded-2xl border-2 border-dashed">
                    <BookOpenIcon className="mx-auto h-16 w-16 text-muted-foreground/30 mb-4" />
                    <h3 className="text-xl font-semibold text-foreground/80">
                        {novels.length === 0 ? "Chưa có bộ truyện nào" : "Không tìm thấy bộ truyện nào"}
                    </h3>
                    <p className="text-muted-foreground text-sm mt-2 max-w-sm mx-auto">
                        {novels.length === 0
                            ? "Hãy là người đầu tiên chia sẻ truyện từ Thư viện cá nhân lên Phòng Đọc!"
                            : "Không tìm thấy kết quả phù hợp. Hãy thử thay đổi từ khoá hoặc bộ lọc."}
                    </p>
                </div>
            ) : (
                <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {displayedNovels.map((novel, index) => (
                        <div
                            key={novel.id}
                            className="group cursor-pointer"
                            onClick={() => router.push(`/reading-room/${novel.id}`)}
                        >
                            {/* Book cover — portrait 3:4 ratio */}
                            <div className="relative aspect-3/4 w-full overflow-hidden rounded-lg bg-muted shadow-sm transition-shadow group-hover:shadow-md">
                                {novel.coverImage ? (
                                    <img
                                        src={novel.coverImage}
                                        alt={novel.title}
                                        referrerPolicy="no-referrer"
                                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                                    />
                                ) : (
                                    <div className="flex h-full flex-col justify-center items-center p-3 font-serif bg-gradient-to-br from-primary/10 to-primary/5">
                                        <p className="line-clamp-3 text-sm font-semibold leading-snug text-center text-foreground/80">
                                            {novel.title}
                                        </p>
                                    </div>
                                )}
                                {/* Genre + chapter count overlay */}
                                <div className="absolute inset-x-0 bottom-0 flex flex-wrap gap-1 bg-linear-to-t from-black/60 to-transparent p-2 pt-4">
                                    <span className="rounded-sm bg-black/50 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white/90 backdrop-blur-sm">
                                        {novel.chapterCount} ch
                                    </span>
                                    {novel.genres && novel.genres[0] && (
                                        <span className="rounded-sm bg-primary/70 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white/90 backdrop-blur-sm">
                                            {novel.genres[0]}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Info below cover */}
                            <div className="mt-2 px-0.5">
                                <p className="line-clamp-2 text-sm font-semibold leading-snug group-hover:text-primary transition-colors">
                                    {novel.title}
                                </p>
                                <p className="mt-0.5 truncate text-[11px] text-muted-foreground font-medium">
                                    {novel.uploaderName}
                                </p>
                                <p className="text-[10px] text-muted-foreground/60">
                                    {formatDate(novel.updatedAt)}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Infinite Scroll Trigger */}
            {hasMore && (
                <div ref={lastElementRef} className="py-12 flex justify-center">
                    <Loader2Icon className="w-8 h-8 text-primary animate-spin" />
                </div>
            )}

            {!hasMore && filteredNovels && filteredNovels.length > 0 && (
                <div className="mt-16 text-center text-muted-foreground text-sm">
                    Bạn đã xem hết tất cả bộ truyện. 🎉
                </div>
            )}
        </main>
    );
}
