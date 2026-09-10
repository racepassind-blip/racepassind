import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Clock3, LayoutDashboard, QrCode, XCircle } from "lucide-react";

import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";

const API_ORIGIN = (import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const API_BASE = `${API_ORIGIN}/api/v1`;
const CONFIRMATION_TOKEN_KEY = "racepass_confirmation_token";

interface ConfirmationState {
  confirmationToken?: string;
  registrationReference: string;
  amountPaise: number;
  status: string;
  checkInStatus?: "checked_in" | "not_checked_in";
  checkedInAt?: string | null;
  paymentStatus: string;
  event: { name: string; date: string; location: string };
  participant: { name: string };
  paymentSettings: {
    upiId: string;
    payeeName: string;
    instructions: string;
    qrDataUrl?: string;
    upiUri?: string;
  } | null;
  ticket: { version: number; format: string; qrDataUrl: string } | null;
}

const statusDetails: Record<string, { label: string; description: string }> = {
  awaiting_payment: {
    label: "Awaiting payment",
    description: "Your registration is reserved temporarily. Pay the organizer by UPI, then submit your UTR/reference.",
  },
  pending_verification: {
    label: "Pending organizer verification",
    description: "Your payment reference was recorded. The organizer will verify the payment manually.",
  },
  rejected: {
    label: "Payment not approved",
    description: "The organizer did not approve this payment. Contact the organizer if you think this is incorrect.",
  },
  expired: {
    label: "Registration expired",
    description: "The payment window expired before the organizer could confirm this registration.",
  },
  confirmed: {
    label: "Registration confirmed",
    description: "Your payment was approved. Keep this ticket QR ready for event check-in.",
  },
  checked_in: {
    label: "Checked in",
    description: "This registration has been checked in.",
  },
};

const Confirmation = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const initialState = location.state as ConfirmationState | null;
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(initialState);
  const [token] = useState(() => initialState?.confirmationToken ?? sessionStorage.getItem(CONFIRMATION_TOKEN_KEY));
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    sessionStorage.setItem(CONFIRMATION_TOKEN_KEY, token);
    const controller = new AbortController();
    const loadConfirmation = async () => {
      try {
        const response = await fetch(`${API_BASE}/registrations/confirmation`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ confirmation_token: token }),
        });
        if (!response.ok) {
          if (response.status === 404) sessionStorage.removeItem(CONFIRMATION_TOKEN_KEY);
          const body = await response.json().catch(() => null) as { detail?: string } | null;
          throw new Error(body?.detail ?? "Could not load this registration");
        }
        const result = await response.json() as Omit<ConfirmationState, "confirmationToken">;
        setConfirmation({ ...result, confirmationToken: token });
        setError(null);
      } catch (loadError) {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Could not load this registration");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void loadConfirmation();
    return () => controller.abort();
  }, [token]);

  if (!token && !initialState) return <Navigate to="/" replace />;
  if (loading || !confirmation) return <Layout><div className="py-20 text-center text-muted-foreground">Loading your registration…</div></Layout>;
  if (error) return <Layout><div className="mx-auto max-w-xl px-4 py-20 text-center"><h1 className="mb-3 text-2xl font-bold">Could not load registration</h1><p className="mb-6 text-muted-foreground">{error}</p><Button onClick={() => navigate("/")}>Return to Explore</Button></div></Layout>;

  const details = statusDetails[confirmation.status] ?? {
    label: confirmation.status,
    description: "Your registration status is being processed.",
  };
  const isConfirmed = confirmation.status === "confirmed" || confirmation.status === "checked_in";
  const StatusIcon = confirmation.status === "rejected" || confirmation.status === "expired" ? XCircle : isConfirmed ? CheckCircle2 : Clock3;

  return (
    <Layout>
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div className={`mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full ${confirmation.status === "rejected" || confirmation.status === "expired" ? "bg-destructive/15" : isConfirmed ? "bg-accent/15" : "bg-primary/15"}`}>
          <StatusIcon className={`h-10 w-10 ${confirmation.status === "rejected" || confirmation.status === "expired" ? "text-destructive" : isConfirmed ? "text-accent" : "text-primary"}`} />
        </div>

        <h1 className="mb-2 text-3xl font-extrabold tracking-tight">{details.label}</h1>
        <p className="mb-10 text-muted-foreground">{details.description}</p>

        <div className="overflow-hidden rounded-2xl border bg-card text-left shadow-sm">
          <div className="bg-primary px-6 py-4">
            <p className="text-lg font-bold text-primary-foreground">{confirmation.event.name}</p>
            <p className="text-sm text-primary-foreground/80">{confirmation.event.date} · {confirmation.event.location}</p>
          </div>

          <div className="space-y-6 p-6">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Participant</p>
                <p className="font-semibold">{confirmation.participant.name}</p>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Registration reference</p>
                <p className="font-mono font-semibold">{confirmation.registrationReference}</p>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Status</p>
                <p className="font-semibold">{details.label}</p>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Check-in</p>
                <p className="font-semibold">{confirmation.checkInStatus === "checked_in" ? `Checked in${confirmation.checkedInAt ? ` · ${new Date(confirmation.checkedInAt).toLocaleString("en-IN")}` : ""}` : "Not checked in"}</p>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Amount</p>
                <p className="text-lg font-bold text-primary">₹{(confirmation.amountPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
              </div>
            </div>

            {!isConfirmed && confirmation.paymentSettings && <div className="border-t border-dashed pt-4">
              <p className="mb-1 text-sm font-semibold">Manual UPI payment</p>
              <p className="text-sm text-muted-foreground">Pay {confirmation.paymentSettings.payeeName} at <span className="font-medium text-foreground">{confirmation.paymentSettings.upiId}</span>.</p>
              <p className="mt-2 text-xs text-muted-foreground">{confirmation.paymentSettings.instructions}</p>
            </div>}

            {isConfirmed && confirmation.ticket && <div className="border-t border-dashed pt-5 text-center">
              <p className="mb-3 flex items-center justify-center gap-2 text-sm font-semibold"><QrCode className="h-4 w-4 text-accent" /> Event ticket QR</p>
              <img src={confirmation.ticket.qrDataUrl} alt="RacePass event ticket QR" className="mx-auto h-56 w-56 rounded-lg bg-white p-2" />
              <p className="mt-3 text-xs text-muted-foreground">This QR contains only an opaque ticket credential. Do not share it publicly.</p>
            </div>}

            {isConfirmed && !confirmation.ticket && <div className="border-t border-dashed pt-4 text-sm text-destructive">Your registration is confirmed, but the ticket QR is temporarily unavailable. Please refresh or contact support.</div>}
          </div>
        </div>

        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button size="lg" variant="outline" className="gap-2" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <Button size="lg" variant="secondary" className="gap-2" onClick={() => navigate("/dashboard")}>
            <LayoutDashboard className="h-4 w-4" /> View dashboard
          </Button>
        </div>
      </div>
    </Layout>
  );
};

export default Confirmation;
