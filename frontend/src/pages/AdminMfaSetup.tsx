import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/api";

interface SetupResponse { secret: string; otpauthUri: string; qrDataUrl: string }

export default function AdminMfaSetup() {
  const navigate = useNavigate();
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<SetupResponse>("/auth/admin/mfa/setup", { method: "POST" })
      .then(setSetup)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not start MFA setup"))
      .finally(() => setLoading(false));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await apiRequest("/auth/admin/mfa/verify", { method: "POST", body: JSON.stringify({ code }) });
      toast.success("Admin MFA enabled");
      navigate("/admin", { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Invalid authenticator code");
    }
  };

  return <Layout><main className="mx-auto max-w-xl px-4 py-12">
    <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
      <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShieldCheck className="h-6 w-6" /></div>
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Required security step</p>
      <h1 className="mt-2 text-2xl font-extrabold">Protect your admin account</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">Admin access requires a time-based authenticator code. Add this account to your authenticator app, then enter the current 6-digit code.</p>
      {loading && <p className="mt-6 text-sm text-muted-foreground">Preparing your setup key…</p>}
      {setup && <form onSubmit={submit} className="mt-6 space-y-5">
        <div className="flex flex-col gap-4 rounded-lg border bg-muted/40 p-4 sm:flex-row sm:items-center"><img src={setup.qrDataUrl} alt="Scan this QR code with your authenticator app" className="h-40 w-40 rounded bg-white p-2" /><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Setup key</p><code className="mt-2 block break-all text-sm font-bold">{setup.secret}</code><a className="mt-3 block break-all text-xs text-primary underline" href={setup.otpauthUri}>Open in an authenticator app</a></div></div>
        <div className="space-y-2"><Label htmlFor="setup-mfa-code">Verification code</Label><Input id="setup-mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="123456" required /></div>
        {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        <Button className="w-full" type="submit">Enable admin MFA</Button>
      </form>}
      {!loading && !setup && error && <p role="alert" className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    </div>
  </main></Layout>;
}
