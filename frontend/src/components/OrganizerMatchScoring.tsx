import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OrganizerMatch } from "@/hooks/useEvents";
import { useOrganizerMatches } from "@/hooks/useEvents";
import { apiRequest } from "@/lib/api";

interface OrganizerMatchScoringProps {
  eventId: string;
}

type ScoreRow = { gameNumber: number; scoreA: string; scoreB: string };

const emptyRows = (count: number): ScoreRow[] => Array.from({ length: count }, (_, index) => ({ gameNumber: index + 1, scoreA: "", scoreB: "" }));

const OrganizerMatchScoring = ({ eventId }: OrganizerMatchScoringProps) => {
  const queryClient = useQueryClient();
  const { data: matches = [] } = useOrganizerMatches(eventId);
  const [selectedId, setSelectedId] = useState(matches[0]?.id ?? "");
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [winner, setWinner] = useState<"entry_a" | "entry_b" | "">("");
  const [isSaving, setIsSaving] = useState(false);
  const selectedMatch = useMemo(() => matches.find((match) => match.id === selectedId) ?? null, [matches, selectedId]);
  const maxGames = selectedMatch ? selectedMatch.gamesToWin * 2 - 1 : 0;

  useEffect(() => {
    if (!selectedId && matches[0]) setSelectedId(matches[0].id);
    if (selectedId && !matches.some((match) => match.id === selectedId)) setSelectedId(matches[0]?.id ?? "");
  }, [matches, selectedId]);

  useEffect(() => {
    if (!selectedMatch) {
      setRows([]);
      setWinner("");
      return;
    }
    const existing = new Map(selectedMatch.games.map((game) => [game.gameNumber, game]));
    setRows(emptyRows(maxGames).map((row) => {
      const game = existing.get(row.gameNumber);
      return game ? { gameNumber: row.gameNumber, scoreA: String(game.scoreA), scoreB: String(game.scoreB) } : row;
    }));
    setWinner(selectedMatch.winner ?? "");
  }, [maxGames, selectedMatch]);

  const selectMatch = (matchId: string) => {
    const match = matches.find((item) => item.id === matchId);
    if (match?.status === "completed" && !window.confirm("This match is completed. Editing its score will change the recorded result. Continue?")) return;
    setSelectedId(matchId);
  };

  const updateRow = (index: number, field: "scoreA" | "scoreB", value: string) => {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  };

  const saveScores = async (complete: boolean) => {
    if (!selectedMatch) return;
    if (complete && !winner) {
      toast.error("Select the winner before completing the match.");
      return;
    }
    const games = [];
    for (const row of rows) {
      if (row.scoreA === "" && row.scoreB === "") continue;
      if (row.scoreA === "" || row.scoreB === "") {
        toast.error(`Enter both scores for game ${row.gameNumber}, or leave both blank.`);
        return;
      }
      const scoreA = Number(row.scoreA);
      const scoreB = Number(row.scoreB);
      if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreA > 30 || scoreB < 0 || scoreB > 30) {
        toast.error(`Game ${row.gameNumber} scores must be whole numbers from 0 to 30.`);
        return;
      }
      games.push({ game_number: row.gameNumber, score_a: scoreA, score_b: scoreB });
    }
    setIsSaving(true);
    try {
      await apiRequest(`/organizer/events/${eventId}/matches/${selectedMatch.id}`, {
        method: "PUT",
        body: JSON.stringify({
          category_id: selectedMatch.category.id,
          entry_a_registration_id: selectedMatch.entryA.registrationId,
          entry_b_registration_id: selectedMatch.entryB.registrationId,
          court_id: selectedMatch.court.id,
          round_id: selectedMatch.roundId,
          round_label: selectedMatch.roundLabel,
          scheduled_time: selectedMatch.scheduledTime,
          status: complete ? "completed" : "in_progress",
          winner: complete ? winner : null,
          games,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["organizer-matches", eventId] });
      toast.success(complete ? "Match completed." : "Scores saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save match scores.");
    } finally {
      setIsSaving(false);
    }
  };

  if (matches.length === 0) return <Card><CardHeader><CardTitle>No matches available for scoring</CardTitle><CardDescription>Schedule at least one match from the Matches page before entering scores.</CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground">Scheduled and in-progress matches will appear here for live score entry and completion.</p></CardContent></Card>;

  return (
    <Card>
      <CardHeader><CardTitle>Match scoring</CardTitle><CardDescription>Enter actual game scores and select the winner manually. Scores are recorded as entered.</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2"><Label htmlFor="score-match">Match</Label><select id="score-match" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={selectedId} onChange={(event) => selectMatch(event.target.value)}>{matches.map((match) => <option key={match.id} value={match.id}>{match.roundLabel} · {match.entryA.displayName} vs {match.entryB.displayName}</option>)}</select></div>
        {selectedMatch && <>
          <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border p-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">Entry A</p><p className="mt-1 font-semibold">{selectedMatch.entryA.displayName}</p></div><div className="rounded-lg border p-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">Entry B</p><p className="mt-1 font-semibold">{selectedMatch.entryB.displayName}</p></div></div>
          <div className="space-y-3">{rows.map((row, index) => <div key={row.gameNumber} className="grid grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)] items-end gap-3"><div className="pb-2 text-sm font-medium">Game {row.gameNumber}</div><div className="space-y-2"><Label htmlFor={`score-a-${selectedMatch.id}-${row.gameNumber}`}>Entry A</Label><Input id={`score-a-${selectedMatch.id}-${row.gameNumber}`} type="number" min={0} max={30} inputMode="numeric" value={row.scoreA} onChange={(event) => updateRow(index, "scoreA", event.target.value)} /></div><div className="space-y-2"><Label htmlFor={`score-b-${selectedMatch.id}-${row.gameNumber}`}>Entry B</Label><Input id={`score-b-${selectedMatch.id}-${row.gameNumber}`} type="number" min={0} max={30} inputMode="numeric" value={row.scoreB} onChange={(event) => updateRow(index, "scoreB", event.target.value)} /></div></div>)}</div>
          <p className="text-xs leading-5 text-muted-foreground">Normal target: {selectedMatch.pointsPerGame}. Deuce can continue to 30; the hard cap is 30–29. SportPass does not calculate or validate the winner.</p>
          <div className="flex flex-col gap-4 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-end sm:justify-between"><div className="space-y-2"><Label htmlFor={`score-winner-${selectedMatch.id}`}>Winner</Label><select id={`score-winner-${selectedMatch.id}`} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-64" value={winner} onChange={(event) => setWinner(event.target.value as "entry_a" | "entry_b" | "")}><option value="">Select winner</option><option value="entry_a">Entry A — {selectedMatch.entryA.displayName}</option><option value="entry_b">Entry B — {selectedMatch.entryB.displayName}</option></select></div><div className="flex gap-2"><Button type="button" variant="outline" onClick={() => void saveScores(false)} disabled={isSaving}><Save className="mr-2 h-4 w-4" />Save scores</Button><Button type="button" onClick={() => void saveScores(true)} disabled={isSaving}><CheckCircle2 className="mr-2 h-4 w-4" />Complete Match</Button></div></div>
        </>}
      </CardContent>
    </Card>
  );
};

export default OrganizerMatchScoring;
