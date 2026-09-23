import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getSportConfig } from "@/data/sportConfig";
import { computeSportPassFeePaise, formatPaise } from "@/lib/platform-fee";
import { useEvent } from "@/hooks/useEvents";
import { createWhatsAppUrl, WHATSAPP_MESSAGES } from "@/lib/whatsapp";
import {
  Calendar,
  MapPin,
  ArrowLeft,
  Trophy,
  Clock,
  User,
  Tag,
  Minus,
  Plus,
  ShieldCheck,
  Info,
  FileText,
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

const EventDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: event, isLoading, isError } = useEvent(id);
  const [quantities, setQuantities] = useState<Record<string, number>>({});

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
      const next = Math.max(0, Math.min(current + delta, tierMaxQty(tier)));
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
    percentageBasisPoints: event.sportPassFeePercentageBasisPoints ?? 500,
    perRegistrationPaise: event.sportPassFeePerRegistrationPaise ?? 1000,
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

  const details = [
    { icon: Calendar, label: "Date", value: new Date(event.date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) },
    { icon: MapPin, label: "Location", value: fullLocation },
    { icon: User, label: "Organizer", value: event.organizer },
    { icon: Tag, label: "Category", value: event.category },
    { icon: Trophy, label: "Distance", value: event.distance },
    // Participants Limit hidden for now — it reflects a per-event default that
    // can be misleading on the public page.
    // { icon: Users, label: "Participants Limit", value: `${event.maxParticipants.toLocaleString()} max` },
  ];

  // Check if bib numbers are enabled for this sport
  const eventSportConfig = getSportConfig(event.category);
  const hasNumberAllocation = eventSportConfig.numberEnabled;
  const numberLabel = eventSportConfig.numberLabel || "Bib Number";
  const sportMessage = eventSportConfig.message;

  return (
    <Layout>
      {/* Banner */}
      <div className="relative h-[320px] overflow-hidden md:h-[420px]">
        <img
          src={event.image}
          alt={event.title}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-black/10" />
        <div className="relative mx-auto flex h-full max-w-7xl flex-col justify-end px-4 pb-8 sm:px-6 lg:px-8">
          <div className="w-fit max-w-full rounded-2xl bg-black/55 px-4 py-4 shadow-lg backdrop-blur-sm sm:px-5">
            <button
              onClick={() => navigate(-1)}
              className="mb-4 flex w-fit items-center gap-1 text-sm text-white/90 transition-colors hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <Badge className="mb-2 w-fit capitalize">{event.category}</Badge>
            <h1 className="text-3xl font-extrabold tracking-tight text-white md:text-5xl">
              {event.title}
            </h1>
            <p className="mt-2 text-sm text-white/90 md:text-base">
              {new Date(event.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} · {event.location}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid lg:grid-cols-3 gap-10">
          {/* Left Side */}
          <div className="lg:col-span-2 space-y-8">
            {/* Event Details Grid */}
            <section>
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Info className="h-5 w-5 text-primary" /> Event Details
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {details.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-xl border bg-card p-4 space-y-1"
                  >
                    <item.icon className="h-5 w-5 text-primary" />
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                    <p className="font-semibold text-sm capitalize">{item.value}</p>
                  </div>
                ))}
              </div>
              <Button variant="outline" className="mt-4 gap-2" onClick={() => navigate(`/event/${encodeURIComponent(id ?? "")}/results`)}><Trophy className="h-4 w-4" /> View public results</Button>
            </section>

            {/* Sport-Specific Message */}
            {sportMessage && (
              <section>
                <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
                  <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div>
                    <p className="text-sm text-muted-foreground">{sportMessage}</p>
                  </div>
                </div>
              </section>
            )}

            {/* Description */}
            <section>
              <h2 className="mb-3 text-xl font-bold">About This Event</h2>
              <div className="space-y-5 text-muted-foreground">
                <p className="whitespace-pre-line leading-relaxed">{event.description}</p>
                <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
                  <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div>
                    <p className="text-xs text-muted-foreground">Event location</p>
                    <p className="font-semibold text-foreground">{fullLocation}</p>
                  </div>
                </div>
              </div>
            </section>

            {/* Schedule */}
            <section>
              <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
                <Clock className="h-5 w-5 text-primary" /> Event Schedule
              </h2>
              <div className="rounded-xl border bg-card p-5">
                {event.schedule?.length ? <div className="space-y-0">
                  {event.schedule.map((item, i) => (
                    <div key={`${item.time}-${i}`} className="group flex items-start gap-4 py-3">
                      <div className="flex flex-col items-center">
                        <div className="h-3 w-3 rounded-full border-2 border-primary bg-card group-first:bg-primary" />
                        {i < event.schedule!.length - 1 && <div className="min-h-[20px] h-full w-px bg-border" />}
                      </div>
                      <div className="-mt-1 flex items-center gap-3">
                        <span className="w-14 font-mono text-sm font-semibold text-primary">{item.time}</span>
                        <span className="text-sm text-muted-foreground">{item.label}</span>
                      </div>
                    </div>
                  ))}
                </div> : <p className="text-sm text-muted-foreground">The event schedule will be announced by the organizer.</p>}
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

          {/* Right Side — Sticky Ticket Card */}
          <div className="lg:col-span-1">
            <div className="sticky top-24 space-y-4">
              <div className="rounded-xl border bg-card shadow-lg overflow-hidden">
                <div className="bg-primary px-5 py-4">
                  <h2 className="text-lg font-bold text-primary-foreground">
                    Select Tickets
                  </h2>
                  <p className="text-sm text-primary-foreground/70">
                    {event.participants.toLocaleString()} registered
                  </p>
                </div>

                {registrationClosed && <div className="border-b bg-amber-50 px-5 py-4 text-sm text-amber-950"><p className="font-semibold">Registration is closed</p><p className="mt-1">The organizer is not accepting new responses for this race.</p></div>}

                <div className="p-5 space-y-4">
                  {event.tiers.map((tier) => {
                    const qty = quantities[tier.id] || 0;
                    return (
                      <div
                        key={tier.id}
                        className={`rounded-lg border p-4 space-y-3 transition-colors ${
                          qty > 0 ? "border-primary bg-primary/5" : "hover:border-muted-foreground/30"
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-bold text-sm">{tier.name}</h3>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {tier.description}
                            </p>
                          </div>
                          <span className="text-lg font-bold text-primary whitespace-nowrap ml-3">
                            ₹{tier.price}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">
                            {tier.available} spots left
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => updateQty(tier.id, -1)}
                              disabled={registrationClosed || qty === 0}
                              className="h-7 w-7 rounded-md border flex items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <span className="w-6 text-center text-sm font-semibold">
                              {qty}
                            </span>
                            <button
                              onClick={() => updateQty(tier.id, 1)}
                              disabled={registrationClosed || qty >= tierMaxQty(tier)}
                              className="h-7 w-7 rounded-md border flex items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {tier.entryType === "team" && (
                          <p className="text-xs text-muted-foreground">
                            Only one team can be registered per registration
                            {tier.teamSizeMin && tier.teamSizeMax ? ` (${tier.teamSizeMin}–${tier.teamSizeMax} members).` : "."}
                          </p>
                        )}
                      </div>
                    );
                  })}

                  <Separator />

                  {participantBearsFee && totalTickets > 0 && sportPassFeePaise > 0 ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>Registration Fee</span>
                        <span>{formatPaise(baseTotalPaise)}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>SportPass Fee</span>
                        <span>{formatPaise(sportPassFeePaise)}</span>
                      </div>
                      <div className="flex items-center justify-between border-t pt-1.5">
                        <span className="text-sm font-medium">Total</span>
                        <span className="text-xl font-bold">{formatPaise(participantTotalPaise)}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        {totalTickets} ticket{totalTickets !== 1 ? "s" : ""}
                      </span>
                      <span className="text-xl font-bold">₹{totalPrice}</span>
                    </div>
                  )}

                  <Button
                    className="w-full"
                    size="lg"
                    disabled={registrationClosed || totalTickets === 0}
                    onClick={() => {
                      const cart = Object.entries(quantities)
                        .filter(([, quantity]) => quantity > 0)
                        .map(([ticketId, quantity]) => ({ ticketId, quantity }));
                      sessionStorage.setItem(`sportpass_cart_${event.id}`, JSON.stringify(cart));
                      navigate(`/checkout/${event.id}`);
                    }}
                  >
                    {registrationClosed ? "Registration Closed" : totalTickets === 0 ? "Select Tickets to Continue" : `Register Now — ${formatPaise(participantTotalPaise)}`}
                  </Button>

                  {/* Show Bib Number Link if allocations are enabled */}
                  {hasNumberAllocation && (
                    <div className="pt-4">
                      <Separator />
                      <div className="mt-4 text-center">
                        <p className="text-sm text-muted-foreground mb-2">
                          {numberLabel}
                        </p>
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={() => navigate(`/event/${event.id}/number-list`)}
                        >
                          <FileText className="mr-2 h-4 w-4" />
                          View {numberLabel} List
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default EventDetail;
