import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, FileText, Hash, Layers3, MapPin, Printer, Search, Share2, ShieldCheck, Users, X } from "lucide-react";
import { toast } from "sonner";

import { Layout } from "@/components/Layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePublicNumberList } from "@/hooks/useAllocations";

function formatEventDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
}

const PublicEventNumberList = () => {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, isError } = usePublicNumberList(eventId || "");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const numberLabel = data?.numberLabel || "Number";
  const entries = useMemo(() => data?.entries ?? [], [data?.entries]);
  const categories = data?.categories ?? [];
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filtersActive = Boolean(normalizedSearch) || filterCategory !== "all";

  const filteredEntries = useMemo(() => entries.filter((entry) => {
    const matchesSearch = !normalizedSearch
      || entry.displayName.toLowerCase().includes(normalizedSearch)
      || entry.allocationNumber.toString().includes(normalizedSearch)
      || entry.teamName?.toLowerCase().includes(normalizedSearch);
    const matchesCategory = filterCategory === "all" || entry.categoryName === filterCategory;
    return matchesSearch && matchesCategory;
  }), [entries, filterCategory, normalizedSearch]);

  const publishedCategoryCount = new Set(entries.map((entry) => entry.categoryName).filter(Boolean)).size;
  const teamCount = new Set(entries.map((entry) => entry.teamName).filter(Boolean)).size;
  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedEntries = filteredEntries.slice((safePage - 1) * pageSize, safePage * pageSize);

  const clearFilters = () => {
    setSearchTerm("");
    setFilterCategory("all");
    setPage(1);
  };

  const shareList = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: `${data?.event.title ?? "Event"} ${numberLabel} list`, url: window.location.href });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        toast.success("Public list link copied.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error("Could not share the public list.");
    }
  };

  if (isLoading) {
    return <Layout><div className="flex min-h-[55vh] items-center justify-center px-4"><div className="text-center"><Hash className="mx-auto h-7 w-7 animate-pulse text-primary" /><p className="mt-3 text-sm text-muted-foreground">Loading published assignments…</p></div></div></Layout>;
  }

  if (isError || !data) {
    return <Layout><div className="mx-auto flex min-h-[55vh] max-w-xl flex-col items-center justify-center px-4 py-16 text-center"><span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary"><FileText className="h-7 w-7" /></span><h1 className="mt-5 text-2xl font-black tracking-tight">List not available</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">The organizer may not have published number assignments yet. Check again closer to the event.</p><Button variant="outline" className="mt-6 gap-2" onClick={() => navigate(eventId ? `/event/${encodeURIComponent(eventId)}` : "/")}><ArrowLeft className="h-4 w-4" /> Back to event</Button></div></Layout>;
  }

  return (
    <Layout>
      <div className="min-h-screen bg-muted/20">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-10">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
            <Button variant="ghost" className="-ml-3 gap-2 text-muted-foreground" onClick={() => navigate(`/event/${encodeURIComponent(data.event.id)}`)}><ArrowLeft className="h-4 w-4" /> Event page</Button>
            <div className="flex items-center gap-2"><Button variant="outline" size="sm" className="gap-2" onClick={() => void shareList()}><Share2 className="h-4 w-4" /> Share</Button><Button variant="outline" size="sm" className="hidden gap-2 sm:inline-flex" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button></div>
          </div>

          <header className="overflow-hidden rounded-3xl bg-slate-950 text-white shadow-lg">
            <div className="h-1 bg-primary" />
            <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-end lg:p-10">
              <div>
                <div className="flex flex-wrap items-center gap-2"><Badge className="border-emerald-400/30 bg-emerald-400/15 text-emerald-200 hover:bg-emerald-400/15"><ShieldCheck className="mr-1 h-3 w-3" /> Organizer published</Badge><span className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">{data.event.sport?.replaceAll("_", " ")}</span></div>
                <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-primary">{numberLabel} assignments</p>
                <h1 className="mt-2 max-w-3xl text-3xl font-black tracking-tight sm:text-4xl lg:text-5xl">{data.event.title}</h1>
                <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-300">{data.event.date && <span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" />{formatEventDate(data.event.date)}</span>}{data.event.location && <span className="inline-flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" />{data.event.location}</span>}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm"><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Published</p><p className="mt-2 text-4xl font-black">{entries.length.toLocaleString("en-IN")}</p><p className="mt-1 text-sm text-slate-300">{entries.length === 1 ? "assignment" : "assignments"}</p></div>
            </div>
          </header>

          <div className={`mt-5 grid gap-3 ${teamCount > 0 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
            <Card><CardContent className="flex items-center gap-3 p-4"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Users className="h-5 w-5" /></span><div><p className="text-2xl font-black leading-none">{entries.length.toLocaleString("en-IN")}</p><p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Participants</p></div></CardContent></Card>
            <Card><CardContent className="flex items-center gap-3 p-4"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Layers3 className="h-5 w-5" /></span><div><p className="text-2xl font-black leading-none">{publishedCategoryCount}</p><p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Categories</p></div></CardContent></Card>
            {teamCount > 0 && <Card><CardContent className="flex items-center gap-3 p-4"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShieldCheck className="h-5 w-5" /></span><div><p className="text-2xl font-black leading-none">{teamCount}</p><p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Teams</p></div></CardContent></Card>}
          </div>

          <Alert className="mt-5 border-primary/20 bg-primary/[0.035]"><AlertDescription className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span className="text-xs leading-5 text-muted-foreground">This public list contains only organizer-published assignments. Participant names are shortened to protect personal information.</span></AlertDescription></Alert>

          <section className="mt-8 overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="border-b p-4 sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Published list</p><h2 className="mt-1 text-2xl font-black tracking-tight">Find your {numberLabel.toLowerCase()}</h2><p className="mt-1 text-sm text-muted-foreground">Search using your published name, team, or assigned number.</p></div>
                <div className="grid gap-3 sm:grid-cols-[minmax(260px,1fr)_220px] lg:w-[570px]">
                  <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label={`Search ${numberLabel} assignments`} placeholder={`Name, team, or ${numberLabel.toLowerCase()}…`} value={searchTerm} onChange={(event) => { setSearchTerm(event.target.value); setPage(1); }} className="pl-9 pr-9" />{searchTerm && <button type="button" aria-label="Clear search" onClick={() => { setSearchTerm(""); setPage(1); }} className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>}</div>
                  <Select value={filterCategory} onValueChange={(value) => { setFilterCategory(value); setPage(1); }}><SelectTrigger aria-label="Filter by category"><SelectValue placeholder="All categories" /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map((category) => <SelectItem key={category.id} value={category.name}>{category.name}</SelectItem>)}</SelectContent></Select>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="text-sm text-muted-foreground"><strong className="text-foreground">{filteredEntries.length.toLocaleString("en-IN")}</strong> {filteredEntries.length === 1 ? "assignment" : "assignments"}{filtersActive ? ` found out of ${entries.length.toLocaleString("en-IN")}` : " published"}</p>{filtersActive && <Button variant="ghost" size="sm" className="h-8 gap-2" onClick={clearFilters}><X className="h-3.5 w-3.5" /> Clear filters</Button>}</div>
            </div>

            {filteredEntries.length === 0 ? <div className="px-5 py-16 text-center"><Search className="mx-auto h-8 w-8 text-muted-foreground" /><h3 className="mt-4 font-bold">No assignments found</h3><p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">Check the spelling or try viewing all categories.</p>{filtersActive && <Button variant="outline" className="mt-5" onClick={clearFilters}>Show all assignments</Button>}</div> : <>
              <div className="hidden overflow-x-auto md:block"><Table><TableHeader><TableRow className="bg-muted/30"><TableHead className="w-[180px] px-6"><span className="inline-flex items-center gap-2"><Hash className="h-4 w-4" />{numberLabel}</span></TableHead><TableHead>Participant</TableHead><TableHead>Team</TableHead><TableHead className="px-6">Category</TableHead></TableRow></TableHeader><TableBody>{paginatedEntries.map((entry) => <TableRow key={`${entry.allocationNumber}-${entry.displayName}`}><TableCell className="px-6 py-4"><span className="inline-flex min-w-16 items-center justify-center rounded-lg bg-primary/10 px-3 py-2 font-mono text-lg font-black text-primary">{entry.allocationNumber}</span></TableCell><TableCell className="font-semibold">{entry.displayName}</TableCell><TableCell className="text-muted-foreground">{entry.teamName || "—"}</TableCell><TableCell className="px-6"><Badge variant="outline">{entry.categoryName || "Uncategorized"}</Badge></TableCell></TableRow>)}</TableBody></Table></div>

              <div className="divide-y md:hidden">{paginatedEntries.map((entry) => <article key={`${entry.allocationNumber}-${entry.displayName}`} className="flex items-start gap-4 p-4"><span className="flex min-h-14 min-w-16 shrink-0 items-center justify-center rounded-xl bg-primary/10 px-3 font-mono text-xl font-black text-primary">{entry.allocationNumber}</span><div className="min-w-0 flex-1"><p className="font-bold">{entry.displayName}</p>{entry.teamName && <p className="mt-1 truncate text-sm text-muted-foreground">{entry.teamName}</p>}<Badge variant="outline" className="mt-2">{entry.categoryName || "Uncategorized"}</Badge></div></article>)}</div>
              {filteredEntries.length > 25 && <div className="flex flex-col gap-3 border-t bg-muted/20 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 print:hidden"><div className="flex items-center gap-2 text-sm text-muted-foreground"><span>Rows</span><Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(1); }}><SelectTrigger className="h-8 w-20" aria-label="Rows per page"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="25">25</SelectItem><SelectItem value="50">50</SelectItem><SelectItem value="100">100</SelectItem></SelectContent></Select><span>per page</span></div><div className="flex items-center justify-between gap-3 sm:justify-end"><span className="text-sm text-muted-foreground">Page {safePage} of {totalPages}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft className="mr-1 h-4 w-4" /> Previous</Button><Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next <ChevronRight className="ml-1 h-4 w-4" /></Button></div></div></div>}
            </>}
          </section>

          <p className="mx-auto mt-6 max-w-2xl text-center text-xs leading-5 text-muted-foreground print:hidden">If your assignment is missing or incorrect, contact the event organizer. SportPass displays the information supplied and published by the organizer.</p>
        </div>
      </div>
    </Layout>
  );
};

export default PublicEventNumberList;
