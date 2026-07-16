import { Skeleton } from "@/components/ui/skeleton";

const metricSkeletons = ["metric-1", "metric-2", "metric-3", "metric-4"];

export default function RouteLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-6">
      <span className="sr-only">Cargando contenido...</span>

      <div aria-hidden="true" className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-52 max-w-full" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <Skeleton className="h-8 w-28" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metricSkeletons.map((key) => (
            <Skeleton key={key} className="h-28 rounded-xl" />
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-80 rounded-xl lg:col-span-2" />
          <Skeleton className="h-80 rounded-xl" />
        </div>

        <Skeleton className="h-56 rounded-xl" />
      </div>
    </div>
  );
}
