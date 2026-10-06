import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/api";

export default function ForgotPassword() {
  const [email, setEmail] = useState(""); const [sent, setSent] = useState(false); const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setLoading(true); try { await apiRequest("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }); } finally { setSent(true); setLoading(false); } };
  return <Layout><div className="mx-auto max-w-md px-4 py-16"><h1 className="text-2xl font-bold">Forgot your password?</h1>{sent ? <p className="mt-4 text-muted-foreground">If an account exists for this email, you’ll receive a reset link shortly.</p> : <form onSubmit={submit} className="mt-6 space-y-4"><div className="space-y-2"><Label htmlFor="reset-email">Email address</Label><Input id="reset-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div><Button className="w-full" disabled={loading}>{loading ? "Sending…" : "Send reset link"}</Button></form>}<Link className="mt-6 block text-sm text-primary underline" to="/login">Back to sign in</Link></div></Layout>;
}
