import { FormEvent, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Building2, CheckCircle2, Eye, EyeOff, KeyRound, ShieldCheck, Ticket, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/api";

type SignupMode = "participant" | "organizer";

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
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    organizationName: "",
    message: "",
  });

  const updateForm = (field: keyof typeof form, value: string) => {
    setSubmitted(false);
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
          }),
        });
        await login(form.email.trim(), form.password);
        toast.success("Your participant account is ready.");
        navigate(returnTo ?? "/dashboard", { replace: true });
      } else {
        await apiRequest("/auth/organizer-applications", {
          method: "POST",
          body: JSON.stringify({
            organization_name: form.organizationName,
            name: form.name,
            email: form.email,
            phone: form.phone || null,
            password: form.password,
            message: form.message || null,
          }),
        });
        setSubmitted(true);
        toast.success("Your organizer application was submitted.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not complete signup.");
    } finally {
      setLoading(false);
    }
  };

  const isParticipant = mode === "participant";

  return (
    <Layout>
      <div className="relative min-h-[calc(100vh-10rem)] overflow-hidden bg-muted/30">
        <div className="pointer-events-none absolute -left-32 top-16 h-72 w-72 rounded-full bg-primary/15 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-accent/10 blur-3xl" />

        <div className="relative mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16 lg:px-8">
          <div className="mb-8 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">SportPass account</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Join the race day community.</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Create an account to keep your registrations, tickets, and results together.</p>
            </div>
            <div className="hidden h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary sm:flex"><Ticket className="h-6 w-6" /></div>
          </div>

          <div className="grid overflow-hidden rounded-3xl border bg-card shadow-xl lg:grid-cols-[0.85fr_1.15fr]">
            <aside className="relative overflow-hidden bg-slate-950 px-6 py-8 text-white sm:p-10 lg:p-12">
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

            <section className="bg-background px-6 py-8 sm:p-10 lg:p-12">
              <div className="mb-7 flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Get started</p>
                  <h2 className="mt-2 text-2xl font-black tracking-tight">{isParticipant ? "Create your participant account" : "Apply as an organizer"}</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{isParticipant ? "It takes less than a minute. You can also register as a guest later." : "Tell us about your organization and an admin will review your application."}</p>
                </div>
                <KeyRound className="mt-1 hidden h-5 w-5 text-primary sm:block" />
              </div>

              <div className="mb-7 grid grid-cols-2 gap-2 rounded-xl bg-muted/60 p-1">
                <button type="button" aria-pressed={isParticipant} onClick={() => { setMode("participant"); setSubmitted(false); }} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all ${isParticipant ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}><UserPlus className="h-4 w-4" /> Participant</button>
                <button type="button" aria-pressed={!isParticipant} onClick={() => { setMode("organizer"); setSubmitted(false); }} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all ${!isParticipant ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}><Building2 className="h-4 w-4" /> Organizer</button>
              </div>

              {submitted ? (
                <Card className="border-primary/20 bg-primary/5 shadow-none">
                  <CardHeader>
                    <CardTitle className="text-xl">Application received</CardTitle>
                    <CardDescription>Your application is waiting for admin approval.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <p className="text-sm leading-6 text-muted-foreground">You will be able to sign in as an organizer after approval. Your plan is calculated automatically per event from confirmed registrations.</p>
                    <div className="flex flex-wrap gap-3"><Button onClick={() => navigate("/login")}>Sign in after approval <ArrowRight className="h-4 w-4" /></Button><Button variant="outline" onClick={() => navigate("/")}>Browse events</Button></div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-0 bg-transparent shadow-none">
                  <CardContent className="p-0">
                    <form onSubmit={submit} className="space-y-5">
                      {mode === "organizer" && <div className="space-y-2"><Label htmlFor="organization-name">Organization name</Label><Input id="organization-name" value={form.organizationName} onChange={(event) => updateForm("organizationName", event.target.value)} required minLength={2} maxLength={160} placeholder="Your race organization" /></div>}
                      <div className="grid gap-5 sm:grid-cols-2">
                        <div className="space-y-2"><Label htmlFor="signup-name">Your name</Label><Input id="signup-name" value={form.name} onChange={(event) => updateForm("name", event.target.value)} required minLength={2} maxLength={120} autoComplete="name" placeholder="Your full name" /></div>
                        <div className="space-y-2"><Label htmlFor="signup-phone">Phone <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="signup-phone" value={form.phone} onChange={(event) => updateForm("phone", event.target.value)} maxLength={32} autoComplete="tel" placeholder="+91 98765 43210" /></div>
                      </div>
                      <div className="space-y-2"><Label htmlFor="signup-email">Email address</Label><Input id="signup-email" type="email" value={form.email} onChange={(event) => updateForm("email", event.target.value)} required maxLength={320} autoComplete="email" placeholder="you@example.com" /></div>
                      <div className="space-y-2"><Label htmlFor="signup-password">Password</Label><div className="relative"><Input id="signup-password" type={showPassword ? "text" : "password"} value={form.password} onChange={(event) => updateForm("password", event.target.value)} required minLength={8} maxLength={256} autoComplete="new-password" placeholder="At least 8 characters" className="pr-10" /><button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div><p className="text-xs text-muted-foreground">Use at least 8 characters. A longer passphrase is even better.</p></div>
                      {mode === "organizer" && <div className="space-y-2"><Label htmlFor="organizer-message">Tell us about your organization <span className="font-normal text-muted-foreground">(optional)</span></Label><Textarea id="organizer-message" value={form.message} onChange={(event) => updateForm("message", event.target.value)} maxLength={2000} placeholder="What races do you organize?" rows={4} /></div>}
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
