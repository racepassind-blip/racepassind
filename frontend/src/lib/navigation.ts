/**
 * Keep post-auth redirects inside the SportPass application.
 * Router state can be supplied by callers, so never treat it as a trusted URL.
 */
export function getSafeRedirectPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return undefined;
  }

  // Backslashes are normalized by browsers and can turn a path into an external URL.
  if (value.includes("\\") || value.includes("://")) {
    return undefined;
  }

  return value;
}
