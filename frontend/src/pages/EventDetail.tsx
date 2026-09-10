import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useEvent } from "@/hooks/useEvents";
import {
  Calendar,
  MapPin,
  Users,
  ArrowLeft,
  Trophy,
  Clock,
  User,
  Tag,
  Minus,
  Plus,
  ShieldCheck,
  Info,
} from "lucide-react";

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

  const updateQty = (tierId: string, delta: number) => {
    setQuantities((prev) => {
      const tier = event.tiers.find((t) => t.id === tierId);
      const current = prev[tierId] || 0;
      const next = Math.max(0, Math.min(current + delta, tier?.available ?? 0, 10));
      return { ...prev, [tierId]: next };
    });
  };

  const totalPrice = event.tiers.reduce(
    (sum, tier) => sum + (quantities[tier.id] || 0) * tier.price,
    0
  );
  const totalTickets = Object.values(quantities).reduce((a, b) => a + b, 0);

  const schedule = [
    { time: "06:00", label: "Registration & Kit Pickup" },
    { time: "07:00", label: "Transition Area Opens" },
    { time: "07:30", label: "Warm-up & Race Briefing" },
    { time: "08:00", label: "Race Start — Wave 1" },
    { time: "08:15", label: "Race Start — Wave 2" },
    { time: "12:00", label: "Aid Station Cut-off (50K)" },
    { time: "14:00", label: "Finish Line Closes" },
    { time: "15:00", label: "Awards Ceremony & Celebration" },
  ];

  const details = [
    { icon: Calendar, label: "Date", value: new Date(event.date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) },
    { icon: MapPin, label: "Location", value: event.location },
    { icon: User, label: "Organizer", value: event.organizer },
    { icon: Tag, label: "Category", value: event.category },
    { icon: Trophy, label: "Distance", value: event.distance },
    { icon: Users, label: "Participants Limit", value: `${event.maxParticipants.toLocaleString()} max` },
  ];

  return (
    <Layout>
      {/* Banner */}
      <div className="relative h-[320px] md:h-[420px] overflow-hidden">
        <img
          src={event.image}
          alt={event.title}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-foreground/80 via-foreground/30 to-transparent" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-full flex flex-col justify-end pb-8">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1 text-sm text-primary-foreground/80 hover:text-primary-foreground mb-4 w-fit"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <Badge className="w-fit capitalize mb-2">{event.category}</Badge>
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-primary-foreground">
            {event.title}
          </h1>
          <p className="mt-2 text-primary-foreground/70 text-sm md:text-base">
            {new Date(event.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} · {event.location}
          </p>
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
            </section>

            {/* Description */}
            <section>
              <h2 className="text-xl font-bold mb-3">About This Event</h2>
              <p className="text-muted-foreground leading-relaxed">
                {event.description}
              </p>
            </section>

            {/* Location Map Placeholder */}
            <section>
              <h2 className="text-xl font-bold mb-3 flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary" /> Location
              </h2>
              <div className="rounded-xl border bg-card overflow-hidden">
                <div className="aspect-[16/7] bg-muted flex items-center justify-center">
                  <div className="text-center space-y-2">
                    <MapPin className="h-10 w-10 text-muted-foreground/40 mx-auto" />
                    <p className="text-sm text-muted-foreground">{event.location}</p>
                    <p className="text-xs text-muted-foreground/60">Interactive map coming soon</p>
                  </div>
                </div>
              </div>
            </section>

            {/* Schedule */}
            <section>
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" /> Event Schedule
              </h2>
              <div className="rounded-xl border bg-card p-5">
                <div className="space-y-0">
                  {schedule.map((s, i) => (
                    <div key={s.time + i} className="flex items-start gap-4 py-3 group">
                      <div className="flex flex-col items-center">
                        <div className="h-3 w-3 rounded-full border-2 border-primary bg-card group-first:bg-primary" />
                        {i < schedule.length - 1 && (
                          <div className="w-px h-full min-h-[20px] bg-border" />
                        )}
                      </div>
                      <div className="flex items-center gap-3 -mt-1">
                        <span className="font-mono font-semibold text-sm text-primary w-14">
                          {s.time}
                        </span>
                        <span className="text-sm text-muted-foreground">{s.label}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Rules */}
            <section>
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" /> Rules & Regulations
              </h2>
              <div className="rounded-xl border bg-card p-5">
                <ul className="space-y-3">
                  {event.rules.map((rule, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
                      <span className="flex-shrink-0 mt-0.5 h-5 w-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                        {i + 1}
                      </span>
                      {rule}
                    </li>
                  ))}
                </ul>
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
                    {event.participants.toLocaleString()} / {event.maxParticipants.toLocaleString()} registered
                  </p>
                </div>

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
                              disabled={qty === 0}
                              className="h-7 w-7 rounded-md border flex items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <span className="w-6 text-center text-sm font-semibold">
                              {qty}
                            </span>
                            <button
                              onClick={() => updateQty(tier.id, 1)}
                              disabled={qty >= Math.min(tier.available, 10)}
                              className="h-7 w-7 rounded-md border flex items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  <Separator />

                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      {totalTickets} ticket{totalTickets !== 1 ? "s" : ""}
                    </span>
                    <span className="text-xl font-bold">₹{totalPrice}</span>
                  </div>

                  <Button
                    className="w-full"
                    size="lg"
                    disabled={totalTickets === 0}
                    onClick={() => {
                      const firstTier = Object.entries(quantities).find(([, q]) => q > 0);
                      if (firstTier) navigate(`/checkout/${event.id}/${firstTier[0]}`);
                    }}
                  >
                    {totalTickets === 0 ? "Select Tickets to Continue" : `Register Now — ₹${totalPrice}`}
                  </Button>
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
