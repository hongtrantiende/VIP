"use client";

import { useProfile } from "@/lib/hooks/use-profile";
import { LockIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "./ui/button";

export function VipGuard({ children, pathname }: { children: React.ReactNode, pathname: string }) {
  const { isVip, loading } = useProfile();

  const isRestrictedPath = 
    pathname.startsWith("/import") || 
    pathname.startsWith("/convert") || 
    pathname.startsWith("/scraper") || 
    pathname.startsWith("/settings") ||
    pathname === "/admin";

  if (!isRestrictedPath) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin size-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isVip) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
        <div className="size-20 rounded-full bg-yellow-500/10 flex items-center justify-center mb-6">
          <LockIcon className="size-10 text-yellow-600 dark:text-yellow-500" />
        </div>
        <h2 className="text-2xl font-bold mb-2 font-heading tracking-tight">Tính năng dành cho VIP</h2>
        <p className="text-muted-foreground max-w-md mb-8">
          Chức năng này đã bị khóa. Bạn cần nâng cấp tài khoản VIP hoặc chờ máy chủ mở đợt Free Test để sử dụng các công cụ nâng cao.
        </p>
        <Link href="/dashboard">
          <Button variant="default">Quay lại Trang chủ</Button>
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
