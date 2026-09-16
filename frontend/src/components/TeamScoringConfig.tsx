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

// Team match winners are decided per match by the organizer (Match type +
// selected players determine who plays; the organizer records the result).
// The legacy "winner decided by" bout model is no longer surfaced in the UI,
// but the backend field is preserved for compatibility, so we always send a
// fixed value. "manual" keeps the backend from auto-recomputing winners from
// bouts, which is the correct behaviour for the current match-type flow.
const FIXED_WINNER_BY = "manual" as const;

const TeamScoringConfig = ({ eventId, categories }: TeamScoringConfigProps) => {
  const queryClient = useQueryClient();
  const teamCategories = categories.filter((category) => category.entryType === "team");
  const [categoryId, setCategoryId] = useState(teamCategories[0]?.id ?? "");
  const [pointsForWin, setPointsForWin] = useState("3");
  const [pointsForDraw, setPointsForDraw] = useState("1");
  const [pointsForLoss, setPointsForLoss] = useState("0");
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
          winner_by: FIXED_WINNER_BY,
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
        <CardDescription>
          Set how league points are awarded for standings when a category has multiple teams. Each match winner is
          recorded by the organizer from the match result.
        </CardDescription>
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
            <p className="text-xs text-muted-foreground">
              Standings rank teams by total points across completed matches in the category. Points above are applied
              per match result.
            </p>
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
