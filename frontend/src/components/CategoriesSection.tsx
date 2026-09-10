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
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
      <div className="text-center mb-10">
        <h2 className="text-3xl font-extrabold tracking-tight">Browse by Category</h2>
        <p className="mt-2 text-muted-foreground">Find the perfect event for your sport</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {categories.map((cat) => (
          <Link
            key={cat.slug}
            to={`/?category=${cat.slug}`}
            className="group relative rounded-xl overflow-hidden aspect-[3/4] cursor-pointer"
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
