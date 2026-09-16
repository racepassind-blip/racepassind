import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/api";
import type { OrganizerEventCategory } from "@/hooks/useEvents";

interface TeamScoringResponse {
  categoryId: string;
  pointsForWin: number;
  pointsForDraw: number;
  pointsForLoss: number;
  winnerBy: "bouts" | "manual";
}

interface TeamScoringConfigProps {
  eventId: string;
  categories: OrganizerEventCategory[];
}

const TeamScoringConfig = ({ eventId, categories }: TeamScoringConfigProps) => {
  const queryClient = useQueryClient();
  const teamCategories = categories.filter((category) => category.entryType === "team");
  const [categoryId, setCategoryId] = useState(teamCategories[0]?.id ?? "");
  const [pointsForWin, setPointsForWin] = useState("3");
  const [pointsForDraw, setPointsForDraw] = useState("1");
  const [pointsForLoss, setPointsForLoss] = useState("0");
  const [winnerBy, setWinnerBy] = useState<"bouts" | "manual">("bouts");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!categoryId && teamCategories[0]) setCategoryId(teamCategories[0].id);
  }, [teamCategories, categoryId]);

  useEffect(() => {
    if (!categoryId) return;
    let cancelled = false;
    setIsLoading(true);
    apiRequest<TeamScoringResponse>(`/organizer/events/${eventId}/categories/${categoryId}/team-scoring`)
      .then((config) => {
        if (cancelled) return;
        setPointsForWin(String(config.pointsForWin));
        setPointsForDraw(String(config.pointsForDraw));
        setPointsForLoss(String(config.pointsForLoss));
        setWinnerBy(config.winnerBy);
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [eventId, categoryId]);

  const save = async () => {
    if (!categoryId) return;
    setIsSaving(true);
    try {
      await apiRequest(`/organizer/events/${eventId}/categories/${categoryId}/team-scoring`, {
        method: "PUT",
        body: JSON.stringify({
          points_for_win: Number(pointsForWin) || 0,
          points_for_draw: Number(pointsForDraw) || 0,
          points_for_loss: Number(pointsForLoss) || 0,
          winner_by: winnerBy,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["organizer-standings", eventId] });
      toast.success("Points system saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the points system.");
    } finally {
      setIsSaving(false);
    }
  };

  if (teamCategories.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team points system</CardTitle>
        <CardDescription>Set how league points are awarded and how the winner of each team match is decided.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="max-w-sm space-y-2">
          <Label htmlFor="team-scoring-category">Category</Label>
          <select
            id="team-scoring-category"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            {teamCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading points system…</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1"><Label>Points for win</Label><Input type="number" min={0} max={100} value={pointsForWin} onChange={(e) => setPointsForWin(e.target.value)} /></div>
              <div className="space-y-1"><Label>Points for draw</Label><Input type="number" min={0} max={100} value={pointsForDraw} onChange={(e) => setPointsForDraw(e.target.value)} /></div>
              <div className="space-y-1"><Label>Points for loss</Label><Input type="number" min={0} max={100} value={pointsForLoss} onChange={(e) => setPointsForLoss(e.target.value)} /></div>
            </div>
            <div className="space-y-2">
              <Label>Winner decided by</Label>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="radio" name="winner-by" checked={winnerBy === "bouts"} onChange={() => setWinnerBy("bouts")} /> Bout majority</label>
                <label className="flex items-center gap-2"><input type="radio" name="winner-by" checked={winnerBy === "manual"} onChange={() => setWinnerBy("manual")} /> Manual</label>
              </div>
            </div>
            <Button type="button" onClick={() => void save()} disabled={isSaving}>
              <Save className="mr-2 h-4 w-4" /> Save points system
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default TeamScoringConfig;
