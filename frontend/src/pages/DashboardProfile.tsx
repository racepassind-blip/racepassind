import { UserRound } from "lucide-react";

import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";

const DashboardProfile = () => {
  const { user } = useAuth();

  return (
    <DashboardLayout>
      <div className="max-w-2xl space-y-6 p-6 lg:p-10">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Profile</h1>
          <p className="mt-1 text-sm text-muted-foreground">Account details from your authenticated RacePass session.</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserRound className="h-5 w-5 text-primary" />Your account</CardTitle>
            <CardDescription>Profile editing will be enabled when the backend profile endpoint is available.</CardDescription>
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
      </div>
    </DashboardLayout>
  );
};

export default DashboardProfile;
