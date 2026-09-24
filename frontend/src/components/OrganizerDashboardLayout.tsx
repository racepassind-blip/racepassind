import type { ComponentType, ReactNode } from "react";
import { BarChart3, CalendarDays, ClipboardList, ExternalLink, Gauge, GitBranch, LayoutDashboard, LogOut, Lock, Medal, MessageSquare, Package, ReceiptText, ScanLine, Settings2, Ticket, CreditCard, Timer, Trophy } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganizerEventDashboard } from "@/hooks/useEvents";
import { getSportConfig, eventSupportsTournament, isFreeEvent } from "@/data/sportConfig";
import { cn } from "@/lib/utils";

type OrganizerDashboardLayoutProps = {
  children: ReactNode;
  eventId?: string;
  showNavigation?: boolean;
};

type NavItem = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  to?: string;
};

export function OrganizerDashboardLayout({ children, eventId, showNavigation = true }: OrganizerDashboardLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { data: eventDashboard } = useOrganizerEventDashboard(eventId);
  const eventQuery = eventId ? `?event_id=${eventId}&status=all` : "";
  const currentSportConfig = getSportConfig(eventDashboard?.event.sport);
  const supportsTournament = eventSupportsTournament(eventDashboard?.event.sport, eventDashboard?.event.categories);
  const freeEvent = Boolean(eventId) && isFreeEvent(eventDashboard?.event);
  // Admin override unlocks everything regardless of free/paid
  const adminUnlocked = Boolean(eventDashboard?.event.adminFeatureOverride);
  const unlocked = !freeEvent || adminUnlocked;

  const supportsBib = adminUnlocked || (currentSportConfig.supports_bib && unlocked);
  const supportsCheckin = adminUnlocked || (currentSportConfig.supports_checkin && unlocked);
  const supportsCommunications = adminUnlocked || (currentSportConfig.supports_communications && unlocked);
  const supportsTournamentUnlocked = (supportsTournament && unlocked) || adminUnlocked;
  const supportsRaceResults = eventId ? currentSportConfig.result_type === "race_time" : false;

  const availableItems: NavItem[] = [
    ...(eventId ? [{ label: "Overview", icon: LayoutDashboard, to: `/organizer/events/${eventId}` }] : [{ label: "Events", icon: CalendarDays, to: "/organizer" }, { label: "Plans & pricing", icon: CreditCard, to: "/organizer/pricing" }, { label: "Organization profile", icon: Settings2, to: "/organizer/setup" }]),
    ...(eventId && supportsTournamentUnlocked ? [
      { label: "Tournament setup", icon: Settings2, to: `/organizer/events/${eventId}/tournament` },
      { label: "Matches", icon: Trophy, to: `/organizer/events/${eventId}/tournament/matches` },
      { label: "Scoring", icon: Gauge, to: `/organizer/events/${eventId}/tournament/scoring` },
      { label: "Results", icon: Medal, to: `/organizer/events/${eventId}/tournament/results` },
      { label: "Bracket", icon: GitBranch, to: `/organizer/events/${eventId}/tournament/bracket` },
    ] : []),
    { label: "Registrations", icon: ClipboardList, to: `/organizer/registrations${eventQuery}` },
    ...(eventId && supportsCommunications ? [{ label: "Communications", icon: MessageSquare, to: `/organizer/events/${eventId}/communications` }] : []),
    ...(eventId && supportsCheckin ? [{ label: "Check-in", icon: ScanLine, to: `/organizer/events/${eventId}/check-in` }] : []),
    ...(eventId && supportsBib ? [{ label: "Bib Management", icon: Package, to: `/organizer/events/${eventId}/allocations` }] : []),
    ...(supportsRaceResults ? [{ label: "Race Results", icon: Timer, to: `/organizer/events/${eventId}/race-results` }] : []),
    // Refunds: event-scoped when inside an event, global when on the dashboard
    ...(eventId
      ? [{ label: "Refunds", icon: ReceiptText, to: `/organizer/events/${eventId}/refunds` }]
      : [{ label: "Refunds", icon: ReceiptText, to: "/organizer/refunds" }]
    ),
  ];

  const lockedItems: NavItem[] = freeEvent && !adminUnlocked ? [
    ...(eventId && supportsTournament ? [
      { label: "Tournament setup", icon: Settings2 },
      { label: "Matches", icon: Trophy },
      { label: "Scoring", icon: Gauge },
      { label: "Results", icon: Medal },
      { label: "Bracket", icon: GitBranch },
    ] : []),
    ...(eventId && currentSportConfig.supports_communications ? [{ label: "Communications", icon: MessageSquare }] : []),
    ...(currentSportConfig.supports_checkin ? [{ label: "Check-in", icon: ScanLine }] : []),
    ...(eventId && currentSportConfig.supports_bib ? [{ label: "Bib Management", icon: Package }] : []),
  ] : [];
  const comingSoonItems: NavItem[] = [
    { label: "Reports", icon: BarChart3 },
  ];
  const initials = user?.name?.split(" ").map((part) => part[0]).join("").toUpperCase() ?? "RP";

  const handleLogout = async () => {
    await logout().catch(() => undefined);
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="flex min-h-screen flex-col lg:flex-row">
        {showNavigation && (
          <aside className="w-full shrink-0 bg-slate-950 text-slate-100 lg:w-72">
            <div className="flex h-full flex-col p-4 lg:sticky lg:top-0 lg:h-screen">
              <Link to="/organizer" className="mb-6 flex items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-white/10">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Ticket className="h-5 w-5" /></span>
                <span><span className="block text-sm font-black tracking-tight">SportPass <span className="text-primary">India</span></span><span className="mt-0.5 block text-xs text-slate-400">Organizer console</span></span>
              </Link>
              <nav className="flex gap-1 overflow-x-auto lg:block lg:space-y-1">
                {availableItems.map((item) => {
                  const basePath = item.to?.split("?")[0];
                  const active = basePath === "/organizer" ? location.pathname === "/organizer" : location.pathname === basePath;
                  return (
                    <Link
                      key={item.label}
                      to={item.to ?? "#"}
                      className={cn(
                        "flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                        active ? "bg-primary text-primary-foreground shadow-sm" : "text-slate-300 hover:bg-white/10 hover:text-white",
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
                {lockedItems.map((item) => {
                  const basePath = item.to?.split("?")[0];
                  const active = basePath === "/organizer" ? location.pathname === "/organizer" : location.pathname === basePath;
                  const isLink = Boolean(item.to);
                  const Component = isLink ? Link : "div";
                  return (
                    <Component
                      key={item.label}
                      to={item.to ?? "#"}
                      className={cn(
                        "flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors cursor-not-allowed",
                        active ? "bg-muted/40 text-muted-foreground" : "text-muted-foreground",
                      )}
                      title="Locked: upgrade to a paid event for full access"
                    >
                      <Lock className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground/60">Locked</span>
                    </Component>
                  );
                })}
              </nav>
              <div className="mt-6 hidden border-t border-white/10 pt-5 lg:block">
                <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">More tools</p>
                <div className="space-y-1">
                  {comingSoonItems.map((item) => (
                    <div key={item.label} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-500" title="Coming soon">
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
                      <span className="ml-auto text-[10px]">Soon</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-auto hidden border-t border-white/10 px-3 pt-5 text-xs leading-5 text-slate-500 lg:block">
                Keep your event operations, registrations, and race-day work in one place.
              </div>
            </div>
          </aside>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b bg-card/95 px-4 backdrop-blur sm:px-6 lg:px-8">
            <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">{eventId ? "Event management" : "Organizer workspace"}</p><p className="mt-0.5 text-sm text-muted-foreground">Plan, publish, and run your races</p></div>
            <div className="flex items-center gap-2 sm:gap-3">
              <Button asChild variant="ghost" size="sm" className="hidden gap-2 text-muted-foreground sm:flex"><Link to="/"><ExternalLink className="h-4 w-4" /> Public site</Link></Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" className="gap-2 px-2"><Avatar className="h-8 w-8"><AvatarFallback className="bg-primary text-xs text-primary-foreground">{initials}</AvatarFallback></Avatar><span className="hidden max-w-40 truncate text-sm font-medium md:inline">{user?.name ?? "Organizer"}</span></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="px-2 py-1.5"><p className="text-sm font-medium">{user?.name ?? "Organizer"}</p><p className="text-xs text-muted-foreground">{user?.email ?? ""}</p></div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/organizer")}><CalendarDays className="mr-2 h-4 w-4" />All events</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void handleLogout()} className="text-destructive"><LogOut className="mr-2 h-4 w-4" />Log out</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </div>
  );
}
