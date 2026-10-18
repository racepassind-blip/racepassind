import { Building2, Calendar, CreditCard } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { Button } from "@/components/ui/button";

interface OrganizerWorkspaceTabsProps {
  organizationEmbedded?: boolean;
  onOrganizationSelect?: () => void;
  onEventsSelect?: () => void;
}

export function OrganizerWorkspaceTabs({ organizationEmbedded = false, onOrganizationSelect, onEventsSelect }: OrganizerWorkspaceTabsProps) {
  const location = useLocation();
  const eventsActive = location.pathname === "/organizer" && !organizationEmbedded;
  const organizationActive = onOrganizationSelect ? organizationEmbedded : location.pathname === "/organizer/setup";
  const creditsActive = location.pathname === "/organizer/credits";
  const transactionsActive = creditsActive || location.pathname === "/organizer/payments";

  return (
    <>
    <nav aria-label="Organizer workspace" className="scrollbar-none grid grid-cols-3 items-stretch gap-1 overflow-hidden border-b">
      <Button asChild variant="ghost" className={`min-w-0 gap-1.5 rounded-b-none border-b-2 px-1 text-xs sm:gap-2 sm:px-4 sm:text-sm ${eventsActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
        <Link to="/organizer" onClick={onEventsSelect}><Calendar className="h-4 w-4" /> Events</Link>
      </Button>
      <Button asChild variant="ghost" className={`min-w-0 gap-1.5 rounded-b-none border-b-2 px-1 text-xs sm:gap-2 sm:px-4 sm:text-sm ${transactionsActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
        <Link to="/organizer/payments" aria-current={transactionsActive ? "page" : undefined}><CreditCard className="h-4 w-4" /> Transactions</Link>
      </Button>
      {onOrganizationSelect ? (
        <Button type="button" variant="ghost" className={`min-w-0 gap-1.5 rounded-b-none border-b-2 px-1 text-xs sm:gap-2 sm:px-4 sm:text-sm ${organizationActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:border-primary/40 hover:text-foreground"}`} onClick={onOrganizationSelect}>
          <Building2 className="h-4 w-4" /> Organization
        </Button>
      ) : (
        <Button asChild variant="ghost" className={`min-w-0 gap-1.5 rounded-b-none border-b-2 px-1 text-xs sm:gap-2 sm:px-4 sm:text-sm ${organizationActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
          <Link to="/organizer/setup"><Building2 className="h-4 w-4" /> Organization</Link>
        </Button>
      )}
    </nav>
    {transactionsActive && <nav aria-label="Transaction sections" className="mt-4 flex flex-wrap gap-2">
      <Button asChild variant={creditsActive ? "default" : "outline"}><Link to={`/organizer/credits${location.search}`} aria-current={creditsActive ? "page" : undefined}>SportPass Credits</Link></Button>
      <Button asChild variant={!creditsActive ? "default" : "outline"}><Link to={`/organizer/payments${location.search}`} aria-current={!creditsActive ? "page" : undefined}>Payments & Settlements</Link></Button>
    </nav>}
    </>
  );
}
