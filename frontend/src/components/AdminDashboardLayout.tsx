import type { ComponentType, ReactNode } from "react";
import { ArchiveRestore, CalendarDays, ChevronRight, CreditCard, ExternalLink, LayoutDashboard, LogOut, ReceiptText, ShieldCheck, Ticket, UserPlus } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

type AdminDashboardLayoutProps = { children: ReactNode };
type NavItem = { label: string; to: string; icon: ComponentType<{ className?: string }> };
type NavGroup = { label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  { label: "Overview", items: [{ label: "Dashboard", to: "/admin", icon: LayoutDashboard }] },
  {
    label: "Communication",
    items: [
      { label: "Communication settings", to: "/admin/communication", icon: ShieldCheck },
    ],
  },
  {
    label: "Organizer management",
    items: [
      { label: "Onboarding requests", to: "/admin/organizer-applications", icon: UserPlus },
    ],
  },
  {
    label: "Race operations",
    items: [
      { label: "Events & registrations", to: "/organizer", icon: CalendarDays },
      { label: "Event recovery", to: "/admin/events", icon: ArchiveRestore },
      { label: "Organizer billing", to: "/admin/billing", icon: ReceiptText },
    ],
  },
  {
    label: "Pricing",
    items: [
      { label: "Plans & pricing", to: "/admin/plans", icon: CreditCard },
    ],
  },
];

function isActivePath(pathname: string, to: string) {
  return to === "/admin" ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
}

export function AdminDashboardLayout({ children }: AdminDashboardLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const initials = user?.name?.split(" ").map((part) => part[0]).join("").toUpperCase() ?? "AD";

  const handleLogout = async () => {
    await logout().catch(() => undefined);
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="w-full shrink-0 bg-slate-950 text-slate-100 lg:w-72">
          <div className="flex h-full flex-col p-4 lg:sticky lg:top-0 lg:h-screen">
            <Link to="/admin" className="mb-7 flex items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-white/10">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Ticket className="h-5 w-5" /></span>
              <span><span className="block text-sm font-black tracking-tight">SportPass <span className="text-primary">India</span></span><span className="mt-0.5 block text-xs text-slate-400">Admin workspace</span></span>
            </Link>
            <nav className="flex gap-4 overflow-x-auto pb-1 lg:block lg:space-y-6 lg:overflow-visible">
              {navGroups.map((group) => (
                <div key={group.label} className="min-w-max lg:min-w-0">
                  <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{group.label}</p>
                  <div className="space-y-1">
                    {group.items.map((item) => {
                      const active = isActivePath(location.pathname, item.to);
                      return (
                        <Link
                          key={item.to}
                          to={item.to}
                          className={cn(
                            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                            active ? "bg-primary text-primary-foreground shadow-sm" : "text-slate-300 hover:bg-white/10 hover:text-white",
                          )}
                        >
                          <item.icon className="h-4 w-4" />
                          <span>{item.label}</span>
                          {active && <ChevronRight className="ml-auto hidden h-4 w-4 lg:block" />}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
            <div className="mt-auto hidden border-t border-white/10 px-3 pt-5 text-xs leading-5 text-slate-500 lg:block">
              Review growth, unblock organizers, and keep every race moving.
            </div>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b bg-card/95 px-4 backdrop-blur sm:px-6 lg:px-8">
            <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Admin control center</p><p className="mt-0.5 text-sm text-muted-foreground">Operate the marketplace and support organizers</p></div>
            <div className="flex items-center gap-2 sm:gap-3">
              <Button asChild variant="ghost" size="sm" className="hidden gap-2 text-muted-foreground sm:flex"><Link to="/"><ExternalLink className="h-4 w-4" /> Public site</Link></Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" className="gap-2 px-2"><Avatar className="h-8 w-8"><AvatarFallback className="bg-primary text-xs text-primary-foreground">{initials}</AvatarFallback></Avatar><span className="hidden max-w-40 truncate text-sm font-medium md:inline">{user?.name ?? "Administrator"}</span></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="px-2 py-1.5"><p className="text-sm font-medium">{user?.name ?? "Administrator"}</p><p className="text-xs text-muted-foreground">{user?.email ?? ""}</p></div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/admin")}><ShieldCheck className="mr-2 h-4 w-4" />Admin dashboard</DropdownMenuItem>
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
