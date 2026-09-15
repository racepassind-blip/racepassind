import { ExternalLink, LayoutDashboard, LogOut, Ticket } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { DashboardSidebar } from "@/components/DashboardSidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const initials = user?.name?.split(" ").map((part) => part[0]).join("").toUpperCase() ?? "RP";

  const handleLogout = async () => {
    await logout().catch(() => undefined);
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <DashboardSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b bg-card/95 px-4 backdrop-blur sm:px-6 lg:px-8">
            <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Participant workspace</p><p className="mt-0.5 text-sm text-muted-foreground">Keep your race-day plans and tickets together</p></div>
            <div className="flex items-center gap-2 sm:gap-3">
              <Button asChild variant="ghost" size="sm" className="hidden gap-2 text-muted-foreground sm:flex"><Link to="/"><ExternalLink className="h-4 w-4" /> Public site</Link></Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" className="gap-2 px-2"><Avatar className="h-8 w-8"><AvatarFallback className="bg-primary text-xs text-primary-foreground">{initials}</AvatarFallback></Avatar><span className="hidden max-w-40 truncate text-sm font-medium md:inline">{user?.name ?? "Participant"}</span></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="px-2 py-1.5"><p className="text-sm font-medium">{user?.name ?? "Participant"}</p><p className="text-xs text-muted-foreground">{user?.email ?? ""}</p></div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/dashboard")}><LayoutDashboard className="mr-2 h-4 w-4" />My dashboard</DropdownMenuItem>
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
