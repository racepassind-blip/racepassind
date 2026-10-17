import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { downloadApiFile } from "@/lib/api";

export type RefundDates = { date_from: string; date_to: string; date_field: string };
export const emptyRefundDates: RefundDates = { date_from: "", date_to: "", date_field: "requested" };

export function RefundAuditFilters({ value, onChange, endpoint, filters }: {
  value: RefundDates;
  onChange: (value: RefundDates) => void;
  endpoint: string;
  filters: Record<string, string>;
}) {
  const id = useId();
  const [exporting, setExporting] = useState(false);
  const invalidRange = !!(value.date_from && value.date_to && value.date_from > value.date_to);
  const exportRows = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ ...value, ...filters, export_csv: "true" });
      for (const [key, val] of [...params.entries()]) if (!val || val === "all") params.delete(key);
      await downloadApiFile(`${endpoint}?${params}`, "refund-ledger.csv");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export refunds");
    } finally { setExporting(false); }
  };
  return <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Refund audit filters">
    <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-2"><Label htmlFor={`${id}-field`}>Filter dates by</Label><select id={`${id}-field`} className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={value.date_field} onChange={e => onChange({ ...value, date_field: e.target.value })}><option value="requested">Requested date</option><option value="sent">Sent date</option><option value="completed">Completed date</option></select></div>
      <div className="space-y-2"><Label htmlFor={`${id}-from`}>From (IST)</Label><Input id={`${id}-from`} type="date" value={value.date_from} onChange={e => onChange({ ...value, date_from: e.target.value })} /></div>
      <div className="space-y-2"><Label htmlFor={`${id}-to`}>To (IST)</Label><Input id={`${id}-to`} type="date" value={value.date_to} onChange={e => onChange({ ...value, date_to: e.target.value })} /></div>
      <Button variant="outline" disabled={exporting || invalidRange} onClick={() => void exportRows()}>{exporting ? "Exporting…" : "Export filtered refunds"}</Button>
    </div>
    {invalidRange && <p role="alert" className="text-sm text-destructive">Start date must be on or before end date.</p>}
    <p className="text-xs leading-5 text-muted-foreground">Export includes all matching pages, up to 10,000 refunds. Organizer credit fees are retained; any credit adjustment is recorded separately in the credit ledger. Unlinked outside-platform refunds are audit records only.</p>
  </section>;
}
