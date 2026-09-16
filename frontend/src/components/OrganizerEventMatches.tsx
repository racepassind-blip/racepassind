import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { OrganizerCourt, OrganizerEventCategory, OrganizerMatch } from "@/hooks/useEvents";
import { useOrganizerMatchEntries, useOrganizerMatches, useOrganizerTournamentRounds } from "@/hooks/useEvents";
import { apiRequest } from "@/lib/api";

interface OrganizerEventMatchesProps {
  eventId: string;
  categories: OrganizerEventCategory[];
  courts: OrganizerCourt[];
  supportsTournament: boolean;
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

function entryOptionLabel(entry: { displayName: string; participantName: string; participantNames?: string[]; teamName: string | null; registrationReference: string | null }) {
  // For teams: show team name followed by all member names. For singles/doubles the
  // displayName already contains the member name(s), so keep it as-is.
  const group = entry.teamName ? `${entry.teamName} · ${entryMemberNames(entry)}` : entry.displayName;
  return `${group}${entry.registrationReference ? ` (${entry.registrationReference})` : ""}`;
}

function inputDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

const OrganizerEventMatches = ({ eventId, categories, courts, supportsTournament }: OrganizerEventMatchesProps) => {
  const queryClient = useQueryClient();
  const { data: matches = [], isLoading: isLoadingMatches, isError: isMatchesError } = useOrganizerMatches(eventId);
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [entryAId, setEntryAId] = useState("");
  const [entryBId, setEntryBId] = useState("");
  const [courtId, setCourtId] = useState(courts[0]?.id ?? "");
  const [roundId, setRoundId] = useState("");
  const [roundLabel, setRoundLabel] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [matchStatus, setMatchStatus] = useState<OrganizerMatch["status"]>("scheduled");
  const [winner, setWinner] = useState<"entry_a" | "entry_b" | "">("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { data: entries = [], isLoading: isLoadingEntries } = useOrganizerMatchEntries(eventId, categoryId || undefined);
  const { data: rounds = [], isLoading: isLoadingRounds } = useOrganizerTournamentRounds(eventId, categoryId || undefined, supportsTournament);
  const hasConfiguredRounds = rounds.length > 0;

  useEffect(() => {
    if (!categoryId && categories[0]) setCategoryId(categories[0].id);
  }, [categoryId, categories]);

  useEffect(() => {
    if (!courtId && courts[0]) setCourtId(courts[0].id);
  }, [courtId, courts]);

  useEffect(() => {
    if (hasConfiguredRounds && !rounds.some((round) => round.id === roundId)) setRoundId(rounds[0]?.id ?? "");
  }, [hasConfiguredRounds, roundId, rounds]);

  const resetForm = () => {
    setEntryAId("");
    setEntryBId("");
    setRoundId("");
    setRoundLabel("");
    setScheduledTime("");
    setMatchStatus("scheduled");
    setWinner("");
    setEditingId(null);
  };

  const selectCategory = (value: string) => {
    setCategoryId(value);
    setEntryAId("");
    setEntryBId("");
    setRoundId("");
  };

  const editMatch = (match: OrganizerMatch) => {
    setEditingId(match.id);
    setCategoryId(match.category.id);
    setEntryAId(match.entryA.registrationId);
    setEntryBId(match.entryB.registrationId);
    setCourtId(match.court.id);
    setRoundId(match.roundId ?? "");
    setRoundLabel(match.roundLabel);
    setScheduledTime(inputDateTime(match.scheduledTime));
    setMatchStatus(match.status);
    setWinner(match.winner ?? "");
  };

  const submitMatch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selectedRound = rounds.find((round) => round.id === roundId);
    const resolvedRoundLabel = selectedRound?.name ?? roundLabel.trim();
    if (!categoryId || !entryAId || !entryBId || !courtId || (hasConfiguredRounds ? !selectedRound : !resolvedRoundLabel)) {
      toast.error(hasConfiguredRounds ? "Select a configured round." : "Enter a round label.");
      return;
    }
    if (entryAId === entryBId) {
      toast.error("Choose two different entries.");
      return;
    }
    if (matchStatus === "completed" && !winner) {
      toast.error("Select the winner for a completed match.");
      return;
    }
    setIsSaving(true);
    try {
      await apiRequest(editingId ? `/organizer/events/${eventId}/matches/${editingId}` : `/organizer/events/${eventId}/matches`, {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify({
          category_id: categoryId,
          entry_a_registration_id: entryAId,
          entry_b_registration_id: entryBId,
          court_id: courtId,
          round_id: selectedRound?.id ?? null,
          round_label: resolvedRoundLabel,
          scheduled_time: scheduledTime ? new Date(scheduledTime).toISOString() : null,
          status: matchStatus,
          winner: matchStatus === "completed" ? winner : null,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["organizer-matches", eventId] });
      toast.success(editingId ? "Match updated." : "Match created.");
      resetForm();
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
      await queryClient.invalidateQueries({ queryKey: ["organizer-matches", eventId] });
      if (editingId === match.id) resetForm();
      toast.success("Match deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the match.");
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Schedule & manage matches</CardTitle><CardDescription>Create the draw manually, assign courts and times, then maintain the event match schedule. Confirmed registrations are the only entries available, and team names are shown for doubles grouping.</CardDescription></CardHeader>
      <CardContent className="space-y-6">
        {categories.length === 0 || courts.length === 0 ? <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">Add at least one event category and one court before creating a match.</div> : <form onSubmit={submitMatch} className="space-y-4 rounded-lg border bg-muted/20 p-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2"><Label htmlFor="match-category">Category</Label><select id="match-category" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={categoryId} onChange={(event) => selectCategory(event.target.value)} required>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
            <div className="space-y-2">{hasConfiguredRounds ? <><Label htmlFor="match-round">Round</Label><select id="match-round" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={roundId} onChange={(event) => setRoundId(event.target.value)} required disabled={isLoadingRounds}><option value="">{isLoadingRounds ? "Loading rounds…" : "Select round"}</option>{rounds.map((round) => <option key={round.id} value={round.id}>{round.position + 1}. {round.name}</option>)}</select></> : <><Label htmlFor="match-round">Custom round label</Label><Input id="match-round" value={roundLabel} onChange={(event) => setRoundLabel(event.target.value)} placeholder="Quarterfinal 1" maxLength={160} required /><p className="text-xs text-muted-foreground">No configured rounds for this category. This legacy label will be kept on the match.</p></>}</div>
            <div className="space-y-2"><Label htmlFor="match-court">Court</Label><select id="match-court" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={courtId} onChange={(event) => setCourtId(event.target.value)} required>{courts.map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}</select></div>
            <div className="space-y-2"><Label htmlFor="match-entry-a">Entry A</Label><select id="match-entry-a" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={entryAId} onChange={(event) => setEntryAId(event.target.value)} required disabled={isLoadingEntries}><option value="">{isLoadingEntries ? "Loading entries…" : "Select entry"}</option>{entries.map((entry) => <option key={entry.registrationId} value={entry.registrationId}>{entryOptionLabel(entry)}</option>)}</select></div>
            <div className="space-y-2"><Label htmlFor="match-entry-b">Entry B</Label><select id="match-entry-b" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={entryBId} onChange={(event) => setEntryBId(event.target.value)} required disabled={isLoadingEntries}><option value="">{isLoadingEntries ? "Loading entries…" : "Select entry"}</option>{entries.map((entry) => <option key={entry.registrationId} value={entry.registrationId}>{entryOptionLabel(entry)}</option>)}</select></div>
            <div className="space-y-2"><Label htmlFor="match-time">Scheduled time</Label><Input id="match-time" type="datetime-local" value={scheduledTime} onChange={(event) => setScheduledTime(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="match-status">Status</Label><select id="match-status" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={matchStatus} onChange={(event) => { const value = event.target.value as OrganizerMatch["status"]; setMatchStatus(value); if (value !== "completed") setWinner(""); }}><option value="scheduled">Scheduled</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select></div>
            {matchStatus === "completed" && <div className="space-y-2"><Label htmlFor="match-winner">Winner</Label><select id="match-winner" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={winner} onChange={(event) => setWinner(event.target.value as "entry_a" | "entry_b" | "")} required><option value="">Select winner</option><option value="entry_a">Entry A</option><option value="entry_b">Entry B</option></select></div>}
          </div>
          <div className="flex gap-2"><Button type="submit" disabled={isSaving || isLoadingEntries}><Plus className="mr-2 h-4 w-4" />{isSaving ? "Saving…" : editingId ? "Save match" : "Schedule match"}</Button>{editingId && <Button type="button" variant="ghost" onClick={resetForm}>Cancel</Button>}</div>
        </form>}

        {isLoadingMatches ? <p className="py-6 text-center text-sm text-muted-foreground">Loading matches…</p> : isMatchesError ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Could not load matches.</div> : matches.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No matches scheduled yet. Use the form above to create the first match.</div> : <Table><TableHeader><TableRow><TableHead>Round</TableHead><TableHead>Entries</TableHead><TableHead>Court / time</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{matches.map((match) => <TableRow key={match.id}><TableCell><div className="font-medium">{match.roundLabel}</div><div className="text-xs text-muted-foreground">{match.category.name}</div></TableCell><TableCell><div>{match.entryA.displayName} <span className="text-muted-foreground">vs</span> {match.entryB.displayName}</div>{(match.entryA.teamName || match.entryB.teamName) && <div className="text-xs text-muted-foreground">{match.entryA.teamName ? entryMemberNames(match.entryA) : "No team"} <span className="text-muted-foreground">vs</span> {match.entryB.teamName ? entryMemberNames(match.entryB) : "No team"}</div>}</TableCell><TableCell><div>{match.court.name}</div><div className="text-xs text-muted-foreground">{match.scheduledTime ? new Date(match.scheduledTime).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Time not set"}</div></TableCell><TableCell><Badge variant={match.status === "completed" ? "default" : match.status === "in_progress" ? "outline" : "secondary"}>{statusLabels[match.status]}{match.winner ? ` · ${match.winner === "entry_a" ? "A wins" : "B wins"}` : ""}</Badge></TableCell><TableCell><div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => editMatch(match)}><Pencil className="mr-2 h-4 w-4" />Edit</Button><Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => void deleteMatch(match)}><Trash2 className="mr-2 h-4 w-4" />Delete</Button></div></TableCell></TableRow>)}</TableBody></Table>}
      </CardContent>
    </Card>
  );
};

export default OrganizerEventMatches;
