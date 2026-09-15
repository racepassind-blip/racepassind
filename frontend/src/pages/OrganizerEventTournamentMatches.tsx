import { useNavigate, useParams } from "react-router-dom";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import OrganizerEventMatches from "@/components/OrganizerEventMatches";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useOrganizerCourts, useOrganizerEventDashboard } from "@/hooks/useEvents";
import { getSportConfig } from "@/data/sportConfig";

const OrganizerEventTournamentMatches = () => {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const { data: dashboard, isLoading: isLoadingEvent, isError: isEventError } = useOrganizerEventDashboard(eventId);
  const eventSportConfig = getSportConfig(dashboard?.event.sport);
  const supportsTournament = eventSportConfig.supports_tournament;
  const { data: courts = [], isLoading: isLoadingCourts } = useOrganizerCourts(eventId, supportsTournament);

  if (isLoadingEvent) {
    return <OrganizerDashboardLayout eventId={eventId}><div className="px-4 py-20 text-center text-sm text-muted-foreground">Loading tournament matches…</div></OrganizerDashboardLayout>;
  }

  if (isEventError || !dashboard?.event) {
    return <OrganizerDashboardLayout eventId={eventId}><div className="mx-auto max-w-3xl px-4 py-20 text-center"><p className="text-sm text-muted-foreground">Could not load this event.</p><Button className="mt-4" variant="outline" onClick={() => navigate("/organizer")}>Back to events</Button></div></OrganizerDashboardLayout>;
  }

  const event = dashboard.event;
  if (!supportsTournament) {
    return <OrganizerDashboardLayout eventId={event.id}><div className="mx-auto max-w-3xl px-4 py-20"><Card><CardHeader><CardTitle>Tournament tools unavailable</CardTitle><CardDescription>Tournament tools are currently unavailable for this sport.</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => navigate(`/organizer/events/${event.id}`)}>Back to event</Button></CardContent></Card></div></OrganizerDashboardLayout>;
  }

  return (
    <OrganizerDashboardLayout eventId={event.id}>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Button variant="ghost" className="mb-3 -ml-3 gap-2 px-3 text-muted-foreground" onClick={() => navigate(`/organizer/events/${event.id}`)}>Back to event</Button>
            <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-primary">Tournament matches</p><Badge variant="outline" className="capitalize">{event.sport.replaceAll("_", " ")}</Badge></div>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Matches</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Create the draw, assign courts and times, and maintain the event schedule. Use Scoring to record results.</p>
          </div>
          <Button variant="outline" onClick={() => navigate(`/organizer/events/${event.id}/tournament`)}>Tournament setup</Button>
        </div>
        <OrganizerEventMatches eventId={event.id} categories={event.categories} courts={courts} supportsTournament={supportsTournament} />
        {isLoadingCourts && <p className="text-center text-sm text-muted-foreground">Loading event courts…</p>}
      </div>
    </OrganizerDashboardLayout>
  );
};

export default OrganizerEventTournamentMatches;
