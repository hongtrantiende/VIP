"use client";

import { AppSidebar, miscNav, navConfig } from "@/components/app-sidebar";
import { GlobalSearchDialog } from "@/components/global-search-dialog";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { VipGuard } from "@/components/vip-guard";
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
import { useProfile } from "@/lib/hooks/use-profile";
import { CrownIcon } from "lucide-react";



// Lazy load heavy panel components for faster initial render
const ChatPanel = lazy(() => import("@/components/chat-panel").then(m => ({ default: m.ChatPanel })));
const NameDictPanel = lazy(() => import("@/components/name-dict/name-dict-panel").then(m => ({ default: m.NameDictPanel })));
const ReaderPanel = lazy(() => import("@/components/reader/reader-panel").then(m => ({ default: m.ReaderPanel })));
const DictInitializer = lazy(() => import("@/components/dict-initializer").then(m => ({ default: m.DictInitializer })));
const WelcomeModal = lazy(() => import("@/components/welcome-modal").then(m => ({ default: m.WelcomeModal })));

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
  const { isVip, profile, loadProfile } = useProfile();

  // Single-session enforcement: check if another device took over
  useEffect(() => {
    if (!profile) return;
    const localToken = localStorage.getItem("session_token");
    if (!localToken) return; // No token = old login, skip check

    const interval = setInterval(async () => {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        const { data } = await supabase
          .from("profiles")
          .select("active_session_id")
          .eq("id", profile.id)
          .single();

        if (data?.active_session_id && data.active_session_id !== localToken) {
          // Another device logged in — force logout
          clearInterval(interval);
          localStorage.removeItem("session_token");
          await supabase.auth.signOut();
          router.push("/login");
          // Use alert instead of toast since we're leaving
          alert("Tài khoản đã đăng nhập ở thiết bị khác. Bạn đã bị đăng xuất.");
        }
      } catch {}
    }, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, [profile, router]);

  // Keep name dict panel's novelId in sync with URL
  useEffect(() => {
    nameDictSetNovelId(currentNovelId);
  }, [currentNovelId, nameDictSetNovelId]);




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
    if (document.documentElement.classList.contains("dark")) setDark(true);
  }, []);
  const toggleDark = useCallback(() => {
    const isDark = document.documentElement.classList.toggle("dark");
    setDark(isDark);
    if (isDark) localStorage.setItem("theme", "dark");
    else localStorage.setItem("theme", "light");
  }, []);

  return (
    <SidebarProvider defaultOpen={true}>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger className="-ml-2" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage className="font-semibold">
                  {pageTitle}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-1.5">
            {profile && (
              <Button
                variant="outline"
                size="sm"
                className={`hidden sm:flex h-8 text-xs ${isVip ? "text-yellow-600 border-yellow-200 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-900" : "text-muted-foreground"}`}
                onClick={loadProfile}
                title="Bấm để tải lại trạng thái VIP"
              >
                <CrownIcon className="w-3.5 h-3.5 mr-1.5" />
                {isVip ? "VIP" : "Thường"}
              </Button>
            )}
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
        <div className="min-w-0 flex-1 overflow-auto">
          <VipGuard pathname={pathname}>
            {children}
          </VipGuard>
        </div>
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
      <Suspense fallback={null}>
        <DictInitializer />
      </Suspense>
      <GlobalSearchDialog />
      <Suspense fallback={null}>
        <WelcomeModal />
      </Suspense>

    </SidebarProvider>
  );
}
