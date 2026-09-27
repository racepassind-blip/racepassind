import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, Clock3, ChevronLeft, ChevronRight, ListChecks, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { OrganizerCourt, OrganizerEventCategory, OrganizerMatch, OrganizerMatchEntry } from "@/hooks/useEvents";
import { useOrganizerMatchEntries, useOrganizerMatches, useOrganizerTournamentRounds } from "@/hooks/useEvents";
import { apiRequest } from "@/lib/api";

interface OrganizerEventMatchesProps {
  eventId: string;
  categories: OrganizerEventCategory[];
  courts: OrganizerCourt[];
  supportsTournament: boolean;
  tournamentFormat?: "league" | "knockout" | "league_knockout";
}

const statusLabels: Record<OrganizerMatch["status"], string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
};

function entryMemberNames(entry: { participantNames?: string[]; participantName: string }) {
  const names = entry.participantNames && entry.participantNames.length > 0 ? entry.participantNames : [entry.participantName];
  return names.join(" / ");
}

// For team matches with specific players picked, show "Rahul & Priya (Team A)".
function matchSideLabel(entry: OrganizerMatch["entryA"], players: OrganizerMatch["playersA"]): string {
  if (players && players.length > 0) {
    const names = players.map((player) => player.name).join(" & ");
    return entry.teamName ? `${names} (${entry.teamName})` : names;
  }
  return entry.displayName;
}

function entryOptionLabel(entry: { displayName: string; participantName: string; participantNames?: string[]; teamName: string | null; registrationReference: string | null }) {
  // For teams: show only the team name in the Entry A/B dropdowns — specific members
  // are chosen in the player dropdowns below. For singles/doubles the displayName
  // already contains the member name(s), so keep it as-is.
  const group = entry.teamName ? entry.teamName : entry.displayName;
  return `${group}${entry.registrationReference ? ` (${entry.registrationReference})` : ""}`;
}

function inputDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

const OrganizerEventMatches = ({ eventId, categories, courts, supportsTournament, tournamentFormat = "knockout" }: OrganizerEventMatchesProps) => {
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [courtFilter, setCourtFilter] = useState("all");
  const [activeView, setActiveView] = useState<"matches" | "schedule">("matches");
  const { data: matches = [], isLoading: isLoadingMatches, isError: isMatchesError } = useOrganizerMatches(eventId);
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [entryAId, setEntryAId] = useState("");
  const [entryBId, setEntryBId] = useState("");
  const [entrySearch, setEntrySearch] = useState("");
  const [courtId, setCourtId] = useState(courts[0]?.id ?? "");
  const [roundId, setRoundId] = useState("");
  const [roundLabel, setRoundLabel] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [matchStatus, setMatchStatus] = useState<OrganizerMatch["status"]>("scheduled");
  const [winner, setWinner] = useState<"entry_a" | "entry_b" | "">("");
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const filteredMatches = matches.filter((match) => {
    const text = [match.entryA.displayName, match.entryB.displayName, match.roundLabel, match.category.name, ...(match.playersA ?? []).map((player) => player.name), ...(match.playersB ?? []).map((player) => player.name)].join(" ").toLowerCase();
    return text.includes(search.toLowerCase().trim()) && (courtFilter === "all" || match.court.id === courtFilter) && (statusFilter === "all" || (statusFilter === "unscheduled" ? !match.scheduledTime : match.status === statusFilter));
  }).sort((a, b) => (a.scheduledTime ? new Date(a.scheduledTime).getTime() : Infinity) - (b.scheduledTime ? new Date(b.scheduledTime).getTime() : Infinity));
  const pageCount = Math.max(1, Math.ceil(filteredMatches.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleMatches = filteredMatches.slice((safePage - 1) * pageSize, safePage * pageSize);
  // Team-mode only: match type + selected player ids per team.
  const [matchType, setMatchType] = useState<"" | "singles" | "doubles">("");
  const [playerAIds, setPlayerAIds] = useState<string[]>([]);
  const [playerBIds, setPlayerBIds] = useState<string[]>([]);
  const { data: entries = [], isLoading: isLoadingEntries, isError: isEntriesError } = useOrganizerMatchEntries(eventId, categoryId || undefined);
  const { data: rounds = [], isLoading: isLoadingRounds, isError: isRoundsError } = useOrganizerTournamentRounds(eventId, categoryId || undefined, supportsTournament);
  const hasConfiguredRounds = rounds.length > 0;
  const selectedRound = rounds.find((round) => round.id === roundId);
  const isKnockoutFormat = tournamentFormat === "knockout";
  const canAutoAdvance = Boolean(isKnockoutFormat && selectedRound && rounds.some((round) => round.position > selectedRound.position));

  // Team-mode helpers. For non-team categories these stay inert so existing flow is unchanged.
  const selectedCategory = categories.find((category) => category.id === categoryId);
  const isTeamCategory = selectedCategory?.entryType === "team";
  const entryA = entries.find((entry) => entry.registrationId === entryAId);
  const entryB = entries.find((entry) => entry.registrationId === entryBId);
  const searchableEntries = entries.filter((entry) => {
    const query = entrySearch.trim().toLowerCase();
    if (!query) return true;
    return [entry.displayName, entry.participantName, entry.teamName ?? "", entry.registrationReference ?? "", ...(entry.participantNames ?? [])].join(" ").toLowerCase().includes(query);
  });
  const requiredPlayers = matchType === "singles" ? 1 : matchType === "doubles" ? 2 : 0;
  const rosterA: OrganizerMatchEntry["members"] = entryA?.members ?? [];
  const rosterB: OrganizerMatchEntry["members"] = entryB?.members ?? [];

  const schedulePayload = {
    category_id: categoryId, court_id: courtId,
    entry_a_registration_id: entryAId, entry_b_registration_id: entryBId,
    round_label: selectedRound?.name ?? (roundLabel.trim() || "Match"),
    scheduled_time: scheduledTime ? new Date(scheduledTime).toISOString() : null,
    duration_minutes: durationMinutes,
    player_a_participant_ids: isTeamCategory ? playerAIds.filter(Boolean) : null,
    player_b_participant_ids: isTeamCategory ? playerBIds.filter(Boolean) : null,
  };
  const canCheckSchedule = Boolean(scheduledTime && categoryId && courtId && entryAId && entryBId && durationMinutes >= 1 && durationMinutes <= 1440);
  const scheduleCheck = useQuery({
    queryKey: ["match-conflicts", eventId, editingId, schedulePayload],
    queryFn: () => apiRequest<{ conflicts: string[] }>(`/organizer/events/${eventId}/matches/conflicts${editingId ? `?match_id=${editingId}` : ""}`, {
      method: "POST", body: JSON.stringify(schedulePayload),
    }),
    enabled: canCheckSchedule,
    retry: false,
  });
  const conflicts = canCheckSchedule ? scheduleCheck.data?.conflicts ?? [] : [];
  const scheduleBlocked = canCheckSchedule && (scheduleCheck.isPending || scheduleCheck.isFetching || scheduleCheck.isError || conflicts.length > 0);
  const roundName = selectedRound?.name ?? roundLabel.trim();
  const matchesInSelectedRound = roundName ? matches.filter((match) => {
    if (match.category.id !== categoryId) return false;
    return selectedRound
      ? match.roundId === selectedRound.id
      : !match.roundId && match.roundLabel.trim().toLocaleLowerCase() === roundName.toLocaleLowerCase();
  }) : [];
  const duplicateMatchup = entryAId && entryBId && roundName
    ? matchesInSelectedRound.find((match) => {
      if (match.id === editingId || match.category.id !== categoryId) return false;
      const sameEntries = (match.entryA.registrationId === entryAId && match.entryB.registrationId === entryBId)
        || (match.entryA.registrationId === entryBId && match.entryB.registrationId === entryAId);
      return sameEntries;
    })
    : undefined;
  const previousRound = selectedRound
    ? [...rounds].filter((round) => round.position < selectedRound.position).sort((a, b) => b.position - a.position)[0]
    : undefined;
  const previousRoundMatches = previousRound ? matches.filter((match) => match.category.id === categoryId && match.roundId === previousRound.id) : [];
  const earlierRoundIds = new Set(rounds.filter((round) => selectedRound && round.position < selectedRound.position).map((round) => round.id));
  const earlierMatches = matches.filter((match) => match.category.id === categoryId && match.roundId !== null && earlierRoundIds.has(match.roundId));
  const roundEntryStatuses = entries.map((entry) => {
    const entryMatches = matchesInSelectedRound.filter((match) =>
      match.entryA.registrationId === entry.registrationId || match.entryB.registrationId === entry.registrationId
    );
    const match = entryMatches.find((item) => item.status === "completed")
      ?? entryMatches.find((item) => item.status === "in_progress")
      ?? entryMatches.find((item) => Boolean(item.scheduledTime))
      ?? entryMatches[0];
    const earlierLoss = earlierMatches.find((item) => item.status === "completed" && (
      (item.entryA.registrationId === entry.registrationId && item.winner === "entry_b") ||
      (item.entryB.registrationId === entry.registrationId && item.winner === "entry_a")
    ));
    const previousMatch = (isKnockoutFormat ? earlierLoss : null) ?? previousRoundMatches.find((item) =>
      item.entryA.registrationId === entry.registrationId || item.entryB.registrationId === entry.registrationId
    ) ?? null;
    const entrySide = previousMatch?.entryA.registrationId === entry.registrationId ? "entry_a" : "entry_b";
    const wonPrevious = Boolean(previousMatch?.status === "completed" && previousMatch.winner === entrySide);
    const lostPrevious = Boolean(previousMatch?.status === "completed" && previousMatch.winner && previousMatch.winner !== entrySide);
    // A later placement never cancels an earlier loss. Existing placements are
    // otherwise accepted as manual advancement; missing matches are not byes.
    const eligibility = !isKnockoutFormat ? "eligible"
      : earlierLoss ? "eliminated"
      : match || wonPrevious || !previousRound ? "eligible" : "awaiting";
    const previousOpponent = previousMatch
      ? previousMatch.entryA.registrationId === entry.registrationId
        ? matchSideLabel(previousMatch.entryB, previousMatch.playersB)
        : matchSideLabel(previousMatch.entryA, previousMatch.playersA)
      : null;
    const previousScore = previousMatch?.games?.length
      ? previousMatch.games.map((game) => `${game.scoreA}-${game.scoreB}`).join(", ")
      : null;
    const previousResult = previousMatch
      ? previousMatch.status === "completed"
        ? `${wonPrevious ? "Won" : lostPrevious ? "Lost" : "Completed"} vs ${previousOpponent}${previousScore ? ` · ${previousScore}` : ""}`
        : `${previousMatch.status === "in_progress" ? "Playing" : "Awaiting result"} vs ${previousOpponent}`
      : previousRound ? `No match recorded in ${previousRound.name}` : null;
    if (eligibility === "eliminated") return { entry, label: "Eliminated", tone: "outline" as const, match, previousResult, eligibility };
    if (eligibility === "awaiting") return { entry, label: previousMatch ? "Awaiting result" : "No advancement recorded", tone: "secondary" as const, match, previousResult, eligibility };
    if (!match) return { entry, label: "Not scheduled", tone: "outline" as const, match: null, previousResult, eligibility };
    if (match.status === "completed") return { entry, label: "Completed", tone: "default" as const, match, previousResult, eligibility };
    if (match.status === "in_progress") return { entry, label: "In progress", tone: "outline" as const, match, previousResult, eligibility };
    if (match.scheduledTime) return { entry, label: "Scheduled", tone: "secondary" as const, match, previousResult, eligibility };
    return { entry, label: "Needs time", tone: "destructive" as const, match, previousResult, eligibility };
  });
  const eligibleRoundEntries = roundEntryStatuses.filter(({ eligibility }) => eligibility === "eligible");
  const coveredRoundEntries = eligibleRoundEntries.filter(({ label }) => label === "Scheduled" || label === "In progress" || label === "Completed").length;
  const remainingRoundEntries = eligibleRoundEntries.length - coveredRoundEntries;
  const awaitingRoundEntries = roundEntryStatuses.filter(({ eligibility }) => eligibility === "awaiting").length;
  const eliminatedRoundEntries = roundEntryStatuses.filter(({ eligibility }) => eligibility === "eliminated").length;
  const isRoundFullyScheduled = eligibleRoundEntries.length > 0 && remainingRoundEntries === 0 && (!isKnockoutFormat || awaitingRoundEntries === 0);
  const roundStatusForEntry = (registrationId: string) => roundEntryStatuses.find(({ entry }) => entry.registrationId === registrationId)?.label;
  const isEntryBlocked = (registrationId: string) => isKnockoutFormat && (
    isLoadingMatches || isMatchesError || isLoadingRounds || isRoundsError ||
    roundEntryStatuses.find(({ entry }) => entry.registrationId === registrationId)?.eligibility !== "eligible"
  );
  const eligibilityBlocked = Boolean((entryAId && isEntryBlocked(entryAId)) || (entryBId && isEntryBlocked(entryBId)));

  const setPlayerAt = (team: "a" | "b", slot: number, value: string) => {
    const setter = team === "a" ? setPlayerAIds : setPlayerBIds;
    setter((current) => {
      const next = [...current];
      next[slot] = value;
      return next.slice(0, requiredPlayers);
    });
  };

  useEffect(() => {
    if (!categoryId && categories[0]) setCategoryId(categories[0].id);
  }, [categoryId, categories]);

  useEffect(() => {
    if (!courtId && courts[0]) setCourtId(courts[0].id);
  }, [courtId, courts]);

  useEffect(() => {
    if (hasConfiguredRounds && !rounds.some((round) => round.id === roundId)) setRoundId(rounds[0]?.id ?? "");
  }, [hasConfiguredRounds, roundId, rounds]);

  // Team categories must always have a match type (singles/doubles) — the plain
  // whole-team option was removed. Default to singles when none is selected.
  useEffect(() => {
    if (isTeamCategory && !matchType) setMatchType("singles");
  }, [isTeamCategory, matchType]);

  const resetForm = () => {
    setEntryAId("");
    setEntryBId("");
    setRoundId("");
    setRoundLabel("");
    setScheduledTime("");
    setDurationMinutes(30);
    setMatchStatus("scheduled");
    setWinner("");
    setAutoAdvance(false);
    setMatchType("");
    setPlayerAIds([]);
    setPlayerBIds([]);
    setEditingId(null);
  };

  const selectCategory = (value: string) => {
    setCategoryId(value);
    setEntryAId("");
    setEntryBId("");
    setRoundId("");
    setMatchType("");
    setPlayerAIds([]);
    setPlayerBIds([]);
  };

  const editMatch = (match: OrganizerMatch) => {
    setActiveView("schedule");
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    formRef.current?.querySelector<HTMLSelectElement>("#match-category")?.focus({ preventScroll: true });
    setEditingId(match.id);
    setCategoryId(match.category.id);
    setEntryAId(match.entryA.registrationId);
    setEntryBId(match.entryB.registrationId);
    setCourtId(match.court.id);
    setRoundId(match.roundId ?? "");
    setRoundLabel(match.roundLabel);
    setScheduledTime(inputDateTime(match.scheduledTime));
    setDurationMinutes(match.durationMinutes ?? 30);
    setMatchStatus(match.status);
    setWinner(match.winner ?? "");
    setAutoAdvance(match.autoAdvance);
    setMatchType(match.matchType ?? "");
    setPlayerAIds((match.playersA ?? []).map((player) => player.regParticipantId));
    setPlayerBIds((match.playersB ?? []).map((player) => player.regParticipantId));
  };

  const submitMatch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (scheduleBlocked) return;
    const resolvedRoundLabel = selectedRound?.name ?? roundLabel.trim();
    if (!categoryId || !entryAId || !entryBId || !courtId || (hasConfiguredRounds ? !selectedRound : !resolvedRoundLabel)) {
      toast.error(hasConfiguredRounds ? "Select a configured round." : "Enter a round label.");
      return;
    }
    if (entryAId === entryBId) {
      toast.error("Choose two different entries.");
      return;
    }
    if (eligibilityBlocked) {
      toast.error("Choose entries that are eligible for this knockout round.");
      return;
    }
    if (matchStatus === "completed" && !winner) {
      toast.error("Select the winner for a completed match.");
      return;
    }
    if (duplicateMatchup) {
      toast.warning(`This matchup already exists in ${duplicateMatchup.roundLabel}. You can still save another match if this is intentional.`);
    }

    // Team-mode player selection. Team categories require a match type
    // (singles/doubles) with specific players — the whole-team option was removed.
    let playerPayload: Record<string, unknown> = {};
    if (isTeamCategory) {
      if (!matchType) {
        toast.error("Select a match type (singles or doubles).");
        return;
      }
      const needed = matchType === "singles" ? 1 : 2;
      const cleanA = playerAIds.filter(Boolean).slice(0, needed);
      const cleanB = playerBIds.filter(Boolean).slice(0, needed);
      if (cleanA.length !== needed || cleanB.length !== needed) {
        toast.error(`Select ${needed} player${needed > 1 ? "s" : ""} from each team.`);
        return;
      }
      if (new Set(cleanA).size !== cleanA.length || new Set(cleanB).size !== cleanB.length) {
        toast.error("A player cannot be selected twice in the same match.");
        return;
      }
      playerPayload = {
        match_type: matchType,
        player_a_participant_ids: cleanA,
        player_b_participant_ids: cleanB,
      };
    }

    setIsSaving(true);
    try {
      const savedMatch = await apiRequest<OrganizerMatch>(editingId ? `/organizer/events/${eventId}/matches/${editingId}` : `/organizer/events/${eventId}/matches`, {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify({
          category_id: categoryId,
          entry_a_registration_id: entryAId,
          entry_b_registration_id: entryBId,
          court_id: courtId,
          round_id: selectedRound?.id ?? null,
          round_label: resolvedRoundLabel,
          duration_minutes: durationMinutes,
          scheduled_time: scheduledTime ? new Date(scheduledTime).toISOString() : null,
          status: matchStatus,
          winner: matchStatus === "completed" ? winner : null,
          auto_advance: canAutoAdvance && autoAdvance,
          ...playerPayload,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["match-conflicts", eventId] });
      await queryClient.invalidateQueries({ queryKey: ["organizer-matches", eventId] });
      toast.success(
        savedMatch.nextMatchId
          ? "Match completed and the winner advanced automatically."
          : editingId ? "Match updated." : "Match created."
      );
      resetForm();
      setActiveView("matches");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the match.");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteMatch = async (match: OrganizerMatch) => {
    if (!window.confirm(`Delete ${match.roundLabel}?`)) return;
    try {
      await apiRequest(`/organizer/events/${eventId}/matches/${match.id}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["match-conflicts", eventId] });
      await queryClient.invalidateQueries({ queryKey: ["organizer-matches", eventId] });
      if (editingId === match.id) resetForm();
      toast.success("Match deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the match.");
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Build your match schedule</CardTitle><CardDescription>Choose who plays, then assign a court and time. We check for overlapping court and player bookings before you save.</CardDescription></CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-xl border bg-muted/30 p-1" role="tablist" aria-label="Match management views">
          <div className="grid grid-cols-2 gap-1">
            <button type="button" role="tab" aria-selected={activeView === "matches"} onClick={() => setActiveView("matches")} className={`rounded-lg px-4 py-3 text-left text-sm transition ${activeView === "matches" ? "bg-background font-semibold shadow-sm" : "text-muted-foreground hover:bg-background/70"}`}>
              <span className="block">Matches</span><span className="mt-1 block text-xs font-normal text-muted-foreground">View the schedule and results</span>
            </button>
            <button type="button" role="tab" aria-selected={activeView === "schedule"} onClick={() => { resetForm(); setActiveView("schedule"); }} className={`rounded-lg px-4 py-3 text-left text-sm transition ${activeView === "schedule" ? "bg-background font-semibold shadow-sm" : "text-muted-foreground hover:bg-background/70"}`}>
              <span className="block">Schedule a match</span><span className="mt-1 block text-xs font-normal text-muted-foreground">Choose players, court and time</span>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[{ label: "Total matches", value: matches.length, icon: CalendarDays }, { label: "Need a time", value: matches.filter((match) => !match.scheduledTime).length, icon: Clock3 }, { label: "In progress", value: matches.filter((match) => match.status === "in_progress").length, icon: Clock3 }, { label: "Completed", value: matches.filter((match) => match.status === "completed").length, icon: CheckCircle2 }].map(({ label, value, icon: Icon }) => <div key={label} className="rounded-xl border bg-muted/20 p-4"><div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">{label}<Icon className="h-4 w-4" /></div><p className="mt-2 text-2xl font-semibold tabular-nums">{isLoadingMatches || isMatchesError ? "—" : value}</p></div>)}
        </div>
        {activeView === "schedule" && (categories.length === 0 || courts.length === 0 ? <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">Add at least one event category and one court before creating a match.</div> : <form ref={formRef} onSubmit={submitMatch} className="scroll-mt-6 space-y-6 rounded-xl border p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3"><div><h3 className="text-lg font-semibold">{editingId ? "Edit match" : "New match"}</h3><p className="mt-1 text-sm text-muted-foreground">{editingId ? "Update the details below and save your changes." : "Start with a category to see eligible players and teams."}</p></div>{editingId && <Badge variant="outline">Editing</Badge>}</div>
          <fieldset className="space-y-4"><legend className="mb-3 text-sm font-semibold">1. Choose the matchup</legend><div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="match-category">Category</Label><select id="match-category" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={categoryId} onChange={(event) => selectCategory(event.target.value)} required>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
            <div className="space-y-2">{hasConfiguredRounds ? <><Label htmlFor="match-round">Round</Label><select id="match-round" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={roundId} onChange={(event) => setRoundId(event.target.value)} required disabled={isLoadingRounds}><option value="">{isLoadingRounds ? "Loading rounds…" : "Select round"}</option>{rounds.map((round) => <option key={round.id} value={round.id}>{round.position + 1}. {round.name}</option>)}</select></> : <><Label htmlFor="match-round">Round name</Label><Input id="match-round" value={roundLabel} onChange={(event) => setRoundLabel(event.target.value)} placeholder="Quarterfinal 1" maxLength={160} required /><p className="text-xs text-muted-foreground">Give this round a clear name, such as Quarterfinal 1. Configure rounds in Tournament setup to enable automatic advancement.</p></>}</div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="match-entry-search">Find a registered {isTeamCategory ? "team" : "player or pair"}</Label><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input id="match-entry-search" className="pl-9" value={entrySearch} onChange={(event) => setEntrySearch(event.target.value)} placeholder={isLoadingEntries ? "Loading entries…" : "Search by name, team, or registration reference"} disabled={isLoadingEntries} /></div><p className="text-xs text-muted-foreground">Search filters both sides below. Ineligible knockout entries remain disabled.</p></div>
            <div className="space-y-2"><Label htmlFor="match-entry-a">{isTeamCategory ? "Team A" : "Player / pair A"}</Label><select id="match-entry-a" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={entryAId} onChange={(event) => { setEntryAId(event.target.value); setPlayerAIds([]); }} required disabled={isLoadingEntries}><option value="">{isLoadingEntries ? "Loading entries…" : "Choose a player / team"}</option>{searchableEntries.filter((entry) => entry.registrationId !== entryBId || entry.registrationId === entryAId).map((entry) => <option key={entry.registrationId} value={entry.registrationId} disabled={isEntryBlocked(entry.registrationId)}>{entryOptionLabel(entry)}{roundName ? ` — ${roundStatusForEntry(entry.registrationId)}` : ""}</option>)}</select></div>
            <div className="space-y-2"><Label htmlFor="match-entry-b">{isTeamCategory ? "Team B" : "Player / pair B"}</Label><select id="match-entry-b" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={entryBId} onChange={(event) => { setEntryBId(event.target.value); setPlayerBIds([]); }} required disabled={isLoadingEntries}><option value="">{isLoadingEntries ? "Loading entries…" : "Choose a player / team"}</option>{searchableEntries.filter((entry) => entry.registrationId !== entryAId || entry.registrationId === entryBId).map((entry) => <option key={entry.registrationId} value={entry.registrationId} disabled={isEntryBlocked(entry.registrationId)}>{entryOptionLabel(entry)}{roundName ? ` — ${roundStatusForEntry(entry.registrationId)}` : ""}</option>)}</select></div>
          </div>
          <Sheet>
            <SheetTrigger asChild>
              <Button type="button" variant="outline" className="w-full justify-between" disabled={!roundName || isLoadingEntries}>
                <span className="flex items-center gap-2"><ListChecks className="h-4 w-4" />View {roundName || "round"} player status</span>
                <span className={isRoundFullyScheduled ? "text-emerald-700" : "text-muted-foreground"}>{coveredRoundEntries}/{eligibleRoundEntries.length} scheduled</span>
              </Button>
            </SheetTrigger>
            <SheetContent className="flex w-full flex-col p-0 sm:max-w-lg">
              <SheetHeader className="border-b p-6 pr-12">
                <SheetTitle>{roundName || "Round"} player status</SheetTitle>
                <SheetDescription>{selectedCategory?.name} · {coveredRoundEntries} of {eligibleRoundEntries.length} {isKnockoutFormat ? "currently qualified" : "league"} players or teams have a court and time.</SheetDescription>
              </SheetHeader>
              <div className="border-b px-6 py-4">
                <div className={`rounded-lg p-4 ${isRoundFullyScheduled ? "bg-emerald-50 text-emerald-800" : "bg-muted"}`}>
                  <p className="font-medium">{isRoundFullyScheduled ? isKnockoutFormat ? "Everyone who qualified is scheduled" : "Everyone is scheduled for this league round" : remainingRoundEntries > 0 ? `${remainingRoundEntries} ${isKnockoutFormat ? "qualified " : ""}player${remainingRoundEntries === 1 ? "" : "s"} still ${remainingRoundEntries === 1 ? "needs" : "need"} to be scheduled` : `${awaitingRoundEntries} place${awaitingRoundEntries === 1 ? "" : "s"} awaiting results or recorded advancement`}</p>
                  <p className="mt-1 text-xs opacity-80">{isKnockoutFormat ? "Completed and in-progress matches count as scheduled. Players who lost any earlier round are eliminated. Missing matches do not count as byes." : "Every team remains eligible in a league. Previous losses are shown for reference and do not eliminate anyone."}</p>
                  {previousRound && isKnockoutFormat && <p className="mt-2 text-xs opacity-80">Earlier rounds: {awaitingRoundEntries} awaiting result or advancement · {eliminatedRoundEntries} eliminated</p>}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                {isLoadingEntries ? <p className="text-sm text-muted-foreground">Loading players…</p> : roundEntryStatuses.length === 0 ? <p className="text-sm text-muted-foreground">No eligible players or teams are available in this category.</p> : <div className="space-y-3">
                  {roundEntryStatuses.map(({ entry, label, tone, match, previousResult }) => <div key={entry.registrationId} className="rounded-lg border p-4">
                    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium">{entry.displayName}</p>{entry.registrationReference && <p className="mt-1 text-xs text-muted-foreground">{entry.registrationReference}</p>}</div><Badge variant={tone}>{label}</Badge></div>
                    {previousResult && <p className="mt-2 text-xs font-medium text-muted-foreground">Previous: {previousResult}</p>}
                    {match && <p className="mt-2 text-xs text-muted-foreground">{match.entryA.registrationId === entry.registrationId ? `vs ${matchSideLabel(match.entryB, match.playersB)}` : `vs ${matchSideLabel(match.entryA, match.playersA)}`} · {match.court.name}{match.scheduledTime ? ` · ${new Date(match.scheduledTime).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` : " · Time not assigned"}</p>}
                  </div>)}
                </div>}
              </div>
            </SheetContent>
          </Sheet>
          {isEntriesError ? <p role="alert" className="text-sm text-destructive">Could not load players. Refresh the page to try again.</p> : !isLoadingEntries && entries.length < 2 ? <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">This category needs at least two eligible registrations. Check registrations or choose another category.</p> : <p className="text-xs text-muted-foreground">Confirmed registrations are shown. Entries that are not eligible for this round are disabled.</p>}
          </fieldset>
          {isTeamCategory && (
            <div className="space-y-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
              <div className="space-y-2">
                <Label htmlFor="match-type">Match type</Label>
                <select
                  id="match-type"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-64"
                  value={matchType}
                  onChange={(event) => {
                    const value = event.target.value as "singles" | "doubles";
                    setMatchType(value);
                    setPlayerAIds([]);
                    setPlayerBIds([]);
                  }}
                  required
                >
                  <option value="singles">Singles — 1 player per team</option>
                  <option value="doubles">Doubles — 2 players per team</option>
                </select>
                <p className="text-xs text-muted-foreground">Pick specific players from each team's roster for this match.</p>
              </div>

              {matchType && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>{entryA?.teamName ?? "Team A"} players</Label>
                    {!entryAId ? (
                      <p className="text-xs text-muted-foreground">Choose Team A above to see its players.</p>
                    ) : (
                      Array.from({ length: requiredPlayers }).map((_, slot) => (
                        <select
                          aria-label={`Team A player ${slot + 1}`}
                          key={`a-${slot}`}
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={playerAIds[slot] ?? ""}
                          onChange={(event) => setPlayerAt("a", slot, event.target.value)}
                          required
                        >
                          <option value="">Select player {slot + 1}</option>
                          {rosterA?.map((member) => (
                            <option key={member.regParticipantId} value={member.regParticipantId}>{member.name}</option>
                          ))}
                        </select>
                      ))
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>{entryB?.teamName ?? "Team B"} players</Label>
                    {!entryBId ? (
                      <p className="text-xs text-muted-foreground">Choose Team B above to see its players.</p>
                    ) : (
                      Array.from({ length: requiredPlayers }).map((_, slot) => (
                        <select
                          aria-label={`Team B player ${slot + 1}`}
                          key={`b-${slot}`}
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={playerBIds[slot] ?? ""}
                          onChange={(event) => setPlayerAt("b", slot, event.target.value)}
                          required
                        >
                          <option value="">Select player {slot + 1}</option>
                          {rosterB?.map((member) => (
                            <option key={member.regParticipantId} value={member.regParticipantId}>{member.name}</option>
                          ))}
                        </select>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <fieldset className="space-y-4 border-t pt-5"><legend className="text-sm font-semibold">2. Set the court & time</legend><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2"><Label htmlFor="match-court">Court</Label><select id="match-court" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={courtId} onChange={(event) => setCourtId(event.target.value)} required>{courts.map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}</select></div>
            <div className="space-y-2"><Label htmlFor="match-time">Start time (optional)</Label><Input id="match-time" type="datetime-local" value={scheduledTime} onChange={(event) => setScheduledTime(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="match-duration">Duration (minutes)</Label><Input id="match-duration" type="number" min={1} max={1440} required value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} /><p className="text-xs text-muted-foreground">Reserves this court and players/teams for the full duration.</p></div>
          </div><p className="text-xs text-muted-foreground">Times are shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}. Leave the start time blank to add the matchup now and schedule it later.</p></fieldset>
          <details className="rounded-lg border bg-muted/20 p-4" open={editingId || matchStatus === "completed" ? true : undefined}><summary className="cursor-pointer text-sm font-medium">Match status & result <span className="font-normal text-muted-foreground">· {statusLabels[matchStatus]}</span></summary><div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="match-status">Status</Label><select id="match-status" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={matchStatus} onChange={(event) => { const value = event.target.value as OrganizerMatch["status"]; setMatchStatus(value); if (value !== "completed") setWinner(""); }}><option value="scheduled">Scheduled</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select></div>
            {matchStatus === "completed" && <div className="space-y-2"><Label htmlFor="match-winner">Winner</Label><select id="match-winner" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={winner} onChange={(event) => setWinner(event.target.value as "entry_a" | "entry_b" | "")} required><option value="">Select winner</option><option value="entry_a">{entryA?.displayName ?? "Side A"}</option><option value="entry_b">{entryB?.displayName ?? "Side B"}</option></select></div>}
          </div><p className="mt-3 text-xs text-muted-foreground">New matches start as Scheduled. Use the Scoring page to record game scores.</p></details>

          {canAutoAdvance && <div className="flex items-start justify-between gap-4 rounded-lg border border-primary/20 bg-primary/5 p-4"><div><Label htmlFor="auto-advance" className="font-semibold">Advance winner automatically</Label><p className="mt-1 text-xs text-muted-foreground">Enable only after all rounds are configured and bracket pairings are finalized. When both paired matches have this enabled and are completed, SportPass creates the next-round match. Assign its date and time afterward.</p></div><Switch id="auto-advance" checked={autoAdvance} onCheckedChange={setAutoAdvance} /></div>}


          <div className="rounded-lg bg-muted/40 p-4 text-sm"><p className="font-medium">{entryA?.displayName ?? "Choose a player / team"} <span className="font-normal text-muted-foreground">vs</span> {entryB?.displayName ?? "Choose an opponent"}</p><p className="mt-1 text-muted-foreground">{courts.find((court) => court.id === courtId)?.name ?? "Choose a court"} · {scheduledTime ? `${new Date(scheduledTime).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} – ${new Date(new Date(scheduledTime).getTime() + durationMinutes * 60000).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : "Time to be decided"}</p></div>
          {canCheckSchedule && <div aria-live="polite">
            {!scheduleCheck.isFetching && scheduleCheck.isSuccess && conflicts.length === 0 && <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />No court or player conflicts found.</p>}
            {scheduleCheck.isFetching && <p className="text-sm text-muted-foreground">Checking schedule…</p>}
            {scheduleCheck.isError && <p role="alert" className="text-sm text-destructive">Could not check conflicts. <button type="button" className="underline" onClick={() => void scheduleCheck.refetch()}>Retry</button></p>}
            {conflicts.length > 0 && <div role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive"><p className="font-medium">Resolve scheduling conflicts before saving:</p><ul className="list-disc pl-5">{conflicts.map((conflict, index) => <li key={index}>{conflict}</li>)}</ul></div>}
          </div>}
          <div className="flex gap-2"><Button type="submit" disabled={isSaving || isLoadingEntries || isEntriesError || entries.length < 2 || scheduleBlocked || eligibilityBlocked}><Plus className="mr-2 h-4 w-4" />{isSaving ? "Saving…" : editingId ? "Save match" : scheduledTime ? "Schedule match" : "Add matchup"}</Button>{editingId && <Button type="button" variant="ghost" onClick={resetForm}>Cancel</Button>}</div>
        </form>)}

        {activeView === "matches" && <section className="space-y-4" aria-label="Match schedule">
          <div><h3 className="text-lg font-semibold">Match schedule</h3><p className="text-sm text-muted-foreground">View upcoming matches in time order. Matchups without a time appear last.</p></div>
          {matches.length > 0 && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2"><Label htmlFor="match-search">Find a match</Label><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="match-search" className="pl-9" placeholder="Player, team, category or round" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></div></div>
            <div className="space-y-2"><Label htmlFor="filter-status">Match status</Label><select id="filter-status" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}><option value="all">All statuses</option><option value="unscheduled">Needs a time</option><option value="scheduled">Scheduled</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select></div>
            <div className="space-y-2"><Label htmlFor="filter-court">Court</Label><select id="filter-court" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={courtFilter} onChange={(event) => { setCourtFilter(event.target.value); setPage(1); }}><option value="all">All courts</option>{courts.map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}</select></div>
          </div>}
          {matches.length > 0 && <p className="text-xs text-muted-foreground" aria-live="polite">{filteredMatches.length} of {matches.length} matches</p>}
        {isLoadingMatches ? <p className="py-6 text-center text-sm text-muted-foreground">Loading matches…</p> : isMatchesError ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Could not load matches.</div> : matches.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Your schedule starts here. Choose two opponents in the form above to add your first matchup. You can assign a time now or later.</div> : filteredMatches.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center"><p className="text-sm text-muted-foreground">No matches found. Try another name or clear the filters.</p><Button type="button" variant="link" onClick={() => { setSearch(""); setCourtFilter("all"); setStatusFilter("all"); setPage(1); }}>Clear filters</Button></div> : <><Table><TableHeader><TableRow><TableHead>Round</TableHead><TableHead>Players / teams</TableHead><TableHead>Court / time</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{visibleMatches.map((match) => <TableRow key={match.id}><TableCell><div className="font-medium">{match.roundLabel}</div><div className="text-xs text-muted-foreground">{match.category.name}</div>{match.autoAdvance && <div className="mt-1 text-xs font-medium text-primary">Auto advancement on</div>}</TableCell><TableCell><div>{matchSideLabel(match.entryA, match.playersA)} <span className="text-muted-foreground">vs</span> {matchSideLabel(match.entryB, match.playersB)}</div>{match.matchType && <div className="text-xs font-medium text-primary">{match.matchType === "singles" ? "Singles" : "Doubles"}</div>}{(match.entryA.teamName || match.entryB.teamName) && !match.matchType && <div className="text-xs text-muted-foreground">{match.entryA.teamName ? entryMemberNames(match.entryA) : "No team"} <span className="text-muted-foreground">vs</span> {match.entryB.teamName ? entryMemberNames(match.entryB) : "No team"}</div>}</TableCell><TableCell><div>{match.court.name}</div><div className="text-xs text-muted-foreground">{match.scheduledTime ? new Date(match.scheduledTime).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Needs a time"}</div></TableCell><TableCell><Badge variant={match.status === "completed" ? "default" : match.status === "in_progress" ? "outline" : "secondary"}>{statusLabels[match.status]}{match.winner ? ` · ${match.winner === "entry_a" ? match.entryA.displayName : match.entryB.displayName} won` : ""}</Badge></TableCell><TableCell><div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => editMatch(match)}><Pencil className="mr-2 h-4 w-4" />Edit</Button><Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => void deleteMatch(match)}><Trash2 className="mr-2 h-4 w-4" />Delete</Button></div></TableCell></TableRow>)}</TableBody></Table>{filteredMatches.length > pageSize && <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4"><p className="text-sm text-muted-foreground">Page {safePage} of {pageCount} · {filteredMatches.length} matches</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button variant="outline" size="sm" disabled={safePage >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>}</>}
        </section>}
      </CardContent>
    </Card>
  );
};

export default OrganizerEventMatches;
