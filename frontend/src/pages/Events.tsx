import { useCallback, useEffect, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { EventCard } from "@/components/EventCard";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEventSearch } from "@/hooks/useEvents";

const PAGE_SIZE = 12;

export default function Events() {
  const [params, setParams] = useSearchParams();
  const search = params.get("q") ?? "";
  const [searchInput, setSearchInput] = useState(search);
  const sport = params.get("sport") ?? "ALL";
  const city = params.get("city") ?? "ALL";
  const timing = params.get("timing") ?? "UPCOMING";
  const rawPage = Number(params.get("page") || "1");
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const { data, isLoading, isError, refetch } = useEventSearch({ q: search, sport, city, timing, page, pageSize: PAGE_SIZE });
  const events = data?.items ?? [];

  const update = useCallback((key: string, value: string, replace = false) => {
    const next = new URLSearchParams(params);
    if (!value || (value === "ALL" && key !== "timing")) next.delete(key); else next.set(key, value);
    if (key !== "page") next.delete("page");
    setParams(next, { replace });
  }, [params, setParams]);
  useEffect(() => setSearchInput(search), [search]);
  useEffect(() => {
    if (searchInput === search) return;
    const timer = window.setTimeout(() => update("q", searchInput.trim(), true), 350);
    return () => window.clearTimeout(timer);
  }, [searchInput, search, update]);
  const clear = () => { setSearchInput(""); setParams({}); };

  const sports = data?.sports ?? [];
  const cities = data?.cities ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useEffect(() => { if (data && page > pageCount) update("page", String(pageCount), true); }, [data, page, pageCount, update]);

  return <Layout><main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
    <div className="max-w-3xl"><p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">SportPass calendar</p><h1 className="mt-2 text-4xl font-black tracking-tight sm:text-5xl">Find an event</h1><p className="mt-3 text-lg text-muted-foreground">Search upcoming races and tournaments, or look back at completed events and results.</p></div>
    <section className="mt-8 rounded-2xl border bg-card p-4 shadow-sm sm:p-5" aria-label="Event filters">
      <div className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal className="h-4 w-4" /> Filter events</div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <div className="relative lg:col-span-2"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={searchInput} onChange={e => setSearchInput(e.target.value)} aria-label="Search events" className="h-11 pl-9 pr-10" placeholder="Event, sport, or city" />{searchInput && <button type="button" aria-label="Clear search" onClick={() => { setSearchInput(""); update("q", "", true); }} className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>}</div>
        <select aria-label="Sport" value={sport} onChange={e => update("sport", e.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="ALL">All sports</option>{sports.map(value => <option key={value} value={value}>{value[0]?.toUpperCase() + value.slice(1)}</option>)}</select>
        <select aria-label="City" value={city} onChange={e => update("city", e.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="ALL">All locations</option>{cities.map(value => <option key={value} value={value}>{value}</option>)}</select>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div className="grid w-full grid-cols-3 rounded-lg bg-muted p-1 sm:flex sm:w-auto">{[["UPCOMING", "Upcoming"], ["PAST", "Past events"], ["ALL", "All"]].map(([value, label]) => <button key={value} type="button" aria-pressed={timing === value} onClick={() => update("timing", value)} className={`min-h-10 rounded-md px-2 py-2 text-xs font-semibold sm:px-4 sm:text-sm ${timing === value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>)}</div><Button variant="ghost" size="sm" onClick={clear}>Reset filters</Button></div>
    </section>
    <div className="mt-8 flex items-end justify-between gap-4"><div><h2 className="text-2xl font-bold">{timing === "PAST" ? "Past events" : timing === "ALL" ? "All events" : "Upcoming events"}</h2><p className="mt-1 text-sm text-muted-foreground">{total} event{total === 1 ? "" : "s"}</p></div></div>
    {isLoading ? <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{Array.from({length: 8}).map((_, index) => <div key={index} className="h-80 animate-pulse rounded-2xl bg-muted" />)}</div> : isError ? <div className="mt-6 rounded-xl border border-dashed p-10 text-center"><p className="font-semibold">Events could not be loaded.</p><Button className="mt-4" variant="outline" onClick={() => void refetch()}>Try again</Button></div> : events.length === 0 ? <div className="mt-6 rounded-xl border border-dashed p-12 text-center"><p className="font-semibold">No events match these filters.</p><p className="mt-1 text-sm text-muted-foreground">Try another sport, location, or date range.</p><Button className="mt-4" variant="outline" onClick={clear}>Clear filters</Button></div> : <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{events.map(event => <EventCard key={event.id} event={event} />)}</div>}
    {pageCount > 1 && <nav className="mt-10 flex items-center justify-center gap-3" aria-label="Event pages"><Button variant="outline" disabled={page <= 1} onClick={() => update("page", String(page - 1))}>Previous</Button><span className="text-sm text-muted-foreground">Page {Math.min(page, pageCount)} of {pageCount}</span><Button variant="outline" disabled={page >= pageCount} onClick={() => update("page", String(page + 1))}>Next</Button></nav>}
  </main></Layout>;
}
