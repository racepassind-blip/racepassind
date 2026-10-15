import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Hash, Timer } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { apiRequest } from "@/lib/api";

type Feature = "bibNumbersEnabled" | "resultsEnabled";

export function EventFeatureDisabled({ eventId, feature, operationalFeatures }: { eventId: string; feature: Feature; operationalFeatures?: { bibNumbersEnabled: boolean; resultsEnabled: boolean } }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isBib = feature === "bibNumbersEnabled";
  const title = isBib ? "Bib numbers are off" : "Results are off";
  const description = isBib
    ? "Enable this only when this event needs participant bib or number assignments."
    : "Enable this when this event needs a published results board.";

  const enable = async (enabled: boolean) => {
    try {
      await apiRequest(`/organizer/events/${eventId}/operational-features`, {
        method: "PUT",
        body: JSON.stringify({
          bib_numbers_enabled: isBib ? enabled : Boolean(operationalFeatures?.bibNumbersEnabled),
          results_enabled: isBib ? Boolean(operationalFeatures?.resultsEnabled) : enabled,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["organizer-event-dashboard", eventId] });
      toast.success(enabled ? `${isBib ? "Bib numbers" : "Results"} enabled` : `${isBib ? "Bib numbers" : "Results"} disabled`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update this event feature.");
    }
  };

  return <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6"><Card><CardHeader><span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">{isBib ? <Hash className="h-5 w-5" /> : <Timer className="h-5 w-5" />}</span><CardTitle>{title}</CardTitle><CardDescription className="leading-6">{description} When it is off, this workspace and its public participant link stay hidden.</CardDescription></CardHeader><CardContent className="flex flex-wrap items-center justify-between gap-4 border-t pt-5"><label className="flex items-center gap-3 text-sm font-semibold"><Switch checked={false} onCheckedChange={(checked) => void enable(checked)} aria-label={`Enable ${isBib ? "bib numbers" : "results"}`} /> Enable {isBib ? "bib numbers" : "results"}</label><Button variant="outline" onClick={() => navigate(`/organizer/events/${eventId}`)}>Back to event</Button></CardContent></Card></div>;
}
