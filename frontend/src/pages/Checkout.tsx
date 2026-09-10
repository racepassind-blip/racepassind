import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, CheckCircle2, Copy, Shield, Ticket, User } from "lucide-react";
import { toast } from "sonner";

import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useEvent } from "@/hooks/useEvents";

const STEPS = ["Ticket", "Participant", "UPI Payment"];
const API_ORIGIN = (import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const API_BASE = `${API_ORIGIN}/api/v1`;
const CONFIRMATION_TOKEN_KEY = "racepass_confirmation_token";

type RegistrationResponse = {
  registrationReference: string;
  confirmationToken: string;
  claimCode: string;
  amountPaise: number;
  status: string;
  paymentStatus: string;
  event: { name: string; date: string; location: string };
  paymentSettings: {
    method: string;
    upiId: string;
    payeeName: string;
    instructions: string;
    qrImageUrl: string | null;
    upiUri: string;
    qrDataUrl: string;
    currency: string;
    amountPaise: number;
  } | null;
};

function csrfToken(): string | undefined {
  return document.cookie.split("; ").find((cookie) => cookie.startsWith("racepass_csrf="))?.split("=")[1];
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  const csrf = csrfToken();
  if (csrf && init.method && init.method !== "GET") headers.set("X-CSRF-Token", decodeURIComponent(csrf));
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(body?.detail ?? `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

const Checkout = () => {
  const { eventId, tierId } = useParams();
  const navigate = useNavigate();
  const { data: event, isLoading, isError } = useEvent(eventId);
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [registration, setRegistration] = useState<RegistrationResponse | null>(null);
  const [utrReference, setUtrReference] = useState("");
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    dateOfBirth: "",
    gender: "",
    jerseySize: "",
    emergencyContact: "",
    teamName: "",
  });

  const selectedTier = useMemo(() => event?.tiers.find((tier) => tier.id === tierId), [event, tierId]);
  const updateForm = (key: keyof typeof form, value: string) => setForm((previous) => ({ ...previous, [key]: value }));
  const participantReady = Boolean(form.fullName.trim() && (form.email.trim() || form.phone.trim()));

  if (isLoading) return <Layout><div className="py-20 text-center text-muted-foreground">Loading event…</div></Layout>;
  if (isError || !event || !selectedTier) return <Layout><div className="py-20 text-center text-muted-foreground">Event or ticket not found.</div></Layout>;

  const createRegistration = async () => {
    if (!participantReady || !eventId || !selectedTier) {
      toast.error("Enter your name and at least an email or phone number.");
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest<RegistrationResponse>("/registrations", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          event_id: eventId,
          ticket_id: selectedTier.id,
          full_name: form.fullName,
          email: form.email || null,
          phone: form.phone || null,
          date_of_birth: form.dateOfBirth || null,
          gender: form.gender || null,
          jersey_size: form.jerseySize || null,
          emergency_contact: form.emergencyContact || null,
          team_name: form.teamName || null,
        }),
      });
      setRegistration(result);
      if (result.confirmationToken) sessionStorage.setItem(CONFIRMATION_TOKEN_KEY, result.confirmationToken);
      setCurrentStep(2);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const submitUtr = async () => {
    if (!registration) return;
    setLoading(true);
    try {
      const result = await apiRequest<RegistrationResponse>("/registrations/payment-reference", {
        method: "POST",
        body: JSON.stringify({ confirmation_token: registration.confirmationToken, utr_reference: utrReference || null }),
      });
      toast.success(
        utrReference.trim()
          ? "Reference submitted. The organizer will verify your payment manually."
          : "Registration saved. Pay by UPI and submit your reference when ready.",
      );
      navigate("/confirmation", {
        state: { ...result, confirmationToken: registration.confirmationToken, claimCode: registration.claimCode },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit payment reference");
    } finally {
      setLoading(false);
    }
  };

  const totalRupees = registration ? registration.amountPaise / 100 : selectedTier.price;
  const copyUpi = async () => {
    if (registration?.paymentSettings?.upiId) {
      await navigator.clipboard.writeText(registration.paymentSettings.upiId);
      toast.success("UPI ID copied");
    }
  };

  return (
    <Layout>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <button onClick={() => (currentStep > 0 && !registration ? setCurrentStep(currentStep - 1) : navigate(-1))} className="mb-6 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> {currentStep > 0 && !registration ? "Previous step" : "Back to event"}
        </button>
        <h1 className="mb-2 text-2xl font-extrabold tracking-tight">Complete Your Registration</h1>
        <p className="mb-6 text-muted-foreground">{event.title} · {event.date}</p>

        <div className="mb-8 flex items-center justify-center gap-2">
          {STEPS.map((label, index) => <div key={label} className="flex items-center gap-2"><div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${index <= currentStep ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>{index < currentStep ? <CheckCircle2 className="h-4 w-4" /> : index + 1}</div><span className={`hidden text-sm sm:inline ${index === currentStep ? "font-medium text-foreground" : "text-muted-foreground"}`}>{label}</span>{index < STEPS.length - 1 && <div className="h-px w-8 bg-border sm:w-12" />}</div>)}
        </div>

        <div className="grid gap-8 md:grid-cols-5">
          <div className="space-y-6 md:col-span-3">
            {currentStep === 0 && <section className="space-y-4"><h2 className="flex items-center gap-2 text-lg font-bold"><Ticket className="h-5 w-5 text-primary" /> Select Your Ticket</h2><div className="rounded-xl border-2 border-primary bg-primary/5 p-4"><div className="flex items-center justify-between"><div><p className="font-semibold">{selectedTier.name}</p><p className="text-sm text-muted-foreground">{selectedTier.description}</p></div><p className="text-lg font-bold text-primary">₹{selectedTier.price.toLocaleString("en-IN")}</p></div><p className="mt-2 text-xs text-muted-foreground">One participant and one ticket per registration.</p></div><Button onClick={() => setCurrentStep(1)} size="lg" className="w-full">Continue <ArrowRight className="ml-2 h-4 w-4" /></Button></section>}

            {currentStep === 1 && <section className="space-y-6"><h2 className="flex items-center gap-2 text-lg font-bold"><User className="h-5 w-5 text-primary" /> Participant Information</h2><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2 sm:col-span-2"><Label>Full name *</Label><Input value={form.fullName} onChange={(e) => updateForm("fullName", e.target.value)} placeholder="Your full name" /></div><div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => updateForm("email", e.target.value)} placeholder="you@example.com" /></div><div className="space-y-2"><Label>Phone</Label><Input value={form.phone} onChange={(e) => updateForm("phone", e.target.value)} placeholder="+91 98765 43210" /></div><p className="text-xs text-muted-foreground sm:col-span-2">At least one of email or phone is required.</p><div className="space-y-2"><Label>Date of birth</Label><Input type="date" value={form.dateOfBirth} onChange={(e) => updateForm("dateOfBirth", e.target.value)} /></div><div className="space-y-2"><Label>Gender</Label><Select value={form.gender} onValueChange={(value) => updateForm("gender", value)}><SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger><SelectContent><SelectItem value="male">Male</SelectItem><SelectItem value="female">Female</SelectItem><SelectItem value="non-binary">Non-binary</SelectItem><SelectItem value="prefer-not">Prefer not to say</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Jersey size</Label><Select value={form.jerseySize} onValueChange={(value) => updateForm("jerseySize", value)}><SelectTrigger><SelectValue placeholder="Select size" /></SelectTrigger><SelectContent>{["xs", "s", "m", "l", "xl", "xxl"].map((size) => <SelectItem key={size} value={size}>{size.toUpperCase()}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Emergency contact</Label><Input value={form.emergencyContact} onChange={(e) => updateForm("emergencyContact", e.target.value)} placeholder="Name and phone" /></div><div className="space-y-2 sm:col-span-2"><Label>Team name</Label><Input value={form.teamName} onChange={(e) => updateForm("teamName", e.target.value)} placeholder="Optional" /></div></div><Button onClick={createRegistration} disabled={!participantReady || loading} size="lg" className="w-full">{loading ? "Creating registration…" : "Continue to UPI payment"} <ArrowRight className="ml-2 h-4 w-4" /></Button></section>}

            {currentStep === 2 && registration && <section className="space-y-5"><h2 className="flex items-center gap-2 text-lg font-bold"><Ticket className="h-5 w-5 text-primary" /> Pay the organizer by UPI</h2><div className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">Registration reference</p><p className="text-xl font-bold tracking-wide">{registration.registrationReference}</p><p className="mt-4 text-sm text-muted-foreground">Amount to pay</p><p className="text-2xl font-extrabold text-primary">₹{totalRupees.toLocaleString("en-IN")}</p></div>{registration.paymentSettings && <div className="space-y-4 rounded-xl border bg-primary/5 p-5"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">UPI ID</p><p className="font-bold">{registration.paymentSettings.upiId}</p><p className="text-xs text-muted-foreground">Payee: {registration.paymentSettings.payeeName}</p></div><Button variant="outline" size="sm" onClick={copyUpi}><Copy className="mr-2 h-4 w-4" /> Copy</Button></div><p className="text-sm text-muted-foreground">{registration.paymentSettings.instructions}</p><div className="flex flex-col items-center gap-3 rounded-lg bg-white p-3"><img src={registration.paymentSettings.qrDataUrl} alt="Generated UPI payment QR" className="h-56 w-56" /><p className="text-xs text-muted-foreground">Scan to pay ₹{totalRupees.toLocaleString("en-IN")}</p></div>{registration.paymentSettings.qrImageUrl && <div><p className="mb-2 text-xs font-medium text-muted-foreground">Organizer-provided QR</p><img src={registration.paymentSettings.qrImageUrl} alt="Organizer UPI QR" className="mx-auto max-h-56 rounded-lg" /></div>}<a href={registration.paymentSettings.upiUri} className="block text-center text-sm font-semibold text-primary underline-offset-4 hover:underline">Open in a UPI app</a></div>}<div className="space-y-2"><Label>UTR / transaction reference (optional)</Label><Input value={utrReference} onChange={(e) => setUtrReference(e.target.value)} placeholder="Enter it after paying in your UPI app" /><p className="text-xs text-muted-foreground">The organizer will verify your payment manually. A UTR helps them find it faster.</p></div><Button onClick={submitUtr} disabled={loading} size="lg" className="w-full">{loading ? "Saving…" : "Submit reference / continue"}</Button><p className="flex items-center justify-center gap-1 text-xs text-muted-foreground"><Shield className="h-3 w-3" /> Do not enter card details on RacePass.</p></section>}
          </div>

          <aside className="md:col-span-2"><div className="sticky top-24 space-y-4 rounded-xl border bg-card p-5"><h2 className="font-bold">Order Summary</h2><img src={event.image} alt={event.title} className="aspect-video w-full rounded-lg object-cover" /><div><p className="font-semibold">{event.title}</p><p className="text-sm text-muted-foreground">{event.location}</p></div><div className="border-t pt-3 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Ticket</span><span>{selectedTier.name}</span></div><div className="mt-2 flex justify-between font-bold"><span>Total</span><span className="text-primary">₹{totalRupees.toLocaleString("en-IN")}</span></div></div></div></aside>
        </div>
      </div>
    </Layout>
  );
};

export default Checkout;
