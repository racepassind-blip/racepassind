import { useSyncExternalStore } from "react";

import { isApiLoading, subscribeToApiLoading } from "@/lib/api";

export function GlobalLoadingIndicator() {
  const loading = useSyncExternalStore(subscribeToApiLoading, isApiLoading, () => false);
  return (
    <div
      role="progressbar"
      aria-label="Loading"
      aria-hidden={!loading}
      className={`pointer-events-none fixed inset-x-0 top-0 z-[100] h-1 overflow-hidden transition-opacity ${loading ? "opacity-100" : "opacity-0"}`}
    >
      <div className="h-full w-1/3 animate-[loading-bar_1s_ease-in-out_infinite] rounded-r-full bg-primary" />
    </div>
  );
}
