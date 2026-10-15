import { Download, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/api";

const DashboardProfile = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const exportData = async () => {
    try {
      const data = await apiRequest<unknown>("/auth/data-export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "sportpass-personal-data.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not prepare your data export.");
    }
  };

  const deleteAccount = async () => {
    try {
      setDeleting(true);
      await apiRequest("/auth/me", { method: "DELETE", body: JSON.stringify({ password, confirmation }) });
      await logout().catch(() => undefined);
      toast.success("Your account has been erased.");
      navigate("/", { replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not erase your account.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-2xl space-y-6 p-6 lg:p-10">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Profile</h1>
          <p className="mt-1 text-sm text-muted-foreground">Account details from your authenticated SportPass session.</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserRound className="h-5 w-5 text-primary" />Your account</CardTitle>
            <CardDescription>Details associated with your authenticated SportPass account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Name</p>
              <p className="mt-1 font-medium">{user?.name ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Email</p>
              <p className="mt-1 font-medium">{user?.email ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Phone</p>
              <p className="mt-1 font-medium">{user?.phone || "Not provided"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Account role</p>
              <p className="mt-1 font-medium capitalize">{user?.role ?? "—"}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" />Privacy and your data</CardTitle><CardDescription>Download the information linked to this account, or request account erasure.</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-3"><Button variant="outline" onClick={() => void exportData()}><Download className="mr-2 h-4 w-4" />Download my data</Button><Button variant="outline" onClick={() => document.getElementById("delete-account")?.scrollIntoView({ behavior: "smooth" })}>Manage account deletion</Button></CardContent>
        </Card>
        <Card id="delete-account" className="border-destructive/30">
          <CardHeader><CardTitle className="flex items-center gap-2 text-destructive"><Trash2 className="h-5 w-5" />Delete my account</CardTitle><CardDescription>This permanently removes your account identifiers, active sessions, password reset tokens, and push subscriptions. Event and payment records may be retained in de-identified form where needed for legal, fraud-prevention, or event-operation obligations.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {user?.role === "participant" || user?.role === "user" ? <>
              <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="delete-password">Password</Label><Input id="delete-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></div><div className="space-y-2"><Label htmlFor="delete-confirmation">Type DELETE to confirm</Label><Input id="delete-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></div></div>
              <Button variant="destructive" disabled={deleting || !password || confirmation !== "DELETE"} onClick={() => void deleteAccount()}>{deleting ? "Erasing account…" : "Permanently delete my account"}</Button>
            </> : <p className="text-sm text-muted-foreground">Organizer and administrator accounts can have event, settlement, or compliance responsibilities. Email <a className="font-semibold text-primary underline" href="mailto:sportpassind@gmail.com?subject=Privacy%20account%20erasure%20request">sportpassind@gmail.com</a> to submit an erasure request.</p>}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default DashboardProfile;
