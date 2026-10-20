import { FormEvent, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Building2, CheckCircle2, Eye, EyeOff, KeyRound, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/api";

const RequiredMark = () => <span aria-hidden="true" className="text-destructive">*</span>;
const ORGANIZER_ID_PROOF_MAX_BYTES = 2_000_000;
const ORGANIZER_ID_PROOF_MAX_MB = ORGANIZER_ID_PROOF_MAX_BYTES / 1_000_000;
import { isValidIndianMobile } from "@/lib/phone";

type SignupMode = "participant" | "organizer";
interface ApplicationStatus {
  id: string;
  status: "pending" | "changes_requested" | "approved" | "rejected";
  organizationName: string;
  applicantName: string;
  phone: string | null;
  organizationType: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  eventHistory: string | null;
  discoverySource: string | null;
  paymentPreference: string | null;
  idProofType: string | null;
  rejectionReason: string | null;
  createdAt: string;
  paymentDetails: {upiId?: string; payeeName?: string; legalName?: string; panNumber?: string};
}

const Signup = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const { login } = useAuth();
  const returnTo = (location.state as { from?: string } | null)?.from;
  const [mode, setMode] = useState<SignupMode>(searchParams.get("type") === "organizer" ? "organizer" : "participant");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(searchParams.has("status"));
  const [application, setApplication] = useState<ApplicationStatus | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    organizationName: "",
    organizationType: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    eventHistory: "",
    discoverySource: "",
    paymentPreference: "",
    idProofType: "",
    idProof: null as File | null,
    upiId: "", payeeName: "", legalName: "", panNumber: "",
    privacyPolicyAccepted: false,
  });

  const updateForm = <K extends keyof typeof form>(field: K, value: typeof form[K]) => {
    setSubmitted(false);
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (checkingStatus && mode === "organizer") {
      setApplication(null);
      setLoading(true);
      try {
        setApplication(await apiRequest<ApplicationStatus>("/auth/organizer-application/status", { method: "POST", body: JSON.stringify({email: form.email, password: form.password}) }));
      } catch (error) { toast.error(error instanceof Error ? error.message : "Could not check application"); }
      finally { setLoading(false); }
      return;
    }
    if (mode === "organizer" && !isValidIndianMobile(form.phone)) {
      toast.error("A valid phone number is required to onboard as an organizer.");
      return;
    }
    if (mode === "organizer" && (!form.idProof || !form.idProofType)) {
      toast.error("Please select an ID proof type and upload the document.");
      return;
    }
    if (mode === "organizer" && form.idProof && form.idProof.size > ORGANIZER_ID_PROOF_MAX_BYTES) {
      toast.error(`ID proof must be ${ORGANIZER_ID_PROOF_MAX_MB} MB or smaller.`);
      return;
    }
    if (!form.privacyPolicyAccepted) {
      toast.error("Please accept the Privacy Policy to create an account.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "participant") {
        await apiRequest("/auth/register", {
          method: "POST",
          body: JSON.stringify({
            name: form.name,
            email: form.email,
            phone: form.phone || null,
            password: form.password,
            privacy_policy_accepted: true,
          }),
        });
        await login(form.email.trim(), form.password);
        toast.success("Your participant account is ready.");
        navigate(returnTo ?? "/dashboard", { replace: true });
      } else {
        const body = new FormData();
        body.append("organization_name", form.organizationName);
        body.append("name", form.name);
        body.append("email", form.email);
        body.append("phone", form.phone);
        body.append("password", form.password);
        body.append("privacy_policy_accepted", "true");
        body.append("organization_type", form.organizationType);
        body.append("address", form.address);
        body.append("city", form.city);
        body.append("state", form.state);
        body.append("pincode", form.pincode);
        body.append("event_history", form.eventHistory);
        body.append("discovery_source", form.discoverySource);
        body.append("payment_preference", form.paymentPreference);
        body.append("id_proof_type", form.idProofType);
        body.append("id_proof", form.idProof as File);
        body.append("upi_id", form.upiId);
        body.append("payee_name", form.payeeName);
        body.append("legal_name", form.legalName);
        body.append("pan_number", form.panNumber);
        await apiRequest("/auth/organizer-signup", {
          method: "POST",
          body,
        });
        setSubmitted(true);
        toast.success("Your organizer application is awaiting approval.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not complete signup.");
    } finally {
      setLoading(false);
    }
  };

  const isParticipant = mode === "participant";
  const contactFields = (
    <>
      <p className="text-xs text-muted-foreground"><span className="font-semibold text-destructive">*</span> Required fields</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="signup-name">Your name <RequiredMark /></Label><Input id="signup-name" value={form.name} onChange={(event) => updateForm("name", event.target.value)} required minLength={2} maxLength={120} autoComplete="name" placeholder="Your full name" /></div>
        <div className="space-y-2"><Label htmlFor="signup-phone">Phone {isParticipant ? <span className="font-normal text-muted-foreground">(optional)</span> : <RequiredMark />}</Label><Input id="signup-phone" type="tel" inputMode="tel" value={form.phone} onChange={(event) => updateForm("phone", event.target.value)} required={!isParticipant} maxLength={20} autoComplete="tel" placeholder="+91 98765 43210" /></div>
      </div>
      <div className="space-y-2"><Label htmlFor="signup-email">Email address <RequiredMark /></Label><Input id="signup-email" type="email" value={form.email} onChange={(event) => updateForm("email", event.target.value)} required maxLength={320} autoComplete="email" placeholder="you@example.com" /></div>
      <div className="space-y-2"><Label htmlFor="signup-password">Password <RequiredMark /></Label><div className="relative"><Input id="signup-password" type={showPassword ? "text" : "password"} value={form.password} onChange={(event) => updateForm("password", event.target.value)} required minLength={8} maxLength={256} autoComplete="new-password" placeholder="At least 8 characters" className="pr-10" /><button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div><p className="text-xs text-muted-foreground">At least 8 characters.</p></div>
    </>
  );
  const sectionHeading = (number: string, title: string, description: string) => (
    <div className="flex items-start gap-3 border-b pb-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{number}</span>
      <div><h3 className="font-bold text-foreground">{title}</h3><p className="mt-0.5 text-sm leading-5 text-muted-foreground">{description}</p></div>
    </div>
  );

  return (
    <Layout>
      <div className="relative min-h-[calc(100vh-10rem)] overflow-hidden bg-muted/30">
        <div className="pointer-events-none absolute -left-32 top-16 h-72 w-72 rounded-full bg-primary/15 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-accent/10 blur-3xl" />

        <div className="relative mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-12 lg:px-8">
          <div className="mb-4 flex items-center justify-between gap-4 sm:mb-8">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">SportPass account</p>
              <h1 className="mt-1 text-2xl font-black tracking-tight sm:mt-2 sm:text-4xl">{isParticipant ? "Join the race day community." : "Bring your events to SportPass."}</h1>
              <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground sm:mt-2 sm:leading-6">{isParticipant ? "Create an account to keep your registrations and results together." : "Tell us about your organization. We’ll review your application before enabling event tools."}</p>
            </div>
          </div>

          <div className="grid overflow-hidden rounded-3xl border bg-card shadow-xl lg:grid-cols-[0.85fr_1.15fr]">
            <aside className="relative hidden overflow-hidden bg-slate-950 px-6 py-8 text-white lg:block lg:p-12">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-orange-500 via-white to-green-500" />
              <div className="absolute -bottom-20 -right-20 h-64 w-64 rounded-full bg-primary/20 blur-3xl" />
              <div className="relative flex h-full flex-col">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
                  {isParticipant ? <UserPlus className="h-6 w-6 text-orange-300" /> : <Building2 className="h-6 w-6 text-orange-300" />}
                </div>
                <p className="mt-8 text-xs font-bold uppercase tracking-[0.2em] text-orange-200">{isParticipant ? "Participant access" : "Organizer access"}</p>
                <h2 className="mt-3 max-w-sm text-3xl font-black tracking-tight sm:text-4xl">{isParticipant ? "Every race. One simple account." : "Build better events with SportPass."}</h2>
                <p className="mt-4 max-w-sm text-sm leading-6 text-slate-300">{isParticipant ? "Register faster next time and keep your race-day information ready whenever you need it." : "Apply to create events, manage participants, and run race-day operations from one workspace."}</p>

                <ul className="mt-9 space-y-4 text-sm text-slate-200">
                  {(isParticipant
                    ? ["Access registrations and tickets in one place", "Claim guest registrations when you need to", "Keep your race results and event history together"]
                    : ["Create and publish events", "Manage registrations, payments, and check-in", "Use tournament and race-day tools as you grow"]
                  ).map((benefit) => <li key={benefit} className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-400" /><span>{benefit}</span></li>)}
                </ul>

                <div className="mt-auto hidden items-center gap-3 border-t border-white/10 pt-8 text-xs text-slate-400 sm:flex"><ShieldCheck className="h-4 w-4 text-green-400" /> Your account is protected with secure sessions.</div>
              </div>
            </aside>

            <section className="bg-background px-4 py-5 sm:p-10 lg:p-12">
              <div className="mb-5 flex items-start justify-between gap-4 sm:mb-7">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Get started</p>
                  <h2 className="mt-2 text-2xl font-black tracking-tight">{isParticipant ? "Create your participant account" : "Apply as an organizer"}</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{isParticipant ? "It takes less than a minute. You can also register as a guest later." : "Your details stay private while we review your application. Paid events require payment verification before publishing."}</p>
                </div>
                <KeyRound className="mt-1 hidden h-5 w-5 text-primary sm:block" />
              </div>

              <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl bg-muted/60 p-1 sm:mb-7">
                <button type="button" aria-pressed={isParticipant} onClick={() => { setMode("participant"); setSubmitted(false); }} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all ${isParticipant ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}><UserPlus className="h-4 w-4" /> Participant</button>
                <button type="button" aria-pressed={!isParticipant} onClick={() => { setMode("organizer"); setSubmitted(false); }} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all ${!isParticipant ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}><Building2 className="h-4 w-4" /> Organizer</button>
              </div>

              {!isParticipant && <Button variant="outline" className="mb-6 h-11 w-full justify-between rounded-xl px-4" onClick={() => {setCheckingStatus(!checkingStatus); setApplication(null); setSubmitted(false);}}><span>{checkingStatus ? "Start a new application" : "Already applied? Check status"}</span><ArrowRight className="h-4 w-4" /></Button>}
              {checkingStatus && !isParticipant ? <div className="space-y-5">
                <div className="rounded-2xl border bg-muted/30 p-4 sm:p-5"><div className="mb-4"><h3 className="text-xl font-bold">Check your application</h3><p className="mt-1 text-sm leading-5 text-muted-foreground">Use the email and password you submitted. We’ll show the next step here.</p></div><form onSubmit={submit} className="space-y-4"><div className="space-y-2"><Label htmlFor="status-email">Email</Label><Input id="status-email" type="email" required autoComplete="username" value={form.email} onChange={e => updateForm("email", e.target.value)} /></div><div className="space-y-2"><Label htmlFor="status-password">Application password</Label><Input id="status-password" type="password" required autoComplete="current-password" value={form.password} onChange={e => updateForm("password", e.target.value)} /></div><div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between"><Button disabled={loading} className="w-full sm:w-auto">{loading ? "Checking…" : "Check status"}</Button><Link to="/forgot-password" className="text-center text-sm font-medium text-primary underline underline-offset-4 sm:text-right">Forgot password?</Link></div></form></div>
                {application && <Card className="min-w-0 overflow-hidden border shadow-sm"><CardHeader className="border-b bg-muted/20 pb-5"><div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><CardTitle className="break-words text-2xl">{application.organizationName}</CardTitle><CardDescription className="mt-1">Submitted {new Date(application.createdAt).toLocaleDateString("en-IN")}</CardDescription></div><span className={`rounded-full border px-3 py-1 text-xs font-bold capitalize ${application.status === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : application.status === "rejected" ? "border-rose-200 bg-rose-50 text-rose-700" : application.status === "changes_requested" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-blue-200 bg-blue-50 text-blue-700"}`}>{application.status.replaceAll("_", " ")}</span></div></CardHeader><CardContent className="min-w-0 space-y-5 pt-5">
                  {application.rejectionReason && <p className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm">{application.rejectionReason}</p>}
                  <dl className="grid min-w-0 gap-4 rounded-xl border bg-background p-4 text-sm sm:grid-cols-2"><div className="min-w-0"><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contact</dt><dd className="mt-1 break-words font-medium">{application.applicantName} · {application.phone}</dd></div><div className="min-w-0"><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment route</dt><dd className="mt-1 break-words font-medium capitalize">{application.paymentPreference?.replaceAll("_", " ")}</dd></div><div className="min-w-0 sm:col-span-2"><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Address</dt><dd className="mt-1 break-words">{[application.address, application.city, application.state, application.pincode].filter(Boolean).join(", ")}</dd></div><div className="min-w-0 sm:col-span-2"><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Event background</dt><dd className="mt-1 break-words whitespace-pre-wrap">{application.eventHistory}</dd></div></dl>
                  {application.status === "pending" && <p>Your application is awaiting review. Check back here for feedback.</p>}
                  {application.status === "changes_requested" && <Button onClick={() => {setForm(current => ({...current, organizationName: application.organizationName, name: application.applicantName, phone: application.phone || "", organizationType: application.organizationType || "", address: application.address || "", city: application.city || "", state: application.state || "", pincode: application.pincode || "", eventHistory: application.eventHistory || "", discoverySource: application.discoverySource || "", paymentPreference: application.paymentPreference || "", idProofType: application.idProofType || "", upiId: application.paymentDetails.upiId || "", payeeName: application.paymentDetails.payeeName || "", legalName: application.paymentDetails.legalName || "", panNumber: application.paymentDetails.panNumber || "", idProof: null})); setCheckingStatus(false);}}>Edit and resubmit</Button>}
                  {application.status === "approved" && <><p className="leading-6">Your organizer access is approved. Sign in to finish payment verification and create your event.</p><Button className="w-full sm:w-auto" onClick={() => navigate("/login")}>Sign in to your workspace <ArrowRight className="ml-1 h-4 w-4" /></Button></>}
                  {application.status === "rejected" && <p className="text-sm">Your application was declined. Contact SportPass support for clarification.</p>}
                </CardContent></Card>}
              </div> : submitted ? (
                <Card className="border-primary/20 bg-primary/5 shadow-none">
                  <CardHeader>
                    <CardTitle className="text-xl">Application received</CardTitle>
                    <CardDescription>Your application is waiting for admin approval.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <p className="text-sm leading-6 text-muted-foreground">An admin will review your application. You can sign in and create events after approval.</p>
                    <div className="flex flex-wrap gap-3"><Button onClick={() => {setCheckingStatus(true); setSubmitted(false);}}>Track application <ArrowRight className="h-4 w-4" /></Button><Button variant="outline" onClick={() => navigate("/")}>Browse events</Button></div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-0 bg-transparent shadow-none">
                  <CardContent className="p-0">
              <form onSubmit={submit} className="space-y-6">
                      {!isParticipant && <section className="space-y-4">{sectionHeading("01", "Your contact details", "The person we’ll contact about this application.")}{contactFields}</section>}
                      {mode === "organizer" && <>
                        {application?.status === "changes_requested" && <p className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-950">Requested corrections: {application.rejectionReason}. Use your original email and password and upload a replacement proof to resubmit.</p>}
                        <section className="space-y-4 border-t pt-6">
                        {sectionHeading("02", "Organization & events", "Fields marked * are required. Enter your complete address and describe your event within the limits shown.")}
                        <div className="space-y-2"><Label htmlFor="organization-name">Organization or club name <RequiredMark /></Label><Input id="organization-name" aria-label="Organization or club name" value={form.organizationName} onChange={(event) => updateForm("organizationName", event.target.value)} required minLength={2} maxLength={160} placeholder="Your race organization" /></div>
                        <div className="grid gap-5 sm:grid-cols-2">
                          <div className="space-y-2"><Label htmlFor="organization-type">Organization type <RequiredMark /></Label><select id="organization-type" value={form.organizationType} onChange={(event) => updateForm("organizationType", event.target.value)} required className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="">Select type</option><option value="RUNNING_CLUB">Running club</option><option value="CYCLING_CLUB">Cycling club</option><option value="TREK_ORGANIZER">Trek organizer</option><option value="BADMINTON_ACADEMY">Badminton academy</option><option value="SPORTS_ACADEMY">Sports academy</option><option value="OTHER">Other</option></select></div>
                          <div className="space-y-2"><Label htmlFor="discovery-source">How did you hear about us? <RequiredMark /></Label><select id="discovery-source" value={form.discoverySource} onChange={(event) => updateForm("discoverySource", event.target.value)} required className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="">Select one</option><option value="REFERRAL">Referral</option><option value="SOCIAL_MEDIA">Social media</option><option value="SEARCH">Google/search</option><option value="EVENT">SportPass event</option><option value="OTHER">Other</option></select></div>
                        </div>
                        <div className="space-y-2"><Label htmlFor="signup-address">Office or correspondence address <RequiredMark /></Label><textarea id="signup-address" value={form.address} onChange={(event) => updateForm("address", event.target.value)} required maxLength={1000} rows={2} placeholder="Full address" className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>
                        <div className="grid gap-5 sm:grid-cols-3"><div className="space-y-2"><Label htmlFor="signup-city">City <RequiredMark /></Label><Input id="signup-city" value={form.city} onChange={(event) => updateForm("city", event.target.value)} required maxLength={120} /></div><div className="space-y-2"><Label htmlFor="signup-state">State <RequiredMark /></Label><Input id="signup-state" value={form.state} onChange={(event) => updateForm("state", event.target.value)} required maxLength={120} /></div><div className="space-y-2"><Label htmlFor="signup-pincode">PIN code <RequiredMark /></Label><Input id="signup-pincode" inputMode="numeric" value={form.pincode} onChange={(event) => updateForm("pincode", event.target.value)} required maxLength={10} /></div></div>
                        <div className="space-y-2"><Label htmlFor="event-history">Tell us about your events <RequiredMark /></Label><textarea id="event-history" value={form.eventHistory} onChange={(event) => updateForm("eventHistory", event.target.value)} required maxLength={2000} rows={3} placeholder="What events do you run, and what are you planning next?" className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>
                        </section>
                        <section className="space-y-4 border-t pt-6">
                        {sectionHeading("03", "Payments & verification", "Fields marked * are required. Payment access is reviewed separately after your application is approved.")}
                        <div className="grid gap-5 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="payment-preference">How will you collect registration payments? <RequiredMark /></Label><select id="payment-preference" aria-label="How will you collect registration payments?" value={form.paymentPreference} onChange={(event) => updateForm("paymentPreference", event.target.value)} required className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="">Select one</option><option value="DIRECT_UPI">Direct UPI</option><option value="CASHFREE">Payment gateway</option><option value="BOTH">Both, depending on the event</option><option value="UNSURE">I need guidance</option></select><p className="text-xs text-muted-foreground">You can use different payment methods for different events.</p></div><div className="space-y-2"><Label htmlFor="id-proof-type">Identity proof <RequiredMark /></Label><select id="id-proof-type" value={form.idProofType} onChange={(event) => updateForm("idProofType", event.target.value)} required className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="">Select proof</option><option value="PAN">PAN card</option><option value="GST">GST certificate</option><option value="REGISTRATION_CERTIFICATE">Registration certificate</option><option value="ASSOCIATION_ID">Association ID</option><option value="OTHER">Other government ID</option></select></div></div>
                        <div className="space-y-2"><Label htmlFor="id-proof">Upload ID proof <RequiredMark /></Label><Input id="id-proof" aria-label="Upload ID proof" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required onChange={(event) => updateForm("idProof", event.target.files?.[0] ?? null)} /><p className="text-xs text-muted-foreground">PDF, PNG, JPG, or WebP. Maximum file size: {ORGANIZER_ID_PROOF_MAX_MB} MB. Stored securely for admin verification.</p></div>
                        {(form.paymentPreference === "DIRECT_UPI" || form.paymentPreference === "BOTH") && <fieldset className="space-y-3 rounded-xl border p-4"><legend className="px-1 text-sm font-semibold">Direct UPI details</legend><Label htmlFor="apply-upi">UPI ID <RequiredMark /></Label><Input id="apply-upi" aria-label="UPI ID" required maxLength={320} value={form.upiId} onChange={e => updateForm("upiId", e.target.value)} placeholder="club@bank" /><Label htmlFor="apply-payee">Payee name <RequiredMark /></Label><Input id="apply-payee" aria-label="Payee name" required minLength={2} maxLength={200} value={form.payeeName} onChange={e => updateForm("payeeName", e.target.value)} /><p className="text-xs text-muted-foreground">Payments go directly to you. Payment access is enabled separately after review.</p></fieldset>}
                        {(form.paymentPreference === "CASHFREE" || form.paymentPreference === "BOTH") && <fieldset className="space-y-3 rounded-xl border p-4"><legend className="px-1 text-sm font-semibold">Payment gateway details</legend><Label htmlFor="apply-legal">Legal name as on PAN <RequiredMark /></Label><Input id="apply-legal" aria-label="Legal name as on PAN" required minLength={2} maxLength={200} value={form.legalName} onChange={e => updateForm("legalName", e.target.value)} /><Label htmlFor="apply-pan">PAN <RequiredMark /></Label><Input id="apply-pan" aria-label="PAN" required maxLength={10} pattern="[A-Z]{5}[0-9]{4}[A-Z]" value={form.panNumber} onChange={e => updateForm("panNumber", e.target.value.toUpperCase())} /><p className="text-xs text-muted-foreground">Gateway access requires separate verification and approval.</p></fieldset>}
                        {form.paymentPreference === "UNSURE" && <p className="text-sm text-muted-foreground">We will discuss your payment needs during review. Payment collection remains disabled until configured and approved.</p>}
                        <p className="rounded-xl bg-muted/50 px-4 py-3 text-xs leading-5 text-muted-foreground">Your proof is kept private and used only by admins to verify your application.</p>
                        </section>
                      </>}
                      {isParticipant && contactFields}
                      <label className="flex items-start gap-3 rounded-xl border bg-muted/30 p-3 text-sm leading-5">
                        <input type="checkbox" checked={form.privacyPolicyAccepted} onChange={(event) => { setSubmitted(false); setForm((current) => ({ ...current, privacyPolicyAccepted: event.target.checked })); }} className="mt-1 h-4 w-4 accent-primary" required />
                        <span aria-hidden="true" className="sr-only">Required</span>
                        <span><span aria-hidden="true" className="mr-1 text-destructive">*</span>I have read the <Link to="/privacy-policy" target="_blank" className="font-semibold text-primary underline underline-offset-2">Privacy Policy</Link>{isParticipant ? " and consent to the collection and use of my data to create and operate my SportPass account and registrations." : " and consent to the collection and use of my contact, organization, event, payment and uploaded identity-proof details to review my organizer application, verify my details, contact me about the decision, and administer my account if approved."}</span>
                      </label>
                      <Button type="submit" className="w-full gap-2" size="lg" disabled={loading}>{loading ? "Submitting…" : mode === "participant" ? "Create participant account" : "Submit organizer application"}<ArrowRight className="h-4 w-4" /></Button>
                    </form>
                  </CardContent>
                </Card>
              )}

              <p className="mt-7 text-center text-sm text-muted-foreground">Already have an account? <button type="button" className="font-semibold text-primary hover:underline" onClick={() => navigate("/login")}>Sign in</button></p>
            </section>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Signup;
