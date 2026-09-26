import { Link, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, LogOut, Menu, ShieldCheck, Ticket, X } from "lucide-react";
import { useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";

export function Navbar() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, logout, isAdmin, isStaff, isLoading } = useAuth();

  const dashboardPath = isAdmin ? "/admin" : isStaff ? "/organizer" : "/dashboard";
  const links: Array<{ to: string; label: string; comingSoon?: boolean }> = [
    { to: "/events", label: "Browse Events" },
    { to: "/organizers", label: "For Organizers" },
    { to: "/federations-associations", label: "Federations & Associations", comingSoon: true },
    ...(user && isAdmin ? [{ to: "/admin", label: "Admin workspace" }] : []),
    ...(user && isStaff ? [{ to: "/organizer", label: "Manage Events" }] : []),
    ...(user && !isStaff ? [{ to: "/dashboard", label: "My Dashboard" }] : []),
  ];

  const handleLogout = async () => {
    await logout().catch(() => undefined);
    navigate("/");
  };

  const initials = user?.name
    ?.split(" ")
    .map((name) => name[0])
    .join("")
    .toUpperCase() ?? "";

  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-card/90 backdrop-blur-xl">
      <div className="h-1 bg-gradient-to-r from-[#ff9933] via-white to-[#138808]" />
      <div className="mx-auto flex h-[4.5rem] max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2.5 text-lg font-black tracking-tight sm:text-xl">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/15">
            <Ticket className="h-5 w-5 text-primary" />
          </span>
          <span>SportPass <span className="text-primary">India</span></span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${pathname === link.to ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
            >
              <span>{link.label}</span>
              {link.comingSoon && <span title="Coming soon" aria-label="Coming soon" className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Soon</span>}
            </Link>
          ))}

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="ml-2 gap-2 px-2">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="bg-primary text-xs text-primary-foreground">{initials}</AvatarFallback>
                  </Avatar>
                  <span className="hidden text-sm font-medium lg:inline">{user.name}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium">{user.name}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs capitalize text-muted-foreground">
                    {isStaff && <ShieldCheck className="h-3 w-3" />}
                    {user.role}
                  </p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate(dashboardPath)}>
                  <LayoutDashboard className="mr-2 h-4 w-4" />
                  {isStaff ? "Manage Events" : "Dashboard"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void handleLogout()} className="text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : !isLoading ? (
            <Button variant="outline" size="sm" className="ml-2" onClick={() => navigate("/login")}>Login</Button>
          ) : null}
        </nav>

        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={open ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {open && (
        <nav className="space-y-1 border-t bg-card px-4 pb-4 pt-2 md:hidden">
          {links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium ${pathname === link.to ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}
            >
              <span>{link.label}</span>
              {link.comingSoon && <span title="Coming soon" aria-label="Coming soon" className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Soon</span>}
            </Link>
          ))}
          {user ? (
            <>
              <div className="px-4 py-2 text-xs text-muted-foreground">Signed in as <span className="font-medium text-foreground">{user.name}</span></div>
              <button onClick={() => { void handleLogout(); setOpen(false); }} className="block w-full rounded-lg px-4 py-2.5 text-left text-sm font-medium text-destructive hover:bg-secondary">Logout</button>
            </>
          ) : !isLoading ? (
            <button onClick={() => { navigate("/login"); setOpen(false); }} className="block w-full rounded-lg px-4 py-2.5 text-left text-sm font-medium text-muted-foreground hover:bg-secondary">Login</button>
          ) : null}
        </nav>
      )}
    </header>
  );
}
