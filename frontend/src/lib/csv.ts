/** Escape a CSV cell and neutralize spreadsheet formulas in untrusted text. */
export function csvCell(value: unknown, formulaSafe = false): string {
  const text = String(value ?? "");
  const safeText = formulaSafe && /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}
