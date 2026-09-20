import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useState, useMemo } from "react";
import { CheckCircle2 } from "lucide-react";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import OrganizerMatchScoring from "@/components/OrganizerMatchScoring";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrganizerEventDashboard } from "@/hooks/useEvents";
import { useOrganizerMatches } from "@/hooks/useEvents";
import { eventSupportsTournament, isFreeEvent } from "@/data/sportConfig";
import type { OrganizerMatch } from "@/hooks/useEvents";

// For team matches with specific players picked, show "Rahul & Priya (Team A)".
function matchSideLabel(entry: OrganizerMatch["entryA"], players: OrganizerMatch["playersA"]): string {
  if (players && players.length > 0) {
    const names = players.map((player) => player.name).join(" & ");
    return entry.teamName ? `${names} (${entry.teamName})` : names;
  }
  return entry.displayName;
}

function winnerName(match: OrganizerMatch): string {
  if (!match.winner) return "—";
  return match.winner === "entry_a"
    ? matchSideLabel(match.entryA, match.playersA)
    : matchSideLabel(match.entryB, match.playersB);
}

function scoresSummary(match: OrganizerMatch): string {
  if (!match.games.length) return "No scores recorded";
  return match.games
    .map((g) => `${g.scoreA}–${g.scoreB}`)
    .join(", ");
}

const OrganizerEventTournamentScoring = () => {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const { data: dashboard, isLoading, isError } = useOrganizerEventDashboard(eventId);
  const { data: matches = [] } = useOrganizerMatches(eventId);
  const supportsTournament = eventSupportsTournament(dashboard?.event.sport, dashboard?.event.categories);

  const completedMatches = useMemo(
    () => matches.filter((m) => m.status === "completed"),
    [matches],
  );

  if (isLoading) {
    return <OrganizerDashboardLayout eventId={eventId}><div className="px-4 py-20 text-center text-sm text-muted-foreground">Loading scoring workspace…</div></OrganizerDashboardLayout>;
  }

  if (isError || !dashboard?.event) {
    return <OrganizerDashboardLayout eventId={eventId}><div className="mx-auto max-w-3xl px-4 py-20 text-center"><p className="text-sm text-muted-foreground">Could not load this event.</p><Button className="mt-4" variant="outline" onClick={() => navigate("/organizer")}>Back to events</Button></div></OrganizerDashboardLayout>;
  }

  const event = dashboard.event;
  const freeEventLocked = Boolean(event) && isFreeEvent(event);
  if (freeEventLocked) {
    return (
      <OrganizerDashboardLayout eventId={event.id}>
        <div className="mx-auto max-w-3xl px-4 py-20">
          <Card>
            <CardHeader>
              <CardTitle>Scoring tools locked</CardTitle>
              <CardDescription>Scoring and results are available for paid events. Free events get only basic registration and participant management.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Upgrade to a paid event to record match scores, publish results, and track standings.
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
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Button variant="ghost" className="mb-3 -ml-3 gap-2 px-3 text-muted-foreground" onClick={() => navigate(`/organizer/events/${event.id}`)}>Back to event</Button>
            <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-primary">Tournament operations</p><Badge variant="outline" className="capitalize">{event.sport.replaceAll("_", " ")}</Badge></div>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Tournament scoring</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Record match scores and review completed results.</p>
          </div>
          <Button variant="outline" onClick={() => navigate(`/organizer/events/${event.id}/tournament/matches`)}>View matches</Button>
        </div>
        
        <Tabs defaultValue="scoring" className="space-y-4">
          <TabsList>
            <TabsTrigger value="scoring">Match scoring</TabsTrigger>
            <TabsTrigger value="completed">Completed matches</TabsTrigger>
          </TabsList>
          <TabsContent value="scoring" className="space-y-4">
            <OrganizerMatchScoring eventId={event.id} showCompletedSection={false} />
          </TabsContent>
          <TabsContent value="completed" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Completed matches</CardTitle>
                <CardDescription>Results recorded for this tournament. See all finished matches with scores and winners.</CardDescription>
              </CardHeader>
              <CardContent>
                {completedMatches.length === 0 ? (
                  <div className="py-12 text-center">
                    <CheckCircle2 className="mx-auto h-12 w-12 text-muted-foreground" />
                    <p className="mt-4 text-sm text-muted-foreground">No completed matches yet.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {completedMatches.map((match) => (
                      <div key={match.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {match.roundLabel} · {match.category.name}
                            {match.matchType ? ` · ${match.matchType === "singles" ? "Singles" : "Doubles"}` : ""}
                          </p>
                          <p className="mt-0.5 text-sm font-medium">{matchSideLabel(match.entryA, match.playersA)} vs {matchSideLabel(match.entryB, match.playersB)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Scores</p>
                          <p className="mt-0.5 text-sm font-mono">{scoresSummary(match)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                          <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{winnerName(match)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </OrganizerDashboardLayout>
  );
};

export default OrganizerEventTournamentScoring;
