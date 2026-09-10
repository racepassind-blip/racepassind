import { AlertCircle, ClipboardList, Ticket } from "lucide-react";
import { Link } from "react-router-dom";

import { DashboardLayout } from "@/components/DashboardLayout";
import { ParticipantRegistrationCard } from "@/components/ParticipantRegistrationCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useParticipantRegistrations } from "@/hooks/useParticipantRegistrations";

const Dashboard = () => {
  const { data: registrations = [], isLoading, isError, error } = useParticipantRegistrations();
  const errorMessage = error instanceof Error ? error.message : "Failed to load your registrations.";

  return (
    <DashboardLayout>
      <div className="max-w-6xl space-y-8 p-6 lg:p-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">My Tickets</h1>
            <p className="mt-1 text-sm text-muted-foreground">Manage registrations linked to your RacePass account.</p>
          </div>
          <Button asChild variant="outline" className="gap-2">
            <Link to="/dashboard/registrations"><ClipboardList className="h-4 w-4" />Manage registrations</Link>
          </Button>
        </div>

        {isLoading && <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Loading your registrations…</CardContent></Card>}
        {!isLoading && isError && (
          <Card><CardContent className="flex items-start gap-2 py-8 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{errorMessage}</span></CardContent></Card>
        )}
        {!isLoading && !isError && registrations.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <Ticket className="mx-auto mb-3 h-9 w-9 text-muted-foreground" />
              <p className="font-medium">No tickets linked yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Claim a guest registration or browse events to get started.</p>
              <Button asChild className="mt-5"><Link to="/dashboard/registrations">Claim a registration</Link></Button>
            </CardContent>
          </Card>
        )}
        {!isLoading && !isError && registrations.length > 0 && (
          <div className="grid gap-5 lg:grid-cols-2">
            {registrations.map((registration) => <ParticipantRegistrationCard key={registration.id} registration={registration} />)}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default Dashboard;
