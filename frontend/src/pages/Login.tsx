import { FormEvent, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, Eye, EyeOff, LogIn, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { SignIn } from "@clerk/react";

import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { getSafeRedirectPath } from "@/lib/navigation";
import { useAuth } from "@/contexts/AuthContext";

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = getSafeRedirectPath((location.state as { from?: unknown })?.from);

  if (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY) {
    return <Layout><div className="mx-auto flex justify-center px-4 py-10"><SignIn routing="path" path="/login" forceRedirectUrl={from ?? "/dashboard"} /></div></Layout>;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      const loggedInUser = await login(email.trim(), password, needsMfa ? mfaCode : undefined);
      toast.success("Welcome back!");
      if (loggedInUser.role === "admin" && loggedInUser.mfaRequired && !loggedInUser.mfaEnabled) {
        navigate("/admin/mfa", { replace: true });
        return;
      }
      const destination = from ?? (loggedInUser.role === "admin" ? "/admin" : loggedInUser.role === "organizer" ? "/organizer" : "/dashboard");
      navigate(destination, { replace: true });
    } catch (loginError) {
      if (loginError instanceof ApiError && loginError.message === "admin_mfa_required") {
        setNeedsMfa(true);
        setError("Enter the 6-digit code from your authenticator app.");
      } else {
        setError(loginError instanceof ApiError ? loginError.message : "Could not sign in. Please try again.");
      }
    }
  };

  return (
    <Layout>
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute -left-24 top-16 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 bottom-10 h-72 w-72 rounded-full bg-accent/10 blur-3xl" />

        <div className="relative mx-auto w-full max-w-none px-4 py-10 sm:px-6 sm:py-16 lg:px-8">
          <div className="grid overflow-hidden rounded-2xl border bg-card shadow-sm lg:grid-cols-[0.9fr_1.1fr]">
            <section className="relative overflow-hidden bg-slate-950 px-6 py-8 text-white sm:p-10 lg:p-12">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-orange-500 via-white to-green-500" />
              <div className="absolute -bottom-20 -right-20 h-52 w-52 rounded-full bg-primary/20 blur-3xl" />
              <div className="relative">
                <div className="mb-10 flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                  <ShieldCheck className="h-6 w-6 text-orange-300" />
                </div>
                <p className="mb-4 inline-flex items-center rounded-full border border-orange-300/30 bg-orange-300/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-orange-200">
                  Members only
                </p>
                <h1 className="max-w-sm text-3xl font-extrabold tracking-tight sm:text-4xl">Welcome back to race day.</h1>
                <p className="mt-4 max-w-sm text-sm leading-6 text-slate-300">
                  Sign in with your existing SportPass account to keep your registrations, tickets, and race plans together.
                </p>

                <ul className="mt-8 space-y-4 text-sm text-slate-200">
                  <li className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-400" /><span>View your registrations and tickets</span></li>
                  <li className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-400" /><span>Keep your race-day details in one place</span></li>
                  <li className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-400" /><span>Access your participant dashboard</span></li>
                </ul>
              </div>
            </section>

            <section className="px-6 py-8 sm:p-10 lg:p-12">
              <div className="mb-8">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <LogIn className="h-5 w-5" />
                </div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Member access</p>
                <h2 className="mt-2 text-2xl font-extrabold tracking-tight">Sign in to your account</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Use the email and password linked to your SportPass membership.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    required
                  />
                </div>
                {needsMfa && <div className="space-y-2">
                  <Label htmlFor="mfa-code">Authenticator code</Label>
                  <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" placeholder="123456" value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, ""))} required />
                  <p className="text-xs text-muted-foreground">Use the code from the authenticator app enrolled for this admin account.</p>
                </div>}
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      required
                      className="pr-10"
                    />
                    <button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full gap-2" size="lg" disabled={isLoading}>
                  {isLoading ? "Signing in…" : "Sign in"}
                  {!isLoading && <ArrowRight className="h-4 w-4" />}
                </Button>
              </form>

              <div className="mt-8 border-t pt-6 text-center text-sm">
                <p className="text-muted-foreground">Not a member yet?</p>
                <Button type="button" variant="link" className="mt-1 h-auto gap-1 p-0 font-semibold" onClick={() => navigate("/signup?type=participant")}>
                  Create a participant account <UserPlus className="h-3.5 w-3.5" />
                </Button>
                <p className="mt-4 text-xs text-muted-foreground">
                  Organizing an event? <button type="button" className="font-medium text-primary hover:underline" onClick={() => navigate("/signup?type=organizer")}>Apply as an organizer</button>
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Login;
