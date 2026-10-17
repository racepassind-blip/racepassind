import { Link } from "react-router-dom";
import { AlertCircle, ArrowRight, Bell, CalendarDays, CheckCircle2, ClipboardList, Clock3, MapPin, QrCode, Sparkles } from "lucide-react";

import { DashboardLayout } from "@/components/DashboardLayout";
import { ParticipantRegistrationCard, RegistrationStatusBadge } from "@/components/ParticipantRegistrationCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useParticipantRegistrations } from "@/hooks/useParticipantRegistrations";
import { useParticipantAnnouncements } from "@/hooks/useParticipantAnnouncements";
import { formatRegistrationDate, registrationDateValue } from "@/lib/registration-format";

const Dashboard = () => {
  const { user } = useAuth();
  const { data: registrations = [], isLoading, isError, error } = useParticipantRegistrations();
  const { data: announcementData, isLoading: announcementsLoading } = useParticipantAnnouncements();
  const announcements = announcementData?.items ?? [];
  const errorMessage = error instanceof Error ? error.message : "Failed to load your registrations.";
  const confirmedCount = registrations.filter((registration) => ["confirmed", "checked_in"].includes(registration.status)).length;
  const checkedInCount = registrations.filter((registration) => registration.checkInStatus === "checked_in").length;
  const pendingCount = registrations.filter((registration) => ["awaiting_payment", "pending_verification"].includes(registration.status)).length;
  const firstName = user?.name?.split(" ")[0] ?? "there";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const nextRegistration = registrations
    .filter((registration) => registration.paymentStatus !== "refunded" && !["rejected", "expired"].includes(registration.status) && registrationDateValue(registration.event.date) !== Number.MAX_SAFE_INTEGER && registrationDateValue(registration.event.date) >= today.getTime())
    .sort((first, second) => registrationDateValue(first.event.date) - registrationDateValue(second.event.date))[0];
  const daysToNextEvent = nextRegistration ? Math.max(0, Math.ceil((registrationDateValue(nextRegistration.event.date) - today.getTime()) / 86400000)) : null;
  const featuredRegistrations = nextRegistration
    ? [nextRegistration, ...registrations.filter((registration) => registration.id !== nextRegistration.id)].slice(0, 4)
    : registrations.slice(0, 4);

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-10">
        <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">Participant dashboard</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Welcome back, {firstName}.</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Your tickets, registrations, and race-day details are all in one place.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="outline" className="gap-2"><Link to="/dashboard/registrations"><ClipboardList className="h-4 w-4" /> Manage registrations</Link></Button>
            <Button asChild className="gap-2"><Link to="/events"><Sparkles className="h-4 w-4" /> Browse events</Link></Button>
          </div>
        </header>

        {!announcementsLoading && announcements.length > 0 && <Card className="border-primary/30 bg-primary/[0.05] shadow-none"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><span className="rounded-lg bg-primary/10 p-2 text-primary"><Bell className="h-5 w-5" /></span><div><p className="font-bold">{announcements.length} organizer {announcements.length === 1 ? "message" : "messages"} for your registered events</p><p className="mt-0.5 text-sm text-muted-foreground">See what changed before race day.</p></div></div><Button asChild size="sm" className="shrink-0"><a href="#organizer-updates">Read updates</a></Button></CardContent></Card>}

        {nextRegistration && <section className="overflow-hidden rounded-2xl border border-primary/20 bg-card shadow-sm" aria-label="Next registered event">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/10 bg-primary/5 px-5 py-3 sm:px-6"><span className="text-xs font-semibold text-primary">{daysToNextEvent === 0 ? "Today’s event" : "Coming up next"}</span><RegistrationStatusBadge status={nextRegistration.status} /></div>
          <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="flex min-w-0 items-start gap-4">
              <div className="hidden h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-primary/10 text-primary sm:flex"><span className="text-xl font-black leading-none">{daysToNextEvent}</span><span className="mt-1 text-[10px] font-bold uppercase tracking-wide">{daysToNextEvent === 1 ? "day" : "days"}</span></div>
              <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Next on your calendar</p><h2 className="mt-1 truncate text-xl font-black tracking-tight">{nextRegistration.event.name}</h2><p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground"><span>{formatRegistrationDate(nextRegistration.event.date)}</span><span aria-hidden="true">·</span><MapPin className="h-3.5 w-3.5" />{nextRegistration.event.location}</p><p className="mt-2 text-xs font-medium text-muted-foreground">{daysToNextEvent === 0 ? "Happening today" : `${daysToNextEvent} ${daysToNextEvent === 1 ? "day" : "days"} to go`} · {nextRegistration.ticket ? "Your QR ticket is ready" : "Registration details available"}</p></div>
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex"><Button asChild className="gap-2"><a href={`#registration-${nextRegistration.id}`}><QrCode className="h-4 w-4" />{nextRegistration.ticket ? "View QR ticket" : "View registration"}</a></Button><Button asChild variant="outline"><Link to={`/event/${encodeURIComponent(nextRegistration.event.id)}`}>Event details</Link></Button></div>
          </div>
        </section>}

        {!isLoading && !isError && !nextRegistration && <section className="relative overflow-hidden rounded-2xl bg-slate-950 px-5 py-6 text-white sm:px-8 sm:py-8">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-orange-500 via-white to-green-500" />
          <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-primary/25 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-accent/15 blur-3xl" />
          <div className="relative flex flex-col justify-between gap-8 lg:flex-row lg:items-center">
            <div className="max-w-2xl">
              <Badge className="border-white/15 bg-white/10 text-white hover:bg-white/10">Race day, made simple</Badge>
              <h2 className="mt-4 text-2xl font-black tracking-tight sm:text-3xl">{nextRegistration ? "Find your next challenge." : "Your next start begins here."}</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">{nextRegistration ? "Keep your plans moving with another event. Your tickets and race-day details stay together in SportPass." : "Find an event, register in minutes, and keep every ticket ready for check-in."}</p>
            </div>
            <div className="flex shrink-0 flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row"><Button asChild size="lg" className="gap-2 bg-white text-slate-950 hover:bg-white/90"><Link to="/"><span>Find an event</span><ArrowRight className="h-4 w-4" /></Link></Button><Button asChild size="lg" variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"><Link to="/dashboard/registrations">Claim a guest ticket</Link></Button></div>
          </div>
        </section>}

        {!isLoading && !isError && <section className="grid grid-cols-3 gap-2 [&_.p-5]:p-3 [&_.text-3xl]:text-2xl sm:gap-4 sm:[&_.p-5]:p-5 [&_svg]:hidden sm:[&_svg]:block" aria-label="Registration summary">
          <Card className="border-primary/15 bg-primary/5 shadow-none"><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-sm font-semibold text-muted-foreground">Total registrations</p><ClipboardList className="h-5 w-5 text-primary" /></div><p className="mt-3 text-3xl font-black tracking-tight">{registrations.length}</p><p className="mt-1 text-xs text-muted-foreground">Linked to your account</p></CardContent></Card>
          <Card className="border-accent/20 bg-accent/5 shadow-none"><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-sm font-semibold text-muted-foreground">Confirmed</p><CheckCircle2 className="h-5 w-5 text-accent" /></div><p className="mt-3 text-3xl font-black tracking-tight">{confirmedCount}</p><p className="mt-1 text-xs text-muted-foreground">Ready for race day</p></CardContent></Card>
          <Card className="border-border bg-card shadow-none"><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-sm font-semibold text-muted-foreground">Check-ins</p><CalendarDays className="h-5 w-5 text-primary" /></div><p className="mt-3 text-3xl font-black tracking-tight">{checkedInCount}</p><p className="mt-1 text-xs text-muted-foreground">{pendingCount > 0 ? `${pendingCount} awaiting action` : "Your race history is up to date"}</p></CardContent></Card>
        </section>}

        {(announcementsLoading || announcements.length > 0) && <section id="organizer-updates" className="space-y-4 scroll-mt-24" aria-label="Updates from your event organizers">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">Organizer messages</p><h2 className="mt-1 text-2xl font-black tracking-tight">Updates for your events</h2><p className="mt-1 text-sm text-muted-foreground">Only updates from events with a confirmed registration are shown here.</p></div></div>
          {announcementsLoading ? <Card><CardContent className="flex items-center gap-3 p-5 text-sm text-muted-foreground"><Bell className="h-5 w-5 animate-pulse text-primary" />Checking for updates from your organizers…</CardContent></Card> : <div className="grid gap-4 lg:grid-cols-2">{announcements.slice(0, 4).map(({ event, announcement }) => <Card key={announcement.id} className={announcement.isPinned ? "border-primary/35" : ""}><CardContent className="p-5"><div className="flex items-start gap-3"><div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary"><Bell className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-wide text-primary">Message from {event.organizer}</p><h3 className="mt-1 font-bold leading-5">{announcement.title}</h3><p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">{announcement.body}</p><p className="mt-3 text-xs text-muted-foreground">{event.title} · {announcement.publishedAt ? new Date(announcement.publishedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "New update"}</p><div className="mt-4 flex flex-wrap gap-2"><Button asChild size="sm"><Link to={`/event/${event.id}/announcements`}>Read all updates</Link></Button><Button asChild size="sm" variant="outline"><Link to={`/event/${event.id}`}>Open event</Link></Button></div></div></div></CardContent></Card>)}</div>}
        </section>}

        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">Your SportPass</p><h2 className="mt-1 text-2xl font-black tracking-tight">My tickets</h2><p className="mt-1 text-sm text-muted-foreground">Open a ticket to review its QR code, payment status, and check-in details.</p></div>
            {registrations.length > 0 && <Button asChild variant="ghost" className="gap-2"><Link to="/dashboard/registrations">View all registrations <ArrowRight className="h-4 w-4" /></Link></Button>}
          </div>

          {isLoading && <div className="grid gap-5 lg:grid-cols-2"><Card><CardContent className="space-y-4 p-6"><div className="h-5 w-2/3 animate-pulse rounded bg-muted" /><div className="h-4 w-1/2 animate-pulse rounded bg-muted" /><div className="h-28 animate-pulse rounded-xl bg-muted" /></CardContent></Card><Card><CardContent className="space-y-4 p-6"><div className="h-5 w-2/3 animate-pulse rounded bg-muted" /><div className="h-4 w-1/2 animate-pulse rounded bg-muted" /><div className="h-28 animate-pulse rounded-xl bg-muted" /></CardContent></Card></div>}
          {!isLoading && isError && <Card><CardContent className="flex items-start gap-3 py-10 text-sm text-destructive"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-semibold">We couldn’t load your tickets</p><p className="mt-1">{errorMessage}</p></div></CardContent></Card>}
          {!isLoading && !isError && registrations.length === 0 && <Card className="overflow-hidden"><CardContent className="relative py-14 text-center"><div className="pointer-events-none absolute inset-x-1/3 top-0 h-32 rounded-full bg-primary/10 blur-3xl" /><div className="relative"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><ClipboardList className="h-7 w-7" /></div><h3 className="mt-5 text-xl font-black">Your next race starts here</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Browse upcoming events or claim a guest registration using the reference and private code from your confirmation.</p><div className="mt-6 flex flex-wrap justify-center gap-3"><Button asChild><Link to="/">Browse events</Link></Button><Button asChild variant="outline"><Link to="/dashboard/registrations">Claim a registration</Link></Button></div></div></CardContent></Card>}
          {!isLoading && !isError && registrations.length > 0 && <div className="grid items-start gap-5 lg:grid-cols-2">{featuredRegistrations.map((registration) => <div key={registration.id} id={`registration-${registration.id}`} tabIndex={-1} className="scroll-mt-24 rounded-xl target:ring-2 target:ring-primary target:ring-offset-4"><ParticipantRegistrationCard registration={registration} /></div>)}</div>}
        </section>

        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" /> Keep your QR ticket private and show it only at event check-in.</div>
      </div>
    </DashboardLayout>
  );
};

export default Dashboard;
