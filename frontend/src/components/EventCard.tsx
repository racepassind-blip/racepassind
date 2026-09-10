import { Link } from "react-router-dom";
import { Calendar, MapPin, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SportEvent } from "@/data/mockEvents";

const categoryColors: Record<string, string> = {
  running: "bg-accent text-accent-foreground",
  cycling: "bg-primary text-primary-foreground",
  marathon: "bg-accent text-accent-foreground",
  triathlon: "bg-primary/80 text-primary-foreground",
  trail: "bg-accent/80 text-accent-foreground",
};

export function EventCard({ event }: { event: SportEvent }) {
  const lowestPrice = Math.min(...event.tiers.map((t) => t.price));

  return (
    <Link
      to={`/event/${event.id}`}
      className="group block rounded-xl overflow-hidden bg-card shadow-sm border hover:shadow-lg transition-shadow duration-300"
    >
      <div className="relative aspect-[16/10] overflow-hidden">
        <img
          src={event.image}
          alt={event.title}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
        <Badge className={`absolute top-3 left-3 ${categoryColors[event.category]} capitalize`}>
          {event.category}
        </Badge>
      </div>

      <div className="p-5 space-y-3">
        <h3 className="text-lg font-bold tracking-tight group-hover:text-primary transition-colors">
          {event.title}
        </h3>

        <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            {new Date(event.date).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </span>
          <span className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            {event.location}
          </span>
          <span className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            {event.participants.toLocaleString()} / {event.maxParticipants.toLocaleString()}
          </span>
        </div>

        <div className="flex items-center justify-between pt-2 border-t">
          <span className="text-sm text-muted-foreground">{event.distance}</span>
          <span className="font-bold text-primary">From ₹{lowestPrice.toLocaleString("en-IN")}</span>
        </div>
      </div>
    </Link>
  );
}
