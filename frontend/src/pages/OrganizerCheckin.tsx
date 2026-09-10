import { FormEvent, useState } from "react";
import { CheckCircle2, ClipboardList, ScanLine, XCircle } from "lucide-react";
import { Link } from "react-router-dom";

import { Layout } from "@/components/Layout";
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

const OrganizerCheckin = () => {
  const [credential, setCredential] = useState("");
  const [registrationReference, setRegistrationReference] = useState("");
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submitCheckin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedCredential = credential.trim();
    const normalizedReference = registrationReference.trim();
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
      setSubmitting(false);
    }
  };

  return (
    <Layout>
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Race check-in</h1>
            <p className="mt-1 text-sm text-muted-foreground">Scan a ticket QR value or use the exact registration reference.</p>
          </div>
          <Button asChild variant="outline" className="gap-2"><Link to="/organizer/registrations"><ClipboardList className="h-4 w-4" />Registrations</Link></Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ScanLine className="h-5 w-5 text-primary" />Check in participant</CardTitle>
            <CardDescription>Paste the full RacePass QR credential (`racepass://ticket?...`) or enter a registration reference. The backend verifies event ownership and confirmation status.</CardDescription>
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
    </Layout>
  );
};

export default OrganizerCheckin;
