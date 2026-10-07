import { FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/api";

export default function ResetPassword() {
  const [params] = useSearchParams(); const [password, setPassword] = useState(""); const [done, setDone] = useState(false); const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(null); try { await apiRequest("/auth/reset-password", { method: "POST", body: JSON.stringify({ token: params.get("token") ?? "", password }) }); setDone(true); } catch (e) { setError(e instanceof Error ? e.message : "The reset link is invalid or expired."); } };
  return <Layout><div className="mx-auto max-w-md px-4 py-16"><h1 className="text-2xl font-bold">Create a new password</h1>{done ? <><p className="mt-4 text-muted-foreground">Your password was reset successfully.</p><Link className="mt-6 block text-primary underline" to="/login">Sign in</Link></> : <form onSubmit={submit} className="mt-6 space-y-4"><div className="space-y-2"><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></div>{error && <p className="text-sm text-destructive">{error}</p>}<Button className="w-full">Reset password</Button></form>}</div></Layout>;
}
