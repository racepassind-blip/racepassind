import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Mail, MessageSquare, RefreshCw } from "lucide-react";

import { EventCommunicationPanel } from "@/components/EventCommunicationPanel";
import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOrganizerEventOptions } from "@/hooks/useEvents";
import { useFreeEventLock } from "@/hooks/useFreeEventLock";

const OrganizerEventCommunications = () => {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const { data, isLoading, isError, refetch, isFetching, locked } = useFreeEventLock(eventId);
  const { data: organizerEvents = [] } = useOrganizerEventOptions();

  if (isLoading || locked) {
    return <OrganizerDashboardLayout eventId={eventId}><div className="px-4 py-20 text-center text-sm text-muted-foreground">Loading event communications…</div></OrganizerDashboardLayout>;
  }

  if (isError || !data?.event) {
    return <OrganizerDashboardLayout eventId={eventId}><div className="mx-auto max-w-3xl px-4 py-20 text-center"><p className="text-sm text-muted-foreground">Could not load communications for this event.</p><Button className="mt-4" variant="outline" onClick={() => navigate("/organizer")}>Back to events</Button></div></OrganizerDashboardLayout>;
  }

  const event = data.event;
  const eventOptions = organizerEvents.length > 0 ? organizerEvents : [event];

  return (
    <OrganizerDashboardLayout eventId={event.id}>
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Button variant="ghost" className="mb-3 -ml-3 gap-2 px-3 text-muted-foreground" onClick={() => navigate(`/organizer/events/${event.id}`)}><ArrowLeft className="h-4 w-4" /> Back to event</Button>
            <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-primary">Event communications</p><Badge variant={event.registrationStatus === "open" ? "outline" : "secondary"}>{event.registrationStatus === "open" ? "Registration open" : "Registration closed"}</Badge></div>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Share {event.name}</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Use the event-specific registration link and ready-made WhatsApp message whenever you need to invite participants.</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={event.id} onValueChange={(value) => navigate(`/organizer/events/${value}/communications`)}>
              <SelectTrigger className="w-full bg-card sm:w-[280px]" aria-label="Select event"><SelectValue placeholder="Select event" /></SelectTrigger>
              <SelectContent>{eventOptions.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => void refetch()} disabled={isFetching} aria-label="Refresh communications"><RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /></Button>
          </div>
        </div>

        {event.isArchived && <Card className="border-amber-300 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/20"><CardHeader><CardTitle className="text-amber-950 dark:text-amber-100">This event is archived</CardTitle><CardDescription className="text-amber-900/80 dark:text-amber-100/80">The link and message are preserved for your records, but participants cannot register until the event is restored.</CardDescription></CardHeader></Card>}
        <EventCommunicationPanel event={event} />
        <section>
          <h2 className="mb-2 text-lg font-semibold text-card-foreground">Bulk email sender</h2>
          <div className="rounded-xl border border-dashed bg-muted p-8 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><Mail className="h-6 w-6" /></div>
            <h3 className="text-lg font-semibold">Coming soon</h3>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">Bulk email sender will let you communicate with all registrants of this event at once.</p>
            <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
              <li className="flex items-center gap-2"><div className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Send email to all registrants with email addresses</li>
              <li className="flex items-center gap-2"><div className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Include event updates, schedule changes, and important announcements</li>
              <li className="flex items-center gap-2"><div className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Track sent, failed, and pending emails per event</li>
            </ul>
          </div>
        </section>
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex items-start gap-3 p-5"><MessageSquare className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div><p className="font-semibold">Keep this page bookmarked for {event.name}</p><p className="mt-1 text-sm text-muted-foreground">The link and message are generated from this event, so switching events in the selector always changes the shared details.</p></div></CardContent>
        </Card>
      </div>
    </OrganizerDashboardLayout>
  );
};

export default OrganizerEventCommunications;
