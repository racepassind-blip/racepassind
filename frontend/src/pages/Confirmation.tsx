import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Clock3, Copy, FileDown, KeyRound, LayoutDashboard, MessageCircle, QrCode, XCircle } from "lucide-react";

import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { apiRequest, ApiError, API_BASE, resolveCsrfToken, trackApiRequest } from "@/lib/api";

const CONFIRMATION_TOKEN_KEY = "sportpass_confirmation_token";

interface ConfirmationRegistration {
  confirmationToken?: string;
  claimCode?: string | null;
  registrationReference: string;
  amountPaise: number;
  status: string;
  checkInStatus?: "checked_in" | "not_checked_in";
  checkedInAt?: string | null;
  paymentStatus: string;
  participant: { name: string; email?: string | null; phone?: string | null };
  participants?: Array<{ index: number; participant: { name: string; email?: string | null; phone?: string | null } }>;
  participantCount?: number;
  ticket: {
    version: number;
    format: string;
    qrDataUrl: string;
    name?: string | null;
    category?: string | null;
    quantity?: number;
  } | null;
}

interface ConfirmationState extends ConfirmationRegistration {
  event: {
    name: string;
    date: string;
    location: string;
    whatsappGroupUrl?: string | null;
    address?: string | null;
    description?: string | null;
    organizer?: string;
  };
  paymentSettings: {
    upiId: string;
    payeeName: string;
    instructions: string;
    qrDataUrl?: string;
    upiUri?: string;
  } | null;
  registrations?: ConfirmationRegistration[];
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
    description: "Your registration is confirmed. Keep this ticket QR ready for event check-in.",
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
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [claimCopied, setClaimCopied] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    sessionStorage.setItem(CONFIRMATION_TOKEN_KEY, token);
    const controller = new AbortController();
    const loadConfirmation = async () => {
      try {
        const result = await apiRequest<Omit<ConfirmationState, "confirmationToken">>("/registrations/confirmation", {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({ confirmation_token: token }),
        });
        setConfirmation((current) => ({
          ...result,
          confirmationToken: token,
          claimCode: result.claimCode ?? current?.claimCode,
          registrations: result.registrations?.map((child, index) => ({
            ...child,
            confirmationToken: child.confirmationToken ?? current?.registrations?.[index]?.confirmationToken,
            claimCode: child.claimCode ?? current?.registrations?.[index]?.claimCode,
          })) ?? current?.registrations,
        }));
        setError(null);
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 404) sessionStorage.removeItem(CONFIRMATION_TOKEN_KEY);
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
  const isBatch = (confirmation.registrations?.length ?? 0) > 1;
  const allEntriesConfirmed = isBatch && confirmation.registrations?.every((entry) => entry.status === "confirmed" || entry.status === "checked_in") === true;
  const StatusIcon = confirmation.status === "rejected" || confirmation.status === "expired" ? XCircle : isConfirmed ? CheckCircle2 : Clock3;

  const downloadTicketPdf = async (ticketToken: string | undefined, filename: string) => {
    if (!ticketToken) return;
    setDownloadingPdf(true);
    setPdfError(null);
    try {
      const csrf = await resolveCsrfToken();
      const response = await trackApiRequest(() => fetch(`${API_BASE}/registrations/confirmation/ticket.pdf`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        },
        body: JSON.stringify({ confirmation_token: ticketToken }),
      }));
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { detail?: string } | null;
        throw new Error(body?.detail ?? "Could not download the ticket PDF");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (downloadError) {
      setPdfError(downloadError instanceof Error ? downloadError.message : "Could not download the ticket PDF");
    } finally {
      setDownloadingPdf(false);
    }
  };

  const copyClaimCode = async () => {
    if (!confirmation.claimCode) return;
    try {
      await navigator.clipboard.writeText(confirmation.claimCode);
      setClaimCopied(true);
      window.setTimeout(() => setClaimCopied(false), 1800);
    } catch {
      // The code remains visible so it can be copied manually if clipboard access is unavailable.
    }
  };

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

          {isBatch && confirmation.registrations && <div className="border-b bg-muted/30 px-6 py-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><p className="font-semibold">Entries in this order ({confirmation.registrations.length})</p><p className="mt-1 text-sm text-muted-foreground">Each entry has one registration, payment amount, check-in record, and ticket QR.</p></div><div className="text-left sm:text-right"><p className="text-xs uppercase tracking-wide text-muted-foreground">Total amount</p><p className="text-xl font-bold text-primary">₹{(confirmation.amountPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p></div></div><div className="mt-4 space-y-3">{confirmation.registrations.map((entry, index) => { const entryConfirmed = entry.status === "confirmed" || entry.status === "checked_in"; const entryStatus = statusDetails[entry.status]?.label ?? entry.status.replace("_", " "); const entryCheckIn = entry.checkInStatus === "checked_in" ? `Checked in${entry.checkedInAt ? ` · ${new Date(entry.checkedInAt).toLocaleString("en-IN")}` : ""}` : "Not checked in"; const memberNames = entry.participants?.map((member) => member.participant.name).join(" · ") || entry.participant.name; return <div key={entry.registrationReference} className="rounded-xl border bg-card p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">Entry {index + 1}: {memberNames}</p><p className="mt-1 text-xs text-muted-foreground">{entry.ticket?.name ?? "Ticket"}{entry.ticket?.category ? ` · ${entry.ticket.category}` : ""}</p></div><span className={`text-xs font-semibold ${entryConfirmed ? "text-accent" : "text-muted-foreground"}`}>{entryStatus}</span></div><div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 text-xs sm:grid-cols-5"><div><p className="uppercase tracking-wide text-muted-foreground">Members</p><p className="mt-1 font-medium">{memberNames}</p></div><div><p className="uppercase tracking-wide text-muted-foreground">Registration reference</p><p className="mt-1 break-all font-mono font-medium">{entry.registrationReference}</p></div><div><p className="uppercase tracking-wide text-muted-foreground">Status</p><p className="mt-1 font-medium">{entryStatus}</p></div><div><p className="uppercase tracking-wide text-muted-foreground">Check-in</p><p className="mt-1 font-medium">{entryCheckIn}</p></div><div><p className="uppercase tracking-wide text-muted-foreground">Amount</p><p className="mt-1 font-semibold text-primary">₹{(entry.amountPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p></div></div></div>; })}</div></div>}

          {isBatch && confirmation.registrations?.some((entry) => entry.claimCode) && <div className="border-b bg-amber-50 px-6 py-5 dark:bg-amber-950/20"><div className="flex items-start gap-3"><KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" /><div><p className="font-semibold text-amber-950 dark:text-amber-100">Guest claim codes</p><p className="mt-1 text-sm text-amber-900/80 dark:text-amber-100/80">Use each code with its registration reference in your participant dashboard to link the guest entries.</p><div className="mt-3 space-y-2">{confirmation.registrations.filter((entry) => entry.claimCode).map((entry) => <div key={entry.registrationReference} className="flex flex-wrap items-center gap-2 text-sm"><code className="rounded bg-white px-2 py-1 font-mono font-bold dark:bg-slate-900">{entry.registrationReference}</code><span className="text-muted-foreground">·</span><code className="rounded bg-white px-2 py-1 font-mono font-bold tracking-wider dark:bg-slate-900">{entry.claimCode}</code></div>)}</div></div></div></div>}

          {isBatch && <div className="border-b bg-primary/5 px-6 py-5"><p className="font-semibold">Download your entry tickets</p><p className="mt-1 text-sm text-muted-foreground">Each entry has one QR code. Download all {confirmation.registrations?.length ?? 0} entry tickets together in one PDF.</p>{allEntriesConfirmed ? <Button type="button" size="sm" className="mt-4 gap-2" onClick={() => void downloadTicketPdf(token, "sportpass-tickets.pdf")} disabled={downloadingPdf}><FileDown className="h-4 w-4" /> {downloadingPdf ? "Preparing tickets…" : "Download all tickets PDF"}</Button> : <p className="mt-3 text-xs text-muted-foreground">The combined PDF will be available after every entry is confirmed.</p>}{confirmation.event.whatsappGroupUrl && <Button asChild type="button" size="sm" variant="outline" className="ml-2 mt-4 gap-2"><a href={confirmation.event.whatsappGroupUrl} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" /> Join WhatsApp group</a></Button>}{pdfError && <p className="mt-3 text-sm text-destructive">{pdfError}</p>}</div>}

          <div className="space-y-6 p-6">
            {!isBatch && <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Participant</p>
                <p className="font-semibold">{confirmation.participant.name}</p>
                {confirmation.participants && confirmation.participants.length > 1 && <p className="mt-1 text-sm text-muted-foreground">Members: {confirmation.participants.map((member) => member.participant.name).join(" · ")}</p>}
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
            </div>}

            {!isBatch && confirmation.claimCode ? <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/20"><KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" /><div className="min-w-0 flex-1"><p className="font-semibold text-amber-950 dark:text-amber-100">Save your guest claim code</p><p className="mt-1 text-sm text-amber-900/80 dark:text-amber-100/80">Use this code with your registration reference in your participant dashboard to link this guest registration to your account.</p><div className="mt-3 flex flex-wrap items-center gap-2"><code className="rounded-md bg-white px-3 py-2 font-mono text-sm font-bold tracking-wider text-foreground shadow-sm dark:bg-slate-900">{confirmation.claimCode}</code><Button type="button" size="sm" variant="outline" className="gap-2" onClick={() => void copyClaimCode()}><Copy className="h-3.5 w-3.5" /> {claimCopied ? "Copied" : "Copy code"}</Button></div><p className="mt-2 text-xs text-amber-900/70 dark:text-amber-100/70">The code expires after 7 days and can be used once.</p></div></div> : !isBatch && <div className="flex items-start gap-3 rounded-xl border border-accent/30 bg-accent/5 p-4"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" /><div><p className="font-semibold">Saved to your participant account</p><p className="mt-1 text-sm text-muted-foreground">You can access this registration, ticket, and results from your dashboard. No claim code is needed.</p></div></div>}

            {!isConfirmed && confirmation.paymentSettings && <div className="border-t border-dashed pt-4">
              <p className="mb-1 text-sm font-semibold">Manual UPI payment</p>
              <p className="text-sm text-muted-foreground">Pay {confirmation.paymentSettings.payeeName} at <span className="font-medium text-foreground">{confirmation.paymentSettings.upiId}</span>.</p>
              <p className="mt-2 text-xs text-muted-foreground">{confirmation.paymentSettings.instructions}</p>
            </div>}

            {!isBatch && isConfirmed && confirmation.ticket && <div className="border-t border-dashed pt-5 text-center">
              <p className="mb-3 flex items-center justify-center gap-2 text-sm font-semibold"><QrCode className="h-4 w-4 text-accent" /> Event ticket QR</p>
              <img src={confirmation.ticket.qrDataUrl} alt="SportPass event ticket QR" className="mx-auto h-56 w-56 rounded-lg bg-white p-2" />
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button type="button" size="sm" className="gap-2" onClick={() => void downloadTicketPdf(token, `sportpass-ticket-${confirmation.registrationReference}.pdf`)} disabled={downloadingPdf}>
                  <FileDown className="h-4 w-4" /> {downloadingPdf ? "Preparing PDF…" : "Download ticket PDF"}
                </Button>
                {confirmation.event.whatsappGroupUrl && <Button asChild type="button" size="sm" variant="outline" className="gap-2"><a href={confirmation.event.whatsappGroupUrl} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" /> Join WhatsApp group</a></Button>}
              </div>
              {pdfError && <p className="mt-3 text-sm text-destructive">{pdfError}</p>}
              <p className="mt-3 text-xs text-muted-foreground">The PDF includes your event, registration, organizer details, and this QR. The QR contains only an opaque ticket credential.</p>
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
