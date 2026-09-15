import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, Camera, CheckCircle2, ChevronRight, ClipboardList, ScanLine, Settings2, ShieldCheck, XCircle } from "lucide-react";
import QrScanner from "qr-scanner";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/api";

interface EventOption { id: string; name: string; isArchived: boolean; }
interface Checkpoint { id: string; name: string; position: number; }
interface CheckpointResponse { checkpoints: Checkpoint[]; }
interface CheckinResult {
  registrationReference: string;
  event: { id: string; name: string; location: string };
  participantName: string;
  participantNames?: string[];
  participantCount?: number;
  ticketName: string;
  checkpoint: { id: string; name: string; position: number };
  status: "checked_in";
  alreadyCheckedIn: boolean;
  alreadyScanned: boolean;
  checkedInAt: string;
  scannedAt: string;
  message: string;
}
type ScannerState = "idle" | "starting" | "active" | "error";

function formatScanTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-IN", { hour: "numeric", minute: "2-digit", day: "numeric", month: "short" });
}

const OrganizerCheckin = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const decodeLockRef = useRef(false);
  const [searchParams] = useSearchParams();
  const requestedEventId = searchParams.get("event_id") ?? "";
  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventId, setEventId] = useState("");
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [checkpointId, setCheckpointId] = useState("");
  const [checkpointsLoading, setCheckpointsLoading] = useState(false);
  const [credential, setCredential] = useState("");
  const [registrationReference, setRegistrationReference] = useState("");
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerState, setScannerState] = useState<ScannerState>("idle");
  const [scannerError, setScannerError] = useState<string | null>(null);

  useEffect(() => {
    void apiRequest<EventOption[]>("/organizer/event-options").then((options) => {
      const active = options.filter((option) => !option.isArchived);
      setEvents(active);
      setEventId(active.find((event) => event.id === requestedEventId)?.id ?? active[0]?.id ?? "");
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Could not load events"));
  }, [requestedEventId]);

  useEffect(() => {
    if (!eventId) { setCheckpoints([]); setCheckpointId(""); setCheckpointsLoading(false); return; }
    setCheckpointId("");
    setCheckpoints([]);
    setCheckpointsLoading(true);
    setResult(null);
    void apiRequest<CheckpointResponse>(`/organizer/events/${eventId}/checkpoints`).then((response) => {
      setCheckpoints(response.checkpoints);
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Could not load checkpoints")).finally(() => setCheckpointsLoading(false));
  }, [eventId]);

  const submitCheckinValues = useCallback(async (normalizedCredential: string, normalizedReference: string) => {
    if (!checkpointId) { setError("Select the checkpoint where you are stationed before scanning."); setResult(null); return; }
    if (Boolean(normalizedCredential) === Boolean(normalizedReference)) { setError("Enter either the QR credential or the registration reference, not both."); setResult(null); return; }
    setSubmitting(true); setError(null); setResult(null);
    try {
      const checkedIn = await apiRequest<CheckinResult>("/organizer/checkins/scan", { method: "POST", body: JSON.stringify({ ...(normalizedCredential ? { credential: normalizedCredential } : { registration_reference: normalizedReference }), checkpoint_id: checkpointId }) });
      setResult(checkedIn); setCredential(""); setRegistrationReference("");
    } catch (checkinError) { setError(checkinError instanceof Error ? checkinError.message : "Could not record this scan"); }
    finally { decodeLockRef.current = false; setSubmitting(false); }
  }, [checkpointId]);

  const stopScanner = useCallback(() => { scannerRef.current?.stop(); setScannerOpen(false); setScannerState("idle"); setScannerError(null); }, []);

  useEffect(() => {
    if (!scannerOpen || !videoRef.current) return;
    const video = videoRef.current;
    let disposed = false;
    setScannerState("starting"); setScannerError(null);
    const scanner = new QrScanner(video, (scanResult) => {
      const scannedCredential = scanResult.data.trim();
      if (disposed || decodeLockRef.current || !scannedCredential) return;
      decodeLockRef.current = true; setCredential(scannedCredential); stopScanner(); void submitCheckinValues(scannedCredential, "");
    }, { preferredCamera: "environment", maxScansPerSecond: 5, highlightScanRegion: true, returnDetailedScanResult: true, onDecodeError: (scanError) => { if (!disposed && scanError !== QrScanner.NO_QR_CODE_FOUND) setScannerError("The camera could not read this QR code. Hold it steady inside the frame."); } });
    scannerRef.current = scanner;
    void scanner.start().then(() => { if (!disposed) setScannerState("active"); }).catch((startError: unknown) => { if (disposed) return; const message = startError instanceof Error ? startError.message : String(startError); setScannerState("error"); setScannerError(/permission|denied|not allowed/i.test(message) ? "Camera permission was denied. Allow camera access in your browser settings and try again." : "Could not start the camera. Use HTTPS or localhost and make sure a camera is available."); });
    return () => { disposed = true; scanner.destroy(); scannerRef.current = null; };
  }, [scannerOpen, stopScanner, submitCheckinValues]);

  const submitCheckin = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void submitCheckinValues(credential.trim(), registrationReference.trim()); };
  const selectedEvent = events.find((event) => event.id === eventId);
  const selectedCheckpoint = checkpoints.find((checkpoint) => checkpoint.id === checkpointId);
  const readyToScan = Boolean(eventId && checkpointId);

  return (
    <OrganizerDashboardLayout eventId={eventId || undefined}>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <section className="rounded-2xl border bg-card px-5 py-6 shadow-sm sm:px-7 sm:py-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2"><Badge variant="outline" className="gap-1.5 border-emerald-200 bg-emerald-50 text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Live check-in desk</Badge><span className="text-xs text-muted-foreground">Same QR · every checkpoint</span></div>
              <h1 className="text-3xl font-black tracking-tight text-foreground sm:text-4xl">Ready to scan</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Choose the station below, then scan each participant&apos;s existing ticket QR. Duplicate scans are checked only for the selected station.</p>
            </div>
            <div className="flex flex-wrap gap-2"><Button asChild variant="outline" className="w-fit gap-2"><Link to={eventId ? `/organizer/events/${eventId}/checkpoints` : "/organizer"}><Settings2 className="h-4 w-4" />Set up checkpoints</Link></Button><Button asChild variant="outline" className="w-fit gap-2"><Link to={eventId ? `/organizer/events/${eventId}/check-in` : "/organizer/registrations"}><ClipboardList className="h-4 w-4" />View matrix<ChevronRight className="h-4 w-4" /></Link></Button></div>
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1 space-y-2"><Label htmlFor="scan-event" className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Event</Label><Select value={eventId} onValueChange={setEventId}><SelectTrigger id="scan-event" className="h-12 bg-background text-base" aria-label="Select event"><SelectValue placeholder="Select event" /></SelectTrigger><SelectContent>{events.map((event) => <SelectItem key={event.id} value={event.id}>{event.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="flex-1 space-y-2"><Label htmlFor="scan-checkpoint" className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Currently scanning for <span className="text-destructive">*</span></Label><Select value={checkpointId} onValueChange={(value) => { setCheckpointId(value); setResult(null); setError(null); }} disabled={checkpointsLoading || checkpoints.length === 0}><SelectTrigger id="scan-checkpoint" className="h-12 bg-background text-base" aria-label="Select checkpoint" aria-required="true"><SelectValue placeholder={checkpointsLoading ? "Loading checkpoints…" : checkpoints.length === 0 ? "No checkpoints configured" : "Select checkpoint"} /></SelectTrigger><SelectContent>{checkpoints.map((checkpoint, index) => <SelectItem key={checkpoint.id} value={checkpoint.id}>{index + 1}. {checkpoint.name}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Choose the station you are physically working at before scanning.</p></div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4 text-sm"><span className="text-muted-foreground">Station status:</span>{readyToScan ? <Badge variant="default" className="gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />{selectedCheckpoint?.name} selected</Badge> : <Badge variant="secondary">Select an event and checkpoint</Badge>}{selectedEvent && <span className="text-muted-foreground">for <span className="font-medium text-foreground">{selectedEvent.name}</span></span>}</div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <Card className="overflow-hidden border-slate-200 shadow-md dark:border-slate-800">
            <CardHeader className="border-b bg-muted/20 pb-4"><div className="flex items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2 text-xl"><ScanLine className="h-5 w-5 text-primary" />Scan participant</CardTitle><CardDescription className="mt-1">{selectedCheckpoint ? `Scanning for ${selectedCheckpoint.name}` : "Select a checkpoint to begin"}</CardDescription></div>{readyToScan && <Badge variant="outline" className="hidden gap-1.5 sm:flex"><ShieldCheck className="h-3.5 w-3.5 text-accent" />Secure station</Badge>}</div></CardHeader>
            <CardContent className="p-4 sm:p-6">
              {scannerOpen ? <div className="space-y-4"><div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-slate-950 shadow-inner sm:aspect-video"><video ref={videoRef} className="h-full w-full object-cover" autoPlay muted playsInline /><div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,transparent_34%,rgba(2,6,23,0.42)_68%,rgba(2,6,23,0.72)_100%)]" /><div className="pointer-events-none absolute inset-[16%] rounded-3xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(2,6,23,0.28)] sm:inset-[20%]" /><div className="absolute inset-x-0 bottom-4 text-center text-xs font-medium text-white/80">Align the participant QR inside the frame</div>{scannerState === "starting" && <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 text-sm text-white">Starting camera…</div>}</div><div className="flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground" aria-live="polite">{scannerState === "active" ? "Camera is ready. Scan the next ticket." : scannerError ?? "Requesting camera access…"}</p><Button type="button" variant="outline" size="sm" onClick={stopScanner}>{scannerState === "error" ? "Close" : "Stop camera"}</Button></div>{scannerError && <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><XCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{scannerError}</span></div>}</div> : <div className="rounded-2xl border border-dashed bg-muted/20 px-5 py-10 text-center sm:px-10 sm:py-14"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Camera className="h-8 w-8" /></div><h2 className="mt-5 text-lg font-bold">Use the camera to scan</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">The QR credential already belongs to the participant. No new QR is needed for this station.</p><Button type="button" className="mt-6 h-12 w-full gap-2 sm:w-auto sm:px-10" onClick={() => { decodeLockRef.current = false; setError(null); setScannerError(null); setScannerState("starting"); setScannerOpen(true); }} disabled={submitting || !readyToScan}><Camera className="h-4 w-4" />{readyToScan ? "Start camera" : "Select a checkpoint first"}</Button></div>}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className={result ? result.alreadyScanned ? "border-amber-300 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20" : "border-emerald-300 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20" : "border-dashed"}>
              <CardHeader className="pb-3"><CardTitle className="text-base">Latest scan</CardTitle><CardDescription>{result ? "The operator result is shown here." : "Scan a participant to see confirmation details."}</CardDescription></CardHeader>
              <CardContent>{result ? <div className="space-y-4"><div className="flex items-start gap-3">{result.alreadyScanned ? <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" /> : <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />}<div className="min-w-0"><p className="font-bold leading-6">{result.message}</p><p className="mt-1 text-sm text-muted-foreground">{result.alreadyScanned ? "No duplicate scan was created." : "Checkpoint scan recorded successfully."}</p></div></div><div className="grid gap-3 border-t pt-4 text-sm"><div><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Participant</p><p className="mt-1 font-semibold">{result.participantNames?.join(" · ") ?? result.participantName}</p></div><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Checkpoint</p><p className="mt-1 font-medium">{result.checkpoint.name}</p></div><Badge variant={result.alreadyScanned ? "secondary" : "default"}>{result.alreadyScanned ? "Already scanned" : "Recorded"}</Badge></div><div><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Scanned at</p><p className="mt-1 font-medium">{formatScanTime(result.scannedAt)}</p></div><p className="font-mono text-xs text-muted-foreground">{result.registrationReference}</p></div></div> : <div className="py-4 text-center"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground"><ScanLine className="h-5 w-5" /></div><p className="mt-3 text-sm font-medium">Waiting for the next ticket</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Keep this panel visible while volunteers scan.</p></div>}</CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Settings2 className="h-4 w-4 text-primary" />Manual fallback</CardTitle><CardDescription>Use a credential or registration reference if the camera cannot read the ticket.</CardDescription></CardHeader>
              <CardContent><form onSubmit={submitCheckin} className="space-y-4"><div className="space-y-2"><Label htmlFor="ticket-credential">Ticket QR credential</Label><Input id="ticket-credential" value={credential} onChange={(event) => setCredential(event.target.value)} placeholder="sportpass://ticket?v=1&t=…" maxLength={300} autoComplete="off" /></div><div className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div><div className="space-y-2"><Label htmlFor="checkin-reference">Registration reference</Label><Input id="checkin-reference" value={registrationReference} onChange={(event) => setRegistrationReference(event.target.value)} placeholder="RP-…" maxLength={80} autoComplete="off" /></div>{error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><XCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}<Button type="submit" className="h-11 w-full gap-2" disabled={submitting || !readyToScan}>{submitting ? "Recording scan…" : "Record manual scan"}</Button></form></CardContent>
            </Card>
          </div>
        </div>
      </div>
    </OrganizerDashboardLayout>
  );
};

export default OrganizerCheckin;
