import { Calendar, CreditCard } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { Button } from "@/components/ui/button";

export function OrganizerWorkspaceTabs() {
  const location = useLocation();
  const eventsActive = location.pathname === "/organizer";
  const pricingActive = location.pathname === "/organizer/pricing";

  return (
    <nav aria-label="Organizer workspace" className="flex items-center gap-1 overflow-x-auto border-b">
      <Button asChild variant="ghost" className={`shrink-0 gap-2 rounded-b-none border-b-2 px-4 ${eventsActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
        <Link to="/organizer"><Calendar className="h-4 w-4" /> Events</Link>
      </Button>
      <Button asChild variant="ghost" className={`shrink-0 gap-2 rounded-b-none border-b-2 px-4 ${pricingActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
        <Link to="/organizer/pricing"><CreditCard className="h-4 w-4" /> Plans &amp; pricing</Link>
      </Button>
    </nav>
  );
}
