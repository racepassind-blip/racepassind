import { Link } from "react-router-dom";
import { AlertCircle, ArrowRight, CalendarDays, CheckCircle2, ClipboardList, Clock3, Sparkles, Ticket } from "lucide-react";

import { DashboardLayout } from "@/components/DashboardLayout";
import { ParticipantRegistrationCard } from "@/components/ParticipantRegistrationCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useParticipantRegistrations } from "@/hooks/useParticipantRegistrations";

const Dashboard = () => {
  const { user } = useAuth();
  const { data: registrations = [], isLoading, isError, error } = useParticipantRegistrations();
  const errorMessage = error instanceof Error ? error.message : "Failed to load your registrations.";
  const confirmedCount = registrations.filter((registration) => ["confirmed", "checked_in"].includes(registration.status)).length;
  const checkedInCount = registrations.filter((registration) => registration.checkInStatus === "checked_in").length;
  const pendingCount = registrations.filter((registration) => !["confirmed", "checked_in"].includes(registration.status)).length;
  const firstName = user?.name?.split(" ")[0] ?? "there";

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-8 p-4 sm:p-6 lg:p-10">
        <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">Participant dashboard</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Welcome back, {firstName}.</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Your tickets, registrations, and race-day details are all in one place.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="outline" className="gap-2"><Link to="/dashboard/registrations"><ClipboardList className="h-4 w-4" /> Manage registrations</Link></Button>
            <Button asChild className="gap-2"><Link to="/"><Sparkles className="h-4 w-4" /> Browse events</Link></Button>
          </div>
        </header>

        <section className="relative overflow-hidden rounded-3xl bg-slate-950 px-6 py-8 text-white shadow-lg sm:px-8 sm:py-10">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-orange-500 via-white to-green-500" />
          <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-primary/25 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-accent/15 blur-3xl" />
          <div className="relative flex flex-col justify-between gap-8 lg:flex-row lg:items-center">
            <div className="max-w-2xl">
              <Badge className="border-white/15 bg-white/10 text-white hover:bg-white/10">Race day, made simple</Badge>
              <h2 className="mt-4 text-2xl font-black tracking-tight sm:text-3xl">Ready for your next start?</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">Find a new event, register in minutes, and keep every ticket ready for check-in. Guest registrations can also be claimed here whenever you create an account.</p>
            </div>
            <div className="flex shrink-0 flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row"><Button asChild size="lg" className="gap-2 bg-white text-slate-950 hover:bg-white/90"><Link to="/"><span>Find an event</span><ArrowRight className="h-4 w-4" /></Link></Button><Button asChild size="lg" variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"><Link to="/dashboard/registrations">Claim a guest ticket</Link></Button></div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-3" aria-label="Registration summary">
          <Card className="border-primary/15 bg-primary/5 shadow-none"><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-sm font-semibold text-muted-foreground">Total registrations</p><Ticket className="h-5 w-5 text-primary" /></div><p className="mt-3 text-3xl font-black tracking-tight">{registrations.length}</p><p className="mt-1 text-xs text-muted-foreground">Linked to your account</p></CardContent></Card>
          <Card className="border-accent/20 bg-accent/5 shadow-none"><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-sm font-semibold text-muted-foreground">Confirmed</p><CheckCircle2 className="h-5 w-5 text-accent" /></div><p className="mt-3 text-3xl font-black tracking-tight">{confirmedCount}</p><p className="mt-1 text-xs text-muted-foreground">Ready for race day</p></CardContent></Card>
          <Card className="border-border bg-card shadow-none"><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-sm font-semibold text-muted-foreground">Check-ins</p><CalendarDays className="h-5 w-5 text-primary" /></div><p className="mt-3 text-3xl font-black tracking-tight">{checkedInCount}</p><p className="mt-1 text-xs text-muted-foreground">{pendingCount > 0 ? `${pendingCount} awaiting action` : "Your race history is up to date"}</p></CardContent></Card>
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">Your SportPass</p><h2 className="mt-1 text-2xl font-black tracking-tight">My tickets</h2><p className="mt-1 text-sm text-muted-foreground">Open a ticket to review its QR code, payment status, and check-in details.</p></div>
            {registrations.length > 0 && <Button asChild variant="ghost" className="gap-2"><Link to="/dashboard/registrations">View all registrations <ArrowRight className="h-4 w-4" /></Link></Button>}
          </div>

          {isLoading && <div className="grid gap-5 lg:grid-cols-2"><Card><CardContent className="space-y-4 p-6"><div className="h-5 w-2/3 animate-pulse rounded bg-muted" /><div className="h-4 w-1/2 animate-pulse rounded bg-muted" /><div className="h-28 animate-pulse rounded-xl bg-muted" /></CardContent></Card><Card><CardContent className="space-y-4 p-6"><div className="h-5 w-2/3 animate-pulse rounded bg-muted" /><div className="h-4 w-1/2 animate-pulse rounded bg-muted" /><div className="h-28 animate-pulse rounded-xl bg-muted" /></CardContent></Card></div>}
          {!isLoading && isError && <Card><CardContent className="flex items-start gap-3 py-10 text-sm text-destructive"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-semibold">We couldn’t load your tickets</p><p className="mt-1">{errorMessage}</p></div></CardContent></Card>}
          {!isLoading && !isError && registrations.length === 0 && <Card className="overflow-hidden"><CardContent className="relative py-14 text-center"><div className="pointer-events-none absolute inset-x-1/3 top-0 h-32 rounded-full bg-primary/10 blur-3xl" /><div className="relative"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Ticket className="h-7 w-7" /></div><h3 className="mt-5 text-xl font-black">Your next race starts here</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Browse upcoming events or claim a guest registration using the reference and private code from your confirmation.</p><div className="mt-6 flex flex-wrap justify-center gap-3"><Button asChild><Link to="/">Browse events</Link></Button><Button asChild variant="outline"><Link to="/dashboard/registrations">Claim a registration</Link></Button></div></div></CardContent></Card>}
          {!isLoading && !isError && registrations.length > 0 && <div className="grid gap-5 lg:grid-cols-2">{registrations.map((registration) => <ParticipantRegistrationCard key={registration.id} registration={registration} />)}</div>}
        </section>

        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" /> Keep your QR ticket private and show it only at event check-in.</div>
      </div>
    </DashboardLayout>
  );
};

export default Dashboard;
