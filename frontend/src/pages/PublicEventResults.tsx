import { useState } from "react";
import { ArrowLeft, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, ExternalLink, ListFilter, RefreshCw, Trophy, Users } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { Layout } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePublicEventResults, usePublicStandings } from "@/hooks/useEvents";
import type { PublicMatchResult } from "@/hooks/useEvents";

function PublicStandings({ eventId, categoryId, categoryName }: { eventId: string; categoryId: string; categoryName: string }) {
  const { data: standings = [], isLoading } = usePublicStandings(eventId, categoryId);
  if (isLoading || standings.length === 0) return null;
  return (
    <Card className="mt-5">
      <CardHeader>
        <CardTitle>Standings — {categoryName}</CardTitle>
        <CardDescription>League table from completed team matches.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table className="min-w-[560px]">
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead className="text-center">P</TableHead>
                <TableHead className="text-center">W</TableHead>
                <TableHead className="text-center">D</TableHead>
                <TableHead className="text-center">L</TableHead>
                <TableHead className="text-center font-bold">Pts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {standings.map((row) => (
                <TableRow key={row.registrationId}>
                  <TableCell className="font-medium">{row.teamName}</TableCell>
                  <TableCell className="text-center">{row.matchesPlayed}</TableCell>
                  <TableCell className="text-center">{row.wins}</TableCell>
                  <TableCell className="text-center">{row.draws}</TableCell>
                  <TableCell className="text-center">{row.losses}</TableCell>
                  <TableCell className="text-center font-bold">{row.points}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

type StatusFilter = "all" | PublicMatchResult["status"];

const statusLabels: Record<PublicMatchResult["status"], string> = {
  scheduled: "Upcoming",
  in_progress: "Live",
  completed: "Completed",
};

const statusFilters: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All matches" },
  { value: "in_progress", label: "Live now" },
  { value: "completed", label: "Completed" },
  { value: "scheduled", label: "Upcoming" },
];

function formatDate(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

function formatDateTime(value: string | null) {
  if (!value) return "Time not set";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function statusVariant(status: PublicMatchResult["status"]) {
  if (status === "completed") return "default" as const;
  if (status === "in_progress") return "outline" as const;
  return "secondary" as const;
}

const PublicEventResults = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { data, isLoading, isError, refetch, isFetching } = usePublicEventResults(id);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [page, setPage] = useState(1);

  if (isLoading) {
    return <Layout><div className="mx-auto max-w-7xl px-4 py-24 text-center text-sm text-muted-foreground">Loading event results…</div></Layout>;
  }

  if (isError || !data) {
    return (
      <Layout>
        <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-24 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary"><Trophy className="h-7 w-7" /></div>
          <h1 className="mt-5 text-2xl font-black tracking-tight">Results unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">This event may be unpublished, archived, or not have a public results board yet.</p>
          <Button variant="outline" className="mt-6 gap-2" onClick={() => navigate(id ? `/event/${encodeURIComponent(id)}` : "/")}><ArrowLeft className="h-4 w-4" /> Back to event</Button>
        </div>
      </Layout>
    );
  }

  const completedCount = data.matches.filter((match) => match.status === "completed").length;
  const liveCount = data.matches.filter((match) => match.status === "in_progress").length;
  const upcomingCount = data.matches.filter((match) => match.status === "scheduled").length;
  const filteredMatches = data.matches.filter((match) => {
    const matchesStatus = statusFilter === "all" || match.status === statusFilter;
    const matchesCategory = categoryFilter === "all" || match.category.id === categoryFilter;
    return matchesStatus && matchesCategory;
  });
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(filteredMatches.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageOffset = (safePage - 1) * pageSize;
  const visibleMatches = filteredMatches.slice(pageOffset, pageOffset + pageSize);
  const matchesByCategory = data.categories
    .map((category) => ({ category, matches: visibleMatches.filter((match) => match.category.id === category.id) }))
    .filter(({ matches }) => matches.length > 0);

  return (
    <Layout>
      <div className="min-h-screen bg-[#f7f8fb]">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
          <div className="mb-5 flex items-center justify-between gap-4">
            <Button variant="ghost" className="-ml-3 gap-2 text-muted-foreground" onClick={() => navigate(id ? `/event/${encodeURIComponent(id)}` : "/")}><ArrowLeft className="h-4 w-4" /> Event page</Button>
            <Badge variant="outline" className="hidden sm:inline-flex">Public results board</Badge>
          </div>

          <header className="overflow-hidden rounded-2xl border bg-slate-950 text-white shadow-lg">
            <div className="h-1 bg-gradient-to-r from-orange-500 via-white to-green-500" />
            <div className="grid gap-8 px-6 py-7 sm:px-9 sm:py-9 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-end lg:px-12">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-orange-200"><span>Live scores & results</span><span className="h-1 w-1 rounded-full bg-orange-300" /><span className="text-slate-400">{data.event.category}</span></div>
                <h1 className="mt-3 max-w-4xl text-3xl font-black tracking-tight sm:text-5xl">{data.event.title}</h1>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-300"><span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-orange-300" />{formatDate(data.event.date)}</span><span className="inline-flex items-center gap-2"><Users className="h-4 w-4 text-green-300" />{data.matches.length} match{data.matches.length === 1 ? "" : "es"}</span></div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm"><div className="flex items-center justify-between gap-3"><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Board status</p><span className="flex items-center gap-1.5 text-xs font-semibold text-green-300"><span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />Active</span></div><p className="mt-2 text-sm text-slate-300">Refresh for the latest published updates.</p><Button variant="outline" size="sm" className="mt-4 w-full gap-2 border-white/20 bg-white/5 text-white hover:bg-white/15 hover:text-white" onClick={() => void refetch()} disabled={isFetching}><RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /> {isFetching ? "Updating…" : "Refresh board"}</Button></div>
            </div>
          </header>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Card><CardContent className="flex items-center gap-3 p-4"><CheckCircle2 className="h-5 w-5 text-green-600" /><div><p className="text-2xl font-black leading-none">{completedCount}</p><p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Completed</p></div></CardContent></Card>
            <Card><CardContent className="flex items-center gap-3 p-4"><Trophy className="h-5 w-5 text-primary" /><div><p className="text-2xl font-black leading-none">{liveCount}</p><p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Live now</p></div></CardContent></Card>
            <Card><CardContent className="flex items-center gap-3 p-4"><Clock3 className="h-5 w-5 text-sky-600" /><div><p className="text-2xl font-black leading-none">{upcomingCount}</p><p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Upcoming</p></div></CardContent></Card>
          </div>

          <div className="mt-8 overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex flex-col gap-4 border-b p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
              <div><div className="flex items-center gap-2 text-primary"><ListFilter className="h-4 w-4" /><p className="text-xs font-bold uppercase tracking-[0.16em]">Match centre</p></div><h2 className="mt-1 text-2xl font-black tracking-tight">Fixtures & scores</h2></div>
              <div className="flex items-center gap-2"><label htmlFor="category-filter" className="text-sm text-muted-foreground">Category</label><select id="category-filter" value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setPage(1); }} className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium"><option value="all">All categories</option>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
            </div>
            <div className="flex gap-1 overflow-x-auto border-b bg-muted/30 p-2" aria-label="Filter results by status">
              {statusFilters.map((filter) => { const count = filter.value === "all" ? data.matches.length : data.matches.filter((match) => match.status === filter.value).length; return <button key={filter.value} type="button" aria-pressed={statusFilter === filter.value} onClick={() => { setStatusFilter(filter.value); setPage(1); }} className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold transition-colors ${statusFilter === filter.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/70 hover:text-foreground"}`}>{filter.label}<span className="ml-2 text-xs text-muted-foreground">{count}</span></button>; })}
            </div>

            {data.matches.length === 0 ? (
              <div className="p-12 text-center"><Trophy className="mx-auto h-9 w-9 text-muted-foreground" /><p className="mt-4 font-semibold">No public results yet</p><p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">Results will appear here as the organizer publishes the event schedule and score updates.</p></div>
            ) : filteredMatches.length === 0 ? (
              <div className="p-12 text-center"><p className="font-semibold">No matches in this view</p><p className="mt-1 text-sm text-muted-foreground">Try another status or category filter.</p></div>
            ) : (
              <div className="divide-y">
                {matchesByCategory.map(({ category, matches }) => {
                  const rounds = [...new Set(matches.map((match) => match.roundLabel))];
                  return <section key={category.id}>
                    <div className="flex items-center justify-between gap-4 bg-muted/20 px-4 py-4 sm:px-6"><div><h3 className="font-bold">{category.name}</h3><p className="mt-0.5 text-xs text-muted-foreground">{category.distance ? `${category.distance} · ` : ""}{matches.length} match{matches.length === 1 ? "" : "es"}</p></div><Badge variant="outline">{statusFilter === "all" ? "All" : statusFilters.find((filter) => filter.value === statusFilter)?.label}</Badge></div>
                    <div className="space-y-6 p-4 sm:p-6">{rounds.map((round) => <div key={round}><div className="mb-3 flex items-center gap-3"><p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">{round || "General"}</p><div className="h-px flex-1 bg-border" /></div><div className="space-y-2">{matches.filter((match) => match.roundLabel === round).map((match) => <article key={match.id} className="rounded-xl border bg-background p-4 transition-colors hover:border-primary/40 sm:p-5"><div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.7fr)_180px] lg:items-center"><div className="min-w-0"><div className="mb-3 flex items-center justify-between gap-3 lg:mb-0 lg:block"><p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">{match.court.name}</p><Badge className="lg:hidden" variant={statusVariant(match.status)}>{statusLabels[match.status]}</Badge></div><div className="space-y-2"><div className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${match.winner === "entry_a" ? "border-primary/40 bg-primary/5" : "bg-card"}`}><span className="truncate font-semibold">{match.entryA.displayName}</span>{match.winner === "entry_a" && <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-primary">Winner</span>}</div><div className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${match.winner === "entry_b" ? "border-primary/40 bg-primary/5" : "bg-card"}`}><span className="truncate font-semibold">{match.entryB.displayName}</span>{match.winner === "entry_b" && <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-primary">Winner</span>}</div></div></div><div className="border-t pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0"><p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Scores</p>{match.games.length > 0 ? <div className="flex flex-wrap gap-2">{match.games.map((game) => <span key={game.gameNumber} className="rounded-md bg-muted px-3 py-2 text-sm font-bold">{game.scoreA}<span className="mx-1 text-muted-foreground">–</span>{game.scoreB}<span className="ml-2 text-[10px] font-medium uppercase text-muted-foreground">{game.gameNumber}</span></span>)}</div> : <p className="text-sm text-muted-foreground">No score recorded</p>}</div><div className="flex items-center justify-between gap-3 border-t pt-4 text-xs text-muted-foreground lg:block lg:border-t-0 lg:pl-2 lg:pt-0"><div className="hidden justify-end lg:flex"><Badge variant={statusVariant(match.status)}>{statusLabels[match.status]}</Badge></div><p className="mt-0 lg:mt-3">{formatDateTime(match.scheduledTime)}</p><p className="mt-1">{match.status === "completed" ? "Final result" : match.status === "in_progress" ? "Currently in progress" : "Scheduled fixture"}</p></div></div></article>)}</div></div>)}</div>
                  </section>;
                })}
              </div>
            )}
            {filteredMatches.length > pageSize && <div className="flex flex-col gap-3 border-t px-4 py-4 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6"><span className="text-muted-foreground">Showing {pageOffset + 1}–{Math.min(pageOffset + pageSize, filteredMatches.length)} of {filteredMatches.length} matches</span><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft className="h-4 w-4" /> Previous</Button><span className="min-w-20 text-center text-xs font-medium text-muted-foreground">Page {safePage} of {pageCount}</span><Button variant="outline" size="sm" disabled={safePage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next <ChevronRight className="h-4 w-4" /></Button></div></div>}
          </div>

          {data.categories.filter((category) => category.entryType === "team").map((category) => (
            <PublicStandings key={category.id} eventId={data.event.id} categoryId={category.id} categoryName={category.name} />
          ))}

          <div className="mt-8 flex justify-center"><Button asChild variant="ghost" className="gap-2"><a href={`/event/${encodeURIComponent(data.event.id)}`}><ExternalLink className="h-4 w-4" /> View full event page</a></Button></div>
        </div>
      </div>
    </Layout>
  );
};

export default PublicEventResults;
