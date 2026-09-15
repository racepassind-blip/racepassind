/** Imperatively scroll the window to the top. Use after in-page step changes. */
export function scrollToTop() {
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
}
