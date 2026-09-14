import { Link } from "react-router-dom";
import { Bike, Footprints, Waves, Trophy, Car } from "lucide-react";

import catCycling from "@/assets/event-cycling.jpg";
import catRunning from "@/assets/cat-running.jpg";
import catTriathlon from "@/assets/event-triathlon.jpg";
import catMarathon from "@/assets/hero-marathon.jpg";
import catMotorsport from "@/assets/event-motorsport.jpg";

const categories = [
  { name: "Cycling", icon: Bike, image: catCycling, slug: "cycling" },
  { name: "Running", icon: Footprints, image: catRunning, slug: "running" },
  { name: "Triathlon", icon: Waves, image: catTriathlon, slug: "triathlon" },
  { name: "Marathon", icon: Trophy, image: catMarathon, slug: "marathon" },
  { name: "Motorsport", icon: Car, image: catMotorsport, slug: "motorsport" },
];

export function CategoriesSection() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
      <div className="mb-10 text-center">
        <p className="mb-2 text-sm font-bold uppercase tracking-[0.18em] text-primary">Find your discipline</p>
        <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Choose your way to move</h2>
        <p className="mt-2 text-muted-foreground">From city streets to hill roads, find your next Indian adventure.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {categories.map((cat) => (
          <Link
            key={cat.slug}
            to={`/?category=${cat.slug}`}
            className="group relative aspect-[3/4] cursor-pointer overflow-hidden rounded-2xl border border-border/20 shadow-sm transition-shadow hover:shadow-xl"
          >
            <img
              src={cat.image}
              alt={cat.name}
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-foreground/80 via-foreground/20 to-transparent" />
            <div className="relative h-full flex flex-col items-center justify-end pb-6 text-primary-foreground">
              <cat.icon className="h-8 w-8 mb-2 drop-shadow-lg" />
              <span className="font-bold text-lg drop-shadow-lg">{cat.name}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
