import { useNavigate, useParams } from "react-router-dom";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import OrganizerEventMatches from "@/components/OrganizerEventMatches";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useOrganizerCourts, useOrganizerEventDashboard } from "@/hooks/useEvents";
import { eventSupportsTournament, isFreeEvent } from "@/data/sportConfig";


const OrganizerEventTournamentMatches = () => {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const { data: dashboard, isLoading: isLoadingEvent, isError: isEventError } = useOrganizerEventDashboard(eventId);
  const supportsTournament = eventSupportsTournament(dashboard?.event.sport, dashboard?.event.categories);
  const { data: courts = [], isLoading: isLoadingCourts, isError: isCourtsError, refetch: refetchCourts } = useOrganizerCourts(eventId, supportsTournament);

  if (isLoadingEvent) {
    return <OrganizerDashboardLayout eventId={eventId}><div className="px-4 py-20 text-center text-sm text-muted-foreground">Loading tournament matches…</div></OrganizerDashboardLayout>;
  }

  if (isEventError || !dashboard?.event) {
    return <OrganizerDashboardLayout eventId={eventId}><div className="mx-auto max-w-3xl px-4 py-20 text-center"><p className="text-sm text-muted-foreground">Could not load this event.</p><Button className="mt-4" variant="outline" onClick={() => navigate("/organizer")}>Back to events</Button></div></OrganizerDashboardLayout>;
  }

  const event = dashboard.event;
  // Free events only get overview + registrations; paid-only tooling is locked.
  if (isFreeEvent(event)) {
    return (
      <OrganizerDashboardLayout eventId={event.id}>
        <div className="mx-auto max-w-3xl px-4 py-20">
          <Card>
            <CardHeader>
              <CardTitle>Tournament tools locked</CardTitle>
              <CardDescription>Tournament tools are available for paid events. For free events, only the core registration workflow is unlocked.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Upgrade to a paid event to access match scheduling, courts, and tournament bracket views.
              </p>
              <p className="text-xs text-muted-foreground">
                Need custom tournament features? <a href="mailto:sportpassind@gmail.com" className="font-medium text-primary hover:underline">Contact SportPass India</a> for custom pricing.
              </p>
              <Button variant="outline" onClick={() => navigate(`/organizer/events/${event.id}`)}>Back to event</Button>
            </CardContent>
          </Card>
        </div>
      </OrganizerDashboardLayout>
    );
  }
  if (!supportsTournament) {
    return <OrganizerDashboardLayout eventId={event.id}><div className="mx-auto max-w-3xl px-4 py-20"><Card><CardHeader><CardTitle>Tournament tools unavailable</CardTitle><CardDescription>Tournament tools are currently unavailable for this sport.</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => navigate(`/organizer/events/${event.id}`)}>Back to event</Button></CardContent></Card></div></OrganizerDashboardLayout>;
  }

  return (
    <OrganizerDashboardLayout eventId={event.id}>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Button variant="ghost" className="mb-3 -ml-3 gap-2 px-3 text-muted-foreground" onClick={() => navigate(`/organizer/events/${event.id}`)}>Back to event</Button>
            <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-primary">{event.name}</p><Badge variant="outline" className="capitalize">{event.sport.replaceAll("_", " ")}</Badge></div>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Matches</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Plan who plays, where they play, and when. Keep every court and player on schedule.</p>
          </div>
          <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => navigate(`/organizer/events/${event.id}/tournament/scoring`)}>Record scores</Button><Button variant="outline" onClick={() => navigate(`/organizer/events/${event.id}/tournament`)}>Courts & rounds</Button></div>
        </div>
        {isLoadingCourts ? <p className="py-8 text-center text-sm text-muted-foreground">Loading courts and schedule…</p> : isCourtsError ? <div role="alert" className="rounded-xl border p-6"><p>We couldn’t load the courts for this event.</p><Button variant="outline" className="mt-3" onClick={() => void refetchCourts()}>Try again</Button></div> : <OrganizerEventMatches eventId={event.id} categories={event.categories} courts={courts} supportsTournament={supportsTournament} tournamentFormat={event.sportConfig?.tournament_format ?? "knockout"} />}
      </div>
    </OrganizerDashboardLayout>
  );
};

export default OrganizerEventTournamentMatches;
