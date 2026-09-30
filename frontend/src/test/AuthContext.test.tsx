import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/api";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function PublicPage() {
  const auth = useAuth();
  const events = useQuery({ queryKey: ["event-search", "UPCOMING"], queryFn: () => apiRequest<{ title: string }[]>("/events/search") });
  const products = useQuery({ queryKey: ["public-product-listings"], queryFn: () => apiRequest<{ title: string }[]>("/products") });
  return <>
    <span>{auth.isInitialized ? "Guest ready" : "Checking session"}</span>
    <span>{events.data?.[0]?.title ?? "Loading events"}</span>
    <span>{products.data?.[0]?.title ?? "Loading products"}</span>
  </>;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("guest homepage requests", () => {
  it.each([true, false])("keeps public requests when auth finishes first: %s", async (authFirst) => {
    const auth = deferred<Response>();
    const events = deferred<Response>();
    const products = deferred<Response>();
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/auth/me")) return auth.promise;
      if (url.endsWith("/events/search")) return events.promise;
      if (url.endsWith("/products")) return products.promise;
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["organizer-events"], [{ title: "Private event" }]);
    client.setQueryData(["participant-registrations"], [{ id: "private" }]);
    render(<QueryClientProvider client={client}><AuthProvider><PublicPage /></AuthProvider></QueryClientProvider>);

    const finishAuth = async () => {
      await act(async () => { auth.resolve(new Response(JSON.stringify({ detail: "Not authenticated" }), { status: 401 })); });
      await screen.findByText("Guest ready");
    };
    const finishPublic = async () => {
      await act(async () => {
        events.resolve(new Response(JSON.stringify([{ title: "Mysuru race" }]), { headers: { "Content-Type": "application/json" } }));
        products.resolve(new Response(JSON.stringify([{ title: "Team jersey" }]), { headers: { "Content-Type": "application/json" } }));
      });
      await screen.findByText("Mysuru race");
      await screen.findByText("Team jersey");
    };
    if (authFirst) { await finishAuth(); await finishPublic(); }
    else { await finishPublic(); await finishAuth(); }

    expect(screen.getByText("Mysuru race")).toBeInTheDocument();
    expect(screen.getByText("Team jersey")).toBeInTheDocument();
    expect(client.getQueryData(["organizer-events"])).toBeUndefined();
    expect(client.getQueryData(["participant-registrations"])).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    client.clear();
  });
});
