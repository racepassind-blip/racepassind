import { useEffect, useState } from "react";
import { Bell, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { enableEventPush } from "@/lib/pushNotifications";
import { apiRequest } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function EventPushPrompt({ eventId }: { eventId: string }) {
  const { user, isParticipant } = useAuth();
  const [hidden, setHidden] = useState(() => (
    sessionStorage.getItem(`push-prompt:${eventId}`) === "dismissed" ||
    localStorage.getItem(`push-enabled:${eventId}`) === "true"
  ));
  const [busy, setBusy] = useState(false);
  const [homeScreenRequired, setHomeScreenRequired] = useState(false);
  const [eligible, setEligible] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void apiRequest<{ eligible: boolean; enabled: boolean }>(`/push/subscriptions/status?event_id=${encodeURIComponent(eventId)}`)
      .then((status) => {
        if (!active) return;
        setEligible(status.eligible);
        if (status.enabled) {
          localStorage.setItem(`push-enabled:${eventId}`, "true");
          setHidden(true);
        }
      })
      .catch(() => { if (active) setEligible(false); });
    return () => { active = false; };
  }, [eventId]);

  if (!user || !isParticipant || eligible !== true || hidden) return null;

  const dismiss = () => {
    sessionStorage.setItem(`push-prompt:${eventId}`, "dismissed");
    setHidden(true);
  };

  const enable = async () => {
    setBusy(true);
    try {
      const result = await enableEventPush(eventId);
      if (result.status === "enabled") {
        localStorage.setItem(`push-enabled:${eventId}`, "true");
        toast.success("Event updates enabled");
        setHidden(true);
      } else if (result.status === "home-screen-required") {
        setHomeScreenRequired(true);
      } else if (result.status === "denied") {
        toast.error("Notifications are blocked. You can enable them in browser settings.");
      } else {
        toast.error("Push notifications are not available on this device yet.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not enable event updates");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Alert className="mb-6 border-primary/25 bg-primary/[0.04]">
      <Bell className="h-4 w-4" />
      <AlertTitle>Stay updated about this event</AlertTitle>
      <AlertDescription className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {homeScreenRequired ? (
          <span className="text-sm"><Smartphone className="mr-1 inline h-4 w-4" />On iPhone, use Share → Add to Home Screen, open SportPass, then enable updates.</span>
        ) : (
          <span>Get important route, schedule, venue, and check-in changes.</span>
        )}
        <span className="flex shrink-0 gap-2">
          {!homeScreenRequired && <Button size="sm" onClick={() => void enable()} disabled={busy}>{busy ? "Enabling…" : "Enable updates"}</Button>}
          <Button size="sm" variant="ghost" onClick={dismiss}>Not now</Button>
        </span>
      </AlertDescription>
    </Alert>
  );
}
