import { Skeleton } from "@/components/ui/skeleton";

export default function BulkScraperLoading() {
    return (
        <div className="flex-1 p-6 space-y-6 animate-page-enter">
            <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <div className="space-y-1">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-3 w-56" />
                </div>
            </div>
            <Skeleton className="h-[200px] rounded-xl" />
        </div>
    );
}
