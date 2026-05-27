"use client";

import { useState, useEffect } from "react";
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
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

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

    if (!mounted || loading) {
        return (
            <div className="mx-auto w-full max-w-4xl px-6 py-12 flex justify-center items-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
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
