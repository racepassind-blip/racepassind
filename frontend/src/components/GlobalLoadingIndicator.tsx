import { useSyncExternalStore } from "react";
import { Bike } from "lucide-react";

import { isApiLoading, subscribeToApiLoading } from "@/lib/api";

export function GlobalLoadingIndicator() {
  const isLoading = useSyncExternalStore(subscribeToApiLoading, isApiLoading, () => false);

  if (!isLoading) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center" role="status" aria-live="polite" aria-label="Loading">
      <div className="mt-3 flex items-center gap-2 rounded-full border border-primary/20 bg-card/95 px-3 py-2 text-xs font-semibold text-foreground shadow-lg backdrop-blur">
        <span className="relative h-5 w-12 shrink-0 overflow-hidden" aria-hidden="true">
          <span className="absolute inset-x-0 bottom-0 h-px bg-primary/20" />
          <Bike className="racepass-ride absolute bottom-0 left-0 h-5 w-5 text-primary" />
        </span>
        <span>Preparing your race…</span>
      </div>
    </div>
  );
}
