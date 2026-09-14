import { FormEvent, useState } from "react";
import { Building2, UserPlus } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
  const { login } = useAuth();
  const [mode, setMode] = useState<SignupMode>(searchParams.get("type") === "organizer" ? "organizer" : "participant");
  const [loading, setLoading] = useState(false);
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
        navigate("/dashboard", { replace: true });
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

  return (
    <Layout>
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight">Join RacePass</h1>
          <p className="mt-2 text-muted-foreground">Choose how you want to use RacePass.</p>
        </div>

        <div className="mb-8 grid gap-4 md:grid-cols-2">
          <button type="button" onClick={() => { setMode("participant"); setSubmitted(false); }} className={`rounded-xl border p-5 text-left transition-colors ${mode === "participant" ? "border-primary bg-primary/5" : "hover:bg-secondary"}`}>
            <UserPlus className="mb-3 h-6 w-6 text-primary" />
            <p className="font-bold">Create participant account</p>
            <p className="mt-1 text-sm text-muted-foreground">View registrations, claim guest registrations, and access tickets.</p>
          </button>
          <button type="button" onClick={() => { setMode("organizer"); setSubmitted(false); }} className={`rounded-xl border p-5 text-left transition-colors ${mode === "organizer" ? "border-primary bg-primary/5" : "hover:bg-secondary"}`}>
            <Building2 className="mb-3 h-6 w-6 text-primary" />
            <p className="font-bold">Apply as organizer</p>
            <p className="mt-1 text-sm text-muted-foreground">Request access to create events and manage registrations.</p>
          </button>
        </div>

        {submitted ? (
          <Card>
            <CardHeader>
              <CardTitle>Application received</CardTitle>
              <CardDescription>Your application is waiting for admin approval.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">You will be able to sign in as an organizer after an admin approves your application. After approval, sign in to see your Plans & Pricing page first. Your plan is calculated automatically per event from confirmed registrations — there is nothing to configure while creating a race.</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => navigate("/login")}>Sign in after approval</Button>
                <Button variant="outline" onClick={() => navigate("/")}>Browse events</Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{mode === "participant" ? "Create participant account" : "Apply as organizer"}</CardTitle>
              <CardDescription>{mode === "participant" ? "Use at least a name, email, and a strong password." : "An admin will review your organization before granting organizer access."}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-5">
                {mode === "organizer" && <div className="space-y-2"><Label htmlFor="organization-name">Organization name</Label><Input id="organization-name" value={form.organizationName} onChange={(event) => updateForm("organizationName", event.target.value)} required minLength={2} maxLength={160} placeholder="Your race organization" /></div>}
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2"><Label htmlFor="signup-name">Your name</Label><Input id="signup-name" value={form.name} onChange={(event) => updateForm("name", event.target.value)} required minLength={2} maxLength={120} autoComplete="name" placeholder="Your full name" /></div>
                  <div className="space-y-2"><Label htmlFor="signup-phone">Phone (optional)</Label><Input id="signup-phone" value={form.phone} onChange={(event) => updateForm("phone", event.target.value)} maxLength={32} autoComplete="tel" placeholder="+91 98765 43210" /></div>
                </div>
                <div className="space-y-2"><Label htmlFor="signup-email">Email</Label><Input id="signup-email" type="email" value={form.email} onChange={(event) => updateForm("email", event.target.value)} required maxLength={320} autoComplete="email" placeholder="you@example.com" /></div>
                <div className="space-y-2"><Label htmlFor="signup-password">Password</Label><Input id="signup-password" type="password" value={form.password} onChange={(event) => updateForm("password", event.target.value)} required minLength={12} maxLength={256} autoComplete="new-password" placeholder="At least 12 characters" /><p className="text-xs text-muted-foreground">Use at least 12 characters.</p></div>
                {mode === "organizer" && <div className="space-y-2"><Label htmlFor="organizer-message">Tell us about your organization (optional)</Label><Textarea id="organizer-message" value={form.message} onChange={(event) => updateForm("message", event.target.value)} maxLength={2000} placeholder="What races do you organize?" /></div>}
                <Button type="submit" className="w-full" size="lg" disabled={loading}>{loading ? "Submitting…" : mode === "participant" ? "Create account" : "Submit organizer application"}</Button>
              </form>
            </CardContent>
          </Card>
        )}

        <p className="mt-6 text-center text-sm text-muted-foreground">Already have an account? <button type="button" className="font-medium text-primary hover:underline" onClick={() => navigate("/login")}>Sign in</button></p>
      </div>
    </Layout>
  );
};

export default Signup;
