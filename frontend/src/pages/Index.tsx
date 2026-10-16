import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, Bell, Bike, Check, ClipboardList, HeartHandshake, MapPinned, Package, QrCode, Search, ShieldCheck, Trophy, WalletCards, X } from "lucide-react";
import { Layout } from "@/components/Layout";
import { EventCard } from "@/components/EventCard";
import { CategoriesSection } from "@/components/CategoriesSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import heroImg from "@/assets/hero-marathon.jpg";
import { useEventSearch } from "@/hooks/useEvents";
import { apiRequest } from "@/lib/api";

type PublicProductListing = { id: string; name: string; description: string; catalog: { products: Array<{ name: string; image_ids: string[]; variants: Array<{ price_paise: number; stock: number }> }> }; images: Record<string, string> };

const Index = () => {
  const [search, setSearch] = useState("");
  const { data, isLoading, isError } = useEventSearch({
    q: "",
    sport: "ALL",
    city: "ALL",
    timing: "UPCOMING",
    page: 1,
    pageSize: 48,
  });
  const events = data?.items ?? [];
  const { data: productListings = [] } = useQuery({ queryKey: ["public-product-listings"], queryFn: () => apiRequest<PublicProductListing[]>("/products") });

  const query = search.trim().toLowerCase();
  const orderedEvents = [...events].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const filtered = orderedEvents.filter((event) => {
    const searchable = [event.title, event.location, event.locationDetails?.city, event.locationDetails?.state, event.category].filter(Boolean).join(" ").toLowerCase();
    return !query || searchable.includes(query);
  });
  const featured = query ? filtered : orderedEvents.slice(0, 3);

  return (
    <Layout>
      <section className="relative isolate min-h-[520px] overflow-hidden bg-[#101b35] text-white sm:min-h-[570px]">
        <img
          src={heroImg}
          alt="Runners crossing a finish line"
          className="absolute inset-0 -z-20 h-full w-full object-cover"
        />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(10,20,45,0.97)_0%,rgba(10,20,45,0.84)_42%,rgba(10,20,45,0.30)_100%)]" />
        <div className="absolute inset-x-0 top-0 -z-10 h-1 bg-gradient-to-r from-[#ff9933] via-white to-[#138808]" />
        <div className="absolute -right-24 top-16 -z-10 h-72 w-72 rounded-full bg-[#ff9933]/12 blur-3xl" />
        <div className="absolute -bottom-24 left-1/3 -z-10 h-72 w-72 rounded-full bg-[#138808]/12 blur-3xl" />

        <div className="mx-auto flex min-h-[520px] max-w-6xl flex-col justify-center px-4 pb-24 pt-12 sm:min-h-[570px] sm:px-6 sm:pt-16 lg:px-8">
          <div className="max-w-2xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-bold uppercase tracking-[0.16em] backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-[#ff9933]" />
              SportPass India
              <span className="h-1.5 w-1.5 rounded-full bg-[#138808]" />
            </div>
            <h1 className="max-w-3xl text-4xl font-black leading-[1.04] tracking-tight sm:text-6xl lg:text-7xl">
              Find your next way to move.
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-white/80 sm:mt-6 sm:text-xl sm:leading-8">
              Discover races, treks, tournaments, and community events across India. Choose your challenge, register in minutes, and show up ready.
            </p>

            <div className="mt-7 flex max-w-2xl flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search events or cities…"
                  aria-label="Search events or cities"
                  className="h-14 rounded-xl border-0 bg-white pl-12 pr-4 text-base text-foreground shadow-2xl"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                {search && <button type="button" aria-label="Clear event search" onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>}
              </div>
              <Button asChild size="lg" className="h-14 rounded-lg bg-primary px-7 text-base font-bold text-primary-foreground shadow-md hover:bg-primary/90">
                <Link to={search.trim() ? `/events?q=${encodeURIComponent(search.trim())}` : "/events"}>Explore events <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
            </div>

            <div className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-sm text-white/75">
              <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#ff9933]" /> Secure registration</span>
              <span className="flex items-center gap-2"><HeartHandshake className="h-4 w-4 text-[#138808]" /> Built for Indian sports</span>
            </div>
          </div>
        </div>

        <div className="relative border-t border-white/15 bg-[#101b35]/85 backdrop-blur-md sm:absolute sm:inset-x-0 sm:bottom-0">
          <div className="mx-auto grid max-w-6xl divide-y divide-white/15 px-4 py-3 sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:px-6 sm:py-5 lg:px-8">
            <div className="flex items-start gap-3 py-3 sm:py-0 sm:pr-4 lg:gap-4 lg:pr-8"><span className="pt-0.5 text-xs font-black tracking-widest text-[#ffb866]">01</span><div><p className="font-bold sm:text-lg">Find your event</p><p className="mt-1 text-xs leading-5 text-white/60 sm:text-sm">Explore races, treks, and tournaments.</p></div></div>
            <div className="flex items-start gap-3 py-3 sm:px-4 sm:py-0 lg:gap-4 lg:px-8"><span className="pt-0.5 text-xs font-black tracking-widest text-[#ffb866]">02</span><div><p className="font-bold sm:text-lg">Register simply</p><p className="mt-1 text-xs leading-5 text-white/60 sm:text-sm">Choose your entry and pay securely.</p></div></div>
            <div className="flex items-start gap-3 py-3 sm:py-0 sm:pl-4 lg:gap-4 lg:pl-8"><span className="pt-0.5 text-xs font-black tracking-widest text-[#ffb866]">03</span><div><p className="font-bold sm:text-lg">Show up ready</p><p className="mt-1 text-xs leading-5 text-white/60 sm:text-sm">Keep your ticket and event details close.</p></div></div>
          </div>
        </div>
      </section>

      <section id="events" className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:px-8 lg:py-18">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-sm font-bold uppercase tracking-[0.18em] text-primary">Selected for you</p>
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Events worth showing up for</h2>
            <p className="mt-2 text-muted-foreground">Find your next start line, trail, court, or finish line.</p>
          </div>
          <Link to="/events" className="hidden items-center gap-1 text-sm font-bold text-primary transition-colors hover:text-primary/80 sm:flex">
            View all <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {featured.length > 0 ? <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{featured.map((event) => <EventCard key={event.id} event={event} />)}</div> : <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{isLoading ? "Loading events…" : isError ? "Failed to load events." : query ? `No events found for “${search.trim()}”.` : "No upcoming events right now. Check back soon."}</div>}
        <Button asChild variant="outline" className="mt-6 w-full sm:hidden"><Link to={query ? `/events?q=${encodeURIComponent(search.trim())}` : "/events"}>View all events <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
      </section>

      {productListings.length > 0 && <section className="border-y bg-card"><div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8"><div className="mb-8"><p className="mb-2 text-sm font-bold uppercase tracking-[0.18em] text-primary">Shop from organizers</p><h2 className="text-3xl font-black tracking-tight sm:text-4xl">Products for event day</h2><p className="mt-2 text-muted-foreground">Order meals, jerseys, and merchandise directly from verified organizers.</p></div><div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{productListings.map((listing) => { const product = listing.catalog.products[0]; const imageId = product?.image_ids[0]; const prices = listing.catalog.products.flatMap((item) => item.variants).filter((variant) => variant.stock > 0).map((variant) => variant.price_paise); const fromPrice = prices.length ? Math.min(...prices) : null; return <Link key={listing.id} to={`/products/${listing.id}`} className="group overflow-hidden rounded-2xl border bg-background shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">{imageId && listing.images[imageId] ? <img src={listing.images[imageId]} alt="" className="aspect-[16/9] w-full object-cover" /> : <div className="flex aspect-[16/9] items-center justify-center bg-primary/5 text-primary"><Package className="h-10 w-10" /></div>}<div className="p-5"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold group-hover:text-primary">{listing.name}</h3><p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{listing.description}</p></div>{fromPrice !== null && <span className="shrink-0 text-sm font-bold text-primary">From ₹{(fromPrice / 100).toFixed(0)}</span>}</div><p className="mt-4 text-sm font-semibold text-primary">Shop products <ArrowRight className="ml-1 inline h-4 w-4" /></p></div></Link>; })}</div></div></section>}

      <div className="border-y bg-card">
        <CategoriesSection />
      </div>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20" aria-labelledby="event-day-heading">
        <div className="mb-9 grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)] md:items-end">
          <div>
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-primary">From sign-up to finish line</p>
            <h2 id="event-day-heading" className="max-w-xl text-3xl font-black leading-tight tracking-tight sm:text-4xl">Your event, running smoothly from start to finish.</h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-muted-foreground md:justify-self-end">Bring participants, check-in, and results into one workspace, with practical tools for the sport you organize.</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {[
            {
              icon: Bike,
              number: "01",
              title: "Running & cycling",
              description: "Keep race-day operations moving from bib collection to the finish.",
              features: ["Distance categories and bibs", "QR checkpoint scans", "Timed results and rankings"],
              accent: "bg-orange-500",
              iconStyle: "bg-orange-50 text-orange-700",
            },
            {
              icon: MapPinned,
              number: "02",
              title: "Trekking",
              description: "Share the plan before departure and make arrivals easier to manage.",
              features: ["Routes and pickup points", "Digital waiver acknowledgement", "Ticket and QR check-in"],
              accent: "bg-emerald-600",
              iconStyle: "bg-emerald-50 text-emerald-700",
            },
            {
              icon: Trophy,
              number: "03",
              title: "Badminton",
              description: "Guide players and organizers from the draw through the final score.",
              features: ["Tournament draws and courts", "Match scheduling and scores", "Standings and results"],
              accent: "bg-sky-600",
              iconStyle: "bg-sky-50 text-sky-700",
            },
          ].map(({ icon: Icon, number, title, description, features, accent, iconStyle }) => (
            <article key={title} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className={`h-1.5 ${accent}`} />
              <div className="p-6">
                <div className="flex items-center justify-between">
                  <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${iconStyle}`}><Icon className="h-6 w-6" aria-hidden="true" /></span>
                  <span className="text-xs font-bold tracking-[0.18em] text-muted-foreground/60">{number}</span>
                </div>
                <h3 className="mt-6 text-xl font-black tracking-tight">{title}</h3>
                <p className="mt-2 min-h-12 text-sm leading-6 text-muted-foreground">{description}</p>
                <ul className="mt-6 space-y-3 border-t border-border pt-5 text-sm font-medium">
                  {features.map((feature) => <li key={feature} className="flex items-start gap-2.5"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />{feature}</li>)}
                </ul>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-4 grid gap-4 rounded-2xl bg-[#101b35] px-6 py-6 text-white sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:items-center sm:px-8">
          <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ffb866]">The event essentials</p><p className="mt-1 text-lg font-bold">One clear view for your team.</p></div>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs font-medium text-white/85 sm:text-sm">
            <li className="flex items-center gap-2"><ClipboardList className="h-4 w-4 shrink-0 text-[#ffb866]" aria-hidden="true" />Participant registrations</li>
            <li className="flex items-center gap-2"><WalletCards className="h-4 w-4 shrink-0 text-[#ffb866]" aria-hidden="true" />Payment tracking</li>
            <li className="flex items-center gap-2"><QrCode className="h-4 w-4 shrink-0 text-[#ffb866]" aria-hidden="true" />Check-in</li>
            <li className="flex items-center gap-2"><Bell className="h-4 w-4 shrink-0 text-[#ffb866]" aria-hidden="true" />Participant updates</li>
          </ul>
        </div>
      </section>

      <section className="border-y bg-muted/40">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8 lg:py-20">
          <div>
            <p className="mb-2 text-sm font-bold uppercase tracking-[0.18em] text-primary">Built for a complete event lifecycle</p>
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">More than a registration form.</h2>
            <p className="mt-4 leading-7 text-muted-foreground">SportPass connects the participant journey with the organizer workflow, so the important details stay visible from signup to event day and beyond.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border bg-card p-5"><p className="font-black">Clear participant details</p><p className="mt-2 text-sm leading-6 text-muted-foreground">Collect waivers, pickup points, ticket choices, and sport-specific information in one flow.</p></div>
            <div className="rounded-2xl border bg-card p-5"><p className="font-black">Payments with a clear status</p><p className="mt-2 text-sm leading-6 text-muted-foreground">Events use one enabled payment mode at a time: Direct UPI or Cashfree checkout.</p></div>
            <div className="rounded-2xl border bg-card p-5"><p className="font-black">Event-day confidence</p><p className="mt-2 text-sm leading-6 text-muted-foreground">Give organizers searchable registrations, QR tickets, check-in, and operational exports.</p></div>
            <div className="rounded-2xl border bg-card p-5"><p className="font-black">Traceable follow-through</p><p className="mt-2 text-sm leading-6 text-muted-foreground">Refunds, Credits deductions, settlements, and admin actions remain linked to the event record.</p></div>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-[#101b35] px-4 py-16 text-center text-white sm:px-6 lg:py-20">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#ff9933] via-white to-[#138808]" />
        <div className="relative mx-auto max-w-2xl">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#ffb866]">For organizers, clubs &amp; communities</p>
          <h2 className="mt-3 text-3xl font-black sm:text-4xl">Run better sports events.</h2>
          <p className="mt-4 text-white/70">Manage registrations, payments, participants and event-day operations from one place — with workflows designed around your sport.</p>
          <Button asChild size="lg" className="mt-7 rounded-lg bg-white font-bold text-[#101b35] hover:bg-white/90">
            <Link to="/organizers">See SportPass for Organizers <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
          <p className="mt-6 text-sm text-white/60">From registration to game day.</p>
        </div>
      </section>
    </Layout>
  );
};

export default Index;
