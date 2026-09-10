import { FormEvent, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Chrome, LogIn } from "lucide-react";
import { toast } from "sonner";

import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: string })?.from;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      const loggedInUser = await login(email.trim(), password);
      toast.success("Welcome back!");
      const destination = from ?? (loggedInUser.role === "admin" || loggedInUser.role === "organizer" ? "/organizer" : "/dashboard");
      navigate(destination, { replace: true });
    } catch (loginError) {
      setError(loginError instanceof ApiError ? loginError.message : "Could not sign in. Please try again.");
    }
  };

  return (
    <Layout>
      <div className="mx-auto max-w-md px-4 py-20">
        <div className="mb-8 text-center">
          <LogIn className="mx-auto mb-3 h-10 w-10 text-primary" />
          <h1 className="text-2xl font-extrabold tracking-tight">Sign In</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to view your RacePass registrations and tickets.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border bg-card p-6">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
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
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Your password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" size="lg" disabled={isLoading}>
            {isLoading ? "Signing in…" : "Sign In"}
          </Button>
        </form>

        <div className="mt-5">
          <Button type="button" variant="outline" className="w-full gap-2" disabled title="Google sign-in requires OAuth configuration">
            <Chrome className="h-4 w-4" />
            Continue with Google
          </Button>
          <p className="mt-2 text-center text-xs text-muted-foreground">Google sign-in will be enabled after OAuth credentials are configured.</p>
        </div>
      </div>
    </Layout>
  );
};

export default Login;
