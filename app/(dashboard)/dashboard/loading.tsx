import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <main className="mx-auto w-full min-w-0 max-w-5xl overflow-hidden px-4 py-6 md:px-6 md:py-8 space-y-10">
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Skeleton className="size-5 rounded" />
          <Skeleton className="h-6 w-40" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[2/3] w-full rounded-xl" />
          ))}
        </div>
      </section>
      <section>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </section>
    </main>
  );
}
