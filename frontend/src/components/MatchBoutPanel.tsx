import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/api";
import { useOrganizerBouts, type MatchBout, type OrganizerMatch } from "@/hooks/useEvents";

interface MatchBoutPanelProps {
  eventId: string;
  match: OrganizerMatch;
}

interface BoutDraft {
  playerAName: string;
  playerBName: string;
  winner: "" | "player_a" | "player_b" | "draw";
  scoreA: string;
  scoreB: string;
  status: "scheduled" | "in_progress" | "completed";
}

const emptyDraft: BoutDraft = { playerAName: "", playerBName: "", winner: "", scoreA: "", scoreB: "", status: "scheduled" };

const MatchBoutPanel = ({ eventId, match }: MatchBoutPanelProps) => {
  const queryClient = useQueryClient();
  const { data: bouts = [], isLoading } = useOrganizerBouts(eventId, match.id);
  const [draft, setDraft] = useState<BoutDraft>(emptyDraft);
  const [isSaving, setIsSaving] = useState(false);

  const playersA = match.entryA.participantNames ?? [match.entryA.participantName];
  const playersB = match.entryB.participantNames ?? [match.entryB.participantName];

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["organizer-bouts", eventId, match.id] }),
      queryClient.invalidateQueries({ queryKey: ["organizer-matches", eventId] }),
      queryClient.invalidateQueries({ queryKey: ["organizer-standings", eventId] }),
    ]);

  const addBout = async () => {
    if (!draft.playerAName || !draft.playerBName) {
      toast.error("Choose a player from each team.");
      return;
    }
    setIsSaving(true);
    try {
      await apiRequest(`/organizer/events/${eventId}/matches/${match.id}/bouts`, {
        method: "POST",
        body: JSON.stringify({
          player_a_name: draft.playerAName,
          player_b_name: draft.playerBName,
          status: draft.status,
          winner: draft.winner || null,
          score_a: draft.scoreA === "" ? null : Number(draft.scoreA),
          score_b: draft.scoreB === "" ? null : Number(draft.scoreB),
        }),
      });
      await invalidate();
      setDraft(emptyDraft);
      toast.success("Bout added.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add bout.");
    } finally {
      setIsSaving(false);
    }
  };

  const updateBoutResult = async (bout: MatchBout, patch: Partial<Pick<MatchBout, "winner" | "scoreA" | "scoreB" | "status">>) => {
    try {
      await apiRequest(`/organizer/events/${eventId}/matches/${match.id}/bouts/${bout.id}`, {
        method: "PUT",
        body: JSON.stringify({
          player_a_reg_participant_id: bout.playerARegParticipantId,
          player_b_reg_participant_id: bout.playerBRegParticipantId,
          player_a_name: bout.playerAName,
          player_b_name: bout.playerBName,
          court_id: bout.courtId,
          status: patch.status ?? bout.status,
          winner: patch.winner !== undefined ? (patch.winner || null) : bout.winner,
          score_a: patch.scoreA !== undefined ? patch.scoreA : bout.scoreA,
          score_b: patch.scoreB !== undefined ? patch.scoreB : bout.scoreB,
          scheduled_time: bout.scheduledTime,
        }),
      });
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update bout.");
    }
  };

  const deleteBout = async (bout: MatchBout) => {
    try {
      await apiRequest(`/organizer/events/${eventId}/matches/${match.id}/bouts/${bout.id}`, { method: "DELETE" });
      await invalidate();
      toast.success("Bout removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove bout.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bouts</CardTitle>
        <CardDescription>
          Any player from {match.entryA.displayName} can face any player from {match.entryB.displayName}. Score each bout;
          the match winner is decided by bout majority.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading bouts…</p>
        ) : bouts.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No bouts yet. Add one below.</p>
        ) : (
          <div className="space-y-2">
            {bouts.map((bout) => (
              <div key={bout.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                <div className="text-sm">
                  <span className="font-medium">{bout.playerAName ?? "Player A"}</span>
                  <span className="mx-1 text-muted-foreground">vs</span>
                  <span className="font-medium">{bout.playerBName ?? "Player B"}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Input className="h-8 w-14" type="number" min={0} value={bout.scoreA ?? ""} onChange={(e) => void updateBoutResult(bout, { scoreA: e.target.value === "" ? null : Number(e.target.value) })} />
                  <span className="text-muted-foreground">–</span>
                  <Input className="h-8 w-14" type="number" min={0} value={bout.scoreB ?? ""} onChange={(e) => void updateBoutResult(bout, { scoreB: e.target.value === "" ? null : Number(e.target.value) })} />
                </div>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  value={bout.winner ?? ""}
                  onChange={(e) => void updateBoutResult(bout, { winner: (e.target.value || null) as MatchBout["winner"], status: e.target.value ? "completed" : bout.status })}
                >
                  <option value="">Winner…</option>
                  <option value="player_a">{bout.playerAName ?? "Player A"}</option>
                  <option value="player_b">{bout.playerBName ?? "Player B"}</option>
                  <option value="draw">Draw</option>
                </select>
                <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => void deleteBout(bout)} aria-label="Remove bout">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Player from {match.entryA.displayName}</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={draft.playerAName}
              onChange={(e) => setDraft((d) => ({ ...d, playerAName: e.target.value }))}
            >
              <option value="">Select player</option>
              {playersA.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Player from {match.entryB.displayName}</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={draft.playerBName}
              onChange={(e) => setDraft((d) => ({ ...d, playerBName: e.target.value }))}
            >
              <option value="">Select player</option>
              {playersB.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Button type="button" size="sm" onClick={() => void addBout()} disabled={isSaving}>
              <Plus className="mr-1 h-4 w-4" /> Add bout
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default MatchBoutPanel;
