import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { scrollToTop } from "@/lib/scroll";

/**
 * Scrolls the window to the top whenever the route path changes.
 *
 * Single-page apps keep the previous scroll position across navigations, which
 * on mobile often leaves the user looking at the bottom of the new page after a
 * submission or button click. Rendering this once inside the router resets the
 * scroll position to the top on every navigation.
 */
export function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    scrollToTop();
  }, [pathname]);

  return null;
}
