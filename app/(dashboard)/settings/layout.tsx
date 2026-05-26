"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ServerIcon, DatabaseIcon, LockIcon, SparklesIcon } from "lucide-react";
import { useProfile } from "@/lib/hooks/use-profile";

export default function SettingsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const { isVip, loading } = useProfile();

    const tabs = [
        {
            name: "Cài đặt AI",
            href: "/settings/ai-settings",
            icon: SparklesIcon,
        },
        {
            name: "Nhà cung cấp AI",
            href: "/settings/providers",
            icon: ServerIcon,
        },
        {
            name: "Quản lý dữ liệu",
            href: "/settings/data",
            icon: DatabaseIcon,
        },
    ];

    if (loading) {
        return (
            <div className="mx-auto w-full max-w-4xl px-6 py-12 flex justify-center items-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
        );
    }

    if (!isVip) {
        return (
            <div className="mx-auto w-full max-w-4xl px-6 py-16 text-center">
                <div className="inline-flex items-center justify-center size-16 rounded-full bg-yellow-500/10 text-yellow-550 mb-4">
                    <LockIcon className="size-8 text-yellow-600" />
                </div>
                <h2 className="text-2xl font-bold mb-2">Tính năng giới hạn VIP</h2>
                <p className="text-muted-foreground max-w-md mx-auto mb-6">
                    Vui lòng nâng cấp tài khoản lên VIP để cấu hình nhà cung cấp AI và quản lý dữ liệu hệ thống.
                </p>
            </div>
        );
    }

    return (
        <main className="mx-auto w-full max-w-4xl px-6 py-8">
            <div className="mb-8 border-b border-zinc-200 dark:border-zinc-800 pb-2">
                <div className="flex gap-4">
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = pathname === tab.href;
                        return (
                            <Link
                                key={tab.href}
                                href={tab.href}
                                className={`flex items-center gap-2 px-3 py-2 text-sm font-semibold border-b-2 transition-colors duration-150 ${isActive
                                        ? "border-primary text-primary"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                    }`}
                            >
                                <Icon className="size-4" />
                                {tab.name}
                            </Link>
                        );
                    })}
                </div>
            </div>
            {children}
        </main>
    );
}
