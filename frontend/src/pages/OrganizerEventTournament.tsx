import { ArrowDown, ArrowRight, ArrowUp, CalendarDays, CheckCircle2, ExternalLink, GitBranch, Gauge, ListOrdered, Medal, Pencil, Plus, RefreshCw, Swords, Trash2, Trophy, Users } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import OrganizerScoringConfig from "@/components/OrganizerScoringConfig";
import TeamScoringConfig from "@/components/TeamScoringConfig";
import TournamentSetupGuide from "@/components/TournamentSetupGuide";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOrganizerCourts, useOrganizerEventDashboard, useOrganizerTournamentRounds } from "@/hooks/useEvents";
import type { OrganizerTournamentRound } from "@/hooks/useEvents";
import { getSportConfig, eventSupportsTournament, isFreeEvent } from "@/data/sportConfig";
import { apiRequest } from "@/lib/api";

const emptyRounds: OrganizerTournamentRound[] = [];

const OrganizerEventTournament = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { eventId } = useParams();
  const { data: dashboard, isLoading: isLoadingEvent, isError: isEventError } = useOrganizerEventDashboard(eventId);
  const eventSportConfig = getSportConfig(dashboard?.event.sport);
  const supportsTournament = eventSupportsTournament(dashboard?.event.sport, dashboard?.event.categories);
  const freeEventLocked = Boolean(dashboard?.event) && isFreeEvent(dashboard?.event);

  useEffect(() => {
    if (eventId && freeEventLocked) {
      toast.error("Tournament tools are locked for free events. Upgrade to a paid event to unlock, or contact SportPass India for custom pricing.");
      navigate(`/organizer/events/${eventId}`, { replace: true });
    }
  }, [eventId, freeEventLocked, navigate]);
  const { data: courts = [], isLoading: isLoadingCourts, isError: isCourtsError, refetch, isFetching } = useOrganizerCourts(eventId, supportsTournament);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [roundCategoryId, setRoundCategoryId] = useState("");
  const [roundDrafts, setRoundDrafts] = useState<Array<Pick<OrganizerTournamentRound, "id" | "name">>>([]);
  const [isSavingRounds, setIsSavingRounds] = useState(false);
  const [tournamentFormat, setTournamentFormat] = useState<"league" | "knockout">("knockout");
  const [isSavingFormat, setIsSavingFormat] = useState(false);
  const { data: configuredRoundsData, isLoading: isLoadingRounds, isError: isRoundsError } = useOrganizerTournamentRounds(eventId, roundCategoryId || undefined, supportsTournament);
  const configuredRounds = configuredRoundsData ?? emptyRounds;

  useEffect(() => {
    if (!roundCategoryId && dashboard?.event.categories[0]) setRoundCategoryId(dashboard.event.categories[0].id);
  }, [dashboard?.event.categories, roundCategoryId]);

  useEffect(() => {
    setRoundDrafts(configuredRounds.map((round) => ({ id: round.id, name: round.name })));
  }, [configuredRounds]);

  useEffect(() => {
    const configuredFormat = dashboard?.event.sportConfig?.tournament_format;
    setTournamentFormat(configuredFormat === "league" ? "league" : "knockout");
  }, [dashboard?.event.sportConfig?.tournament_format]);

  const saveTournamentFormat = async () => {
    if (!eventId) return;
    setIsSavingFormat(true);
    try {
      await apiRequest(`/organizer/events/${eventId}/tournament-format`, {
        method: "PUT",
        body: JSON.stringify({ tournament_format: tournamentFormat }),
      });
      await queryClient.invalidateQueries({ queryKey: ["organizer-event-dashboard", eventId] });
      await queryClient.invalidateQueries({ queryKey: ["organizer-matches", eventId] });
      toast.success("Tournament format saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the tournament format.");
    } finally {
      setIsSavingFormat(false);
    }
  };

  const addRound = () => {
    setRoundDrafts((current) => [...current, { id: `new-${Date.now()}-${current.length}`, name: "" }]);
  };

  const updateRoundName = (index: number, name: string) => {
    setRoundDrafts((current) => current.map((round, roundIndex) => roundIndex === index ? { ...round, name } : round));
  };

  const moveRound = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= roundDrafts.length) return;
    setRoundDrafts((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removeRound = (index: number) => {
    setRoundDrafts((current) => current.filter((_, roundIndex) => roundIndex !== index));
  };

  const saveRounds = async () => {
    if (!eventId || !roundCategoryId) return;
    const names = roundDrafts.map((round) => round.name.trim());
    if (names.some((roundName) => !roundName)) {
      toast.error("Enter a name for every round.");
      return;
    }
    if (new Set(names.map((roundName) => roundName.toLocaleLowerCase())).size !== names.length) {
      toast.error("Round names must be unique within a category.");
      return;
    }
    setIsSavingRounds(true);
    try {
      const savedRounds = await apiRequest<OrganizerTournamentRound[]>(`/organizer/events/${eventId}/categories/${roundCategoryId}/tournament-rounds`, {
        method: "PUT",
        body: JSON.stringify({ rounds: roundDrafts.map((round, index) => ({ id: round.id.startsWith("new-") ? undefined : round.id, name: names[index] })) }),
      });
      setRoundDrafts(savedRounds.map((round) => ({ id: round.id, name: round.name })));
      await queryClient.invalidateQueries({ queryKey: ["organizer-tournament-rounds", eventId, roundCategoryId] });
      await queryClient.invalidateQueries({ queryKey: ["organizer-matches", eventId] });
      toast.success("Round order saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the round order.");
    } finally {
      setIsSavingRounds(false);
    }
  };

  const submitCourt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName || !eventId) return;
    setIsSaving(true);
    try {
      await apiRequest(editingId ? `/organizer/events/${eventId}/courts/${editingId}` : `/organizer/events/${eventId}/courts`, {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify({ name: normalizedName }),
      });
      await queryClient.invalidateQueries({ queryKey: ["organizer-courts", eventId] });
      toast.success(editingId ? "Court updated." : "Court added.");
      setName("");
      setEditingId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the court.");
    } finally {
      setIsSaving(false);
    }
  };

  const editCourt = (courtId: string, courtName: string) => {
    setEditingId(courtId);
    setName(courtName);
  };

  const deleteCourt = async (courtId: string, courtName: string) => {
    if (!eventId || !window.confirm(`Delete ${courtName}?`)) return;
    try {
      await apiRequest(`/organizer/events/${eventId}/courts/${courtId}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["organizer-courts", eventId] });
      if (editingId === courtId) {
        setEditingId(null);
        setName("");
      }
      toast.success("Court deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the court.");
    }
  };

  if (isLoadingEvent) {
    return <OrganizerDashboardLayout eventId={eventId}><div className="px-4 py-20 text-center text-sm text-muted-foreground">Loading tournament setup…</div></OrganizerDashboardLayout>;
  }

  if (isEventError || !dashboard?.event) {
    return <OrganizerDashboardLayout eventId={eventId}><div className="mx-auto max-w-3xl px-4 py-20 text-center"><p className="text-sm text-muted-foreground">Could not load this event.</p><Button className="mt-4" variant="outline" onClick={() => navigate("/organizer")}>Back to events</Button></div></OrganizerDashboardLayout>;
  }

  const event = dashboard.event;
  if (!supportsTournament) {
    return <OrganizerDashboardLayout eventId={event.id}><div className="mx-auto max-w-3xl px-4 py-20"><Card><CardHeader><CardTitle>Tournament tools unavailable</CardTitle><CardDescription>Tournament tools are currently unavailable for this sport.</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => navigate(`/organizer/events/${event.id}`)}>Back to event</Button></CardContent></Card></div></OrganizerDashboardLayout>;
  }

  const eventDateLabel = new Date(event.eventDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const selectedCategoryName = event.categories.find((category) => category.id === roundCategoryId)?.name;
  const setupSteps = [
    { label: "Categories", value: event.categories.length, complete: event.categories.length > 0, detail: event.categories.length === 1 ? "category ready" : "categories ready" },
    { label: "Rounds", value: roundDrafts.length, complete: roundDrafts.length > 0, detail: selectedCategoryName ? `for ${selectedCategoryName}` : "choose a category" },
    { label: "Courts", value: courts.length, complete: courts.length > 0, detail: courts.length === 1 ? "court available" : "courts available" },
  ];

  return (
    <OrganizerDashboardLayout eventId={event.id}>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-7">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <Button variant="ghost" className="mb-4 -ml-3 gap-2 px-3 text-muted-foreground" onClick={() => navigate(`/organizer/events/${event.id}`)}>Back to event</Button>
              <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-semibold text-primary">Tournament setup</span><Badge variant="outline" className="capitalize">{event.sport.replaceAll("_", " ")}</Badge></div>
              <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Build your tournament</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Set up the structure once, then move into matches and scoring when your event is ready to run.</p>
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground"><span className="flex items-center gap-2"><Trophy className="h-4 w-4 text-primary" />{event.name}</span><span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" />{eventDateLabel}</span></div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row lg:shrink-0"><TournamentSetupGuide eventId={event.id} initialFormat={tournamentFormat} /><Button asChild className="gap-2"><Link to={`/organizer/events/${event.id}/tournament/matches`}>Open matches <ArrowRight className="h-4 w-4" /></Link></Button><Button variant="outline" onClick={() => void refetch()} disabled={isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />Refresh data</Button></div>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-3" aria-label="Tournament setup progress">
          {setupSteps.map((step, index) => <Card key={step.label} className={step.complete ? "border-primary/25 bg-primary/[0.03]" : ""}><CardContent className="flex items-center gap-3 p-4"><div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${step.complete ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{step.complete ? <CheckCircle2 className="h-5 w-5" /> : <span className="text-sm font-bold">{index + 1}</span>}</div><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{step.label}</p><p className="mt-0.5 text-sm font-semibold">{step.value} <span className="font-normal text-muted-foreground">{step.detail}</span></p></div></CardContent></Card>)}
        </section>

        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-muted/20 pb-4"><CardTitle className="text-lg">Run your tournament</CardTitle><CardDescription>Jump directly to the tools you’ll use after setup.</CardDescription></CardHeader>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 sm:p-5">
            {[
              { label: "Matches", description: "Create and assign matches", icon: Trophy, to: `/organizer/events/${event.id}/tournament/matches` },
              { label: "Scoring", description: "Record live game scores", icon: Gauge, to: `/organizer/events/${event.id}/tournament/scoring` },
              { label: "Bracket", description: "See progression by round", icon: GitBranch, to: `/organizer/events/${event.id}/tournament/bracket` },
              { label: "Results", description: "Review completed matches", icon: Medal, to: `/organizer/events/${event.id}/tournament/results` },
            ].map((item) => <Button key={item.label} asChild variant="outline" className="h-auto justify-start gap-3 px-4 py-3 text-left"><Link to={item.to}><item.icon className="h-5 w-5 shrink-0 text-primary" /><span className="min-w-0 flex-1"><span className="block font-semibold">{item.label}</span><span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">{item.description}</span></span><ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /></Link></Button>)}
          </CardContent>
        </Card>

        <OrganizerScoringConfig eventId={event.id} enabled={eventSportConfig.result_type === "match_score"} sport={event.sport} />
        <TeamScoringConfig eventId={event.id} categories={event.categories} />

        {event.sport === "badminton" && <Card>
          <CardHeader className="border-b"><CardTitle>Tournament format</CardTitle><CardDescription>Choose how results affect the next round. This controls advancement and the player-status drawer when scheduling matches.</CardDescription></CardHeader>
          <CardContent className="space-y-4 p-4 sm:p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => setTournamentFormat("league")} className={`rounded-xl border p-4 text-left transition ${tournamentFormat === "league" ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/40"}`} aria-pressed={tournamentFormat === "league"}>
                <div className="flex items-center gap-2 font-semibold"><Users className="h-5 w-5 text-primary" />League</div>
                <p className="mt-2 text-sm text-muted-foreground">Everyone continues playing. A loss does not eliminate a player or team.</p>
              </button>
              <button type="button" onClick={() => setTournamentFormat("knockout")} className={`rounded-xl border p-4 text-left transition ${tournamentFormat === "knockout" ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/40"}`} aria-pressed={tournamentFormat === "knockout"}>
                <div className="flex items-center gap-2 font-semibold"><Swords className="h-5 w-5 text-primary" />Knockout</div>
                <p className="mt-2 text-sm text-muted-foreground">Winners advance. Previous-round losers are marked eliminated.</p>
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t pt-4"><Button type="button" onClick={() => void saveTournamentFormat()} disabled={isSavingFormat}>{isSavingFormat ? "Saving…" : "Save tournament format"}</Button><p className="text-xs text-muted-foreground">Changing the format does not delete existing matches or results.</p></div>
          </CardContent>
        </Card>}

        <Card>
          <CardHeader className="border-b"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle className="flex items-center gap-2"><ListOrdered className="h-5 w-5 text-primary" />Round order</CardTitle><CardDescription className="mt-2 max-w-3xl">Define the stages for each category. The first round appears on the left of the bracket and the final stage on the right.</CardDescription></div><Badge variant="secondary" className="w-fit">{roundDrafts.length} {roundDrafts.length === 1 ? "round" : "rounds"}</Badge></div></CardHeader>
          <CardContent className="space-y-5 p-4 sm:p-6">
            {event.categories.length === 0 ? <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">Add an event category before configuring tournament rounds.</div> : <>
              <div className="max-w-sm space-y-2"><Label htmlFor="round-category">Configure category</Label><select id="round-category" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20" value={roundCategoryId} onChange={(current) => setRoundCategoryId(current.target.value)}>{event.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
              {isLoadingRounds ? <p className="py-4 text-sm text-muted-foreground">Loading round order…</p> : isRoundsError ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Could not load rounds for this category.</div> : <>
                <div className="space-y-3">{roundDrafts.length === 0 ? <div className="rounded-xl border border-dashed bg-muted/10 p-6 text-sm text-muted-foreground"><p className="font-medium text-foreground">No rounds configured yet</p><p className="mt-1">Add stages such as Quarterfinals, Semifinals, and Final to build the bracket.</p></div> : roundDrafts.map((round, index) => <div key={round.id} className="flex flex-col gap-3 rounded-xl border bg-background p-3 sm:flex-row sm:items-end sm:p-4"><div className="flex items-center gap-3 sm:contents"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{index + 1}</div><div className="min-w-0 flex-1 space-y-2"><Label htmlFor={`round-name-${round.id}`}>Round {index + 1}</Label><Input id={`round-name-${round.id}`} value={round.name} onChange={(current) => updateRoundName(index, current.target.value)} placeholder={index === roundDrafts.length - 1 ? "Final" : "Quarterfinals"} maxLength={160} /></div></div><div className="flex justify-end gap-1 sm:shrink-0"><Button type="button" variant="ghost" size="icon" onClick={() => moveRound(index, -1)} disabled={index === 0} aria-label="Move round up"><ArrowUp className="h-4 w-4" /></Button><Button type="button" variant="ghost" size="icon" onClick={() => moveRound(index, 1)} disabled={index === roundDrafts.length - 1} aria-label="Move round down"><ArrowDown className="h-4 w-4" /></Button><Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => removeRound(index)} aria-label="Remove round"><Trash2 className="h-4 w-4" /></Button></div></div>)}</div>
                <div className="flex flex-wrap gap-2 border-t pt-4"><Button type="button" variant="outline" onClick={addRound}><Plus className="mr-2 h-4 w-4" />Add round</Button><Button type="button" onClick={() => void saveRounds()} disabled={isSavingRounds}>{isSavingRounds ? "Saving…" : "Save round order"}</Button></div>
              </>}
            </>}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5 text-primary" />{editingId ? "Edit court" : "Add a court"}</CardTitle><CardDescription>Use a clear name such as Court 1 or Centre Court. Names must be unique within this event.</CardDescription></CardHeader>
            <CardContent><form onSubmit={submitCourt} className="space-y-4"><div className="space-y-2"><Label htmlFor="court-name">Court name</Label><Input id="court-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Court 1" maxLength={120} required /></div><div className="flex flex-wrap gap-2"><Button type="submit" disabled={isSaving || !name.trim()}><Plus className="mr-2 h-4 w-4" />{isSaving ? "Saving…" : editingId ? "Save changes" : "Add court"}</Button>{editingId && <Button type="button" variant="ghost" onClick={() => { setEditingId(null); setName(""); }}>Cancel</Button>}</div></form></CardContent>
          </Card>

          <Card>
            <CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>Event courts</CardTitle><CardDescription className="mt-1">{courts.length === 0 ? "No courts have been added yet." : `${courts.length} court${courts.length === 1 ? "" : "s"} available for matches.`}</CardDescription></div><Badge variant="secondary">{courts.length}</Badge></div></CardHeader>
            <CardContent>
              {isLoadingCourts ? <p className="py-6 text-center text-sm text-muted-foreground">Loading courts…</p> : isCourtsError ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Could not load courts. Try refreshing.</div> : courts.length === 0 ? <div className="rounded-xl border border-dashed bg-muted/10 p-6 text-center text-sm text-muted-foreground">Add the first court to make it available when creating matches.</div> : <div className="overflow-x-auto"><Table className="min-w-[460px]"><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Added</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{courts.map((court) => <TableRow key={court.id}><TableCell className="font-medium">{court.name}</TableCell><TableCell className="text-muted-foreground">{new Date(court.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</TableCell><TableCell><div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => editCourt(court.id, court.name)}><Pencil className="mr-2 h-4 w-4" />Edit</Button><Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => void deleteCourt(court.id, court.name)}><Trash2 className="mr-2 h-4 w-4" />Delete</Button></div></TableCell></TableRow>)}</TableBody></Table></div>}
            </CardContent>
          </Card>
        </div>
      </div>
    </OrganizerDashboardLayout>
  );
};

export default OrganizerEventTournament;
