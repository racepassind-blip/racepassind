import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, RefreshCw, ScanLine } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest } from "@/lib/api";

interface Checkpoint { id: string; name: string; position: number; }
interface Scan { scannedAt: string; checkpointName: string; }
interface MatrixItem { registrationId: string; registrationReference: string | null; participantName: string; participantNames: string[]; participantCount: number; scans: Record<string, Scan | null>; timeline: Scan[]; }
interface MatrixResponse { eventName: string; checkpoints: Checkpoint[]; counts: Array<{ checkpointId: string; scanned: number; total: number }>; items: MatrixItem[]; totalParticipants: number; }

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

const OrganizerCheckinMatrix = () => {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<MatrixResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    try { setData(await apiRequest<MatrixResponse>(`/organizer/events/${eventId}/check-in-matrix`)); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not load the check-in matrix"); }
    finally { setLoading(false); }
  }, [eventId]);

  useEffect(() => { void load(); const interval = window.setInterval(() => void load(), 15000); return () => window.clearInterval(interval); }, [load]);

  return (
    <OrganizerDashboardLayout eventId={eventId}>
      <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><Button variant="ghost" size="icon" onClick={() => navigate(`/organizer/events/${eventId}`)} aria-label="Back to event dashboard"><ArrowLeft className="h-4 w-4" /></Button><div><h1 className="text-2xl font-extrabold tracking-tight">Check-in matrix</h1><p className="text-sm text-muted-foreground">{data?.eventName ?? "Event"} · rows are registrations, columns are checkpoints.</p></div></div><div className="flex gap-2"><Button variant="outline" className="gap-2" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />Refresh</Button><Button className="gap-2" onClick={() => navigate(`/organizer/check-in?event_id=${encodeURIComponent(eventId ?? "")}`)}><ScanLine className="h-4 w-4" />Open scanner</Button></div></div>

        {data && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{data.counts.map((count) => { const checkpoint = data.checkpoints.find((item) => item.id === count.checkpointId); return <Card key={count.checkpointId}><CardContent className="p-5"><div className="flex items-center justify-between"><p className="font-semibold">{checkpoint?.name ?? "Checkpoint"}</p><CheckCircle2 className="h-5 w-5 text-accent" /></div><p className="mt-3 text-3xl font-black">{count.scanned.toLocaleString()} <span className="text-base font-medium text-muted-foreground">/ {count.total.toLocaleString()}</span></p><p className="mt-1 text-xs text-muted-foreground">served</p></CardContent></Card>; })}</div>}

        <Card><CardHeader><CardTitle>Participant progress</CardTitle><CardDescription>Click a participant name to view their checkpoint history in order. The matrix refreshes every 15 seconds.</CardDescription></CardHeader><CardContent className="p-0">{loading && !data ? <p className="p-8 text-center text-sm text-muted-foreground">Loading check-in progress…</p> : !data || data.items.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">No confirmed registrations are visible for this event.</p> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="sticky left-0 z-10 min-w-56 bg-card">Participant</TableHead>{data.checkpoints.map((checkpoint) => <TableHead key={checkpoint.id} className="min-w-36 text-center">{checkpoint.name}</TableHead>)}</TableRow></TableHeader><TableBody>{data.items.map((item) => <TableRow key={item.registrationId}><TableCell className="sticky left-0 z-10 bg-card align-top"><details><summary className="cursor-pointer list-none"><p className="font-medium underline decoration-dotted underline-offset-4">{item.participantName}</p><p className="text-xs text-muted-foreground">{item.registrationReference ?? "No reference"}{item.participantCount > 1 ? ` · ${item.participantCount} participants` : ""}</p></summary><div className="mt-3 space-y-1 rounded-md bg-muted/50 p-2 text-xs">{item.timeline.length === 0 ? <p className="text-muted-foreground">No scans yet.</p> : item.timeline.map((scan) => <p key={`${scan.checkpointName}-${scan.scannedAt}`}><span className="font-medium">{scan.checkpointName}</span> ✓ {formatTime(scan.scannedAt)}</p>)}</div></details></TableCell>{data.checkpoints.map((checkpoint) => { const scan = item.scans[checkpoint.id]; return <TableCell key={checkpoint.id} className="text-center align-top">{scan ? <div className="space-y-1"><Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" />Scanned</Badge><p className="text-xs text-muted-foreground">{formatTime(scan.scannedAt)}</p></div> : <span className="text-sm text-muted-foreground">—</span>}</TableCell>; })}</TableRow>)}</TableBody></Table></div>}</CardContent></Card>
      </div>
    </OrganizerDashboardLayout>
  );
};

export default OrganizerCheckinMatrix;
