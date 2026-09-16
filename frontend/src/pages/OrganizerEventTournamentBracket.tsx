import { useMemo, useState } from "react";
import { ArrowRight, GitBranch, RefreshCw } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OrganizerMatch } from "@/hooks/useEvents";
import { useOrganizerEventDashboard, useOrganizerMatches } from "@/hooks/useEvents";
import { eventSupportsTournament } from "@/data/sportConfig";

const ROUND_ORDER = ["round of 128", "round of 64", "round of 32", "round of 16", "quarterfinal", "semifinal", "final"];

function roundTitle(label: string) {
  return label.replace(/\s+\d+\s*$/, "").trim() || label;
}

function roundRank(label: string) {
  const normalized = label.toLowerCase();
  const exactIndex = ROUND_ORDER.findIndex((known) => normalized.includes(known));
  return exactIndex === -1 ? ROUND_ORDER.length : exactIndex;
}

function formatDateTime(value: string | null) {
  if (!value) return "Time not set";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function winnerId(match: OrganizerMatch) {
  if (match.winner === "entry_a") return match.entryA.registrationId;
  if (match.winner === "entry_b") return match.entryB.registrationId;
  return null;
}

const OrganizerEventTournamentBracket = () => {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const { data: dashboard, isLoading: isLoadingEvent, isError: isEventError } = useOrganizerEventDashboard(eventId);
  const event = dashboard?.event;
  const supportsTournament = eventSupportsTournament(event?.sport, event?.categories);
  const { data: matches = [], isLoading: isLoadingMatches, isError: isMatchesError, refetch, isFetching } = useOrganizerMatches(eventId);
  const [categoryId, setCategoryId] = useState("all");

  const categories = useMemo(() => [...new Map(matches.map((match) => [match.category.id, match.category])).values()], [matches]);
  const filteredMatches = useMemo(() => categoryId === "all" ? matches : matches.filter((match) => match.category.id === categoryId), [categoryId, matches]);
  const roundGroups = useMemo(() => {
    const grouped = new Map<string, { key: string; name: string; categoryName: string; position: number | null; legacyRank: number; matches: OrganizerMatch[] }>();
    filteredMatches.forEach((match) => {
      const isConfiguredRound = Boolean(match.roundId && match.round);
      const name = isConfiguredRound ? match.round?.name ?? match.roundLabel : roundTitle(match.roundLabel);
      const key = isConfiguredRound ? `${match.category.id}:${match.roundId}` : `${match.category.id}:legacy:${name}`;
      const existing = grouped.get(key);
      grouped.set(key, {
        key,
        name,
        categoryName: match.category.name,
        position: isConfiguredRound ? match.round?.position ?? null : null,
        legacyRank: isConfiguredRound ? ROUND_ORDER.length : roundRank(name),
        matches: [...(existing?.matches ?? []), match],
      });
    });
    return [...grouped.values()]
      .map((round) => ({ ...round, matches: round.matches.sort((a, b) => {
        const left = a.scheduledTime ? new Date(a.scheduledTime).getTime() : Number.MAX_SAFE_INTEGER;
        const right = b.scheduledTime ? new Date(b.scheduledTime).getTime() : Number.MAX_SAFE_INTEGER;
        return left - right || a.createdAt.localeCompare(b.createdAt);
      }) }))
      .sort((a, b) => {
        if (categoryId === "all" && a.categoryName !== b.categoryName) return a.categoryName.localeCompare(b.categoryName);
        return (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER)
          || a.legacyRank - b.legacyRank
          || a.name.localeCompare(b.name);
      });
  }, [categoryId, filteredMatches]);
  const completedCount = filteredMatches.filter((match) => match.status === "completed").length;
  const winnersCount = filteredMatches.filter((match) => match.winner).length;

  if (isLoadingEvent) {
    return <OrganizerDashboardLayout eventId={eventId}><div className="px-4 py-20 text-center text-sm text-muted-foreground">Loading bracket…</div></OrganizerDashboardLayout>;
  }

  if (isEventError || !event) {
    return <OrganizerDashboardLayout eventId={eventId}><div className="mx-auto max-w-3xl px-4 py-20 text-center"><p className="text-sm text-muted-foreground">Could not load this event.</p><Button className="mt-4" variant="outline" onClick={() => navigate("/organizer")}>Back to events</Button></div></OrganizerDashboardLayout>;
  }

  if (!supportsTournament) {
    return <OrganizerDashboardLayout eventId={event.id}><div className="mx-auto max-w-3xl px-4 py-20"><Card><CardHeader><CardTitle>Tournament tools unavailable</CardTitle><CardDescription>Bracket views are currently unavailable for this sport.</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => navigate(`/organizer/events/${event.id}`)}>Back to event</Button></CardContent></Card></div></OrganizerDashboardLayout>;
  }

  return (
    <OrganizerDashboardLayout eventId={event.id}>
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Button variant="ghost" className="mb-3 -ml-3 gap-2 px-3 text-muted-foreground" onClick={() => navigate(`/organizer/events/${event.id}`)}>Back to event</Button>
            <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-primary">Tournament bracket</p><Badge variant="outline" className="capitalize">{event.sport.replaceAll("_", " ")}</Badge></div>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Bracket map</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Follow entries across rounds, see recorded winners, and check the court and scheduled time for every match.</p>
          </div>
          <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => navigate(`/organizer/events/${event.id}/tournament/matches`)}>Schedule matches</Button><Button variant="outline" onClick={() => void refetch()} disabled={isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />Refresh</Button></div>
        </div>

        <Card className="border-primary/20 bg-primary/5"><CardContent className="flex gap-3 p-4"><GitBranch className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div className="text-sm"><p className="font-semibold">How advancement is shown</p><p className="mt-1 text-muted-foreground">First-round positions are shown as slots because seed numbers are not stored yet. A winner is connected to a later round when that later match contains the same registration.</p></div></CardContent></Card>

        <div className="grid gap-3 sm:grid-cols-3"><Card><CardContent className="p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Matches</p><p className="mt-2 text-2xl font-black">{filteredMatches.length}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Completed</p><p className="mt-2 text-2xl font-black">{completedCount}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Winners recorded</p><p className="mt-2 text-2xl font-black">{winnersCount}</p></CardContent></Card></div>

        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><CardTitle>Bracket by round</CardTitle><CardDescription>Use the horizontal view to follow the draw from opening matches to the final.</CardDescription></div><div className="w-full sm:w-64"><label htmlFor="bracket-category" className="mb-1 block text-xs font-medium text-muted-foreground">Category</label><select id="bracket-category" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={categoryId} onChange={(current) => setCategoryId(current.target.value)}><option value="all">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div></CardHeader>
          <CardContent>
            {isLoadingMatches ? <p className="py-8 text-center text-sm text-muted-foreground">Loading bracket…</p> : isMatchesError ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Could not load the bracket.</div> : roundGroups.length === 0 ? <div className="rounded-lg border border-dashed p-10 text-center"><GitBranch className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 font-semibold">No matches to map yet</p><p className="mt-1 text-sm text-muted-foreground">Schedule matches first, then this view will map them by round.</p></div> : <div className="overflow-x-auto pb-3"><div className="flex min-w-max items-stretch gap-4">{roundGroups.map((round, roundIndex) => <div key={round.key} className="flex items-center gap-4"><div className="w-80 shrink-0"><div className="mb-3 flex items-center justify-between"><h2 className="font-bold">{categoryId === "all" ? `${round.categoryName} · ` : ""}{round.name}</h2><Badge variant="secondary">{round.matches.length}</Badge></div><div className="space-y-4">{round.matches.map((match, matchIndex) => { const winner = winnerId(match); const nextRound = winner ? roundGroups.slice(roundIndex + 1).find((candidate) => candidate.matches.some((nextMatch) => nextMatch.entryA.registrationId === winner || nextMatch.entryB.registrationId === winner)) : undefined; const firstRoundSlot = roundIndex === 0 ? `Slot ${matchIndex * 2 + 1} / ${matchIndex * 2 + 2}` : `Match ${matchIndex + 1}`; return <div key={match.id} className="rounded-xl border bg-background p-4 shadow-sm"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{firstRoundSlot}</p><Badge variant={match.status === "completed" ? "default" : match.status === "in_progress" ? "outline" : "secondary"}>{match.status.replaceAll("_", " ")}</Badge></div><div className="mt-3 space-y-1.5"><div className={`flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm ${match.winner === "entry_a" ? "bg-primary/10 font-bold text-primary" : ""}`}><span className="min-w-0 truncate">{match.entryA.displayName}</span><span className="shrink-0 text-xs font-semibold">{match.games.find((game) => game.gameNumber === 1)?.scoreA ?? "—"}</span></div><div className={`flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm ${match.winner === "entry_b" ? "bg-primary/10 font-bold text-primary" : ""}`}><span className="min-w-0 truncate">{match.entryB.displayName}</span><span className="shrink-0 text-xs font-semibold">{match.games.find((game) => game.gameNumber === 1)?.scoreB ?? "—"}</span></div></div><div className="mt-3 border-t pt-3 text-xs text-muted-foreground"><p>{match.court.name} · {formatDateTime(match.scheduledTime)}</p>{match.games.length > 0 && <p className="mt-1">{match.games.map((game) => `${game.scoreA}–${game.scoreB}`).join(" · ")}</p>}{winner && <p className="mt-2 font-semibold text-primary">{nextRound ? `Winner advances to ${nextRound.name}` : "Winner recorded"}</p>}</div></div>; })}</div></div>{roundIndex < roundGroups.length - 1 && <ArrowRight className="mt-36 h-5 w-5 shrink-0 text-muted-foreground" />}</div>)}</div></div>}
          </CardContent>
        </Card>
      </div>
    </OrganizerDashboardLayout>
  );
};

export default OrganizerEventTournamentBracket;
