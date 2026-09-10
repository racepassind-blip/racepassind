import { FormEvent, useState } from "react";
import { AlertCircle, CheckCircle2, Ticket } from "lucide-react";

import { DashboardLayout } from "@/components/DashboardLayout";
import { ParticipantRegistrationCard } from "@/components/ParticipantRegistrationCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useClaimParticipantRegistration, useParticipantRegistrations } from "@/hooks/useParticipantRegistrations";

const ParticipantRegistrations = () => {
  const { data: registrations = [], isLoading, isError, error } = useParticipantRegistrations();
  const claimMutation = useClaimParticipantRegistration();
  const [registrationReference, setRegistrationReference] = useState("");
  const [claimCode, setClaimCode] = useState("");
  const [claimSuccess, setClaimSuccess] = useState<string | null>(null);

  const handleClaim = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setClaimSuccess(null);
    try {
      const claimed = await claimMutation.mutateAsync({
        registration_reference: registrationReference.trim(),
        claim_code: claimCode.trim(),
      });
      setRegistrationReference("");
      setClaimCode("");
      setClaimSuccess(`Registration ${claimed.registrationReference} is now linked to your account.`);
    } catch {
      // The mutation error is rendered below using the backend's safe detail message.
    }
  };

  const loadError = error instanceof Error ? error.message : "Could not load your registrations";
  const claimError = claimMutation.error instanceof Error ? claimMutation.error.message : "Registration could not be claimed";

  return (
    <DashboardLayout>
      <div className="max-w-6xl space-y-8 p-6 lg:p-10">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">My Registrations</h1>
          <p className="mt-1 text-sm text-muted-foreground">View registrations linked to your account or securely claim a guest registration.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><Ticket className="h-5 w-5 text-primary" />Claim a guest registration</CardTitle>
            <CardDescription>Enter the registration reference and private claim code from your confirmation. Never share the claim code publicly.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleClaim} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="registration-reference">Registration reference</Label>
                <Input id="registration-reference" value={registrationReference} onChange={(event) => setRegistrationReference(event.target.value)} placeholder="RP-…" required maxLength={64} autoComplete="off" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="claim-code">Claim code</Label>
                <Input id="claim-code" value={claimCode} onChange={(event) => setClaimCode(event.target.value)} placeholder="Private claim code" required maxLength={128} autoComplete="off" />
              </div>
              <Button type="submit" disabled={claimMutation.isPending} className="sm:min-w-28">{claimMutation.isPending ? "Claiming…" : "Claim registration"}</Button>
            </form>
            {(claimMutation.isError || claimSuccess) && (
              <div className={`mt-4 flex items-start gap-2 rounded-md border p-3 text-sm ${claimMutation.isError ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-accent/40 bg-accent/10 text-accent-foreground"}`}>
                {claimMutation.isError ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
                <span>{claimMutation.isError ? claimError : claimSuccess}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-bold">Linked registrations</h2>
            <p className="text-sm text-muted-foreground">Only registrations belonging to your authenticated account are shown.</p>
          </div>

          {isLoading && <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Loading your registrations…</CardContent></Card>}
          {!isLoading && isError && (
            <Card><CardContent className="flex items-start gap-2 py-6 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{loadError}</span></CardContent></Card>
          )}
          {!isLoading && !isError && registrations.length === 0 && (
            <Card><CardContent className="py-10 text-center"><Ticket className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-medium">No linked registrations yet</p><p className="mt-1 text-sm text-muted-foreground">Use the claim form above to link a guest registration.</p></CardContent></Card>
          )}
          {!isLoading && !isError && registrations.length > 0 && (
            <div className="grid gap-5 lg:grid-cols-2">
              {registrations.map((registration) => <ParticipantRegistrationCard key={registration.id} registration={registration} />)}
            </div>
          )}
        </section>
      </div>
    </DashboardLayout>
  );
};

export default ParticipantRegistrations;
