import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    const submittedEmail = email.trim();
    try {
      await apiRequest("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email: submittedEmail }) });
      const [name, domain] = submittedEmail.split("@");
      const visibleLength = Math.min(3, Math.max(0, name.length - 1));
      setMaskedEmail(`${name.slice(0, visibleLength)}xxxxx@${domain}`);
    } catch {
      setError("Could not request a reset link. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="mx-auto max-w-md px-4 py-16">
        <h1 className="text-2xl font-bold">Forgot your password?</h1>
        {maskedEmail ? (
          <div role="status" className="mt-4 space-y-3">
            <p className="text-muted-foreground">
              If this email matches a registered account, a password reset link will be sent to:
            </p>
            <p className="break-all font-semibold">{maskedEmail}</p>
            <p className="text-sm text-muted-foreground">Check your inbox and spam folder.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <p className="text-sm text-muted-foreground">Enter the email address you already use to sign in to SportPass.</p>
            <div className="space-y-2">
              <Label htmlFor="reset-email">Registered login email</Label>
              <Input id="reset-email" type="email" autoComplete="email" placeholder="you@example.com" required disabled={loading} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" disabled={loading}>{loading ? "Sending…" : "Send reset link"}</Button>
          </form>
        )}
        <Link className="mt-6 block text-sm text-primary underline" to="/login">Back to sign in</Link>
      </div>
    </Layout>
  );
}
