import { useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { csvCell } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

type Row = { id: string; kind: string; reference: string | null; customer: string; event: string; event_id: string | null; organizer: string; organization_id: string; method: string; status: string; amount: number | null; fee: number; refunded: number; payment_reference: string | null; created_at: string; confirmation: string };
type Report = { items: Row[]; total: number; counts: Record<string, number> };
const labels: Record<string, string> = { all: "All", successful: "Confirmed", awaiting: "Awaiting payment", needs_review: "Needs review", refunded: "Refunded", partially_refunded: "Partly refunded", refund_in_progress: "Refund in progress", not_required: "Free", expired: "Expired", failed: "Failed", cancelled: "Cancelled", rejected: "Rejected" };
const methods: Record<string, string> = { all: "All methods", cashfree: "Cashfree", direct_upi: "Direct UPI", offline: "Offline", free: "Free" };
const money = (value: number | null) => value === null ? "Unavailable" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value / 100);
const date = (value: string) => new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
const control = "h-10 rounded-md border bg-background px-3 text-sm w-full";

export default function AdminTransactions() {
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<Row | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const history = useQuery({ queryKey: ["transaction-history", selected?.kind, selected?.id], queryFn: () => apiRequest<{ history: { date: string; label: string; reference: string | null; note: string | null }[] }>(`/admin/transactions/${selected!.kind}/${selected!.id}`), enabled: !!selected });
  const get = (key: string, fallback = "") => params.get(key) || fallback;
  const change = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); if (key !== "page") next.delete("page"); setParams(next, { replace: true }); };
  const filters = new URLSearchParams();
  ["search", "organization_id", "event_id", "date_from", "date_to", "method", "kind", "status"].forEach(key => { if (get(key)) filters.set(key, get(key)); });
  const page = Math.max(1, Number(get("page", "1")) || 1);
  const invalid = !!(get("date_from") && get("date_to") && get("date_from") > get("date_to"));
  const report = useQuery({ queryKey: ["admin-transactions", filters.toString(), page], queryFn: ({ signal }) => apiRequest<Report>(`/admin/transactions?${filters}&page=${page}`, { signal }), enabled: !invalid });
  const options = useQuery({ queryKey: ["admin-transactions-options"], queryFn: () => apiRequest<{ organizers: { id: string; name: string }[]; events: { id: string; name: string; organization_id: string }[] }>("/admin/transactions/options") });
  const data = invalid ? undefined : report.data;
  const exportCsv = async () => {
    setExporting(true); setError("");
    try {
      const rows: Row[] = [];
      for (let p = 1; ; p++) {
        const result = await apiRequest<Report>(`/admin/transactions?${filters}&page=${p}&page_size=100`);
        rows.push(...result.items);
        if (rows.length >= result.total || !result.items.length) break;
        if (rows.length >= 10000) throw new Error("More than 10,000 transactions. Narrow your filters before exporting.");
      }
      const records = [["Date (IST)", "Type", "SportPass reference", "Customer", "Event / store", "Organizer", "Method", "Status", "Amount INR", "Fee INR", "Refunded INR", "Payment reference", "Confirmation"],
        ...rows.map(r => [date(r.created_at), r.kind, r.reference || r.id, r.customer, r.event, r.organizer, methods[r.method], labels[r.status] || r.status, r.amount === null ? "" : (r.amount / 100).toFixed(2), (r.fee / 100).toFixed(2), (r.refunded / 100).toFixed(2), r.payment_reference || "", r.confirmation])];
      const url = URL.createObjectURL(new Blob([records.map(r => r.map(v => csvCell(String(v), true)).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a"); a.href = url; a.download = "sportpass-transactions.csv"; a.click(); URL.revokeObjectURL(url);
    } catch (e) { setError(e instanceof Error ? e.message : "Export failed"); } finally { setExporting(false); }
  };
  return <section className="space-y-4">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Transactions</h2><p className="text-sm text-muted-foreground">Registrations and merchandise · live payments only</p></div><Button variant="outline" disabled={exporting || invalid || !data} onClick={() => void exportCsv()}>{exporting ? "Exporting…" : "Export CSV"}</Button></div>
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <Input aria-label="Search transactions" placeholder="Search participant, SportPass reference, organizer or payment reference" value={get("search")} onChange={e => change("search", e.target.value)} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs font-medium">Organizer<select className={control} value={get("organization_id")} onChange={e => { const next = new URLSearchParams(params); next.set("organization_id", e.target.value); next.delete("event_id"); next.delete("page"); setParams(next); }}><option value="">All organizers</option>{options.data?.organizers.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label className="text-xs font-medium">Event<select className={control} value={get("event_id")} onChange={e => change("event_id", e.target.value)}><option value="">All events / stores</option>{options.data?.events.filter(e => !get("organization_id") || e.organization_id === get("organization_id")).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <label className="text-xs font-medium">Payment method<select className={control} value={get("method", "all")} onChange={e => change("method", e.target.value)}>{Object.entries(methods).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        <label className="text-xs font-medium">Type<select className={control} value={get("kind", "all")} onChange={e => change("kind", e.target.value)}><option value="all">Registrations + merchandise</option><option value="registration">Registrations</option><option value="merchandise">Merchandise</option></select></label>
        <label className="text-xs font-medium">From (IST)<Input type="date" value={get("date_from")} onChange={e => change("date_from", e.target.value)} /></label>
        <label className="text-xs font-medium">To (IST)<Input type="date" min={get("date_from")} value={get("date_to")} onChange={e => change("date_to", e.target.value)} /></label>
      </div>
      <div className="flex flex-wrap gap-2">{["all", "needs_review", "awaiting", "successful", "refunded"].map(key => <Button key={key} size="sm" variant={get("status", "all") === key ? "default" : "outline"} onClick={() => change("status", key)}>{labels[key]} {data && <span className="ml-2">{key === "all" ? Object.values(data.counts).reduce((a, b) => a + b, 0) : data.counts[key] || 0}</span>}</Button>)}
        <select aria-label="All transaction statuses" className="rounded-md border bg-background px-2 text-sm" value={get("status", "all")} onChange={e => change("status", e.target.value)}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <Button size="sm" variant="ghost" onClick={() => setParams({ tab: "transactions" })}>Clear filters</Button>
      </div>
    </div>
    {(invalid || report.isError || options.isError || error) && <p role="alert" className="text-sm text-destructive">{invalid ? "Choose an end date after the start date." : error || report.error?.message || options.error?.message}</p>}
    <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full text-left text-sm"><thead className="border-b bg-muted/40"><tr>{["Participant / buyer", "Event / store", "Amount", "Payment", "Status", ""].map((h, i) => <th className="p-4" key={i}>{h}</th>)}</tr></thead><tbody>{data?.items.map(row => <tr key={`${row.kind}-${row.id}`} className="border-b"><td className="p-4"><p className="font-medium">{row.customer}</p><p className="text-xs text-muted-foreground">{row.reference || row.id}</p><p className="text-xs text-muted-foreground">{date(row.created_at)}</p></td><td className="p-4">{row.event}<p className="text-xs text-muted-foreground">{row.organizer} · {row.kind}</p></td><td className="p-4 font-semibold whitespace-nowrap">{money(row.amount)}</td><td className="p-4">{methods[row.method]}<p className="text-xs text-muted-foreground">{row.method === "cashfree" ? "Through Cashfree" : row.method === "free" ? "No payment" : "Direct to organizer"}</p></td><td className="p-4"><span className={`rounded-full px-2 py-1 text-xs ${row.status === "successful" ? "bg-emerald-100 text-emerald-800" : "bg-muted"}`}>{labels[row.status] || row.status}</span></td><td className="p-4"><Button variant="outline" size="sm" onClick={() => setSelected(row)}>Details</Button></td></tr>)}</tbody></table>
      {report.isFetching && <p className="p-6 text-center" role="status">Loading transactions…</p>}
      {!report.isFetching && data?.total === 0 && <p className="p-8 text-center text-muted-foreground">No transactions match your filters.</p>}
    </div>
    <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{data?.total ?? 0} transactions · Page {page}</span><div className="flex gap-2"><Button variant="outline" disabled={page === 1 || report.isFetching} onClick={() => change("page", String(page - 1))}>Previous</Button><Button variant="outline" disabled={!data || page * 25 >= data.total || report.isFetching} onClick={() => change("page", String(page + 1))}>Next</Button></div></div>
    <Sheet open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}><SheetContent className="overflow-y-auto"><SheetHeader><SheetTitle>Payment details</SheetTitle><SheetDescription>{selected?.customer} · {selected?.event}</SheetDescription></SheetHeader>{selected && <div className="mt-6 space-y-5 text-sm"><p className="text-3xl font-bold">{money(selected.amount)}</p><p className="rounded-lg bg-muted p-3">{selected.confirmation}</p><dl className="space-y-4">{[["SportPass reference", selected.reference || selected.id], ["Organizer", selected.organizer], ["Payment method", methods[selected.method]], ["Payment reference", selected.payment_reference || "Not submitted"], ["SportPass fee", money(selected.fee)], ["Completed refunds", money(selected.refunded)], ["Created (IST)", date(selected.created_at)]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 break-all font-medium">{value}</dd></div>)}</dl><section><h3 className="font-semibold">Payment history</h3>{history.isFetching && <p>Loading history…</p>}{history.isError && <p role="alert">Could not load history.</p>}{history.data?.history.map((entry, i) => <div key={i} className="mt-3 border-l-2 pl-3"><p>{entry.label}</p><p className="text-xs text-muted-foreground">{date(entry.date)}</p><p className="break-all text-xs">{entry.reference}</p>{entry.note && <p>{entry.note}</p>}</div>)}{history.data?.history.length === 0 && <p className="mt-2 text-muted-foreground">No payment history recorded.</p>}</section>{selected.event_id && <Button asChild variant="outline"><Link to={`/organizer/registrations?event_id=${selected.event_id}&search=${encodeURIComponent(selected.reference || selected.id)}`}>Open registration</Link></Button>}<Button asChild variant="outline"><Link to="/admin/payments?tab=attention">Open payment reviews & refunds</Link></Button></div>}</SheetContent></Sheet>
  </section>;
}
