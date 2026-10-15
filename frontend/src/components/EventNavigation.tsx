import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bell, ChevronRight, Hash, Trophy } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/api";
import { usePublicNumberList } from "@/hooks/useAllocations";
import { usePublicRaceResults } from "@/hooks/useRaceTimeResults";
import { usePublicEventAnnouncements, usePublicEventResults } from "@/hooks/useEvents";
import type { ParticipantRegistration } from "@/hooks/useParticipantRegistrations";
import { getSportConfig } from "@/data/sportConfig";

/** A permanent, participant-friendly home for event updates and documents. */
export function EventNavigation({ eventId }: { eventId: string }) {
  const { data: announcements } = usePublicEventAnnouncements(eventId);
  const event = announcements?.event;
  const sport = getSportConfig(event?.category);
  const supportsNumbers = sport.numberEnabled;
  const supportsResults = sport.result_type !== "none";
  const numbers = usePublicNumberList(eventId, supportsNumbers);
  const raceResults = usePublicRaceResults(eventId, sport.result_type === "race_time");
  const matchResults = usePublicEventResults(eventId, sport.result_type === "match_score");
  const base = `/event/${encodeURIComponent(eventId)}`;
  const announcementCount = announcements?.announcements.length ?? 0;
  const latest = announcements?.announcements[0];
  const bibsPublished = (numbers.data?.entries.length ?? 0) > 0;
  const resultsPublished = sport.result_type === "race_time"
    ? raceResults.data?.resultSetStatus === "published"
    : sport.result_type === "match_score" && Boolean(matchResults.data?.matches.some((match) => match.status === "completed"));

  return <section aria-label="Event hub" className="mb-8 overflow-hidden rounded-2xl border bg-card shadow-sm">
    <div className="border-b px-5 py-5 sm:px-6">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Event hub</p>
      <h2 className="mt-1 text-xl font-bold">Updates, bibs and results</h2>
      <p className="mt-1 text-sm text-muted-foreground">Everything released by the organizer for this event lives here.</p>
    </div>
    <div className={`grid gap-px bg-border ${supportsNumbers && supportsResults ? "lg:grid-cols-3" : "md:grid-cols-2"}`}>
      <HubCard to={`${base}/announcements`} icon={Bell} eyebrow={announcementCount ? `${announcementCount} update${announcementCount === 1 ? "" : "s"}` : "Updates from organizer"} title={latest?.title ?? "Announcements"} description={latest?.body ?? "No announcements have been published yet. Check here for organizer updates."} />
      {supportsNumbers && <HubCard to={`${base}/number-list`} icon={Hash} eyebrow={bibsPublished ? "Released" : numbers.isLoading ? "Checking status" : "Not released yet"} title={bibsPublished ? `${numbers.data?.numberLabel ?? sport.numberLabel ?? "Bib numbers"} are ready` : `${sport.numberLabel || "Bib number"} not released`} description={bibsPublished ? "Find your published assignment before event day." : "The organizer will publish assignments here when they are ready."} muted={!bibsPublished} />}
      {supportsResults && <HubCard to={`${base}/results`} icon={Trophy} eyebrow={resultsPublished ? "Results live" : (raceResults.isLoading || matchResults.isLoading) ? "Checking status" : "Not released yet"} title={resultsPublished ? "Results are available" : "Results are not released"} description={resultsPublished ? "View published standings and category results." : "Published results will appear here after the organizer releases them."} muted={!resultsPublished} />}
    </div>
    <PersonalEventInfo eventId={eventId} numberLabel={sport.numberLabel || "Bib number"} showNumber={supportsNumbers} showResults={supportsResults} />
  </section>;
}

function HubCard({ to, icon: Icon, eyebrow, title, description, muted = false }: { to: string; icon: typeof Bell; eyebrow: string; title: string; description: string; muted?: boolean }) {
  return <Link to={to} className="group flex min-h-44 flex-col bg-card p-5 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-6">
    <div className="flex items-start justify-between gap-3"><span className={`flex h-11 w-11 items-center justify-center rounded-xl ${muted ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}><Icon className="h-5 w-5" /></span><ChevronRight className="mt-2 h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" /></div>
    <p className={`mt-5 text-xs font-bold uppercase tracking-[0.12em] ${muted ? "text-muted-foreground" : "text-primary"}`}>{eyebrow}</p>
    <h3 className="mt-1 text-base font-bold leading-5">{title}</h3>
    <p className="mt-2 text-sm leading-5 text-muted-foreground">{description}</p>
  </Link>;
}

function PersonalEventInfo({ eventId, numberLabel, showNumber, showResults }: { eventId: string; numberLabel: string; showNumber: boolean; showResults: boolean }) {
  const { user, isParticipant, isInitialized } = useAuth();
  const query = useQuery({ queryKey: ["participant-registrations", user?.id], queryFn: () => apiRequest<ParticipantRegistration[]>("/registrations/me"), enabled: isInitialized && isParticipant && Boolean(user) });
  if (!isInitialized) return null;
  if (!user) return <div className="border-t bg-muted/20 px-5 py-4 text-sm text-muted-foreground sm:px-6"><Link className="font-semibold text-primary underline" to="/login" state={{ from: `/event/${eventId}` }}>Sign in</Link> to see your own registration, {numberLabel.toLowerCase()} and result.</div>;
  if (!isParticipant || query.isPending) return null;
  if (query.isError) return <div className="border-t px-5 py-4 text-sm">Your event details could not be loaded. <button type="button" onClick={() => void query.refetch()} className="font-semibold underline">Try again</button></div>;
  const registrations = query.data.filter((registration) => registration.event.id === eventId);
  if (registrations.length === 0) return <div className="border-t bg-muted/20 px-5 py-4 text-sm text-muted-foreground sm:px-6">No registration for this event is linked to your account. <Link to="/dashboard/registrations" className="font-semibold text-primary underline">Claim a guest registration</Link> in My registrations.</div>;
  return <section aria-label="Your event details" className="border-t bg-muted/20 px-5 py-5 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">Your event details</h3><Link to="/dashboard/registrations" className="text-sm font-semibold text-primary underline">My tickets</Link></div>{registrations.map((registration) => <div key={registration.id} className="mt-3 border-t pt-3 text-sm"><p className="font-semibold">{registration.participantName} · {registration.ticketType.name}</p><p className="mt-1 text-muted-foreground">{registration.registrationReference}{showNumber ? ` · ${numberLabel}: ${registration.allocationNumber ?? "not published"}` : ""}{showResults ? ` · Result: ${registration.raceResult ? [registration.raceResult.status, registration.raceResult.finishTime, registration.raceResult.rank != null ? `Rank ${registration.raceResult.rank}` : null].filter(Boolean).join(" · ") : "not published"}` : ""}</p></div>)}</section>;
}
