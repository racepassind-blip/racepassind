import { MAX_TICKETS_PER_TRANSACTION } from "@/lib/registration-limits";
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getSportConfig } from "@/data/sportConfig";
import { computeSportPassFeePaise, formatPaise } from "@/lib/platform-fee";
import { useEvent, usePublicEventResults } from "@/hooks/useEvents";
import { usePublicNumberList } from "@/hooks/useAllocations";
import { usePublicRaceResults } from "@/hooks/useRaceTimeResults";
import { createWhatsAppUrl, WHATSAPP_MESSAGES } from "@/lib/whatsapp";
import {
  Calendar,
  MapPin,
  ArrowLeft,
  ArrowRight,
  Trophy,
  Clock,
  User,
  Tag,
  Minus,
  Plus,
  ShieldCheck,
  Info,
  FileText,
  Check,
} from "lucide-react";

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M16 0C7.163 0 0 7.163 0 16c0 2.833.738 5.494 2.031 7.8L0 32l8.418-2.007A15.934 15.934 0 0016 32c8.837 0 16-7.163 16-16S24.837 0 16 0zm0 29.333a13.267 13.267 0 01-6.771-1.853l-.485-.29-5.013 1.196 1.25-4.883-.317-.5A13.24 13.24 0 012.667 16C2.667 8.636 8.636 2.667 16 2.667S29.333 8.636 29.333 16 23.364 29.333 16 29.333zm7.27-9.927c-.398-.2-2.358-1.163-2.723-1.296-.364-.133-.63-.2-.896.2-.265.4-1.03 1.296-1.262 1.562-.232.267-.465.3-.863.1-.398-.2-1.682-.62-3.203-1.978-1.184-1.057-1.983-2.362-2.216-2.762-.232-.4-.025-.616.175-.815.18-.178.398-.465.597-.697.2-.233.265-.4.398-.666.133-.267.066-.5-.033-.7-.1-.2-.896-2.162-1.228-2.96-.323-.778-.651-.672-.896-.684-.232-.012-.498-.015-.764-.015s-.697.1-.996.483C9.07 11.17 8 12.333 8 14.128s1.163 3.594 1.329 3.843c.165.25 2.29 3.497 5.546 4.904 3.256 1.408 3.256.938 3.843.879.587-.058 1.892-.773 2.158-1.52.265-.747.265-1.387.185-1.52-.08-.133-.315-.2-.713-.4z" />
    </svg>
  );
}

function parseEventDate(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

function eventDayNumber(start: string, current: string): number {
  const toUtcDay = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.floor((toUtcDay(current) - toUtcDay(start)) / 86_400_000) + 1;
}

function formatEventDateRange(start: string, end?: string | null, includeWeekday = false): string {
  const options: Intl.DateTimeFormatOptions = {
    ...(includeWeekday ? { weekday: "long" as const } : {}),
    month: "long",
    day: "numeric",
    year: "numeric",
  };
  const startLabel = parseEventDate(start).toLocaleDateString("en-IN", options);
  if (!end || end === start) return startLabel;
  return `${startLabel} – ${parseEventDate(end).toLocaleDateString("en-IN", options)}`;
}

const EventDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: event, isLoading, isError } = useEvent(id);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const eventSportConfig = getSportConfig(event?.category);
  const publicNumbers = usePublicNumberList(id ?? "", Boolean(event) && eventSportConfig.numberEnabled);
  const publicMatchResults = usePublicEventResults(id, Boolean(event) && eventSportConfig.result_type === "match_score");
  const publicRaceResults = usePublicRaceResults(id, Boolean(event) && eventSportConfig.result_type === "race_time");

  if (isLoading) {
    return (
      <Layout>
        <div className="mx-auto max-w-7xl px-4 py-20 text-center">
          <p className="text-muted-foreground">Loading event…</p>
        </div>
      </Layout>
    );
  }

  if (isError || !event) {
    return (
      <Layout>
        <div className="mx-auto max-w-7xl px-4 py-20 text-center">
          <p className="text-muted-foreground">Event not found.</p>
        </div>
      </Layout>
    );
  }

  const registrationClosed = event.registrationStatus === "closed";
  // Team categories: only one team entry can be registered at a time.
  const tierMaxQty = (tier?: { entryType?: string; available: number }) =>
    tier?.entryType === "team" ? Math.min(tier.available, 1) : Math.min(tier?.available ?? 0, 10);
  const updateQty = (tierId: string, delta: number) => {
    if (registrationClosed) return;
    setQuantities((prev) => {
      const tier = event.tiers.find((t) => t.id === tierId);
      const current = prev[tierId] || 0;
      const otherTickets = Object.values(prev).reduce((sum, quantity) => sum + quantity, 0) - current;
      const next = Math.max(0, Math.min(current + delta, tierMaxQty(tier), MAX_TICKETS_PER_TRANSACTION - otherTickets));
      return { ...prev, [tierId]: next };
    });
  };

  const totalPrice = event.tiers.reduce(
    (sum, tier) => sum + (quantities[tier.id] || 0) * tier.price,
    0
  );
  const totalTickets = Object.values(quantities).reduce((a, b) => a + b, 0);

  // SportPass fee preview. When the participant bears the fee, it is added per
  // paid registration (one ticket unit = one registration). Free entries (₹0) never accrue a fee.
  const feeConfig = {
    percentageBasisPoints: event.sportPassFeePercentageBasisPoints ?? 400,
    minimumFeePaise: event.sportPassFeeMinimumPaise ?? 2000,
    maximumFeePaise: event.sportPassFeeMaximumPaise ?? 6000,
  };
  const participantBearsFee = event.platformFeeBearer === "PARTICIPANT";
  const sportPassFeePaise = event.tiers.reduce((sum, tier) => {
    const qty = quantities[tier.id] || 0;
    if (qty === 0) return sum;
    return sum + qty * computeSportPassFeePaise(tier.price * 100, feeConfig);
  }, 0);
  const baseTotalPaise = totalPrice * 100;
  const participantTotalPaise = baseTotalPaise + (participantBearsFee ? sportPassFeePaise : 0);

  const locationParts = [
    event.locationDetails?.name ?? event.location,
    event.locationDetails?.address,
    event.locationDetails?.city,
    event.locationDetails?.state,
    event.locationDetails?.country,
  ].filter((part, index, parts): part is string => Boolean(part) && parts.indexOf(part) === index);
  const fullLocation = locationParts.join(", ") || event.location;
  const scheduleDays = [...new Set((event.schedule ?? []).map((item) => item.date || event.date))].sort();

  const details = [
    { icon: Calendar, label: event.endDate ? "Dates" : "Date", value: formatEventDateRange(event.date, event.endDate, true) },
    { icon: MapPin, label: "Location", value: fullLocation },
    { icon: User, label: "Organizer", value: event.organizer },
    { icon: Tag, label: "Category", value: event.category },
    { icon: Trophy, label: "Distance", value: event.distance },
    // Participants Limit hidden for now — it reflects a per-event default that
    // can be misleading on the public page.
    // { icon: Users, label: "Participants Limit", value: `${event.maxParticipants.toLocaleString()} max` },
  ];

  // Check if bib numbers are enabled for this sport
  const hasNumberAllocation = eventSportConfig.numberEnabled;
  const numberLabel = eventSportConfig.numberLabel || "Bib Number";
  const sportMessage = eventSportConfig.message;
  const hasPublishedNumbers = hasNumberAllocation && (publicNumbers.data?.entries.length ?? 0) > 0;
  const hasPublishedResults = eventSportConfig.result_type === "race_time"
    ? publicRaceResults.data?.resultSetStatus === "published"
    : eventSportConfig.result_type === "match_score" && Boolean(publicMatchResults.data?.matches.some((match) => match.status === "completed"));

  return (
    <Layout>
      <section className="relative h-[340px] overflow-hidden md:h-[460px]">
        <img
          src={event.image}
          alt={event.title}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-black/30" />
        <div className="relative mx-auto flex h-full max-w-7xl flex-col justify-between px-4 pb-12 pt-6 sm:px-6 lg:px-8">
          <button onClick={() => navigate(-1)} className="flex w-fit items-center gap-2 rounded-full border border-white/30 bg-black/25 px-3 py-2 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/45">
            <ArrowLeft className="h-4 w-4" /> Back to events
          </button>
          <div className="max-w-4xl">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge className="border-0 bg-white text-foreground hover:bg-white capitalize">{event.category}</Badge>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${registrationClosed ? "bg-amber-100 text-amber-950" : "bg-emerald-100 text-emerald-950"}`}>
                {registrationClosed ? "Registration closed" : "Registration open"}
              </span>
            </div>
            <h1 className="max-w-4xl text-3xl font-extrabold leading-tight tracking-tight text-white drop-shadow-sm sm:text-4xl md:text-5xl">{event.title}</h1>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-white/90 sm:text-base">
              <span className="flex items-center gap-2"><Calendar className="h-4 w-4" />{formatEventDateRange(event.date, event.endDate)}</span>
              <span className="flex items-center gap-2"><MapPin className="h-4 w-4" />{event.location}</span>
            </div>
          </div>
        </div>
      </section>

      <div className="relative mx-auto -mt-6 max-w-7xl px-4 pb-14 sm:px-6 lg:px-8">
        <div className="mb-8 grid gap-px overflow-hidden rounded-2xl border bg-border shadow-md sm:grid-cols-2 lg:grid-cols-4">
          {details.slice(0, 4).map((item) => (
            <div key={item.label} className="flex items-start gap-3 bg-card p-4 sm:p-5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><item.icon className="h-4 w-4" /></span>
              <div className="min-w-0"><p className="text-xs font-medium text-muted-foreground">{item.label}</p><p className="mt-1 text-sm font-semibold capitalize leading-5">{item.value}</p></div>
            </div>
          ))}
        </div>

        {(hasPublishedNumbers || hasPublishedResults) && <section className="mb-8 overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="border-b px-5 py-4 sm:px-6"><p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Event updates</p><h2 className="mt-1 text-lg font-bold">Published information</h2></div>
          <div className={`grid gap-px bg-border ${hasPublishedNumbers && hasPublishedResults ? "md:grid-cols-2" : ""}`}>
            {hasPublishedNumbers && <button type="button" onClick={() => navigate(`/event/${event.id}/number-list`)} className="group flex items-center gap-4 bg-card p-5 text-left transition-colors hover:bg-muted/40 sm:p-6">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><FileText className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1"><span className="block font-bold">{numberLabel}s are published</span><span className="mt-1 block text-sm leading-5 text-muted-foreground">Find your assigned {numberLabel.toLowerCase()} before event day.</span></span>
              <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </button>}
            {hasPublishedResults && <button type="button" onClick={() => navigate(`/event/${encodeURIComponent(id ?? "")}/results`)} className="group flex items-center gap-4 bg-card p-5 text-left transition-colors hover:bg-muted/40 sm:p-6">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Trophy className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1"><span className="block font-bold">Results are live</span><span className="mt-1 block text-sm leading-5 text-muted-foreground">View published results and category standings.</span></span>
              <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </button>}
          </div>
        </section>}

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
          <div className="space-y-8">
            <section id="about" className="overflow-hidden rounded-2xl border bg-card">
              <div className="p-5 sm:p-6">
                <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Event overview</p><h2 className="mt-1 text-2xl font-bold">About the event</h2></div>
                <p className="mt-5 whitespace-pre-line leading-7 text-muted-foreground">{event.description}</p>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <div className="flex items-start gap-3 rounded-xl bg-muted/45 p-4"><MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div><p className="text-xs font-medium text-muted-foreground">Venue</p><p className="mt-1 text-sm font-semibold leading-5">{fullLocation}</p></div></div>
                  {event.distance && <div className="flex items-start gap-3 rounded-xl bg-muted/45 p-4"><Trophy className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div><p className="text-xs font-medium text-muted-foreground">Categories / distance</p><p className="mt-1 text-sm font-semibold leading-5">{event.distance}</p></div></div>}
                </div>
              </div>
              {sportMessage && <div className="flex items-start gap-3 border-t bg-primary/[0.035] px-5 py-4 sm:px-6"><Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><p className="text-sm leading-6 text-muted-foreground">{sportMessage}</p></div>}
            </section>

            {/* Schedule */}
            <section>
              <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
                <Clock className="h-5 w-5 text-primary" /> Event Schedule
              </h2>
              <div className="rounded-xl border bg-card p-5">
                {event.schedule?.length ? <div className="space-y-6">{scheduleDays.map((date) => {
                  const items = event.schedule!.filter((item) => (item.date || event.date) === date).sort((left, right) => left.time.localeCompare(right.time));
                  return <div key={date}>
                    <div className="mb-2 flex items-center gap-3"><div className="rounded-lg bg-primary/10 px-3 py-2 text-center"><p className="text-[10px] font-bold uppercase tracking-wider text-primary">Day {eventDayNumber(event.date, date)}</p><p className="text-sm font-bold">{parseEventDate(date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</p></div><div className="h-px flex-1 bg-border" /></div>
                    <div className="space-y-0">{items.map((item, itemIndex) => <div key={`${date}-${item.time}-${itemIndex}`} className="group flex items-start gap-4 py-3"><div className="flex flex-col items-center"><div className="h-3 w-3 rounded-full border-2 border-primary bg-card group-first:bg-primary" />{itemIndex < items.length - 1 && <div className="min-h-[20px] h-full w-px bg-border" />}</div><div className="-mt-1 flex items-center gap-3"><span className="w-14 font-mono text-sm font-semibold text-primary">{item.time}</span><span className="text-sm text-muted-foreground">{item.label}</span></div></div>)}</div>
                  </div>;
                })}</div> : <p className="text-sm text-muted-foreground">The event schedule will be announced by the organizer.</p>}
              </div>
            </section>

            {/* Rules */}
            <section>
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" /> Rules & Regulations
              </h2>
              <div className="rounded-xl border bg-card p-5">
                {event.rules?.length ? <ul className="space-y-3">
                  {event.rules.map((rule, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                        {i + 1}
                      </span>
                      <span>{rule}</span>
                    </li>
                  ))}
                </ul> : <p className="text-sm text-muted-foreground">No rules have been published by the organizer yet.</p>}
              </div>
            </section>

            {/* Refund Policy — only shown when refund_policy_enabled */}
            {event.refundPolicyEnabled && (
              <section>
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-primary" /> Refund Policy
                </h2>
                <div className="rounded-xl border bg-card p-5 space-y-3 text-sm text-muted-foreground">
                  {event.refundPolicyType === "full_refund" && event.refundCutoffAt && (
                    <p>Refunds are available until <span className="font-semibold text-foreground">{new Date(event.refundCutoffAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</span>.</p>
                  )}
                  {event.refundPolicyType === "partial_refund" && (
                    <p>A partial refund of <span className="font-semibold text-foreground">{event.refundPercentage ?? 100}%</span> of the registration fee is available{event.refundCutoffAt ? ` until ${new Date(event.refundCutoffAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}` : ""}.</p>
                  )}
                  {event.refundPolicyType === "organizer_approval" && (
                    <p>Refund requests are subject to organizer approval. Submit your request and the organizer will review it.</p>
                  )}
                  {event.refundPolicyType === "no_refund" && (
                    <p className="text-amber-700 font-medium">No refunds are available after registration.</p>
                  )}
                  {event.refundPolicyType !== "no_refund" && (
                    <p><span className="font-semibold text-foreground">SportPass convenience fee</span> is {event.platformFeeRefundable ? "refundable" : "non-refundable"}.</p>
                  )}
                  {event.refundPolicyText && (
                    <p className="border-t pt-3 whitespace-pre-line">{event.refundPolicyText}</p>
                  )}
                </div>
              </section>
            )}

            {/* WhatsApp Support CTA */}
            <section>
              <div className="rounded-xl border border-[#25D366]/20 bg-[#25D366]/5 p-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white">
                    <WhatsAppIcon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-sm">Need help? Chat with SportPass</h3>
                    <p className="mt-1 text-sm text-muted-foreground mb-3">
                      Have questions about {event.title}? We're here to help via WhatsApp.
                    </p>
                    <a
                      href={createWhatsAppUrl(WHATSAPP_MESSAGES.eventSupport(event.title))}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#25D366] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#20bd5a] focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:ring-offset-2"
                    >
                      <WhatsAppIcon className="h-4 w-4" />
                      Chat on WhatsApp
                    </a>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <aside className="order-first lg:order-none lg:sticky lg:top-24">
            <div className="overflow-hidden rounded-2xl border bg-card shadow-lg shadow-black/5">
              <div className="border-b p-5">
                <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Registration</p><h2 className="mt-1 text-xl font-bold">Choose your entry</h2></div><span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">{event.participants.toLocaleString()} registered</span></div>
                <p className="mt-2 text-sm text-muted-foreground">Select the ticket and number of entries you want to register.</p>
                <div className="mt-4 flex items-center gap-3 border-t pt-4">
                  {event.organizerInfo?.logoUrl ? <img src={event.organizerInfo.logoUrl} alt={`${event.organizerInfo.name} logo`} className="h-10 w-10 rounded-lg border bg-white object-contain p-1" /> : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-primary/10 text-sm font-black text-primary">{(event.organizerInfo?.name ?? event.organizer ?? "Organizer").slice(0, 1).toUpperCase()}</span>}
                  <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Organized by</p><p className="truncate text-sm font-semibold">{event.organizerInfo?.name ?? event.organizer}</p></div>
                </div>
              </div>

              {registrationClosed && <div className="border-b border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950"><p className="font-semibold">Registration is closed</p><p className="mt-1 leading-5">The organizer is no longer accepting new registrations.</p></div>}

              <div className="space-y-4 p-4 sm:p-5">
                <p className="text-sm text-muted-foreground" aria-live="polite">{totalTickets} / {MAX_TICKETS_PER_TRANSACTION} tickets selected. Maximum {MAX_TICKETS_PER_TRANSACTION} tickets per transaction.</p>
                <div className="space-y-3">
                  {event.tiers.map((tier) => {
                    const qty = quantities[tier.id] || 0;
                    const soldOut = tier.available <= 0;
                    return <div key={tier.id} className={`rounded-xl border p-4 transition-colors ${qty > 0 ? "border-primary bg-primary/[0.04] shadow-sm" : "bg-background hover:border-primary/40"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0"><div className="flex items-center gap-2"><h3 className="font-bold leading-5">{tier.name}</h3>{qty > 0 && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check className="h-3 w-3" /></span>}</div>{tier.description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{tier.description}</p>}</div>
                        <span className="shrink-0 text-lg font-extrabold text-primary">{tier.price === 0 ? "Free" : formatPaise(tier.price * 100)}</span>
                      </div>

                      {tier.entryType === "team" && <p className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">One ticket registers one team{tier.teamSizeMin && tier.teamSizeMax ? ` of ${tier.teamSizeMin}–${tier.teamSizeMax} members` : ""}.</p>}

                      <div className="mt-4 flex items-center justify-between gap-4">
                        <span className={`text-xs font-medium ${soldOut ? "text-destructive" : tier.available <= 10 ? "text-amber-700" : "text-muted-foreground"}`}>{soldOut ? "Sold out" : `${tier.available.toLocaleString("en-IN")} ${tier.available === 1 ? "spot" : "spots"} left`}</span>
                        <div className="flex items-center rounded-lg border bg-card" aria-label={`Quantity for ${tier.name}`}>
                          <button aria-label={`Remove one ${tier.name}`} onClick={() => updateQty(tier.id, -1)} disabled={registrationClosed || qty === 0} className="flex h-9 w-9 items-center justify-center rounded-l-lg text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"><Minus className="h-4 w-4" /></button>
                          <span className="w-9 text-center text-sm font-bold" aria-live="polite">{qty}</span>
                          <button aria-label={`Add one ${tier.name}`} onClick={() => updateQty(tier.id, 1)} disabled={registrationClosed || soldOut || qty >= tierMaxQty(tier) || totalTickets >= MAX_TICKETS_PER_TRANSACTION} className="flex h-9 w-9 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"><Plus className="h-4 w-4" /></button>
                        </div>
                      </div>
                    </div>;
                  })}
                </div>

                <div className="rounded-xl bg-muted/45 p-4">
                  {participantBearsFee && totalTickets > 0 && sportPassFeePaise > 0 ? <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm text-muted-foreground"><span>Registration fee</span><span>{formatPaise(baseTotalPaise)}</span></div>
                    <div className="flex items-center justify-between text-sm text-muted-foreground"><span>SportPass fee</span><span>{formatPaise(sportPassFeePaise)}</span></div>
                    <div className="flex items-center justify-between border-t pt-3"><span className="font-bold">Total</span><span className="text-xl font-extrabold">{formatPaise(participantTotalPaise)}</span></div>
                  </div> : <div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">{totalTickets} {totalTickets === 1 ? "entry" : "entries"} selected</p><p className="font-bold">Total</p></div><span className="text-xl font-extrabold">{formatPaise(baseTotalPaise)}</span></div>}
                </div>

                <Button className="h-12 w-full gap-2 text-base" size="lg" disabled={registrationClosed || totalTickets === 0 || totalTickets > MAX_TICKETS_PER_TRANSACTION} onClick={() => {
                  const cart = Object.entries(quantities).filter(([, quantity]) => quantity > 0).map(([ticketId, quantity]) => ({ ticketId, quantity }));
                  sessionStorage.setItem(`sportpass_cart_${event.id}`, JSON.stringify(cart));
                  navigate(`/checkout/${event.id}`);
                }}>
                  {registrationClosed ? "Registration closed" : totalTickets === 0 ? "Select an entry to continue" : <>Continue to registration <ArrowRight className="h-4 w-4" /></>}
                </Button>
                {!registrationClosed && <p className="text-center text-xs leading-5 text-muted-foreground">You can review participant details and the final amount before payment.</p>}

              </div>
            </div>
          </aside>
        </div>
      </div>
    </Layout>
  );
};

export default EventDetail;
