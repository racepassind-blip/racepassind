import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOrganizerScoringConfig } from "@/hooks/useEvents";
import { apiRequest } from "@/lib/api";

interface OrganizerScoringConfigProps {
  eventId: string;
  enabled: boolean;
}

type Draft = { gamesToWin: string; pointsPerGame: string };

const OrganizerScoringConfig = ({ eventId, enabled }: OrganizerScoringConfigProps) => {
  const { data, isLoading, isError } = useOrganizerScoringConfig(eventId, enabled);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setDrafts(Object.fromEntries(data.categories.map((config) => [config.categoryId, { gamesToWin: String(config.gamesToWin), pointsPerGame: String(config.pointsPerGame) }])));
  }, [data]);

  const updateDraft = (categoryId: string, field: keyof Draft, value: string) => {
    setDrafts((current) => ({ ...current, [categoryId]: { ...current[categoryId], [field]: value } }));
  };

  const saveConfig = async (categoryId: string) => {
    const draft = drafts[categoryId];
    const gamesToWin = Number(draft?.gamesToWin);
    const pointsPerGame = Number(draft?.pointsPerGame);
    if (!Number.isInteger(gamesToWin) || gamesToWin < 1 || gamesToWin > 5 || !Number.isInteger(pointsPerGame) || pointsPerGame < 1 || pointsPerGame > 30) {
      toast.error("Games to win must be 1–5 and points per game must be 1–30.");
      return;
    }
    setSavingId(categoryId);
    try {
      await apiRequest(`/organizer/events/${eventId}/categories/${categoryId}/scoring-config`, {
        method: "PUT",
        body: JSON.stringify({ games_to_win: gamesToWin, points_per_game: pointsPerGame }),
      });
      toast.success("Scoring configuration saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save scoring configuration.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Scoring configuration</CardTitle><CardDescription>Set the defaults used when new matches are created. Scores can still continue beyond the points target up to 30.</CardDescription></CardHeader>
      <CardContent>
        {isLoading ? <p className="py-6 text-center text-sm text-muted-foreground">Loading scoring configuration…</p> : isError ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Could not load scoring configuration.</div> : data?.categories.length === 0 ? <p className="text-sm text-muted-foreground">Add a category to configure scoring.</p> : <div className="space-y-4">{data?.categories.map((config) => {
          const draft = drafts[config.categoryId] ?? { gamesToWin: String(config.gamesToWin), pointsPerGame: String(config.pointsPerGame) };
          return <div key={config.categoryId} className="grid gap-4 rounded-lg border p-4 sm:grid-cols-[minmax(0,1fr)_8rem_8rem_auto] sm:items-end"><div><p className="font-medium">{config.categoryName}</p><p className="mt-1 text-xs text-muted-foreground">Best of up to {Math.max(1, Number(draft.gamesToWin) * 2 - 1)} games</p></div><div className="space-y-2"><Label htmlFor={`games-to-win-${config.categoryId}`}>Games to win</Label><Input id={`games-to-win-${config.categoryId}`} type="number" min={1} max={5} value={draft.gamesToWin} onChange={(event) => updateDraft(config.categoryId, "gamesToWin", event.target.value)} /></div><div className="space-y-2"><Label htmlFor={`points-per-game-${config.categoryId}`}>Points / game</Label><Input id={`points-per-game-${config.categoryId}`} type="number" min={1} max={30} value={draft.pointsPerGame} onChange={(event) => updateDraft(config.categoryId, "pointsPerGame", event.target.value)} /></div><Button type="button" variant="outline" onClick={() => void saveConfig(config.categoryId)} disabled={savingId === config.categoryId}><Save className="mr-2 h-4 w-4" />{savingId === config.categoryId ? "Saving…" : "Save"}</Button></div>;
        })}</div>}
        <p className="mt-4 text-xs leading-5 text-muted-foreground">Normal target is 21. Deuce may continue to 30, with a hard cap of 30–29. SportPass records the scores and organizer-selected winner; it does not calculate or validate the winner.</p>
      </CardContent>
    </Card>
  );
};

export default OrganizerScoringConfig;
