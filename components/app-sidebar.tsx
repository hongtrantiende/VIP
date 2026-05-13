"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";

import { useQTEngineStatus } from "@/lib/hooks/use-qt-engine";
import { Button } from "@/components/ui/button";

import {
  BookOpenIcon,
  DatabaseIcon,
  GitCompareArrowsIcon,
  GlobeIcon,
  HomeIcon,
  LibraryIcon,
  LoaderIcon,
  ServerIcon,
  ShieldCheckIcon,
  UploadIcon,
  SettingsIcon,
  ChevronRightIcon,
  Wand2Icon,
  LogOutIcon,
  LockIcon,
  SparklesIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useProfile } from "@/lib/hooks/use-profile";
import { UserProfileDialog } from "@/components/user-profile-dialog";
import { createClient } from "@/lib/supabase/client";
import {
  isTrainingRunning,
  subscribeTrainingManager,
} from "@/lib/training-manager";
import { useTrainingStore } from "@/lib/stores/training-store";

export const navConfig = [
  { title: "Trang chủ", href: "/dashboard", icon: HomeIcon },
  { title: "Thư viện", href: "/library", icon: LibraryIcon },
  { title: "Nhập sách", href: "/import", icon: UploadIcon },
  { title: "Convert nhanh", href: "/convert", icon: Wand2Icon },
  { title: "Import Truyện", href: "/scraper", icon: GlobeIcon },
  { title: "Tạo Prompt Scraper", href: "/scraper/generator", icon: GitCompareArrowsIcon },
  { title: "Quản lý từ điển", href: "/dictionary", icon: BookOpenIcon },
  { title: "Nhà cung cấp AI", href: "/settings/providers", icon: ServerIcon },
  {
    title: "Quản lý dữ liệu",
    href: "/settings/data",
    icon: DatabaseIcon,
  },
] as const;

export const miscNav = [
  { 
    title: "Lấy API Key Free", 
    href: "/settings/api-guide", 
    icon: ServerIcon
  },
] as const;

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, loadProfile, isVip } = useProfile();
  const [isAdmin, setIsAdmin] = useState(false);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  useEffect(() => {
    import("@/lib/supabase/client").then(({ createClient }) => {
      const supabase = createClient();
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user?.email === "nthanhnam2005@gmail.com" || user?.email === "thanhxnam2005@gmail.com") {
          setIsAdmin(true);
        }
      });
    });
  }, []);

  const adminNavItem = {
    title: "Quản lý VIP",
    href: "/admin",
    icon: ShieldCheckIcon,
  } as const;

  let mainNav = navConfig.filter(
    (item) => !item.href.startsWith("/settings"),
  );
  const settingsNav = navConfig.filter((item) =>
    item.href.startsWith("/settings"),
  );

  // Hide Scraper Generator in production
  if (process.env.NODE_ENV !== "development") {
    mainNav = mainNav.filter((item) => item.href !== "/scraper/generator");
  }

  const [logoError, setLogoError] = useState(false);
  const sidebarNav = isAdmin ? [...mainNav, adminNavItem] : mainNav;

  return (
    <Sidebar collapsible="offcanvas" variant="sidebar">
      <SidebarHeader className="px-4 py-6">
        <Link
          href="/dashboard"
          className="flex items-center gap-3 overflow-hidden mb-6"
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary overflow-hidden relative">
            {!logoError ? (
              <Image
                src="/logo.png"
                alt="Logo"
                width={40}
                height={40}
                className="w-full h-full object-cover rounded-xl"
                onError={() => setLogoError(true)}
              />
            ) : (
              <BookOpenIcon className="size-6" />
            )}
          </div>
          <div className="flex flex-col gap-0.5 leading-none">
            <span className="font-heading text-lg font-bold tracking-tight text-sidebar-foreground">
              Thuyết Thư Các
            </span>
            <span className="text-xs text-sidebar-foreground/60">
              Kho tàng truyện chữ
            </span>
          </div>
        </Link>

        {profile && (
          <>
            <div 
              className="flex items-center gap-3 px-2 mb-2 pb-2 cursor-pointer hover:bg-accent rounded-md p-1 transition-colors"
              onClick={() => setProfileDialogOpen(true)}
              title="Nhấn để đổi ảnh đại diện"
            >
              <div className="relative">
                <div className={`flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-sm shadow-sm overflow-hidden ${
                  (profile.vip_until && new Date(profile.vip_until) > new Date()) 
                    ? "ring-2 ring-yellow-400 ring-offset-2 ring-offset-background" 
                    : ""
                }`}>
                  {profile.avatar_url ? (
                    <img src={profile.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    (profile.display_name || (isAdmin ? "Admin" : "U")).substring(0, 2).toUpperCase()
                  )}
                </div>
                {profile.vip_until && new Date(profile.vip_until) > new Date() && (
                  <div className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 rounded-full p-0.5 shadow-md border border-yellow-200">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/></svg>
                  </div>
                )}
              </div>
              <div className="flex flex-col overflow-hidden">
                <span className={`text-sm font-semibold truncate ${
                  (profile.vip_until && new Date(profile.vip_until) > new Date()) ? "text-yellow-600 dark:text-yellow-500" : "text-foreground"
                }`}>
                  {profile.display_name || (isAdmin ? "Admin" : "Người dùng")}
                </span>
                <span className="text-[10px] text-muted-foreground truncate">
                  {profile.vip_until && new Date(profile.vip_until) > new Date()
                    ? `VIP còn ${Math.ceil((new Date(profile.vip_until).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))} ngày`
                    : profile.email}
                </span>
              </div>
              <div 
                className="ml-auto flex size-8 items-center justify-center rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  handleLogout();
                }}
                title="Đăng xuất"
              >
                <LogOutIcon className="size-4" />
              </div>
            </div>
            <UserProfileDialog 
              profile={profile} 
              open={profileDialogOpen} 
              onOpenChange={setProfileDialogOpen} 
              onProfileUpdated={loadProfile} 
            />
          </>
        )}
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Điều hướng</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {sidebarNav.map((item) => {
                const isRestricted = 
                  item.href.startsWith("/import") || 
                  item.href.startsWith("/convert") || 
                  item.href.startsWith("/scraper") || 
                  item.href.startsWith("/settings") ||
                  item.href === "/admin";
                
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.href}
                      tooltip={item.title}
                      className="text-base font-medium py-2.5 h-auto relative"
                    >
                      <Link href={item.href}>
                        <item.icon className="size-5" />
                        <span className="flex-1">{item.title}</span>
                        {isRestricted && !isVip && (
                          <LockIcon className="size-4 ml-auto text-yellow-600/70" />
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>



        <SidebarGroup>
          <SidebarGroupLabel>Cài đặt</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <Collapsible defaultOpen className="group/collapsible">
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton tooltip="Cài đặt" className="text-base font-medium py-2.5 h-auto w-full justify-between">
                      <div className="flex items-center gap-2">
                        <SettingsIcon className="size-5" />
                        <span>Cài đặt hệ thống</span>
                      </div>
                      <ChevronRightIcon className="size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {settingsNav.map((item) => {
                        const isRestricted = true; // All settings are restricted
                        return (
                          <SidebarMenuSubItem key={item.href}>
                            <SidebarMenuSubButton asChild isActive={pathname === item.href} className="text-sm py-2 h-auto relative">
                              <Link href={item.href}>
                                <item.icon className="size-4" />
                                <span className="flex-1">{item.title}</span>
                                {isRestricted && !isVip && (
                                  <LockIcon className="size-3.5 ml-auto text-yellow-600/70" />
                                )}
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        );
                      })}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Cộng đồng</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {miscNav.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    tooltip={item.title}
                    className="text-base font-medium py-2.5 h-auto hover:text-blue-500 transition-colors"
                  >
                    <a href={item.href} target="_blank" rel="noreferrer">
                      <item.icon className="size-5" />
                      <span>{item.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <TrainingStatusFooter />
      <DictLoadingFooter />
      <SidebarRail />
    </Sidebar>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  names: "Names",
  names2: "Names2",
  phienam: "Phiên âm",
  luatnhan: "Luật nhân",
  vietphrase: "VietPhrase",
};

function TrainingStatusFooter() {
  const running = useSyncExternalStore(
    subscribeTrainingManager,
    isTrainingRunning,
    () => false
  );
  const extractedCount = useTrainingStore(s => s.extractedTerms.length);

  if (!running) return null;

  return (
    <SidebarFooter className="border-t px-3 py-2 bg-emerald-500/5">
      <Link href="/convert" className="block">
        <div className="flex items-center gap-2">
          <SparklesIcon className="size-3.5 shrink-0 text-emerald-500 animate-pulse" />
          <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
            Đang train từ điển...
          </span>
          <span className="ml-auto text-xs text-emerald-600 font-mono">
            {extractedCount} từ
          </span>
        </div>
      </Link>
    </SidebarFooter>
  );
}


function DictLoadingFooter() {
  const { phase, loadingSource, loadingPercent } = useQTEngineStatus();

  if (phase === "idle" || phase === "ready") return null;

  return (
    <SidebarFooter className="border-t px-3 py-2">
      {phase === "error" ? (
        <p className="text-xs text-red-500">Lỗi tải từ điển</p>
      ) : (
        <div className="space-y-2">
          {phase === "loading" && (
            <Progress value={loadingPercent} className="h-1.5" />
          )}
          <div className="flex items-center gap-2">
            <LoaderIcon className="size-3.5 shrink-0 animate-spin text-blue-500" />
            <span className="text-[10px] text-sidebar-foreground/70 leading-tight flex-1">
              {phase === "loading"
                ? `Đang tải ${SOURCE_LABELS[loadingSource] ?? loadingSource}...`
                : "Đang khởi tạo engine..."}
            </span>
            <span className="text-[10px] text-sidebar-foreground/50 font-mono">
              {phase === "loading" ? `${loadingPercent}%` : null}
            </span>
          </div>
          <Button 
            variant="ghost" 
            size="xs" 
            className="w-full h-6 text-[9px] uppercase font-bold text-muted-foreground hover:text-primary"
            onClick={() => {
              // Force ready state
              import("@/lib/hooks/use-qt-engine").then(m => {
                m.setDictLoadPhase("ready");
                // We don't have direct access to setReady but changing phase to ready might work if the UI listens to phase
                // Actually we need to call setReady(true)
                // Let's use a custom event or direct store access if possible
              });
              // Simpler: use a flag in localStorage to skip next time or just reload
              window.location.reload();
            }}
          >
            Tải lại hoặc Đợi thêm...
          </Button>
          <button 
            className="w-full text-[8px] text-muted-foreground hover:underline uppercase tracking-tighter"
            onClick={() => {
               // The most reliable way to skip is to just tell the engine it's ready
               window.dispatchEvent(new CustomEvent('force-dict-ready'));
            }}
          >
            Nhấn vào đây để vào luôn (Bỏ qua tải)
          </button>
        </div>
      )}
    </SidebarFooter>
  );
}
