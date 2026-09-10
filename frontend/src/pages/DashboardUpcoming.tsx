import { AlertCircle, CalendarDays } from "lucide-react";

import { DashboardLayout } from "@/components/DashboardLayout";
import { ParticipantRegistrationCard } from "@/components/ParticipantRegistrationCard";
import { Card, CardContent } from "@/components/ui/card";
import { useParticipantRegistrations } from "@/hooks/useParticipantRegistrations";
import { registrationDateValue } from "@/lib/registration-format";

const DashboardUpcoming = () => {
  const { data: registrations = [], isLoading, isError, error } = useParticipantRegistrations();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcoming = registrations
    .filter((registration) => !["rejected", "expired"].includes(registration.status) && registrationDateValue(registration.event.date) >= today.getTime())
    .sort((first, second) => registrationDateValue(first.event.date) - registrationDateValue(second.event.date));
  const errorMessage = error instanceof Error ? error.message : "Failed to load your upcoming registrations.";

  return (
    <DashboardLayout>
      <div className="max-w-6xl space-y-6 p-6 lg:p-10">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Upcoming Events</h1>
          <p className="mt-1 text-sm text-muted-foreground">Events you are registered to attend.</p>
        </div>
        {isLoading && <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Loading your registrations…</CardContent></Card>}
        {!isLoading && isError && <Card><CardContent className="flex items-start gap-2 py-8 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{errorMessage}</span></CardContent></Card>}
        {!isLoading && !isError && upcoming.length === 0 && (
          <Card><CardContent className="py-12 text-center"><CalendarDays className="mx-auto mb-3 h-9 w-9 text-muted-foreground" /><p className="font-medium">No upcoming registered events</p><p className="mt-1 text-sm text-muted-foreground">Your linked registrations will appear here.</p></CardContent></Card>
        )}
        {!isLoading && !isError && upcoming.length > 0 && <div className="grid gap-5 lg:grid-cols-2">{upcoming.map((registration) => <ParticipantRegistrationCard key={registration.id} registration={registration} />)}</div>}
      </div>
    </DashboardLayout>
  );
};

export default DashboardUpcoming;
