import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, CheckCircle2, ClipboardList, ScanLine, XCircle } from "lucide-react";
import QrScanner from "qr-scanner";
import { Link } from "react-router-dom";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/api";

interface CheckinResult {
  registrationReference: string;
  event: { id: string; name: string; location: string };
  participantName: string;
  ticketName: string;
  status: "checked_in";
  alreadyCheckedIn: boolean;
  checkedInAt: string;
  message: string;
}

type ScannerState = "idle" | "starting" | "active" | "error";

const OrganizerCheckin = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const decodeLockRef = useRef(false);
  const [credential, setCredential] = useState("");
  const [registrationReference, setRegistrationReference] = useState("");
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerState, setScannerState] = useState<ScannerState>("idle");
  const [scannerError, setScannerError] = useState<string | null>(null);

  const submitCheckinValues = useCallback(async (normalizedCredential: string, normalizedReference: string) => {
    if (Boolean(normalizedCredential) === Boolean(normalizedReference)) {
      setError("Enter either the QR credential or the registration reference, not both.");
      setResult(null);
      return;
    }

    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const checkedIn = await apiRequest<CheckinResult>("/organizer/checkins/scan", {
        method: "POST",
        body: JSON.stringify(normalizedCredential
          ? { credential: normalizedCredential }
          : { registration_reference: normalizedReference }),
      });
      setResult(checkedIn);
      setCredential("");
      setRegistrationReference("");
    } catch (checkinError) {
      setError(checkinError instanceof Error ? checkinError.message : "Could not check in this registration");
    } finally {
      decodeLockRef.current = false;
      setSubmitting(false);
    }
  }, []);

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

    const scanner = new QrScanner(
      video,
      (scanResult) => {
        const scannedCredential = scanResult.data.trim();
        if (disposed || decodeLockRef.current || !scannedCredential) return;

        decodeLockRef.current = true;
        setCredential(scannedCredential);
        stopScanner();
        void submitCheckinValues(scannedCredential, "");
      },
      {
        preferredCamera: "environment",
        maxScansPerSecond: 5,
        highlightScanRegion: true,
        returnDetailedScanResult: true,
        onDecodeError: (scanError) => {
          if (!disposed && scanError !== QrScanner.NO_QR_CODE_FOUND) {
            setScannerError("The camera could not read this QR code. Hold it steady inside the frame.");
          }
        },
      },
    );
    scannerRef.current = scanner;

    void scanner.start()
      .then(() => {
        if (!disposed) setScannerState("active");
      })
      .catch((startError: unknown) => {
        if (disposed) return;
        const message = startError instanceof Error ? startError.message : String(startError);
        const permissionDenied = /permission|denied|not allowed/i.test(message);
        setScannerState("error");
        setScannerError(permissionDenied
          ? "Camera permission was denied. Allow camera access in your browser settings and try again."
          : "Could not start the camera. Use HTTPS or localhost and make sure a camera is available.");
      });

    return () => {
      disposed = true;
      scanner.destroy();
      scannerRef.current = null;
    };
  }, [scannerOpen, stopScanner, submitCheckinValues]);

  const openScanner = () => {
    decodeLockRef.current = false;
    setScannerError(null);
    setScannerState("starting");
    setScannerOpen(true);
  };

  const submitCheckin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitCheckinValues(credential.trim(), registrationReference.trim());
  };

  return (
    <OrganizerDashboardLayout>
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Race check-in</h1>
            <p className="mt-1 text-sm text-muted-foreground">Scan a ticket QR code or use the exact registration reference.</p>
          </div>
          <Button asChild variant="outline" className="gap-2"><Link to="/organizer/registrations"><ClipboardList className="h-4 w-4" />Registrations</Link></Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ScanLine className="h-5 w-5 text-primary" />Scan ticket QR</CardTitle>
            <CardDescription>Use the phone camera to scan the participant&apos;s RacePass ticket. Camera access requires HTTPS or localhost.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {scannerOpen ? (
              <>
                <div className="relative aspect-video overflow-hidden rounded-xl border bg-slate-950">
                  <video ref={videoRef} className="h-full w-full object-cover" autoPlay muted playsInline />
                  {scannerState === "starting" && <p className="absolute inset-0 flex items-center justify-center bg-slate-950/70 px-4 text-center text-sm text-white">Starting camera…</p>}
                  {scannerState === "active" && <div className="pointer-events-none absolute inset-8 rounded-xl border-2 border-primary shadow-[0_0_0_9999px_rgba(2,6,23,0.35)]" />}
                </div>
                <p className="text-sm text-muted-foreground" aria-live="polite">{scannerState === "active" ? "Hold the QR code inside the frame." : scannerError ?? "Requesting camera access…"}</p>
                {scannerError && <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><XCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{scannerError}</span></div>}
                <Button type="button" variant="outline" className="w-full" onClick={stopScanner}>{scannerState === "error" ? "Close camera" : "Stop scanning"}</Button>
              </>
            ) : (
              <Button type="button" className="w-full gap-2" onClick={openScanner} disabled={submitting}><Camera className="h-4 w-4" />Scan with camera</Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Manual check-in</CardTitle>
            <CardDescription>Use the QR credential as a fallback, or enter the exact registration reference.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitCheckin} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="ticket-credential">Ticket QR credential</Label>
                <Input id="ticket-credential" value={credential} onChange={(event) => setCredential(event.target.value)} placeholder="racepass://ticket?v=1&t=…" maxLength={300} autoComplete="off" />
              </div>
              <div className="text-center text-xs uppercase tracking-wide text-muted-foreground">or</div>
              <div className="space-y-2">
                <Label htmlFor="checkin-reference">Registration reference</Label>
                <Input id="checkin-reference" value={registrationReference} onChange={(event) => setRegistrationReference(event.target.value)} placeholder="RP-…" maxLength={80} autoComplete="off" />
              </div>
              {error && <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><XCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
              <Button type="submit" className="w-full gap-2" disabled={submitting}>{submitting ? "Checking in…" : "Check in participant"}</Button>
            </form>
          </CardContent>
        </Card>

        {result && <Card className={result.alreadyCheckedIn ? "border-secondary" : "border-accent"}>
          <CardContent className="space-y-4 p-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-accent" />
              <div><p className="font-semibold">{result.message}</p><p className="text-sm text-muted-foreground">{result.alreadyCheckedIn ? "No duplicate check-in was created." : "The participant is now checked in."}</p></div>
            </div>
            <div className="grid gap-4 border-t pt-4 text-sm sm:grid-cols-2">
              <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Participant</p><p className="mt-1 font-medium">{result.participantName}</p></div>
              <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Registration reference</p><p className="mt-1 font-mono font-medium">{result.registrationReference}</p></div>
              <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Event</p><p className="mt-1 font-medium">{result.event.name}</p></div>
              <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Checked in at</p><p className="mt-1 font-medium">{new Date(result.checkedInAt).toLocaleString("en-IN")}</p></div>
            </div>
          </CardContent>
        </Card>}
      </div>
    </OrganizerDashboardLayout>
  );
};

export default OrganizerCheckin;
