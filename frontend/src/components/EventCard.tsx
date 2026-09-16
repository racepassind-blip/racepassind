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
  const locationName = event.locationDetails?.name || event.location;
  const cityState = [event.locationDetails?.city, event.locationDetails?.state].filter(Boolean).join(", ");

  return (
    <Link
      to={`/event/${event.id}`}
      className="group block overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-secondary">
        <img
          src={event.image}
          alt={event.title}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/25 to-transparent opacity-70" />
        <Badge className={`absolute left-4 top-4 ${categoryColors[event.category]} capitalize shadow-sm`}>
          {event.category}
        </Badge>
      </div>

      <div className="space-y-3 p-5">
        <h3 className="text-lg font-bold tracking-tight transition-colors group-hover:text-primary">
          {event.title}
        </h3>

        <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            {new Date(event.date).toLocaleDateString("en-IN", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
          <span className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            <span className="font-medium">{locationName}</span>
          </span>
          {cityState && (
            <span className="flex items-center gap-2 pl-6 text-xs text-muted-foreground">
              <span className="h-1 w-1 rounded-full bg-muted-foreground" />
              {cityState}
            </span>
          )}
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
