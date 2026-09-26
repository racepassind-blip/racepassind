import { Link } from "react-router-dom";
import { Bike, Footprints, Waves, Trophy, Car } from "lucide-react";

import catCycling from "@/assets/event-cycling.jpg";
import catRunning from "@/assets/cat-running.jpg";
import catTriathlon from "@/assets/event-triathlon.jpg";
import catTrail from "@/assets/event-trail.jpg";
import catBadminton from "@/assets/Badminton.png";

// Define all available sports with their display info
const availableSports = [
  { name: "Badminton", icon: Trophy, image: catBadminton, slug: "badminton" },
  { name: "Cycling", icon: Bike, image: catCycling, slug: "cycling" },
  { name: "Running", icon: Footprints, image: catRunning, slug: "running" },
  { name: "Triathlon", icon: Waves, image: catTriathlon, slug: "triathlon" },
  { name: "Trail", icon: Footprints, image: catTrail, slug: "trail" },
];

// Show all available sports
export function CategoriesSection() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
      <div className="mb-10 text-center">
        <p className="mb-2 text-sm font-bold uppercase tracking-[0.18em] text-primary">Find your sport</p>
        <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Choose how you play</h2>
        <p className="mt-2 text-muted-foreground">From local tournaments to endurance events, find something worth showing up for.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {availableSports.map((cat) => (
          <Link
            key={cat.slug}
            to={`/events?sport=${cat.slug}`}
            className="group relative aspect-[3/4] cursor-pointer overflow-hidden rounded-2xl border border-border/20 shadow-sm transition-shadow hover:shadow-xl"
          >
            <img
              src={cat.image}
              alt={cat.name}
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
            <div className="absolute inset-x-0 bottom-0 flex min-h-20 items-center justify-center gap-2 bg-black/85 px-3 py-4 text-white backdrop-blur-sm">
              <cat.icon className="h-5 w-5 shrink-0 text-white" />
              <span className="text-base font-bold text-white sm:text-lg">{cat.name}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
