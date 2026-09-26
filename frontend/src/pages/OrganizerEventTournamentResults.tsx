import { useMemo, useState } from "react";
import { CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Copy, ExternalLink, Medal, RefreshCw, Trophy } from "lucide-react";
import { Navigate, useNavigate, useParams } from "react-router-dom";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import TeamStandingsCard from "@/components/TeamStandingsCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useOrganizerEventDashboard, useOrganizerMatches } from "@/hooks/useEvents";
import { eventSupportsTournament, isFreeEvent } from "@/data/sportConfig";
import { buildResultsUrl } from "@/lib/eventCommunication";
import { apiRequest } from "@/lib/api";
import { toast } from "sonner";

function formatDateTime(value: string | null) {
  if (!value) return "Time not set";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

const OrganizerEventTournamentResults = () => {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const { data: dashboard, isLoading: isLoadingEvent, isError: isEventError } = useOrganizerEventDashboard(eventId);
  const event = dashboard?.event;
  const supportsTournament = eventSupportsTournament(event?.sport, event?.categories);
  const { data: matches = [], isLoading: isLoadingMatches, isError: isMatchesError, refetch, isFetching } = useOrganizerMatches(eventId);
  const freeEventLocked = Boolean(event) && isFreeEvent(event);
  const [categoryId, setCategoryId] = useState("all");
  const [resultsCopied, setResultsCopied] = useState(false);
  const [page, setPage] = useState(1);
  const [approvalMatchId, setApprovalMatchId] = useState<string | null>(null);

  const completedMatches = useMemo(() => matches.filter((match) => match.status === "completed"), [matches]);
  const categories = useMemo(() => [...new Map(completedMatches.map((match) => [match.category.id, match.category])).values()], [completedMatches]);
  const visibleMatches = useMemo(() => categoryId === "all" ? completedMatches : completedMatches.filter((match) => match.category.id === categoryId), [categoryId, completedMatches]);
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(visibleMatches.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageOffset = (safePage - 1) * pageSize;
  const renderedMatches = visibleMatches.slice(pageOffset, pageOffset + pageSize);
  const gamesRecorded = visibleMatches.reduce((total, match) => total + match.games.length, 0);
  const roundsRecorded = new Set(visibleMatches.map((match) => match.roundLabel)).size;

  if (isLoadingEvent) {
    return <OrganizerDashboardLayout eventId={eventId}><div className="px-4 py-20 text-center text-sm text-muted-foreground">Loading tournament results…</div></OrganizerDashboardLayout>;
  }

  if (isEventError || !event) {
    return <OrganizerDashboardLayout eventId={eventId}><div className="mx-auto max-w-3xl px-4 py-20 text-center"><p className="text-sm text-muted-foreground">Could not load this event.</p><Button className="mt-4" variant="outline" onClick={() => navigate("/organizer")}>Back to events</Button></div></OrganizerDashboardLayout>;
  }

  if (freeEventLocked) {
    return (
      <OrganizerDashboardLayout eventId={event.id}>
        <div className="mx-auto max-w-3xl px-4 py-20">
          <Card>
            <CardHeader>
              <CardTitle>Results tools locked</CardTitle>
              <CardDescription>Results and public shareable links are available for paid events. Free events get only basic registration and participant management.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Upgrade to a paid event to publish public results and get event insights.
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
    return <OrganizerDashboardLayout eventId={event.id}><div className="mx-auto max-w-3xl px-4 py-20"><Card><CardHeader><CardTitle>Tournament tools unavailable</CardTitle><CardDescription>Tournament results are currently unavailable for this sport.</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => navigate(`/organizer/events/${event.id}`)}>Back to event</Button></CardContent></Card></div></OrganizerDashboardLayout>;
  }

  const resultsUrl = buildResultsUrl(event.id);
  const copyResultsLink = async () => {
    try {
      await navigator.clipboard.writeText(resultsUrl);
      setResultsCopied(true);
      toast.success("Public results link copied.");
      window.setTimeout(() => setResultsCopied(false), 1800);
    } catch {
      toast.error("Could not copy automatically. Select the URL and copy it manually.");
    }
  };

  const setResultApproval = async (matchId: string, approved: boolean) => {
    setApprovalMatchId(matchId);
    try {
      await apiRequest(`/organizer/events/${event.id}/matches/${matchId}/result-approval`, {
        method: "PUT",
        body: JSON.stringify({ approved }),
      });
      await refetch();
      toast.success(approved ? "Result approved and published." : "Result removed from the public board.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update result approval.");
    } finally {
      setApprovalMatchId(null);
    }
  };

  return (
    <OrganizerDashboardLayout eventId={event.id}>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6 lg:p-7">
          <div>
            <Button variant="ghost" className="mb-4 -ml-3 gap-2 px-3 text-muted-foreground" onClick={() => navigate(`/organizer/events/${event.id}`)}>Back to event</Button>
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><Badge>Results desk</Badge><Badge variant="outline" className="capitalize">{event.sport.replaceAll("_", " ")}</Badge></div>
                <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">The scoreboard, ready to share.</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Review every completed match, confirm the winners, and keep a clean record of the tournament as it moves round by round.</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2"><Button variant="outline" onClick={() => navigate(`/organizer/events/${event.id}/tournament/scoring`)}>Open scoring</Button><Button variant="outline" onClick={() => void refetch()} disabled={isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />Refresh</Button></div>
            </div>
            <div className="mt-6 grid gap-4 border-t pt-5 sm:grid-cols-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Completed matches</p><p className="mt-1 text-3xl font-black">{visibleMatches.length}</p></div><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Rounds represented</p><p className="mt-1 text-3xl font-black">{roundsRecorded}</p></div><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Games recorded</p><p className="mt-1 text-3xl font-black">{gamesRecorded}</p></div></div>
          </div>
        </section>

        <Card className="border-primary/20 bg-primary/[0.03]">
          <CardContent className="p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><ExternalLink className="h-4 w-4 text-primary" /><p className="text-sm font-bold">Share live results</p><Badge variant="outline" className="text-[10px] uppercase tracking-wide">Public link</Badge></div>
                <p className="mt-1 text-sm text-muted-foreground">Send this link to participants and spectators. Only completed results you approve are published.</p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto lg:max-w-[620px] lg:flex-1 lg:justify-end">
                <Input readOnly value={resultsUrl} aria-label="Public live results URL" className="min-w-0 bg-background font-mono text-xs" onFocus={(current) => current.currentTarget.select()} />
                <Button type="button" className="shrink-0 gap-2" onClick={() => void copyResultsLink()}>{resultsCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{resultsCopied ? "Copied" : "Copy link"}</Button>
                <Button asChild type="button" variant="outline" className="shrink-0 gap-2"><a href={resultsUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />Open board</a></Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Public result approvals</CardTitle>
            <CardDescription>Completed matches stay private until you review and approve them.</CardDescription>
          </CardHeader>
          <CardContent>
            {completedMatches.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No completed matches are waiting for review.</p>
            ) : (
              <div className="space-y-3">
                {completedMatches.map((match) => (
                  <div key={match.id} className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{match.category.name} · {match.roundLabel}</p>
                        <Badge variant={match.resultApproved ? "default" : "secondary"}>{match.resultApproved ? "Published" : "Private"}</Badge>
                      </div>
                      <p className="mt-1 truncate text-sm text-muted-foreground">{match.entryA.displayName} vs {match.entryB.displayName} · {match.court.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{match.games.map((game) => `${game.scoreA}–${game.scoreB}`).join(" · ") || "No score recorded"}</p>
                    </div>
                    <Button type="button" variant={match.resultApproved ? "outline" : "default"} disabled={approvalMatchId === match.id} onClick={() => void setResultApproval(match.id, !match.resultApproved)}>
                      {approvalMatchId === match.id ? "Saving…" : match.resultApproved ? "Remove from public" : "Approve & publish"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <TeamStandingsCard eventId={event.id} categories={event.categories} />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">Tournament archive</p><h2 className="mt-1 text-2xl font-black tracking-tight">Find a result by category</h2></div><p className="text-sm text-muted-foreground">{visibleMatches.length === 1 ? "1 completed match" : `${visibleMatches.length} completed matches`} shown</p></div>
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Result categories"><button type="button" role="tab" aria-selected={categoryId === "all"} onClick={() => { setCategoryId("all"); setPage(1); }} className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-bold transition-colors ${categoryId === "all" ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>All results<Badge variant={categoryId === "all" ? "secondary" : "outline"} className="px-1.5">{completedMatches.length}</Badge></button>{categories.map((category) => { const count = completedMatches.filter((match) => match.category.id === category.id).length; return <button key={category.id} type="button" role="tab" aria-selected={categoryId === category.id} onClick={() => { setCategoryId(category.id); setPage(1); }} className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-bold transition-colors ${categoryId === category.id ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>{category.name}<Badge variant={categoryId === category.id ? "secondary" : "outline"} className="px-1.5">{count}</Badge></button>; })}</div>

        <Card className="overflow-hidden shadow-sm"><CardHeader className="border-b bg-card px-5 py-5 sm:px-7"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle>Completed results</CardTitle><CardDescription className="mt-1">Review each completed score, then approve it for the public results board.</CardDescription></div><div className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-green-600" /> Approved results are public</div></div></CardHeader><CardContent className="p-5 sm:p-7">
          {isLoadingMatches ? <div className="space-y-3"><div className="h-24 animate-pulse rounded-2xl bg-muted" /><div className="h-24 animate-pulse rounded-2xl bg-muted" /></div> : isMatchesError ? <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">Could not load tournament results. Try refreshing the results desk.</div> : visibleMatches.length === 0 ? <div className="rounded-2xl border border-dashed p-10 text-center"><Trophy className="mx-auto h-10 w-10 text-muted-foreground" /><p className="mt-4 font-semibold">No completed results yet</p><p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">Complete matches from the Live scoring page and their winners and game scores will appear here automatically.</p><Button className="mt-5" variant="outline" onClick={() => navigate(`/organizer/events/${event.id}/tournament/scoring`)}>Open live scoring</Button></div> : <div className="space-y-8">{[...new Set(renderedMatches.map((match) => match.category.id))].map((currentCategoryId) => { const category = categories.find((item) => item.id === currentCategoryId); const categoryMatches = renderedMatches.filter((match) => match.category.id === currentCategoryId); const rounds = [...new Set(categoryMatches.map((match) => match.roundLabel))]; return <section key={currentCategoryId} className="space-y-4"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Medal className="h-5 w-5" /></div><div><h2 className="font-black">{category?.name}</h2><p className="text-sm text-muted-foreground">{categoryMatches.length} {categoryMatches.length === 1 ? "completed match on this page" : "completed matches on this page"}</p></div></div>{rounds.map((round) => <div key={round} className="space-y-3"><div className="flex items-center gap-2"><span className="h-px flex-1 bg-border" /><Badge variant="outline" className="bg-background px-3">{round}</Badge><span className="h-px flex-1 bg-border" /></div><div className="space-y-3">{categoryMatches.filter((match) => match.roundLabel === round).map((match) => { const winnerName = match.winner === "entry_a" ? match.entryA.displayName : match.winner === "entry_b" ? match.entryB.displayName : "Winner not set"; return <article key={match.id} className="overflow-hidden rounded-2xl border bg-background shadow-sm"><div className="flex flex-col gap-3 border-b bg-muted/25 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"><div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />{match.court.name}</span><span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{formatDateTime(match.scheduledTime)}</span></div><Badge className="w-fit gap-1 bg-green-600 text-white"><Trophy className="h-3 w-3" />{winnerName}</Badge></div><div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[1fr_auto] lg:items-center"><div className="space-y-2"><div className={`flex items-center justify-between gap-4 rounded-xl px-3 py-2.5 ${match.winner === "entry_a" ? "bg-primary/10" : "bg-muted/40"}`}><span className={`min-w-0 truncate font-bold ${match.winner === "entry_a" ? "text-primary" : ""}`}>{match.entryA.displayName}</span><span className={`text-xl font-black ${match.winner === "entry_a" ? "text-primary" : "text-muted-foreground"}`}>{match.games.reduce((total, game) => total + (game.scoreA > game.scoreB ? 1 : 0), 0)}</span></div><div className={`flex items-center justify-between gap-4 rounded-xl px-3 py-2.5 ${match.winner === "entry_b" ? "bg-primary/10" : "bg-muted/40"}`}><span className={`min-w-0 truncate font-bold ${match.winner === "entry_b" ? "text-primary" : ""}`}>{match.entryB.displayName}</span><span className={`text-xl font-black ${match.winner === "entry_b" ? "text-primary" : "text-muted-foreground"}`}>{match.games.reduce((total, game) => total + (game.scoreB > game.scoreA ? 1 : 0), 0)}</span></div></div>{match.games.length > 0 && <div className="flex flex-wrap gap-2 lg:max-w-sm lg:justify-end">{match.games.map((game) => <div key={game.gameNumber} className="min-w-[76px] rounded-xl border bg-card px-3 py-2 text-center"><p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Game {game.gameNumber}</p><p className="mt-1 text-lg font-black tracking-tight">{game.scoreA}<span className="mx-1 text-muted-foreground">–</span>{game.scoreB}</p></div>)}</div>}</div></article>; })}</div></div>)}</section>; })}</div>}
          {visibleMatches.length > pageSize && <div className="mt-6 flex items-center justify-between gap-3 border-t pt-4"><p className="text-sm text-muted-foreground">Showing {pageOffset + 1}–{Math.min(pageOffset + pageSize, visibleMatches.length)} of {visibleMatches.length}</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button variant="outline" size="sm" disabled={safePage >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>}
        </CardContent></Card>
      </div>
    </OrganizerDashboardLayout>
  );
};

export default OrganizerEventTournamentResults;
