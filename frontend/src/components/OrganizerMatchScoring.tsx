import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Save } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OrganizerMatch } from "@/hooks/useEvents";
import { useOrganizerMatches } from "@/hooks/useEvents";
import { apiRequest } from "@/lib/api";

interface OrganizerMatchScoringProps {
  eventId: string;
  showCompletedSection?: boolean;
}

type ScoreRow = { gameNumber: number; scoreA: string; scoreB: string };

const emptyRows = (count: number): ScoreRow[] =>
  Array.from({ length: count }, (_, index) => ({ gameNumber: index + 1, scoreA: "", scoreB: "" }));

// For team matches with specific players picked, show "Rahul & Priya (Team A)".
function matchSideLabel(entry: OrganizerMatch["entryA"], players: OrganizerMatch["playersA"]): string {
  if (players && players.length > 0) {
    const names = players.map((player) => player.name).join(" & ");
    return entry.teamName ? `${names} (${entry.teamName})` : names;
  }
  return entry.displayName;
}

function matchTypeLabel(match: OrganizerMatch): string {
  return match.matchType ? (match.matchType === "singles" ? "Singles" : "Doubles") : "";
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

const OrganizerMatchScoring = ({ eventId, showCompletedSection = true }: OrganizerMatchScoringProps) => {
  const queryClient = useQueryClient();
  const { data: matches = [] } = useOrganizerMatches(eventId);

  // Split active vs completed
  const activeMatches = useMemo(
    () => matches.filter((m) => m.status !== "completed"),
    [matches],
  );
  const completedMatches = useMemo(
    () => matches.filter((m) => m.status === "completed"),
    [matches],
  );

  const [selectedId, setSelectedId] = useState(activeMatches[0]?.id ?? "");
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [winner, setWinner] = useState<"entry_a" | "entry_b" | "">("");
  const [isSaving, setIsSaving] = useState(false);
  const [completedOpen, setCompletedOpen] = useState(false);

  const selectedMatch = useMemo(
    () => activeMatches.find((m) => m.id === selectedId) ?? null,
    [activeMatches, selectedId],
  );
  const maxGames = selectedMatch ? selectedMatch.gamesToWin * 2 - 1 : 0;

  // Keep selection valid when matches list updates
  useEffect(() => {
    if (!selectedId && activeMatches[0]) setSelectedId(activeMatches[0].id);
    if (selectedId && !activeMatches.some((m) => m.id === selectedId))
      setSelectedId(activeMatches[0]?.id ?? "");
  }, [activeMatches, selectedId]);

  // Populate score rows when selection changes
  useEffect(() => {
    if (!selectedMatch) { setRows([]); setWinner(""); return; }
    const existing = new Map(selectedMatch.games.map((g) => [g.gameNumber, g]));
    setRows(
      emptyRows(maxGames).map((row) => {
        const g = existing.get(row.gameNumber);
        return g ? { gameNumber: row.gameNumber, scoreA: String(g.scoreA), scoreB: String(g.scoreB) } : row;
      }),
    );
    setWinner(selectedMatch.winner ?? "");
  }, [maxGames, selectedMatch]);

  const updateRow = (index: number, field: "scoreA" | "scoreB", value: string) => {
    setRows((cur) => cur.map((row, i) => i === index ? { ...row, [field]: value } : row));
  };

  const saveScores = async (complete: boolean) => {
    if (!selectedMatch) return;
    // Every match — singles, doubles, team (with or without a match type) — is now
    // scored the same way: the organizer records game scores and picks the winner
    // manually. The legacy bout-aggregation model has been retired.
    if (complete && !winner) { toast.error("Select the winner before completing the match."); return; }
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
      // Preserve the picked players so scoring an edit doesn't wipe the selection.
      const playerPayload = selectedMatch.matchType
        ? {
            match_type: selectedMatch.matchType,
            player_a_participant_ids: (selectedMatch.playersA ?? []).map((player) => player.regParticipantId),
            player_b_participant_ids: (selectedMatch.playersB ?? []).map((player) => player.regParticipantId),
          }
        : {};
      const savedMatch = await apiRequest<OrganizerMatch>(`/organizer/events/${eventId}/matches/${selectedMatch.id}`, {
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
          auto_advance: selectedMatch.autoAdvance,
          games,
          ...playerPayload,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["organizer-matches", eventId] });
      toast.success(
        complete && savedMatch.nextMatchId
          ? "Match completed. Winner advanced to the next round."
          : complete ? "Match completed." : "Scores saved."
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save match scores.");
    } finally {
      setIsSaving(false);
    }
  };

  if (matches.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No matches available for scoring</CardTitle>
          <CardDescription>Schedule at least one match from the Matches page before entering scores.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Scheduled and in-progress matches will appear here for live score entry and completion.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Active scoring card */}
      <Card>
        <CardHeader>
          <CardTitle>Match scoring</CardTitle>
          <CardDescription>Enter actual game scores and select the winner manually. Scores are recorded as entered.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {activeMatches.length === 0 ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200">
              All matches are completed. See the completed matches section below.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="score-match">Match</Label>
                <select
                  id="score-match"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                >
                  {activeMatches.map((match) => (
                    <option key={match.id} value={match.id}>
                      {match.status === "in_progress" ? "▶ " : ""}{match.roundLabel}{match.matchType ? ` · ${matchTypeLabel(match)}` : ""} · {matchSideLabel(match.entryA, match.playersA)} vs {matchSideLabel(match.entryB, match.playersB)}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">Only scheduled and in-progress matches are shown here. Completed matches are listed below.</p>
              </div>

              {selectedMatch && (
                <>
                  {selectedMatch.matchType && (
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">{matchTypeLabel(selectedMatch)}</span>
                      <span className="text-xs text-muted-foreground">Team match — specific players selected</span>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Entry A</p>
                      <p className="mt-1 font-semibold">{selectedMatch.entryA.displayName}</p>
                      {selectedMatch.playersA && selectedMatch.playersA.length > 0 && (
                        <p className="mt-0.5 text-sm text-muted-foreground">{selectedMatch.playersA.map((player) => player.name).join(" & ")}</p>
                      )}
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Entry B</p>
                      <p className="mt-1 font-semibold">{selectedMatch.entryB.displayName}</p>
                      {selectedMatch.playersB && selectedMatch.playersB.length > 0 && (
                        <p className="mt-0.5 text-sm text-muted-foreground">{selectedMatch.playersB.map((player) => player.name).join(" & ")}</p>
                      )}
                    </div>
                  </div>

                  <>
                      <div className="space-y-3">
                        {rows.map((row, index) => (
                          <div key={row.gameNumber} className="grid grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)] items-end gap-3">
                            <div className="pb-2 text-sm font-medium">Game {row.gameNumber}</div>
                            <div className="space-y-2">
                              <Label htmlFor={`score-a-${selectedMatch.id}-${row.gameNumber}`}>Entry A</Label>
                              <Input id={`score-a-${selectedMatch.id}-${row.gameNumber}`} type="number" min={0} max={30} inputMode="numeric" value={row.scoreA} onChange={(e) => updateRow(index, "scoreA", e.target.value)} />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`score-b-${selectedMatch.id}-${row.gameNumber}`}>Entry B</Label>
                              <Input id={`score-b-${selectedMatch.id}-${row.gameNumber}`} type="number" min={0} max={30} inputMode="numeric" value={row.scoreB} onChange={(e) => updateRow(index, "scoreB", e.target.value)} />
                            </div>
                          </div>
                        ))}
                      </div>

                      <p className="text-xs leading-5 text-muted-foreground">Normal target: {selectedMatch.pointsPerGame}. Deuce can continue to 30; the hard cap is 30–29. SportPass does not calculate or validate the winner.</p>

                      <div className="flex flex-col gap-4 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-end sm:justify-between">
                        <div className="space-y-2">
                          <Label htmlFor={`score-winner-${selectedMatch.id}`}>Winner</Label>
                          <select
                            id={`score-winner-${selectedMatch.id}`}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-64"
                            value={winner}
                            onChange={(e) => setWinner(e.target.value as "entry_a" | "entry_b" | "")}
                          >
                            <option value="">Select winner</option>
                            <option value="entry_a">Entry A — {matchSideLabel(selectedMatch.entryA, selectedMatch.playersA)}</option>
                            <option value="entry_b">Entry B — {matchSideLabel(selectedMatch.entryB, selectedMatch.playersB)}</option>
                          </select>
                        </div>
                        <div className="flex gap-2">
                          <Button type="button" variant="outline" onClick={() => void saveScores(false)} disabled={isSaving}>
                            <Save className="mr-2 h-4 w-4" />Save scores
                          </Button>
                          <Button type="button" onClick={() => void saveScores(true)} disabled={isSaving}>
                            <CheckCircle2 className="mr-2 h-4 w-4" />Complete match
                          </Button>
                        </div>
                      </div>
                    </>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Completed matches section */}
      {showCompletedSection && completedMatches.length > 0 && (
        <Card>
          <CardHeader className="cursor-pointer select-none" onClick={() => setCompletedOpen((o) => !o)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CardTitle>Completed matches</CardTitle>
                <Badge variant="secondary">{completedMatches.length}</Badge>
              </div>
              {completedOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
            <CardDescription>Results recorded for this event. Click to expand.</CardDescription>
          </CardHeader>

          {completedOpen && (
            <CardContent>
              <div className="space-y-2">
                {completedMatches.map((match) => (
                  <div key={match.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {match.roundLabel} · {match.category.name}
                        {match.matchType ? ` · ${matchTypeLabel(match)}` : ""}
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
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
};

export default OrganizerMatchScoring;
