import { getSportConfig } from "@/data/sportConfig";
/**
 * PublicRaceTimeResults — public results page for running/cycling events.
 *
 * Shows:
 *   - Category chips with participant count
 *   - Per-category table: Rank | Participant | Bib | Status | Time | Pace/Speed
 *   - Running → Pace column; Cycling → Avg Speed column
 *   - Finished participants ranked by time; DNS/DNF/DSQ shown below
 *
 * Isolated from match/tournament result components.
 */
import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Download, Flag, Search, Share2, Timer, Trophy, Users } from "lucide-react";
import { toast } from "sonner";

import { Layout } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePublicRaceResults } from "@/hooks/useRaceTimeResults";
import type { PublicRaceResultEntry } from "@/hooks/useRaceTimeResults";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadge(status: string) {
  const map: Record<string, string> = {
    Finished: "bg-green-100 text-green-800 border-green-200",
    DNS: "bg-slate-100 text-slate-600 border-slate-200",
    DNF: "bg-amber-100 text-amber-800 border-amber-200",
    DSQ: "bg-red-100 text-red-800 border-red-200",
  };
  const cls = map[status] ?? "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}
    >
      {status}
    </span>
  );
}

function rankCell(rank: number | null, status: string) {
  if (status !== "Finished") return <span className="text-muted-foreground">—</span>;
  if (rank === null) return <span className="text-muted-foreground">—</span>;
  if (rank === 1)
    return (
      <span className="inline-flex items-center gap-1 font-bold text-amber-500">
        <Trophy className="h-3.5 w-3.5" /> 1
      </span>
    );
  if (rank === 2)
    return <span className="font-bold text-slate-400">2</span>;
  if (rank === 3)
    return <span className="font-bold text-amber-700">3</span>;
  return <span className="font-mono text-sm">{rank}</span>;
}

// ---------------------------------------------------------------------------
// Category table
// ---------------------------------------------------------------------------

interface CategoryTableProps {
  entries: PublicRaceResultEntry[];
  isCycling: boolean;
}

function CategoryTable({ entries, isCycling }: CategoryTableProps) {
  // Finished first (already sorted by rank from server), then others
  const finished = entries.filter((e) => e.resultStatus === "Finished");
  const others = entries.filter((e) => e.resultStatus !== "Finished");
  const ordered = [...finished, ...others];

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-14">Rank</TableHead>
          <TableHead>Participant</TableHead>
          <TableHead className="w-16">Bib</TableHead>
          <TableHead className="w-24">Status</TableHead>
          <TableHead className="w-28">Time</TableHead>
          <TableHead className="w-28 text-right">
            {isCycling ? "Avg Speed" : "Pace"}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ordered.map((entry, i) => (
          <TableRow
            key={`${entry.participantName}-${i}`}
            className={entry.resultStatus !== "Finished" ? "bg-muted/20 text-muted-foreground" : entry.rank != null && entry.rank <= 3 ? "bg-amber-50/50 dark:bg-amber-950/10" : ""}
          >
            <TableCell>{rankCell(entry.rank, entry.resultStatus)}</TableCell>
            <TableCell className="font-medium">{entry.participantName}</TableCell>
            <TableCell>
              {entry.bibNumber != null ? <span className="font-mono font-semibold">#{entry.bibNumber}</span> : <span className="text-muted-foreground">—</span>}
            </TableCell>
            <TableCell>{statusBadge(entry.resultStatus)}</TableCell>
            <TableCell className="font-mono text-sm">
              {entry.finishTimeHhmmss ?? "—"}
            </TableCell>
            <TableCell className="text-right text-sm text-muted-foreground">
              {entry.resultStatus === "Finished"
                ? isCycling
                  ? (entry.speedDisplay ?? "—")
                  : (entry.paceDisplay ?? "—")
                : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PublicRaceTimeResults() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError } = usePublicRaceResults(id);

  const [activeCategoryKey, setActiveCategoryKey] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "Finished" | "DNS" | "DNF" | "DSQ">("all");
  const [page, setPage] = useState(1);

  const isCycling = getSportConfig(data?.sport).race_metric === "speed";

  // Once data loads, default to the first category
  const categories = data?.categories ?? [];
  const resolvedCategoryKey = activeCategoryKey ?? (categories.length > 0 ? (categories[0].categoryId ?? "__none__") : null);

  const activeCategory =
    categories.find((category) => (category.categoryId ?? "__none__") === resolvedCategoryKey) ?? categories[0];
  const filteredEntries = useMemo(() => {
    const term = searchText.trim().toLowerCase();
    return (activeCategory?.entries ?? []).filter((entry) => {
      const matchesSearch = !term || entry.participantName.toLowerCase().includes(term) || (entry.bibNumber != null && String(entry.bibNumber).includes(term));
      return matchesSearch && (statusFilter === "all" || entry.resultStatus === statusFilter);
    });
  }, [activeCategory, searchText, statusFilter]);
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(filteredEntries.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageOffset = (safePage - 1) * pageSize;
  const visibleEntries = filteredEntries.slice(pageOffset, pageOffset + pageSize);
  const finishers = activeCategory?.entries.filter((entry) => entry.resultStatus === "Finished") ?? [];
  const podium = finishers.filter((entry) => entry.rank != null && entry.rank <= 3).sort((left, right) => (left.rank ?? 99) - (right.rank ?? 99));

  const shareResults = async () => {
    try {
      if (navigator.share) await navigator.share({ title: `${data?.eventName ?? "Event"} results`, url: window.location.href });
      else {
        await navigator.clipboard.writeText(window.location.href);
        toast.success("Results link copied.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error("Could not share the results link.");
    }
  };

  const exportResults = () => {
    if (!activeCategory || filteredEntries.length === 0) return;
    const escapeCsv = (value: string | number | null) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const lines = [
      ["Rank", "Participant", "Bib", "Status", "Finish time", isCycling ? "Average speed" : "Pace"].map(escapeCsv).join(","),
      ...filteredEntries.map((entry) => [entry.rank, entry.participantName, entry.bibNumber, entry.resultStatus, entry.finishTimeHhmmss, isCycling ? entry.speedDisplay : entry.paceDisplay].map(escapeCsv).join(",")),
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    const fileName = `${data?.eventName ?? "event"}-${activeCategory.categoryName}-results`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    anchor.download = `${fileName}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-24">
          <Timer className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  // ── Error / no results ───────────────────────────────────────────────────
  if (isError || !data || data.resultSetStatus !== "published" || categories.length === 0) {
    return (
      <Layout>
        <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-24 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Timer className="h-7 w-7" />
          </div>
          <h1 className="mt-5 text-2xl font-black tracking-tight">
            Results not yet available
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The organizer hasn't published results for this event yet. Check
            back after the event.
          </p>
          <Button
            variant="outline"
            className="mt-6 gap-2"
            onClick={() =>
              navigate(id ? `/event/${encodeURIComponent(id)}` : "/")
            }
          >
            <ArrowLeft className="h-4 w-4" /> Back to event
          </Button>
        </div>
      </Layout>
    );
  }

  // ── Results ──────────────────────────────────────────────────────────────
  return (
    <Layout>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:py-12">
        <section className="overflow-hidden rounded-3xl bg-slate-950 text-white shadow-lg">
          <div className="relative p-6 sm:p-8 lg:p-10">
            <div className="absolute right-0 top-0 h-56 w-56 rounded-full bg-primary/20 blur-3xl" />
            <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <Button variant="ghost" size="sm" className="-ml-3 gap-2 text-slate-300 hover:bg-white/10 hover:text-white" onClick={() => navigate(id ? `/event/${encodeURIComponent(id)}` : "/")}><ArrowLeft className="h-4 w-4" /> Back to event</Button>
                <div className="mt-5 flex flex-wrap items-center gap-2"><Badge className="border-emerald-400/30 bg-emerald-400/15 text-emerald-200 hover:bg-emerald-400/15"><CheckCircle2 className="mr-1 h-3 w-3" /> Official results</Badge><span className="text-sm capitalize text-slate-400">{data.sport}</span></div>
                <h1 className="mt-4 max-w-3xl text-3xl font-black tracking-tight sm:text-4xl lg:text-5xl">{data.eventName}</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Published race standings, finish times, and performance metrics from the organizer.</p>
              </div>
              <div className="flex flex-wrap gap-2"><Button variant="secondary" className="gap-2" onClick={() => void shareResults()}><Share2 className="h-4 w-4" /> Share results</Button><Button variant="outline" className="gap-2 border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white" onClick={exportResults} disabled={!activeCategory || filteredEntries.length === 0}><Download className="h-4 w-4" /> Download CSV</Button></div>
            </div>
          </div>
        </section>

        {categories.length > 1 && <section><p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Choose category</p><div className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1.5 shadow-sm" role="tablist" aria-label="Result category">{categories.map((category) => { const key = category.categoryId ?? "__none__"; const isActive = key === resolvedCategoryKey; return <button key={key} type="button" role="tab" aria-selected={isActive} onClick={() => { setActiveCategoryKey(key); setSearchText(""); setStatusFilter("all"); setPage(1); }} className={`whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${isActive ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{category.categoryName}{category.distance ? ` · ${category.distance}` : ""}<span className="ml-2 text-xs opacity-70">{category.participantCount}</span></button>; })}</div></section>}

        {activeCategory && <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border bg-card p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm font-medium text-muted-foreground">Category</p><Flag className="h-5 w-5 text-primary" /></div><p className="mt-3 truncate text-xl font-black">{activeCategory.categoryName}</p><p className="mt-1 text-xs text-muted-foreground">{activeCategory.distance || "Distance not specified"}</p></div>
            <div className="rounded-xl border bg-card p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm font-medium text-muted-foreground">Participants</p><Users className="h-5 w-5 text-blue-600" /></div><p className="mt-3 text-3xl font-black">{activeCategory.participantCount.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">Published in this category</p></div>
            <div className="rounded-xl border bg-card p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm font-medium text-muted-foreground">Finishers</p><CheckCircle2 className="h-5 w-5 text-emerald-600" /></div><p className="mt-3 text-3xl font-black">{finishers.length.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">With an official finish time</p></div>
            <div className="rounded-xl border bg-card p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm font-medium text-muted-foreground">Winning time</p><Timer className="h-5 w-5 text-amber-600" /></div><p className="mt-3 font-mono text-2xl font-black">{finishers.find((entry) => entry.rank === 1)?.finishTimeHhmmss ?? "—"}</p><p className="mt-1 text-xs text-muted-foreground">Fastest published finish</p></div>
          </div>

          {podium.length > 0 && <section><div className="mb-3 flex items-center gap-2"><Trophy className="h-5 w-5 text-amber-500" /><h2 className="text-lg font-black tracking-tight">Podium</h2></div><div className="grid gap-4 md:grid-cols-3">{podium.map((entry) => <div key={`${entry.participantName}-${entry.rank}`} className={`relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm ${entry.rank === 1 ? "border-amber-300 md:-translate-y-1" : ""}`}><div className={`absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full text-sm font-black ${entry.rank === 1 ? "bg-amber-100 text-amber-700" : entry.rank === 2 ? "bg-slate-100 text-slate-600" : "bg-orange-100 text-orange-700"}`}>#{entry.rank}</div><p className="pr-12 text-lg font-black">{entry.participantName}</p><p className="mt-1 text-sm text-muted-foreground">{entry.bibNumber != null ? `Bib #${entry.bibNumber}` : "No bib number"}</p><p className="mt-5 font-mono text-2xl font-black">{entry.finishTimeHhmmss ?? "—"}</p><p className="mt-1 text-xs text-muted-foreground">{isCycling ? entry.speedDisplay ?? "Average speed pending" : entry.paceDisplay ?? "Pace pending"}</p></div>)}</div></section>}

          <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="space-y-4 border-b p-4 sm:p-5"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-xl font-black tracking-tight">Full results</h2><p className="mt-1 text-sm text-muted-foreground">{activeCategory.categoryName}{activeCategory.distance ? ` · ${activeCategory.distance}` : ""}</p></div><Badge variant="secondary" className="w-fit">{filteredEntries.length} result{filteredEntries.length === 1 ? "" : "s"}</Badge></div><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="relative w-full lg:max-w-md"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search participant or bib number" value={searchText} onChange={(event) => { setSearchText(event.target.value); setPage(1); }} /></div><div className="flex gap-1 overflow-x-auto rounded-lg bg-muted/60 p-1" role="tablist" aria-label="Filter result status">{(["all", "Finished", "DNS", "DNF", "DSQ"] as const).map((status) => <button key={status} type="button" role="tab" aria-selected={statusFilter === status} onClick={() => { setStatusFilter(status); setPage(1); }} className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${statusFilter === status ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{status === "all" ? "All" : status}</button>)}</div></div></div>
            {filteredEntries.length > 0 ? <><div className="overflow-x-auto"><CategoryTable entries={visibleEntries} isCycling={isCycling} /></div>{filteredEntries.length > pageSize && <div className="flex flex-col gap-3 border-t px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-5"><span className="text-muted-foreground">Showing {pageOffset + 1}–{Math.min(pageOffset + pageSize, filteredEntries.length)} of {filteredEntries.length}</span><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft className="h-4 w-4" /> Previous</Button><span className="min-w-20 text-center text-xs font-medium text-muted-foreground">Page {safePage} of {pageCount}</span><Button variant="outline" size="sm" disabled={safePage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next <ChevronRight className="h-4 w-4" /></Button></div></div>}</> : <div className="p-12 text-center"><Search className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-4 font-semibold">No matching results</p><p className="mt-1 text-sm text-muted-foreground">Try another participant, bib number, or result status.</p><Button variant="ghost" className="mt-3" onClick={() => { setSearchText(""); setStatusFilter("all"); setPage(1); }}>Clear filters</Button></div>}
            <div className="border-t bg-muted/20 px-4 py-3 text-xs text-muted-foreground sm:px-5">DNS: did not start · DNF: did not finish · DSQ: disqualified</div>
          </section>
        </>}
      </div>
    </Layout>
  );
}
