import { Link, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, LogOut, Menu, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

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
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export function Navbar() {
  const [open, setOpen] = useState(false);
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { user, logout, isAdmin, isStaff, isLoading } = useAuth();

  useEffect(() => setOpen(false), [pathname, search]);

  const dashboardPath = isAdmin ? "/admin" : isStaff ? "/organizer" : "/dashboard";
  const links: Array<{ to: string; label: string; comingSoon?: boolean }> = [
    { to: "/events", label: "Browse Events" },
    { to: "/merchandise", label: "Merchandise" },
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

  const isActive = (to: string) => pathname === to || (to !== "/" && pathname.startsWith(`${to}/`));

  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-card/90 backdrop-blur-xl">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[110] focus:rounded-lg focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-lg">Skip to content</a>
      <div className="h-1 bg-gradient-to-r from-[#ff9933] via-white to-[#138808]" />
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex shrink-0 items-center text-lg font-black tracking-tight sm:text-xl">
          <span>SportPass <span className="text-primary">India</span></span>
        </Link>

        <nav className="ml-auto hidden items-center gap-0.5 rounded-xl border border-border/70 bg-muted/40 p-1 shadow-sm xl:flex">
          {links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              aria-current={isActive(link.to) ? "page" : undefined}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${isActive(link.to) ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}
            >
              <span>{link.label}</span>
              {link.comingSoon && <span title="Coming soon" aria-label="Coming soon" className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Soon</span>}
            </Link>
          ))}

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="ml-1 gap-2 rounded-lg px-1.5 hover:bg-background">
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
            <Button variant="outline" size="sm" className="ml-1 h-8 rounded-lg px-3" onClick={() => navigate("/login")}>Login</Button>
          ) : null}
        </nav>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild><Button variant="ghost" size="icon" className="ml-auto h-11 w-11 xl:hidden" aria-label="Open navigation menu"><Menu className="h-5 w-5" /></Button></SheetTrigger>
          <SheetContent side="right" className="flex w-[min(22rem,90vw)] flex-col overflow-y-auto p-5 xl:hidden">
            <SheetTitle className="border-b pb-4 text-left text-lg font-black">SportPass <span className="text-primary">India</span></SheetTitle>
            <nav aria-label="Mobile navigation" className="flex flex-1 flex-col gap-1 pt-3">
              {links.map((link) => <Link key={link.to} to={link.to} onClick={() => setOpen(false)} aria-current={isActive(link.to) ? "page" : undefined} className={`flex min-h-11 items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-semibold ${isActive(link.to) ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"}`}><span>{link.label}</span>{link.comingSoon && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">Soon</span>}</Link>)}
              <div className="mt-auto border-t pt-4">
                {user ? <><p className="truncate px-4 pb-2 text-xs text-muted-foreground">Signed in as {user.name}</p><button type="button" onClick={() => { setOpen(false); void handleLogout(); }} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-4 text-left text-sm font-semibold text-destructive hover:bg-muted"><LogOut className="h-4 w-4" /> Log out</button></> : !isLoading ? <Button asChild className="w-full"><Link to="/login" onClick={() => setOpen(false)}>Log in</Link></Button> : null}
              </div>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
