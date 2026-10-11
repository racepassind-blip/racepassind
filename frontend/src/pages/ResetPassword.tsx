import { FormEvent, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/api";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirmation) { setError("Passwords do not match."); return; }
    setSubmitting(true);
    try {
      await apiRequest("/auth/reset-password", { method: "POST", body: JSON.stringify({ token: params.get("token") ?? "", password }) });
      setDone(true);
    } catch (e) { setError(e instanceof Error ? e.message : "The reset link is invalid or expired."); }
    finally { setSubmitting(false); }
  };
  const passwordInput = (id: string, label: string, value: string, onChange: (value: string) => void) => <div className="space-y-2"><Label htmlFor={id}>{label}</Label><div className="relative"><Input id={id} type={showPassword ? "text" : "password"} minLength={8} required autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)} className="pr-10" /><button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={showPassword ? "Hide passwords" : "Show passwords"} aria-pressed={showPassword}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></div>;
  return <Layout><div className="mx-auto max-w-md px-4 py-16"><h1 className="text-2xl font-bold">Create a new password</h1>{done ? <div role="status"><p className="mt-4 text-muted-foreground">Your password was reset successfully.</p><Link className="mt-6 block text-primary underline" to="/login">Sign in</Link></div> : <form onSubmit={submit} className="mt-6 space-y-4">{passwordInput("new-password", "New password", password, setPassword)}{passwordInput("confirm-password", "Confirm new password", confirmation, setConfirmation)}<p className="text-xs text-muted-foreground">Use at least 8 characters and avoid reusing a password from another service.</p>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button className="w-full" disabled={submitting}>{submitting ? "Resetting password…" : "Reset password"}</Button></form>}</div></Layout>;
}
