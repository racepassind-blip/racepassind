import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, HeartHandshake, Search, ShieldCheck, Sparkles } from "lucide-react";
import { Layout } from "@/components/Layout";
import { EventCard } from "@/components/EventCard";
import { CategoriesSection } from "@/components/CategoriesSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import heroImg from "@/assets/hero-marathon.jpg";
import { useEvents } from "@/hooks/useEvents";

const Index = () => {
  const [search, setSearch] = useState("");
  const { data: events = [], isLoading, isError } = useEvents();

  const filtered = events.filter(
    (event) =>
      event.title.toLowerCase().includes(search.toLowerCase()) ||
      event.location.toLowerCase().includes(search.toLowerCase())
  );

  const featured = events.slice(0, 3);

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
        <div className="absolute -right-24 top-16 -z-10 h-72 w-72 rounded-full bg-[#ff9933]/15 blur-3xl" />
        <div className="absolute -bottom-24 left-1/3 -z-10 h-72 w-72 rounded-full bg-[#138808]/15 blur-3xl" />

        <div className="mx-auto flex min-h-[620px] max-w-7xl flex-col justify-center px-4 pb-24 pt-24 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-bold uppercase tracking-[0.16em] backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-[#ff9933]" />
              SportPass India
              <span className="h-1.5 w-1.5 rounded-full bg-[#138808]" />
            </div>
            <h1 className="text-5xl font-black leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
              India&apos;s start line, all in one place.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-white/80 sm:text-xl">
              Discover the races that move you, register in a few simple steps, and make your next finish line count.
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
              </div>
              <Button asChild size="lg" className="h-14 rounded-xl bg-[#ff9933] px-7 text-base font-bold text-[#101b35] shadow-lg hover:bg-[#ffad5c]">
                <a href="#events">Explore events <ArrowRight className="ml-2 h-4 w-4" /></a>
              </Button>
            </div>

            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm text-white/75">
              <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#ff9933]" /> Secure registration</span>
              <span className="flex items-center gap-2"><HeartHandshake className="h-4 w-4 text-[#138808]" /> Made for Indian athletes</span>
            </div>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 border-t border-white/15 bg-[#101b35]/70 backdrop-blur-md">
          <div className="mx-auto grid max-w-7xl grid-cols-3 divide-x divide-white/15 px-4 py-5 text-center sm:px-6 lg:px-8">
            <div><p className="text-base font-bold sm:text-lg">Every distance</p><p className="mt-1 text-xs text-white/60 sm:text-sm">from 5K to ultra</p></div>
            <div><p className="text-base font-bold sm:text-lg">India-first</p><p className="mt-1 text-xs text-white/60 sm:text-sm">simple INR payments</p></div>
            <div><p className="text-base font-bold sm:text-lg">Community-led</p><p className="mt-1 text-xs text-white/60 sm:text-sm">made for every athlete</p></div>
          </div>
        </div>
      </section>

      <section id="events" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-sm font-bold uppercase tracking-[0.18em] text-primary">Selected for you</p>
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Events worth showing up for</h2>
            <p className="mt-2 text-muted-foreground">Discover your next challenge and the community behind it.</p>
          </div>
          <Link to="/" className="hidden items-center gap-1 text-sm font-bold text-primary transition-colors hover:text-primary/80 sm:flex">
            View all <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((event) => <EventCard key={event.id} event={event} />)}
        </div>
      </section>

      <div className="border-y bg-card">
        <CategoriesSection />
      </div>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-sm font-bold uppercase tracking-[0.18em] text-primary">The race calendar</p>
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Upcoming across India</h2>
            <p className="mt-2 text-muted-foreground">From your neighbourhood to the next big finish line.</p>
          </div>
          <Sparkles className="hidden h-7 w-7 text-[#ff9933] sm:block" />
        </div>

        {isLoading ? (
          <p className="py-16 text-center text-muted-foreground">Loading events…</p>
        ) : isError ? (
          <p className="py-16 text-center text-muted-foreground">Failed to load events.</p>
        ) : search && filtered.length === 0 ? (
          <p className="py-16 text-center text-muted-foreground">No events found for &quot;{search}&quot;</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {(search ? filtered : events).map((event) => <EventCard key={event.id} event={event} />)}
          </div>
        )}
      </section>

      <section className="relative overflow-hidden bg-[#101b35] px-4 py-16 text-center text-white sm:px-6 lg:py-20">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#ff9933] via-white to-[#138808]" />
        <div className="relative mx-auto max-w-2xl">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#ffb866]">For organisers, clubs & communities</p>
          <h2 className="mt-3 text-3xl font-black sm:text-4xl">Run better events. Grow your community.</h2>
          <p className="mt-4 text-white/70">Give every participant a simpler experience, from registration to finish.</p>
          <Button asChild size="lg" className="mt-7 rounded-xl bg-white font-bold text-[#101b35] hover:bg-white/90">
            <Link to="/organizers">See how it works <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
        </div>
      </section>
    </Layout>
  );
};

export default Index;
