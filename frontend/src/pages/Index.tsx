import { useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { EventCard } from "@/components/EventCard";
import { CategoriesSection } from "@/components/CategoriesSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, ArrowRight } from "lucide-react";
import heroImg from "@/assets/hero-marathon.jpg";
import { useEvents } from "@/hooks/useEvents";

const Index = () => {
  const [search, setSearch] = useState("");
  const { data: events = [], isLoading, isError } = useEvents();

  const filtered = events.filter(
    (e) =>
      e.title.toLowerCase().includes(search.toLowerCase()) ||
      e.location.toLowerCase().includes(search.toLowerCase())
  );

  const featured = events.slice(0, 3);

  return (
    <Layout>
      {/* Hero */}
      <section className="relative h-[500px] md:h-[560px] overflow-hidden">
        <img
          src={heroImg}
          alt="Sports event"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-foreground/85 via-foreground/50 to-foreground/20" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-full flex flex-col justify-center">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-primary-foreground max-w-2xl animate-fade-in">
            Discover and Register for Sports Events
          </h1>
          <p
            className="mt-4 text-lg md:text-xl text-primary-foreground/80 max-w-lg animate-fade-in"
            style={{ animationDelay: "0.15s" }}
          >
            Cycling, Running, Triathlon and more
          </p>

          {/* Search bar */}
          <div
            className="mt-8 flex max-w-xl animate-fade-in"
            style={{ animationDelay: "0.3s" }}
          >
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                placeholder="Search events, locations..."
                className="h-12 pl-11 pr-4 rounded-r-none border-r-0 bg-card text-foreground"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button size="lg" className="rounded-l-none h-12 px-6">
              Search
            </Button>
          </div>
        </div>
      </section>

      {/* Featured Events */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">Featured Events</h2>
            <p className="mt-1 text-muted-foreground">Hand-picked events you don't want to miss</p>
          </div>
          <Link to="/" className="hidden sm:flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            View all <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      </section>

      {/* Categories */}
      <div className="bg-card border-y">
        <CategoriesSection />
      </div>

      {/* Upcoming Events Grid */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">Upcoming Events</h2>
            <p className="mt-1 text-muted-foreground">All events coming up soon</p>
          </div>
        </div>

        {isLoading ? (
          <p className="text-center text-muted-foreground py-16">Loading events…</p>
        ) : isError ? (
          <p className="text-center text-muted-foreground py-16">Failed to load events.</p>
        ) : search && filtered.length === 0 ? (
          <p className="text-center text-muted-foreground py-16">
            No events found for "{search}"
          </p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {(search ? filtered : events).map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </section>
    </Layout>
  );
};

export default Index;
