import type { ComponentType, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Bell, CalendarDays, ClipboardList, CreditCard, ExternalLink, Gauge, GitBranch, LayoutDashboard, LogOut, Lock, Medal, MessageSquare, Package, ReceiptText, ScanLine, Settings2, Timer, Trophy } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { MobileNavDrawer } from "@/components/MobileNavDrawer";
import { useOrganizerEventDashboard } from "@/hooks/useEvents";
import { getSportConfig, eventSupportsTournament, isFreeEvent } from "@/data/sportConfig";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/api";

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
  const { data: creditAccounts = [] } = useQuery({
    queryKey: ["organizer-credit-accounts"],
    queryFn: async () => (await apiRequest<{ accounts: Array<{ organizationId: string; balancePaise: number }> }>("/organizer/credits")).accounts,
    enabled: user?.role === "organizer",
    staleTime: 30_000,
  });
  const availableCredits = creditAccounts.reduce((sum, account) => sum + account.balancePaise, 0) / 100;
  const isAdmin = user?.role === "admin";
  const creditLabel = isAdmin ? "Administrator" : `${availableCredits.toLocaleString("en-IN", { maximumFractionDigits: 2 })} Credits`;
  const eventQuery = eventId ? `?event_id=${eventId}&status=all` : "";
  const currentSportConfig = getSportConfig(eventDashboard?.event.sport);
  const supportsTournament = eventSupportsTournament(eventDashboard?.event.sport, eventDashboard?.event.categories);
  const freeEvent = Boolean(eventId) && isFreeEvent(eventDashboard?.event);
  // Admin override bypasses the free-event paywall, but it must not enable
  // tools that the event's sport does not support.
  const adminUnlocked = Boolean(eventDashboard?.event.adminFeatureOverride);
  const unlocked = !freeEvent || adminUnlocked;

  const supportsBib = currentSportConfig.supports_bib && unlocked;
  const supportsCheckin = currentSportConfig.supports_checkin && unlocked;
  const supportsCommunications = currentSportConfig.supports_communications && unlocked;
  const supportsTournamentUnlocked = supportsTournament && unlocked;
  const supportsRaceResults = eventId ? currentSportConfig.result_type === "race_time" : false;

  const availableItems: NavItem[] = [
    ...(eventId ? [{ label: "Overview", icon: LayoutDashboard, to: `/organizer/events/${eventId}` }] : [{ label: isAdmin ? "All events" : "Events", icon: CalendarDays, to: "/organizer" }, ...(!isAdmin ? [{ label: "Merchandise", icon: Package, to: "/organizer/products" }, { label: "Organization profile", icon: Settings2, to: "/organizer/setup" }] : [])]),
    { label: "Registrations", icon: ClipboardList, to: `/organizer/registrations${eventQuery}` },
    ...(eventId && supportsTournamentUnlocked ? [
      { label: "Tournament setup", icon: Settings2, to: `/organizer/events/${eventId}/tournament` },
      { label: "Matches", icon: Trophy, to: `/organizer/events/${eventId}/tournament/matches` },
      { label: "Scoring", icon: Gauge, to: `/organizer/events/${eventId}/tournament/scoring` },
      { label: "Bracket", icon: GitBranch, to: `/organizer/events/${eventId}/tournament/bracket` },
      { label: "Results", icon: Medal, to: `/organizer/events/${eventId}/tournament/results` },
    ] : []),
    ...(eventId && supportsCommunications ? [{ label: "Communications", icon: MessageSquare, to: `/organizer/events/${eventId}/communications` }] : []),
    ...(eventId ? [{ label: "Announcements", icon: Bell, to: `/organizer/events/${eventId}/announcements` }] : []),
    ...(eventId && supportsCheckin ? [{ label: "Check-in", icon: ScanLine, to: `/organizer/events/${eventId}/check-in` }] : []),
    ...(eventId && supportsBib ? [{ label: "Bib Management", icon: Package, to: `/organizer/events/${eventId}/allocations` }] : []),
    ...(supportsRaceResults ? [{ label: "Race Results", icon: Timer, to: `/organizer/events/${eventId}/race-results` }] : []),
    { label: "Transactions", icon: ReceiptText, to: `/organizer/payments${eventId ? `?event_id=${eventId}` : ""}` },
  ];

  const lockedItems: NavItem[] = freeEvent && !adminUnlocked ? [
    ...(eventId && supportsTournament ? [
      { label: "Tournament setup", icon: Settings2 },
      { label: "Matches", icon: Trophy },
      { label: "Scoring", icon: Gauge },
      { label: "Bracket", icon: GitBranch },
      { label: "Results", icon: Medal },
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

  const sidebarContent = (
    <div className="flex h-full flex-col p-4 lg:sticky lg:top-0 lg:h-screen">
              <Link to={isAdmin ? "/admin" : "/organizer"} className="mb-6 flex items-center rounded-xl px-3 py-2 transition-colors hover:bg-white/10">
                <span><span className="block text-sm font-black tracking-tight">SportPass <span className="text-primary">India</span></span><span className="mt-0.5 block text-xs text-slate-400">{isAdmin ? "Admin event operations" : "Organizer console"}</span></span>
              </Link>
              <nav className="space-y-1">
                {availableItems.map((item) => {
                  const basePath = item.to?.split("?")[0];
                  const active = basePath === "/organizer" ? location.pathname === "/organizer" : location.pathname === basePath;
                  return (
                    <Link
                      key={item.label}
                      to={item.to ?? "#"}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
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
                        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors cursor-not-allowed",
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
              <div className="mt-6 border-t border-white/10 pt-5">
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
  );

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="flex min-h-screen flex-col lg:flex-row">
        {showNavigation && (
          <aside className="hidden shrink-0 bg-slate-950 text-slate-100 lg:block lg:w-72">
            {sidebarContent}
          </aside>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-2 border-b bg-card/95 px-4 backdrop-blur sm:px-6 lg:px-8">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {showNavigation && <MobileNavDrawer title="Organizer menu">{sidebarContent}</MobileNavDrawer>}
              <div className="min-w-0"><p className="truncate text-xs font-bold uppercase tracking-[0.12em] text-primary">{isAdmin ? "Admin event operations" : eventId ? "Event management" : "Organizer workspace"}</p><p className="mt-0.5 hidden truncate text-sm text-muted-foreground sm:block">{isAdmin ? "Manage events without leaving your admin account" : "Plan, publish, and run your events"}</p></div>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <Button asChild variant="ghost" size="sm" className="hidden gap-2 text-muted-foreground sm:flex"><Link to="/"><ExternalLink className="h-4 w-4" /> Public site</Link></Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" aria-label="Open account menu" className="h-11 min-w-11 gap-2 px-1.5 sm:px-2"><Avatar className="h-8 w-8"><AvatarFallback className="bg-primary text-xs text-primary-foreground">{initials}</AvatarFallback></Avatar><span className="hidden max-w-36 text-left sm:block"><span className="hidden truncate text-sm font-medium md:block">{user?.name ?? "Organizer"}</span><span className="block truncate text-xs font-semibold text-primary">{creditLabel}</span></span></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="break-words px-2 py-1.5"><p className="text-sm font-medium">{user?.name ?? "Organizer"}</p><p className="text-xs text-muted-foreground">{user?.email ?? ""}</p></div>
                  <DropdownMenuSeparator />
                  {isAdmin && <DropdownMenuItem onClick={() => navigate("/admin")}><Gauge className="mr-2 h-4 w-4" />Admin dashboard</DropdownMenuItem>}
                  <DropdownMenuItem onClick={() => navigate("/organizer")}><CalendarDays className="mr-2 h-4 w-4" />All events</DropdownMenuItem>
                  {!isAdmin && <DropdownMenuItem onClick={() => navigate("/organizer/credits")}><CreditCard className="mr-2 h-4 w-4" />{creditLabel}</DropdownMenuItem>}
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
