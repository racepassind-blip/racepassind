import { Link, NavLink, useLocation, matchPath } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/api";
import type { ParticipantRegistration } from "@/hooks/useParticipantRegistrations";
import { Bell, Hash, Info, Trophy } from "lucide-react";
import { useEvent } from "@/hooks/useEvents";
import { getSportConfig } from "@/data/sportConfig";

/** Keep participant destinations in the same place on every public event page. */
export function EventNavigation() {
  const { pathname } = useLocation();
  const match = matchPath("/event/:eventId/*", pathname);
  return match?.params.eventId ? <EventLinks eventId={match.params.eventId} /> : null;
}

function EventLinks({ eventId }: { eventId: string }) {
  const { data: event } = useEvent(eventId);
  if (!event) return null;
  const sport = getSportConfig(event.category);
  const base = `/event/${encodeURIComponent(eventId)}`;
  const links = [
    { to: base, label: "Overview", icon: Info, end: true },
    { to: `${base}/announcements`, label: "Announcements", icon: Bell, end: false },
    ...(sport.numberEnabled ? [{ to: `${base}/number-list`, label: sport.numberLabel || "Bib number", icon: Hash, end: false }] : []),
    ...(sport.result_type !== "none" ? [{ to: `${base}/results`, label: "Results", icon: Trophy, end: false }] : []),
  ];
  return (
    <div className="border-b bg-background print:hidden">
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
        <p className="mb-2 truncate text-sm font-semibold">{event.title}</p>
        <nav aria-label="Event navigation" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isActive ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
              <Icon aria-hidden="true" className="h-4 w-4 shrink-0" /><span className="break-words">{label}</span>
            </NavLink>
          ))}
        </nav>
        <PersonalEventInfo eventId={eventId} numberLabel={sport.numberLabel || "Bib number"} showNumber={sport.numberEnabled} showResults={sport.result_type !== "none"} />
      </div>
    </div>
  );
}

function PersonalEventInfo({ eventId, numberLabel, showNumber, showResults }: { eventId: string; numberLabel: string; showNumber: boolean; showResults: boolean }) {
  const { user, isParticipant, isInitialized } = useAuth();
  const query = useQuery({
    queryKey: ["participant-registrations", user?.id],
    queryFn: () => apiRequest<ParticipantRegistration[]>("/registrations/me"),
    enabled: isInitialized && isParticipant && Boolean(user),
  });
  if (!isInitialized) return null;
  if (!user) return <p className="mt-3 text-sm text-muted-foreground"><Link className="font-semibold text-primary underline" to="/login" state={{ from: `/event/${eventId}` }}>Sign in</Link> to see your registration and personal event details. Public updates are available above.</p>;
  if (!isParticipant) return null;
  if (query.isPending) return <p role="status" className="mt-3 text-sm text-muted-foreground">Loading your event details…</p>;
  if (query.isError) return <p className="mt-3 text-sm">Your event details could not be loaded. <button type="button" onClick={() => void query.refetch()} className="underline">Try again</button></p>;
  const registrations = query.data.filter((registration) => registration.event.id === eventId);
  return <section aria-label="Your event details" className="mt-3 rounded-lg border bg-muted/20 p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Your event details</h2><Link to="/dashboard/registrations" className="font-semibold text-primary underline">My registrations & tickets</Link></div>
    {registrations.length === 0 ? <p className="mt-2 text-muted-foreground">No registration for this event is linked to your account. If you booked as a guest, you can claim it in My registrations.</p> : registrations.map((registration) => <div key={registration.id} className="mt-3 border-t pt-3">
      <p className="break-words font-semibold">{registration.participantName} · {registration.ticketType.name}</p>
      <p className="mt-1 text-muted-foreground">{registration.status.replaceAll("_", " ")} · {registration.registrationReference}</p>
      {showNumber && <p className="mt-1">{numberLabel}: {registration.allocationNumber ?? "Not published yet"}</p>}
      {showResults && <p className="mt-1">Your result: {registration.raceResult ? [registration.raceResult.status, registration.raceResult.finishTime, registration.raceResult.rank != null ? `Rank ${registration.raceResult.rank}` : null].filter(Boolean).join(" · ") : "No published result linked to this registration yet"}</p>}
    </div>)}
  </section>;
}
