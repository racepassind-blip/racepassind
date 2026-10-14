import { useEffect, useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { useLocation } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/**
 * Mobile navigation drawer for the dashboard layouts.
 *
 * Renders a hamburger button (only below `lg`) that slides the dashboard
 * sidebar in from the left. The drawer closes automatically when the route
 * changes, so tapping a nav link always lands the user on the new page with
 * the menu dismissed. On `lg` and up this renders nothing — the persistent
 * sidebar is used instead.
 */
export function MobileNavDrawer({ title = "Menu", children }: { title?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { pathname, search } = useLocation();

  // Close the drawer whenever the location changes (link tapped inside it).
  useEffect(() => {
    setOpen(false);
  }, [pathname, search]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0 lg:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[18rem] max-w-[85vw] overflow-y-auto border-r-0 bg-slate-950 p-0 text-slate-100"
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
