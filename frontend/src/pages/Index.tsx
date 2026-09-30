import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, HeartHandshake, Package, Search, ShieldCheck, X } from "lucide-react";
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
      <section className="relative isolate min-h-[620px] overflow-hidden bg-[#101b35] text-white">
        <img
          src={heroImg}
          alt="Runners crossing a finish line"
          className="absolute inset-0 -z-20 h-full w-full object-cover"
        />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(10,20,45,0.97)_0%,rgba(10,20,45,0.84)_42%,rgba(10,20,45,0.30)_100%)]" />
        <div className="absolute inset-x-0 top-0 -z-10 h-1 bg-gradient-to-r from-[#ff9933] via-white to-[#138808]" />
        <div className="absolute -right-24 top-16 -z-10 h-72 w-72 rounded-full bg-[#ff9933]/12 blur-3xl" />
        <div className="absolute -bottom-24 left-1/3 -z-10 h-72 w-72 rounded-full bg-[#138808]/12 blur-3xl" />

        <div className="mx-auto flex min-h-[620px] max-w-7xl flex-col justify-center px-4 pb-24 pt-24 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-bold uppercase tracking-[0.16em] backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-[#ff9933]" />
              SportPass India
              <span className="h-1.5 w-1.5 rounded-full bg-[#138808]" />
            </div>
            <h1 className="text-5xl font-black leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
              Find your next event.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-white/80 sm:text-xl">
              Browse races, tournaments, and community events across India. Pick a date, choose your entry, and get moving.
            </p>

            <div className="mt-8 flex max-w-2xl flex-col gap-3 sm:flex-row">
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

            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm text-white/75">
              <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#ff9933]" /> Secure registration</span>
              <span className="flex items-center gap-2"><HeartHandshake className="h-4 w-4 text-[#138808]" /> Built for Indian sports</span>
            </div>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 border-t border-white/15 bg-[#101b35]/80 backdrop-blur-md">
          <div className="mx-auto grid max-w-7xl grid-cols-3 divide-x divide-white/15 px-4 py-5 text-center sm:px-6 lg:px-8">
            <div><p className="text-base font-bold sm:text-lg">Every sport</p><p className="mt-1 text-xs text-white/60 sm:text-sm">From races to tournaments</p></div>
            <div><p className="text-base font-bold sm:text-lg">India-first</p><p className="mt-1 text-xs text-white/60 sm:text-sm">Simple registration &amp; UPI payments</p></div>
            <div><p className="text-base font-bold sm:text-lg">Community-led</p><p className="mt-1 text-xs text-white/60 sm:text-sm">Built around real sporting events</p></div>
          </div>
        </div>
      </section>

      <section id="events" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-sm font-bold uppercase tracking-[0.18em] text-primary">Selected for you</p>
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Upcoming events</h2>
            <p className="mt-2 text-muted-foreground">A few events coming up soon.</p>
          </div>
          <Link to="/events" className="hidden items-center gap-1 text-sm font-bold text-primary transition-colors hover:text-primary/80 sm:flex">
            View all <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {featured.length > 0 ? <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{featured.map((event) => <EventCard key={event.id} event={event} />)}</div> : <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{isLoading ? "Loading events…" : isError ? "Failed to load events." : query ? `No events found for “${search.trim()}”.` : "No upcoming events right now. Check back soon."}</div>}
      </section>

      {productListings.length > 0 && <section className="border-y bg-card"><div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8"><div className="mb-8"><p className="mb-2 text-sm font-bold uppercase tracking-[0.18em] text-primary">Shop from organizers</p><h2 className="text-3xl font-black tracking-tight sm:text-4xl">Products for event day</h2><p className="mt-2 text-muted-foreground">Order meals, jerseys, and merchandise directly from verified organizers.</p></div><div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{productListings.map((listing) => { const product = listing.catalog.products[0]; const imageId = product?.image_ids[0]; const prices = listing.catalog.products.flatMap((item) => item.variants).filter((variant) => variant.stock > 0).map((variant) => variant.price_paise); const fromPrice = prices.length ? Math.min(...prices) : null; return <Link key={listing.id} to={`/products/${listing.id}`} className="group overflow-hidden rounded-2xl border bg-background shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">{imageId && listing.images[imageId] ? <img src={listing.images[imageId]} alt="" className="aspect-[16/9] w-full object-cover" /> : <div className="flex aspect-[16/9] items-center justify-center bg-primary/5 text-primary"><Package className="h-10 w-10" /></div>}<div className="p-5"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold group-hover:text-primary">{listing.name}</h3><p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{listing.description}</p></div>{fromPrice !== null && <span className="shrink-0 text-sm font-bold text-primary">From ₹{(fromPrice / 100).toFixed(0)}</span>}</div><p className="mt-4 text-sm font-semibold text-primary">Shop products <ArrowRight className="ml-1 inline h-4 w-4" /></p></div></Link>; })}</div></div></section>}

      <div className="border-y bg-card">
        <CategoriesSection />
      </div>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="mb-10 text-center">
          <p className="mb-2 text-sm font-bold uppercase tracking-[0.18em] text-primary">More than registration</p>
          <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Everything you need on event day.</h2>
          <p className="mt-2 text-muted-foreground">Simple tools for participants and organizers, from registration through results.</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h3 className="text-lg font-bold">Running &amp; Cycling</h3>
            <p className="mt-2 text-sm text-muted-foreground">Distance-based events with participant management workflows</p>
            <ul className="mt-4 space-y-2 text-sm">
              <li className="flex items-start gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#ff9933] mt-1.5" />Registrations</li>
              <li className="flex items-start gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#ff9933] mt-1.5" />Payments</li>
              <li className="flex items-start gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#ff9933] mt-1.5" />Participant management</li>
              <li className="flex items-start gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#ff9933] mt-1.5" />Bib allotment</li>
              <li className="flex items-start gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#ff9933] mt-1.5" />Check-in</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h3 className="text-lg font-bold">Badminton</h3>
            <p className="mt-2 text-sm text-muted-foreground">Tournament-style events with draw management</p>
            <ul className="mt-4 space-y-2 text-sm">
              <li className="flex items-start gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#ff9933] mt-1.5" />Registrations</li>
              <li className="flex items-start gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#ff9933] mt-1.5" />Payments</li>
              <li className="flex items-start gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#ff9933] mt-1.5" />Tournament setup</li>
              <li className="flex items-start gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#ff9933] mt-1.5" />Draws</li>
              <li className="flex items-start gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#ff9933] mt-1.5" />Courts</li>
              <li className="flex items-start gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#ff9933] mt-1.5" />Matches</li>
              <li className="flex items-start gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#ff9933] mt-1.5" />Scores</li>
              <li className="flex items-start gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#ff9933] mt-1.5" />Results</li>
            </ul>
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
