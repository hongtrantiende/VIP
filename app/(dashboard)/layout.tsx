"use client";

import { AppSidebar, miscNav, navConfig } from "@/components/app-sidebar";
import { DictInitializer } from "@/components/dict-initializer";
import { GlobalSearchDialog } from "@/components/global-search-dialog";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { WelcomeModal } from "@/components/welcome-modal";
import { Button } from "@/components/ui/button";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useChatPanel } from "@/lib/stores/chat-panel";
import { useGlobalSearch } from "@/lib/stores/global-search";
import { useNameDictPanel } from "@/lib/stores/name-dict-panel";
import { isLocalhost } from "@/lib/utils";
import { useReaderPanel } from "@/lib/stores/reader-panel";
import {
  BookTextIcon,
  BotIcon,
  Loader2Icon,
  MoonIcon,
  SearchIcon,
  SunIcon,
  Volume2Icon,
} from "lucide-react";
import { PageContextSync } from "@/components/chat/page-context-sync";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { type User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { ScraperOverlay } from "@/components/scraper/scraper-overlay";

// Lazy load heavy panel components for faster initial render
const ChatPanel = lazy(() => import("@/components/chat-panel").then(m => ({ default: m.ChatPanel })));
const NameDictPanel = lazy(() => import("@/components/name-dict/name-dict-panel").then(m => ({ default: m.NameDictPanel })));
const ReaderPanel = lazy(() => import("@/components/reader/reader-panel").then(m => ({ default: m.ReaderPanel })));

const pageTitles: Record<string, string> = Object.fromEntries(
  [...navConfig, ...miscNav].map((item) => [item.href, item.title]),
);

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  let pageTitle = pageTitles[pathname] ?? "Novel Studio";
  if (pathname.match(/^\/novels\/[^/]+$/)) pageTitle = "Tiểu thuyết";
  if (pathname.match(/^\/novels\/[^/]+\/read(\/\d+)?$/))
    pageTitle = "Đọc truyện";
  if (pathname.match(/^\/novels\/[^/]+\/chapters\/.+$/))
    pageTitle = "Soạn thảo";
  if (pathname === "/admin") pageTitle = "Quản trị";
  const novelIdMatch = pathname.match(/^\/novels\/([^/]+)/);
  const currentNovelId = novelIdMatch?.[1] ?? null;
  const chapterIdMatch = pathname.match(/^\/novels\/[^/]+\/chapters\/([^/]+)/);
  const currentChapterId = chapterIdMatch?.[1] ?? null;
  const readerOrderMatch = pathname.match(/^\/novels\/[^/]+\/read\/(\d+)/);
  const currentReaderOrder = readerOrderMatch
    ? parseInt(readerOrderMatch[1], 10)
    : null;
  const toggleChat = useChatPanel((s) => s.toggle);
  const isReaderOpen = useReaderPanel((s) => s.isOpen);
  const isReaderPlaying = useReaderPanel((s) => s.isPlaying);
  const toggleReader = useReaderPanel((s) => s.toggle);
  const toggleSearch = useGlobalSearch((s) => s.toggle);
  const nameDictToggle = useNameDictPanel((s) => s.toggle);
  const nameDictSetNovelId = useNameDictPanel((s) => s.setNovelId);
  const toggleNameDict = () => nameDictToggle(currentNovelId);

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const isAdmin = true;
  const isVip = true;

  // Keep name dict panel's novelId in sync with URL
  useEffect(() => {
    nameDictSetNovelId(currentNovelId);
  }, [currentNovelId, nameDictSetNovelId]);



  const handleLogout = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

  const handleRefreshAuth = useCallback(async () => {
    if (!supabase) return;
    setAuthLoading(true);
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) {
        console.error('Refresh auth error:', error);
      }
      setUser(session?.user ?? null);
    } catch (err) {
      console.error('Refresh auth exception:', err);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  // Global search shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleSearch();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSearch]);

  const [dark, setDark] = useState(false);
  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const isDark = stored === "dark";
    document.documentElement.classList.toggle("dark", isDark);
    setDark(isDark);
  }, []);
  const toggleDark = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
    setDark(next);
  };

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="mesh-bg">
        <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background/80 backdrop-blur-md px-3 sm:px-4">
          <SidebarTrigger className="-ml-1" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>{pageTitle}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleReader}
              className={
                isReaderPlaying
                  ? !isReaderOpen
                    ? "bg-orange-500/10 text-orange-600 dark:text-orange-400 animate-pulse"
                    : "bg-muted"
                  : undefined
              }
              title="Đọc truyện (TTS)"
            >
              <Volume2Icon className="mr-0.5" />
              Đọc truyện
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleSearch}
              title="Tìm kiếm (⌘K)"
            >
              <SearchIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleDark}
              title="Chế độ sáng/tối"
            >
              {dark ? <SunIcon /> : <MoonIcon />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleNameDict}
              title="Từ điển tên"
            >
              <BookTextIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleChat}
              title="Bật/tắt AI Chat (⌘.)"
            >
              <BotIcon />
            </Button>
          </div>
        </header>
        <div className="min-w-0 flex-1 overflow-auto">{children}</div>
      </SidebarInset>
      <PageContextSync
        novelId={currentNovelId}
        pathnameChapterId={currentChapterId}
        readerChapterOrder={currentReaderOrder}
      />
      <Suspense fallback={null}>
        <ReaderPanel />
      </Suspense>
      <Suspense fallback={null}>
        <ChatPanel />
      </Suspense>
      <Suspense fallback={null}>
        <NameDictPanel />
      </Suspense>
      <DictInitializer />
      <GlobalSearchDialog />
      <WelcomeModal />
      <ScraperOverlay />
    </SidebarProvider>
  );
}
