"use client";

import { useEffect, useState, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * A sleek top-of-page loading bar (NProgress-style) that triggers
 * instantly on every route change, giving the user immediate visual feedback.
 */
export function NavigationProgress() {
    const pathname = usePathname();
    const [isLoading, setIsLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const prevPathname = useRef(pathname);

    useEffect(() => {
        // Detect route change start
        if (pathname !== prevPathname.current) {
            prevPathname.current = pathname;
            // Route has changed — show quick completion animation
            setIsLoading(true);
            setProgress(100);
            const timeout = setTimeout(() => {
                setIsLoading(false);
                setProgress(0);
            }, 300);
            return () => clearTimeout(timeout);
        }
    }, [pathname]);

    // Intercept all link clicks to start the progress bar immediately
    useEffect(() => {
        let safetyTimeout: ReturnType<typeof setTimeout> | null = null;

        function handleClick(e: MouseEvent) {
            const target = (e.target as HTMLElement).closest("a");
            if (!target) return;

            const href = target.getAttribute("href");
            if (!href) return;

            // Skip external links, hash links, and same-page links
            if (href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")) return;
            if (href === pathname) return;

            // Start loading animation immediately
            setIsLoading(true);
            setProgress(30);

            // Simulate incremental progress
            if (timerRef.current) clearInterval(timerRef.current);
            timerRef.current = setInterval(() => {
                setProgress((prev) => {
                    if (prev >= 90) {
                        if (timerRef.current) clearInterval(timerRef.current);
                        return 90;
                    }
                    // Fast at first, then slow down
                    const increment = prev < 50 ? 10 : prev < 70 ? 5 : prev < 85 ? 2 : 1;
                    return Math.min(prev + increment, 90);
                });
            }, 80);

            // Safety: auto-complete after 5 seconds if still loading
            // This prevents the bar from being stuck at 80-90% forever
            if (safetyTimeout) clearTimeout(safetyTimeout);
            safetyTimeout = setTimeout(() => {
                setProgress(100);
                setTimeout(() => {
                    setIsLoading(false);
                    setProgress(0);
                }, 300);
            }, 5000);
        }

        document.addEventListener("click", handleClick);
        return () => {
            document.removeEventListener("click", handleClick);
            if (timerRef.current) clearInterval(timerRef.current);
            if (safetyTimeout) clearTimeout(safetyTimeout);
        };
    }, [pathname]);

    if (!isLoading) return null;

    return (
        <div className="fixed top-0 left-0 right-0 z-[9999] h-[3px] pointer-events-none">
            <div
                className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                style={{
                    width: `${progress}%`,
                    transition: progress === 100
                        ? "width 200ms ease-out, opacity 200ms ease-out 100ms"
                        : "width 200ms ease-in-out",
                    opacity: progress === 100 ? 0 : 1,
                }}
            />
        </div>
    );
}
