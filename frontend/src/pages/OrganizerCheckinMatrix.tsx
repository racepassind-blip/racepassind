import { useCallback, useEffect, useState } from "react";
import { Activity, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Clock3, RefreshCw, ScanLine, Search, Settings2, Users } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest } from "@/lib/api";
import { useFreeEventLock } from "@/hooks/useFreeEventLock";

interface Checkpoint { id: string; name: string; position: number; }
interface Scan { scannedAt: string; checkpointName: string; }
interface MatrixItem { registrationId: string; registrationReference: string | null; participantName: string; participantNames: string[]; participantCount: number; scans: Record<string, Scan | null>; timeline: Scan[]; }
interface MatrixResponse { eventName: string; checkpoints: Checkpoint[]; counts: Array<{ checkpointId: string; scanned: number; total: number }>; items: MatrixItem[]; totalParticipants: number; }
type ProgressFilter = "all" | "not_started" | "in_progress" | "complete";

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

const OrganizerCheckinMatrix = () => {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { locked } = useFreeEventLock(eventId);
  const [data, setData] = useState<MatrixResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [search, setSearch] = useState("");
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>("all");
  const [page, setPage] = useState(1);

  const load = useCallback(async (background = false) => {
    if (!eventId) return;
    if (background) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);
    try {
      setData(await apiRequest<MatrixResponse>(`/organizer/events/${eventId}/check-in-matrix`));
      setLastUpdatedAt(new Date());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load the check-in matrix";
      setLoadError(message);
      if (!background) toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [eventId]);

  useEffect(() => { void load(); const interval = window.setInterval(() => void load(true), 15000); return () => window.clearInterval(interval); }, [load]);

  if (locked) {
    return (
      <OrganizerDashboardLayout eventId={eventId}>
        <div className="mx-auto max-w-3xl px-4 py-20">
          <Card>
            <CardHeader>
              <CardTitle>Check-in locked</CardTitle>
              <CardDescription>Check-in matrix and participant tracking are available for paid events. Free events get only basic registration and participant management.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Upgrade to a paid event to track participant arrivals across multiple check-in stations.
              </p>
              <p className="text-xs text-muted-foreground">
                Need custom check-in features? <a href="mailto:sportpassind@gmail.com" className="font-medium text-primary hover:underline">Contact SportPass India</a> for custom pricing.
              </p>
              <Button variant="outline" onClick={() => navigate(`/organizer/events/${eventId}`)}>Back to event</Button>
            </CardContent>
          </Card>
        </div>
      </OrganizerDashboardLayout>
    );
  }

  const checkpointCount = data?.checkpoints.length ?? 0;
  const totalScans = data?.items.reduce((sum, item) => sum + data.checkpoints.filter((checkpoint) => Boolean(item.scans[checkpoint.id])).length, 0) ?? 0;
  const possibleScans = (data?.items.length ?? 0) * checkpointCount;
  const overallProgress = possibleScans > 0 ? Math.round((totalScans / possibleScans) * 100) : 0;
  const completedRegistrations = checkpointCount > 0 ? data?.items.filter((item) => data.checkpoints.every((checkpoint) => Boolean(item.scans[checkpoint.id]))).length ?? 0 : 0;
  const normalizedSearch = search.trim().toLowerCase();
  const filteredItems = data?.items.filter((item) => {
    const scanCount = data.checkpoints.filter((checkpoint) => Boolean(item.scans[checkpoint.id])).length;
    const progressState: ProgressFilter = scanCount === 0 ? "not_started" : checkpointCount > 0 && scanCount === checkpointCount ? "complete" : "in_progress";
    const matchesSearch = !normalizedSearch || [item.participantName, ...item.participantNames, item.registrationReference].filter(Boolean).some((value) => value!.toLowerCase().includes(normalizedSearch));
    return matchesSearch && (progressFilter === "all" || progressFilter === progressState);
  }) ?? [];
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleItems = filteredItems.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <OrganizerDashboardLayout eventId={eventId}>
      <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-3"><Button variant="ghost" size="icon" className="mt-0.5 shrink-0" onClick={() => navigate(`/organizer/events/${eventId}`)} aria-label="Back to event dashboard"><ArrowLeft className="h-4 w-4" /></Button><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Event check-in</p><h1 className="mt-1 truncate text-2xl font-black tracking-tight sm:text-3xl">{data?.eventName ?? "Check-in progress"}</h1><p className="mt-1 text-sm text-muted-foreground">Monitor every registration across your event checkpoints.</p></div></div>
            <div className="flex flex-wrap gap-2 pl-12 lg:pl-0"><Button variant="outline" className="gap-2" onClick={() => navigate(`/organizer/events/${eventId}/checkpoints`)}><Settings2 className="h-4 w-4" /> Checkpoints</Button><Button variant="outline" className="gap-2" onClick={() => void load()} disabled={loading || refreshing}><RefreshCw className={loading || refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />Refresh</Button><Button className="gap-2" onClick={() => navigate(`/organizer/check-in?event_id=${encodeURIComponent(eventId ?? "")}`)}><ScanLine className="h-4 w-4" /> Open scanner</Button></div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-4 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1.5"><Activity className="h-3.5 w-3.5 text-primary" />Updates automatically every 15 seconds</span>{lastUpdatedAt && <span>Last updated {lastUpdatedAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>}{refreshing && <span className="font-medium text-primary">Updating…</span>}</div>
        </section>

        {loadError && <div className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"><span>{loadError}</span><Button variant="outline" size="sm" className="w-fit" onClick={() => void load()}>Try again</Button></div>}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-sm font-medium text-muted-foreground">Confirmed participants</p><Users className="h-5 w-5 text-primary" /></div><p className="mt-3 text-3xl font-black">{(data?.totalParticipants ?? 0).toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">Across {(data?.items.length ?? 0).toLocaleString()} registration records</p></CardContent></Card>
          <Card><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-sm font-medium text-muted-foreground">Checkpoints</p><Settings2 className="h-5 w-5 text-blue-600" /></div><p className="mt-3 text-3xl font-black">{checkpointCount.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">Configured scanning stations</p></CardContent></Card>
          <Card><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-sm font-medium text-muted-foreground">Completed journey</p><CheckCircle2 className="h-5 w-5 text-emerald-600" /></div><p className="mt-3 text-3xl font-black">{completedRegistrations.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">Registration records scanned everywhere</p></CardContent></Card>
          <Card><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-sm font-medium text-muted-foreground">Overall progress</p><Activity className="h-5 w-5 text-violet-600" /></div><p className="mt-3 text-3xl font-black">{overallProgress}%</p><Progress value={overallProgress} className="mt-3 h-1.5" /><p className="mt-2 text-xs text-muted-foreground">{totalScans.toLocaleString()} checkpoint scans recorded</p></CardContent></Card>
        </div>

        {data && data.checkpoints.length > 0 ? <section className="space-y-3"><div><h2 className="text-lg font-black tracking-tight">Checkpoint progress</h2><p className="text-sm text-muted-foreground">Live completion at each scanning station.</p></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{data.counts.map((count) => { const checkpoint = data.checkpoints.find((item) => item.id === count.checkpointId); const progress = count.total > 0 ? Math.round((count.scanned / count.total) * 100) : 0; return <Card key={count.checkpointId}><CardContent className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{checkpoint?.name ?? "Checkpoint"}</p><p className="mt-1 text-xs text-muted-foreground">Station {checkpoint?.position ?? "—"}</p></div><span className="text-sm font-bold text-primary">{progress}%</span></div><p className="mt-4 text-2xl font-black">{count.scanned.toLocaleString()} <span className="text-sm font-medium text-muted-foreground">of {count.total.toLocaleString()}</span></p><Progress value={progress} className="mt-3 h-1.5" /></CardContent></Card>; })}</div></section> : data && <Card className="border-dashed"><CardContent className="p-10 text-center"><Settings2 className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-4 font-semibold">Set up your first checkpoint</p><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Create checkpoints before opening the scanner so every scan is recorded against the correct station.</p><Button className="mt-5 gap-2" onClick={() => navigate(`/organizer/events/${eventId}/checkpoints`)}><Settings2 className="h-4 w-4" /> Configure checkpoints</Button></CardContent></Card>}

        <Card>
          <CardHeader className="space-y-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle>Participant progress</CardTitle><CardDescription>Open a participant row to see their checkpoint timeline.</CardDescription></div>{data && <Badge variant="secondary" className="w-fit">{filteredItems.length} shown</Badge>}</div><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="relative w-full lg:max-w-md"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search participant or registration number" className="pl-9" /></div><div className="flex gap-1 overflow-x-auto rounded-lg bg-muted/60 p-1" role="tablist" aria-label="Filter checkpoint progress">{([{ value: "all", label: "All" }, { value: "not_started", label: "Not started" }, { value: "in_progress", label: "In progress" }, { value: "complete", label: "Complete" }] as Array<{ value: ProgressFilter; label: string }>).map((filter) => <button key={filter.value} type="button" role="tab" aria-selected={progressFilter === filter.value} onClick={() => { setProgressFilter(filter.value); setPage(1); }} className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${progressFilter === filter.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{filter.label}</button>)}</div></div></CardHeader>
          <CardContent className="p-0">{loading && !data ? <div className="p-12 text-center text-sm text-muted-foreground"><RefreshCw className="mx-auto mb-3 h-5 w-5 animate-spin" />Loading check-in progress…</div> : !data || data.items.length === 0 ? <div className="p-12 text-center"><Users className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-4 font-semibold">No confirmed registrations yet</p><p className="mt-1 text-sm text-muted-foreground">Confirmed registrations will appear here for check-in.</p></div> : filteredItems.length === 0 ? <div className="p-12 text-center"><Search className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-4 font-semibold">No participants found</p><p className="mt-1 text-sm text-muted-foreground">Try a different search or progress filter.</p><Button variant="ghost" className="mt-3" onClick={() => { setSearch(""); setProgressFilter("all"); setPage(1); }}>Clear filters</Button></div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="sticky left-0 z-20 min-w-64 border-r bg-card">Participant</TableHead>{data.checkpoints.map((checkpoint) => <TableHead key={checkpoint.id} className="min-w-40 text-center"><span className="block">{checkpoint.name}</span><span className="text-[11px] font-normal text-muted-foreground">Station {checkpoint.position}</span></TableHead>)}</TableRow></TableHeader><TableBody>{visibleItems.map((item) => { const itemScanCount = data.checkpoints.filter((checkpoint) => Boolean(item.scans[checkpoint.id])).length; return <TableRow key={item.registrationId}><TableCell className="sticky left-0 z-10 border-r bg-card align-top"><details><summary className="cursor-pointer list-none"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold underline decoration-dotted underline-offset-4">{item.participantName}</p><p className="mt-0.5 font-mono text-xs text-muted-foreground">{item.registrationReference ?? "No registration number"}</p><p className="mt-1 text-xs text-muted-foreground">{item.participantCount > 1 ? `${item.participantCount} participants` : "1 participant"}</p></div><Badge variant={checkpointCount > 0 && itemScanCount === checkpointCount ? "default" : "secondary"}>{itemScanCount}/{checkpointCount}</Badge></div></summary><div className="mt-3 space-y-1 rounded-md bg-muted/50 p-2 text-xs">{item.timeline.length === 0 ? <p className="text-muted-foreground">No scans recorded.</p> : item.timeline.map((scan) => <p key={`${scan.checkpointName}-${scan.scannedAt}`}><span className="font-medium">{scan.checkpointName}</span> <span className="text-emerald-600">✓</span> {formatTime(scan.scannedAt)}</p>)}</div></details></TableCell>{data.checkpoints.map((checkpoint) => { const scan = item.scans[checkpoint.id]; return <TableCell key={checkpoint.id} className="text-center align-top">{scan ? <div className="space-y-1"><span className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" /></span><p className="text-xs font-medium text-muted-foreground">{formatTime(scan.scannedAt)}</p></div> : <div className="space-y-1 text-muted-foreground"><Clock3 className="mx-auto h-4 w-4 opacity-40" /><p className="text-xs">Waiting</p></div>}</TableCell>; })}</TableRow>; })}</TableBody></Table></div>}{filteredItems.length > pageSize && <div className="flex items-center justify-between gap-3 border-t px-4 py-3"><p className="text-sm text-muted-foreground">Page {safePage} of {totalPages} · {filteredItems.length} records</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>}</CardContent>
        </Card>
      </div>
    </OrganizerDashboardLayout>
  );
};

export default OrganizerCheckinMatrix;
