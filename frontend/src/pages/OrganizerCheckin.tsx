import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, Camera, CheckCircle2, ClipboardList, MapPin, ScanLine, Search, Settings2, Users, XCircle } from "lucide-react";
import QrScanner from "qr-scanner";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/api";

interface EventOption { id: string; name: string; isArchived: boolean; }
interface Checkpoint { id: string; name: string; position: number; }
interface CheckpointResponse { checkpoints: Checkpoint[]; }
interface AttendeeMatch { id: string; registrationReference: string; participant: { name: string }; participants?: Array<{ participant: { name: string } }>; participantCount?: number; ticket: { name: string; category: string | null }; status: string; checkInStatus: string; }
interface AttendeeMatchResponse { items: AttendeeMatch[]; nextCursor: string | null; hasMore: boolean; }
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
  addOnSelections?: Array<{ name: string; option: string | null; quantity: number }>;
}
type ScannerState = "idle" | "starting" | "active" | "error";

function formatScanTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-IN", { hour: "numeric", minute: "2-digit", day: "numeric", month: "short" });
}

function playCheckinBeep(audioContext: AudioContext | null) {
  if (!audioContext) return;
  try {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.15);
  } catch {
    // Audio feedback is helpful but must never interrupt check-in.
  }
}

const OrganizerCheckin = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const decodeLockRef = useRef(false);
  const [searchParams] = useSearchParams();
  const requestedEventId = searchParams.get("event_id") ?? "";
  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventId, setEventId] = useState("");
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [checkpointId, setCheckpointId] = useState("");
  const [checkpointsLoading, setCheckpointsLoading] = useState(false);
  const [attendeeSearch, setAttendeeSearch] = useState("");
  const [attendeeMatches, setAttendeeMatches] = useState<AttendeeMatch[]>([]);
  const [attendeeSearchError, setAttendeeSearchError] = useState<string | null>(null);
  const [searchingAttendees, setSearchingAttendees] = useState(false);
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
    setAttendeeSearch("");
    setAttendeeMatches([]);
    setAttendeeSearchError(null);
    setScannerOpen(false);
    void apiRequest<CheckpointResponse>(`/organizer/events/${eventId}/checkpoints`).then((response) => {
      setCheckpoints(response.checkpoints);
      const rememberedCheckpoint = window.sessionStorage.getItem(`sportpass-checkpoint-${eventId}`);
      const rememberedMatch = response.checkpoints.find((checkpoint) => checkpoint.id === rememberedCheckpoint);
      if (rememberedMatch) setCheckpointId(rememberedMatch.id);
      else if (response.checkpoints.length === 1) setCheckpointId(response.checkpoints[0].id);
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Could not load checkpoints")).finally(() => setCheckpointsLoading(false));
  }, [eventId]);

  const submitCheckinValues = useCallback(async (credential: string, registrationReference: string) => {
    if (!checkpointId) { setError("Choose the checkpoint where you are working first."); setResult(null); return; }
    if (Boolean(credential) === Boolean(registrationReference)) { setError("Scan a QR code or choose one registration to check in."); setResult(null); return; }
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const checkedIn = await apiRequest<CheckinResult>("/organizer/checkins/scan", {
        method: "POST",
        body: JSON.stringify({ ...(credential ? { credential } : { registration_reference: registrationReference }), checkpoint_id: checkpointId }),
      });
      setResult(checkedIn);
      if (!checkedIn.alreadyScanned) playCheckinBeep(audioContextRef.current);
      setAttendeeMatches((matches) => matches.filter((match) => match.registrationReference !== checkedIn.registrationReference));
    } catch (checkinError) {
      setError(checkinError instanceof Error ? checkinError.message : "Could not record this check-in");
    } finally {
      decodeLockRef.current = false;
      setSubmitting(false);
    }
  }, [checkpointId]);

  const stopScanner = useCallback(() => {
    scannerRef.current?.stop();
    setScannerOpen(false);
    setScannerState("idle");
    setScannerError(null);
  }, []);

  useEffect(() => {
    if (!scannerOpen || !videoRef.current) return;
    const video = videoRef.current;
    let disposed = false;
    setScannerState("starting");
    setScannerError(null);
    const scanner = new QrScanner(video, (scanResult) => {
      const scannedCredential = scanResult.data.trim();
      if (disposed || decodeLockRef.current || !scannedCredential) return;
      decodeLockRef.current = true;
      stopScanner();
      void submitCheckinValues(scannedCredential, "");
    }, {
      preferredCamera: "environment",
      maxScansPerSecond: 5,
      highlightScanRegion: true,
      returnDetailedScanResult: true,
      onDecodeError: (scanError) => {
        if (!disposed && scanError !== QrScanner.NO_QR_CODE_FOUND) setScannerError("The camera could not read this QR code. Hold it steady inside the frame.");
      },
    });
    scannerRef.current = scanner;
    void scanner.start().then(() => {
      if (!disposed) setScannerState("active");
    }).catch((startError: unknown) => {
      if (disposed) return;
      const message = startError instanceof Error ? startError.message : String(startError);
      setScannerState("error");
      setScannerError(/permission|denied|not allowed/i.test(message) ? "Camera permission was denied. Allow camera access and try again." : "Could not start the camera. Make sure a camera is available.");
    });
    return () => { disposed = true; scanner.destroy(); scannerRef.current = null; };
  }, [scannerOpen, stopScanner, submitCheckinValues]);

  const searchAttendees = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = attendeeSearch.trim();
    if (!eventId || !checkpointId || !query) return;
    setSearchingAttendees(true);
    setAttendeeSearchError(null);
    setAttendeeMatches([]);
    setResult(null);
    setError(null);
    try {
      const params = new URLSearchParams({ event_id: eventId, status: "all", q: query, check_in_status: "not_checked_in", page_size: "25" });
      const response = await apiRequest<AttendeeMatchResponse>(`/organizer/registrations?${params}`);
      setAttendeeMatches(response.items);
      if (response.items.length === 0) setAttendeeSearchError("No unchecked-in participant matched that name or registration number.");
    } catch (lookupError) {
      setAttendeeSearchError(lookupError instanceof Error ? lookupError.message : "Could not search registrations.");
    } finally {
      setSearchingAttendees(false);
    }
  };

  const chooseCheckpoint = (value: string) => {
    setCheckpointId(value);
    window.sessionStorage.setItem(`sportpass-checkpoint-${eventId}`, value);
    setResult(null);
    setError(null);
    setAttendeeMatches([]);
  };

  const openScanner = () => {
    decodeLockRef.current = false;
    try {
      audioContextRef.current ??= new window.AudioContext();
      void audioContextRef.current.resume();
    } catch {
      audioContextRef.current = null;
    }
    setResult(null);
    setError(null);
    setScannerError(null);
    setScannerState("starting");
    setScannerOpen(true);
  };

  const selectedEvent = events.find((event) => event.id === eventId);
  const selectedCheckpoint = checkpoints.find((checkpoint) => checkpoint.id === checkpointId);
  const readyToCheckIn = Boolean(eventId && checkpointId);

  return (
    <OrganizerDashboardLayout eventId={eventId || undefined}>
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-5 sm:space-y-6 sm:px-6 sm:py-7 lg:px-8">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-primary"><span className="h-2 w-2 rounded-full bg-emerald-500" />Live operations</div>
            <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">Participant check-in</h1>
            <p className="mt-1 text-sm text-muted-foreground">Search an attendee or scan their QR code.</p>
          </div>
          <div className="hidden shrink-0 gap-2 sm:flex">
            <Button asChild variant="outline" size="sm"><Link to={eventId ? `/organizer/events/${eventId}/checkpoints` : "/organizer"}><Settings2 />Checkpoints</Link></Button>
            <Button asChild variant="outline" size="sm"><Link to={eventId ? `/organizer/events/${eventId}/check-in` : "/organizer/registrations"}><ClipboardList />Check-in report</Link></Button>
          </div>
        </div>

        <section className="sticky top-16 z-30 -mx-4 border-y bg-background/95 px-3 py-2 shadow-sm backdrop-blur sm:static sm:mx-0 sm:rounded-xl sm:border sm:p-4 sm:shadow-none">
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-3">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="checkin-event" className="text-xs font-semibold text-muted-foreground">Event</Label>
              <div id="checkin-event" aria-readonly="true" className="flex min-h-10 w-full min-w-0 items-center rounded-md border border-input bg-muted/40 px-3 py-2 text-sm font-medium leading-5 text-foreground sm:min-h-11" title="Event is fixed for this check-in session">
                {selectedEvent?.name ?? "Loading event…"}
              </div>
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="checkin-checkpoint" className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><MapPin className="h-3.5 w-3.5" />Checkpoint</Label>
              <Select value={checkpointId} onValueChange={chooseCheckpoint} disabled={checkpointsLoading || checkpoints.length === 0}>
                <SelectTrigger id="checkin-checkpoint" className={`h-10 w-full min-w-0 bg-background sm:h-11 ${!checkpointId && checkpoints.length > 0 ? "border-primary ring-2 ring-primary/20" : ""}`} aria-label="Select checkpoint">
                  <SelectValue placeholder={checkpointsLoading ? "Loading checkpoints…" : checkpoints.length === 0 ? "No checkpoints configured" : "Where are you checking in?"} />
                </SelectTrigger>
                <SelectContent>{checkpoints.map((checkpoint) => <SelectItem key={checkpoint.id} value={checkpoint.id}>{checkpoint.position}. {checkpoint.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {readyToCheckIn && <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-3 text-[11px] sm:text-xs"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" /><span className="font-semibold text-foreground">Ready at {selectedCheckpoint?.name}</span><span className="hidden min-w-0 truncate text-muted-foreground sm:inline">· {selectedEvent?.name}</span></div>}
          {!checkpointsLoading && checkpoints.length === 0 && eventId && <p className="mt-3 text-xs text-muted-foreground">This event has no checkpoints. <Link className="font-semibold text-primary underline underline-offset-2" to={`/organizer/events/${eventId}/checkpoints`}>Create one to start check-in</Link>.</p>}
        </section>

        {!readyToCheckIn ? (
          <Card className="border-dashed">
            <CardContent className="px-5 py-12 text-center sm:py-16">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><MapPin className="h-6 w-6" /></div>
              <h2 className="mt-4 text-lg font-bold">Choose your checkpoint</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Select the station where this device is being used. Search and QR scanning will appear immediately.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="overflow-hidden border-primary/20 shadow-sm">
              <CardContent className="p-3 sm:p-5">
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:gap-3">
                  <form onSubmit={searchAttendees} className="min-w-0">
                    <Label htmlFor="attendee-search" className="sr-only">Search by participant name or registration number</Label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-0 top-0 flex h-12 w-14 items-center justify-center sm:h-14"><Search className="h-5 w-5 text-muted-foreground" /></span>
                      <Input id="attendee-search" value={attendeeSearch} onChange={(event) => { setAttendeeSearch(event.target.value); setAttendeeMatches([]); setAttendeeSearchError(null); }} className="h-12 rounded-xl pr-3 text-base sm:h-14 sm:pr-28" style={{ paddingLeft: "3.5rem" }} placeholder="Name or registration number" maxLength={120} autoComplete="off" autoCapitalize="words" />
                      <Button type="submit" size="sm" className="mt-2 h-11 w-full px-4 sm:absolute sm:right-2 sm:top-2 sm:mt-0 sm:h-10 sm:w-auto" disabled={searchingAttendees || !attendeeSearch.trim()}>{searchingAttendees ? "Finding…" : "Search"}</Button>
                    </div>
                  </form>
                  <Button type="button" className="h-12 rounded-xl px-6 text-base font-bold sm:h-14 md:min-w-44" onClick={openScanner} disabled={submitting}><Camera className="h-5 w-5" />Scan QR code</Button>
                </div>
                <p className="mt-2.5 text-xs text-muted-foreground">Search works with a participant name or a reference such as SPE-1234.</p>
              </CardContent>
            </Card>

            {scannerOpen && (
              <Card className="overflow-hidden border-primary/30 shadow-lg">
                <CardContent className="p-3 sm:p-5">
                  <div className="relative aspect-[4/3] max-h-[68dvh] overflow-hidden rounded-xl bg-slate-950 sm:aspect-video">
                    <video ref={videoRef} className="h-full w-full object-cover" autoPlay muted playsInline />
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,transparent_34%,rgba(2,6,23,0.42)_68%,rgba(2,6,23,0.72)_100%)]" />
                    <div className="pointer-events-none absolute inset-[15%] rounded-2xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(2,6,23,0.25)] sm:inset-[20%]" />
                    <div className="absolute inset-x-4 bottom-4 rounded-lg bg-slate-950/70 px-3 py-2 text-center text-xs font-medium text-white">Hold the QR code inside the frame</div>
                    {scannerState === "starting" && <div className="absolute inset-0 flex items-center justify-center bg-slate-950/75 text-sm font-medium text-white">Starting camera…</div>}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground" aria-live="polite">{scannerState === "active" ? `Scanning at ${selectedCheckpoint?.name}` : scannerError ?? "Requesting camera access…"}</p>
                    <Button type="button" variant="outline" onClick={stopScanner}>{scannerState === "error" ? "Close" : "Cancel"}</Button>
                  </div>
                  {scannerError && <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"><XCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{scannerError}</span></div>}
                </CardContent>
              </Card>
            )}

            {error && <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><XCircle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-semibold">Check-in was not recorded</p><p className="mt-0.5">{error}</p></div></div>}

            {result && (
              <div className={`rounded-xl border p-4 shadow-sm sm:p-5 ${result.alreadyScanned ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100" : "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"}`} aria-live="polite">
                <div className="flex items-start gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${result.alreadyScanned ? "bg-amber-100 text-amber-700 dark:bg-amber-900" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900"}`}>{result.alreadyScanned ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-bold uppercase tracking-[0.12em] opacity-70">{result.alreadyScanned ? "Already checked in here" : "Check-in complete"}</p><h2 className="mt-1 text-lg font-bold">{result.participantNames?.join(" · ") ?? result.participantName}</h2></div><Badge variant="outline" className="border-current/20 bg-white/60 dark:bg-black/20">{result.checkpoint.name}</Badge></div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm opacity-75"><span>{result.registrationReference}</span><span>{result.ticketName}</span><span>{formatScanTime(result.scannedAt)}</span></div>
                    {result.addOnSelections && result.addOnSelections.length > 0 && (
                      <div className="mt-3 rounded-lg border border-current/15 bg-white/50 p-3 text-sm dark:bg-black/10">
                        <p className="font-semibold">Registration add-ons</p>
                        <div className="mt-1 space-y-1">
                          {result.addOnSelections.map((addon) => <div key={`${addon.name}-${addon.option ?? "qty"}`} className="flex flex-wrap justify-between gap-2"><span>{addon.name}{addon.option ? ` · ${addon.option}` : ""}</span><span className="font-semibold">×{addon.quantity}</span></div>)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {attendeeSearchError && <div role="status" className="rounded-xl border bg-card p-5 text-center text-sm text-muted-foreground">{attendeeSearchError}</div>}

            {attendeeMatches.length > 0 && (
              <section className="overflow-hidden rounded-xl border bg-card shadow-sm" aria-live="polite">
                <div className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5"><div><h2 className="font-bold">Search results</h2><p className="text-xs text-muted-foreground">Tap check in on the correct participant</p></div><Badge variant="secondary">{attendeeMatches.length}{attendeeMatches.length === 25 ? "+" : ""}</Badge></div>
                <div className="divide-y">
                  {attendeeMatches.map((match) => (
                    <div key={match.id} className="flex items-center gap-3 p-4 sm:px-5">
                      <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary sm:flex"><Users className="h-5 w-5" /></div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold leading-5">{match.participant.name}{match.participantCount && match.participantCount > 1 ? ` + ${match.participantCount - 1}` : ""}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground"><span className="font-mono">{match.registrationReference}</span> · {match.ticket.category ? `${match.ticket.category} · ` : ""}{match.ticket.name}</p>
                        {match.participants && match.participants.length > 1 && <p className="mt-1 truncate text-xs text-muted-foreground">Group: {match.participants.map((entry) => entry.participant.name).join(", ")}</p>}
                      </div>
                      <Button type="button" className="h-11 shrink-0 px-4" disabled={submitting} onClick={() => void submitCheckinValues("", match.registrationReference)}>{submitting ? "Saving…" : "Check in"}</Button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {!scannerOpen && !result && attendeeMatches.length === 0 && !attendeeSearchError && (
              <div className="rounded-xl border border-dashed bg-muted/20 px-5 py-10 text-center sm:py-12">
                <ScanLine className="mx-auto h-7 w-7 text-muted-foreground" />
                <p className="mt-3 font-semibold">Ready for the next participant</p>
                <p className="mt-1 text-sm text-muted-foreground">Search above or scan the QR code on their ticket.</p>
              </div>
            )}

            <div className="flex justify-center gap-2 sm:hidden">
              <Button asChild variant="ghost" size="sm"><Link to={`/organizer/events/${eventId}/checkpoints`}><Settings2 />Checkpoints</Link></Button>
              <Button asChild variant="ghost" size="sm"><Link to={`/organizer/events/${eventId}/check-in`}><ClipboardList />Report</Link></Button>
            </div>
          </>
        )}
      </div>
    </OrganizerDashboardLayout>
  );
};

export default OrganizerCheckin;
