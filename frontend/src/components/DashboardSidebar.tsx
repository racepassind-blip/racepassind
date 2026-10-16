import { CalendarDays, ChevronRight, ClipboardList, History, UserCircle } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { cn } from "@/lib/utils";

const items = [
  { title: "My Tickets", url: "/dashboard", icon: ClipboardList },
  { title: "My Registrations", url: "/dashboard/registrations", icon: ClipboardList },
  { title: "Upcoming Events", url: "/dashboard/upcoming", icon: CalendarDays },
  { title: "Past Events", url: "/dashboard/past", icon: History },
  { title: "Profile", url: "/dashboard/profile", icon: UserCircle },
];

/** Sidebar contents, shared by the persistent desktop sidebar and the mobile drawer. */
export function DashboardSidebarContent() {
  const location = useLocation();

  return (
    <div className="flex h-full flex-col p-4 lg:sticky lg:top-0 lg:h-screen">
      <Link to="/dashboard" className="mb-7 flex items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-white/10">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-xs font-black text-primary-foreground">SP</span>
        <span><span className="block text-sm font-black tracking-tight">SportPass <span className="text-primary">India</span></span><span className="mt-0.5 block text-xs text-slate-400">Participant workspace</span></span>
      </Link>

      <nav className="space-y-1" aria-label="Participant dashboard">
        <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">My race day</p>
        {items.map((item) => {
          const active = item.url === "/dashboard" ? location.pathname === item.url : location.pathname === item.url || location.pathname.startsWith(`${item.url}/`);
          return (
            <Link
              key={item.url}
              to={item.url}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active ? "bg-primary text-primary-foreground shadow-sm" : "text-slate-300 hover:bg-white/10 hover:text-white",
              )}
            >
              <item.icon className="h-4 w-4" />
              <span>{item.title}</span>
              {active && <ChevronRight className="ml-auto h-4 w-4" />}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto hidden border-t border-white/10 px-3 pt-5 text-xs leading-5 text-slate-500 lg:block">
        Keep your tickets, registrations, and race-day details ready in one place.
      </div>
    </div>
  );
}

export function DashboardSidebar() {
  return (
    <aside className="hidden shrink-0 bg-slate-950 text-slate-100 lg:block lg:w-72">
      <DashboardSidebarContent />
    </aside>
  );
}
