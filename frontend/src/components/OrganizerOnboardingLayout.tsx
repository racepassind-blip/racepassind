import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";

type OrganizerOnboardingLayoutProps = {
  children: ReactNode;
};

export function OrganizerOnboardingLayout({ children }: OrganizerOnboardingLayoutProps) {
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link to="/organizer" className="flex min-w-0 items-center rounded-xl py-2">
            <span><span className="block text-sm font-black tracking-tight">SportPass <span className="text-primary">India</span></span><span className="block text-xs text-muted-foreground">Organizer onboarding</span></span>
          </Link>
          <Button asChild variant="ghost" size="sm" className="shrink-0 gap-2 text-muted-foreground"><Link to="/organizer" aria-label="Back to workspace"><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">Back to workspace</span><span className="sm:hidden">Back</span></Link></Button>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
