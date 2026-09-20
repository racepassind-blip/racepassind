import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { useOrganizerEventDashboard } from "@/hooks/useEvents";
import { isFreeEvent } from "@/data/sportConfig";

/**
 * Locks paid-only event pages for free events.
 *
 * Free events (every ticket priced at ₹0) only get the core workflow: the event
 * overview and registrations. Paid-only tooling — communications, check-in, bib
 * management, tournament pages — is hidden in the nav and blocked by URL.
 *
 * Call this at the top of a paid-only event page. When the loaded event turns out
 * to be free, the organizer is redirected back to the event overview with a notice.
 *
 * Returns the dashboard query state so callers can render a loading state while the
 * free/paid status is still unknown (avoids briefly flashing locked content).
 */
export function useFreeEventLock(eventId: string | undefined) {
  const navigate = useNavigate();
  const query = useOrganizerEventDashboard(eventId);
  const { data: dashboard, isLoading } = query;

  const locked = Boolean(dashboard?.event) && isFreeEvent(dashboard?.event.categories);

  useEffect(() => {
    if (!eventId || isLoading || !dashboard?.event) return;
    if (isFreeEvent(dashboard.event.categories)) {
      toast.info("This section is available for paid events only.");
      navigate(`/organizer/events/${eventId}`, { replace: true });
    }
  }, [eventId, isLoading, dashboard, navigate]);

  return { ...query, locked };
}
