import { useEffect, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FileText, Plus, Printer } from "lucide-react";
import "./AdminBills.css";

const money = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(n / 100);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const date = (value?: string | null) => value ? new Date(value + "T12:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

function MoneyInput({ value, onChange, max = 100000000 }: { value: number; onChange: (value: number) => void; max?: number }) {
  const [text, setText] = useState(String(value / 100));
  useEffect(() => {
    setText(current => Math.round(Number(current) * 100) === value ? current : String(value / 100));
  }, [value]);
  return <Input required type="number" min="0" max={max / 100} step="0.01" value={text} onChange={e => {
    setText(e.target.value);
    onChange(Math.round(Number(e.target.value) * 100));
  }} />;
}
type Line = { description: string; quantity: number; unit_paise: number };
type Details = {
  organization_id: string; event_id: string | null; event_name?: string | null; kind: "CREDITS" | "EVENT" | "CUSTOM";
  issuer_name: string; issuer_email: string; issuer_phone: string; issuer_address: string;
  customer_name: string; customer_address: string; issue_date: string; due_date: string | null;
  lines: Line[]; discount_paise: number; notes: string; tax_note?: string;
};
export type Bill = { id: number; number: string; details: Details; totalPaise: number; status: "PENDING" | "PAID" | "CANCELLED"; paymentReference: string | null; paidOn: string | null; cancellationReason?: string | null };
type Customer = { name: string; address: string; events: { id: string; name: string }[]; issuer: Partial<Details> };
const initial = (): Details => ({ organization_id: "", event_id: null, kind: "CREDITS", issuer_name: "SportPass India", issuer_email: "sportpassind@gmail.com", issuer_phone: "", issuer_address: "", customer_name: "", customer_address: "", issue_date: today(), due_date: null, lines: [{ description: "SportPass Credits supplied", quantity: 1, unit_paise: 0 }], discount_paise: 0, notes: "" });

export function BillDocument({ bill }: { bill: Bill }) {
  const d = bill.details;
  const subtotal = d.lines.reduce((sum, line) => sum + line.quantity * line.unit_paise, 0);
  return <article className="sportpass-bill">
    <header className="bill-header"><div className="bill-brand"><img src={`${window.location.origin}/sportpass-mark.svg`} alt="SportPass India" width="56" height="56" /><div><strong>{d.issuer_name}</strong><span>sportpassindia.com</span></div></div><div className="bill-heading"><h1>BILL</h1><span>{bill.number}</span><b className={`bill-status ${bill.status.toLowerCase()}`}>{bill.status === "PENDING" ? "PAYMENT PENDING" : bill.status}</b></div></header>
    <div className="bill-contacts"><p>{d.issuer_address}</p><p>{d.issuer_email} · {d.issuer_phone}</p></div>
    <section className="bill-parties"><div><h2>BILL TO</h2><strong>{d.customer_name}</strong><p>{d.customer_address}</p></div><dl><div><dt>Issue date</dt><dd>{date(d.issue_date)}</dd></div>{d.due_date && <div><dt>Due date</dt><dd>{date(d.due_date)}</dd></div>}<div><dt>Currency</dt><dd>INR</dd></div></dl></section>
    {d.event_name && <p className="bill-event">Event: <strong>{d.event_name}</strong></p>}
    <table><thead><tr><th>Description</th><th>Quantity</th><th>Rate</th><th>Amount</th></tr></thead><tbody>{d.lines.map((line, i) => <tr key={i}><td>{line.description}</td><td>{line.quantity.toLocaleString("en-IN")}</td><td>{money(line.unit_paise)}</td><td>{money(line.quantity * line.unit_paise)}</td></tr>)}</tbody></table>
    <div className="bill-totals"><div><span>Subtotal</span><span>{money(subtotal)}</span></div>{d.discount_paise > 0 && <div><span>Discount</span><span>− {money(d.discount_paise)}</span></div>}<div className="bill-total"><strong>Total</strong><strong>{money(bill.totalPaise)}</strong></div><div><span>Amount received</span><span>{money(bill.status === "PAID" ? bill.totalPaise : 0)}</span></div><div className="bill-due"><strong>Amount due</strong><strong>{money(bill.status === "PENDING" ? bill.totalPaise : 0)}</strong></div></div>
    <p className="bill-tax">{d.tax_note || "GST not charged."}</p>
    {bill.status === "PAID" && <section className="bill-note"><h2>PAYMENT RECEIVED</h2><p>{date(bill.paidOn)} · Reference: {bill.paymentReference}</p></section>}
    {bill.status === "CANCELLED" && <section className="bill-note"><h2>CANCELLATION</h2><p>{bill.cancellationReason}</p></section>}
    {d.notes && <section className="bill-note"><h2>NOTES</h2><p>{d.notes}</p></section>}
    <footer>Thank you for choosing SportPass India.<br /><span>For billing enquiries, contact {d.issuer_email} or {d.issuer_phone}.</span></footer>
  </article>;
}

function printBill(bill: Bill) {
  const frame = document.createElement("iframe");
  frame.title = "Print bill";
  frame.style.cssText = "position:fixed;width:1px;height:1px;left:-10000px;border:0";
  // React escapes every supplied field. No customer text is interpolated as HTML.
  const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).map(node => node.outerHTML).join("");
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${bill.number}</title>${styles}</head><body>${renderToStaticMarkup(<BillDocument bill={bill} />)}</body></html>`;
  frame.onload = async () => {
    const win = frame.contentWindow;
    if (!win) return;
    await Promise.all(Array.from(win.document.images).map(img => img.decode().catch(() => undefined)));
    await win.document.fonts.ready;
    win.addEventListener("afterprint", () => frame.remove(), { once: true });
    win.focus(); win.print();
  };
  document.body.appendChild(frame);
}

export function AdminBills({ organizers }: { organizers: { id: string; name: string }[] }) {
  const [rows, setRows] = useState<Bill[]>([]), [page, setPage] = useState(1), [total, setTotal] = useState(0);
  const [filter, setFilter] = useState("");
  const [form, setForm] = useState<Details>(initial), [customer, setCustomer] = useState<Customer | null>(null);
  const [open, setOpen] = useState(false), [preview, setPreview] = useState<Bill | null>(null), [review, setReview] = useState(false);
  const [status, setStatus] = useState<"PENDING" | "PAID">("PENDING"), [reference, setReference] = useState(""), [paidOn, setPaidOn] = useState(today);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [customerLoading, setCustomerLoading] = useState(false);
  const [action, setAction] = useState<{ bill: Bill; status: "PAID" | "CANCELLED" } | null>(null), [reason, setReason] = useState("");
  const lock = useRef(false), customerVersion = useRef(0), summaryVersion = useRef(0);
  const [summaryBusy, setSummaryBusy] = useState(false);
  async function load() {
    const result = await apiRequest<{ items: Bill[]; total: number }>(`/admin/bills?page=${page}${filter ? `&organization_id=${filter}` : ""}`);
    setRows(result.items); setTotal(result.total);
  }
  useEffect(() => { let active = true; apiRequest<{ items: Bill[]; total: number }>(`/admin/bills?page=${page}${filter ? `&organization_id=${filter}` : ""}`).then(r => { if (active) { setRows(r.items); setTotal(r.total); } }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [page, filter]);
  const set = <K extends keyof Details>(key: K, value: Details[K]) => { setReview(false); setForm(f => ({ ...f, [key]: value })); };
  async function chooseCustomer(id: string) {
    const version = ++customerVersion.current;
    ++summaryVersion.current; setSummaryBusy(false);
    setForm(f => ({ ...f, organization_id: id, event_id: null, event_name: null, customer_name: "", customer_address: "", lines: [{ description: f.kind === "CREDITS" ? "SportPass Credits supplied" : "Services supplied", quantity: 1, unit_paise: 0 }], discount_paise: 0, notes: "" })); setCustomer(null); setCustomerLoading(!!id);
    if (!id) return;
    try {
      const data = await apiRequest<Customer>(`/admin/bills/customer/${id}`);
      if (version !== customerVersion.current) return;
      setCustomer(data); setForm(f => ({ ...f, ...data.issuer, organization_id: id, customer_name: data.name, customer_address: data.address }));
    } catch (e) { if (version === customerVersion.current) setError(e instanceof Error ? e.message : "Could not load billing details."); }
    finally { if (version === customerVersion.current) setCustomerLoading(false); }
  }
  async function fillEvent() {
    if (!form.event_id) return;
    const version = ++summaryVersion.current; setSummaryBusy(true); setError("");
    try {
      const summary = await apiRequest<{ registrationCount: number; netFeePaise: number; eventName: string }>(`/admin/credits/events/${form.event_id}/summary`);
      if (version !== summaryVersion.current) return;
      setForm(f => ({ ...f, lines: [{ description: `Event service fee — ${summary.eventName}`, quantity: 1, unit_paise: summary.netFeePaise }], discount_paise: 0, notes: `${summary.registrationCount} approved registrations. Fee reflects Credits charged after existing Credit discounts.` }));
    } catch (e) { if (version === summaryVersion.current) setError(e instanceof Error ? e.message : "Could not load event fees."); }
    finally { if (version === summaryVersion.current) setSummaryBusy(false); }
  }
  const totalPaise = form.lines.reduce((sum, l) => sum + l.quantity * l.unit_paise, 0) - form.discount_paise;
  const draft: Bill = { id: 0, number: "DRAFT — NOT ISSUED", details: form, totalPaise, status, paymentReference: status === "PAID" ? reference : null, paidOn: status === "PAID" ? paidOn : null };
  async function issue() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const body = { ...form, event_name: undefined, tax_note: undefined, status, payment_reference: status === "PAID" ? reference : null, paid_on: status === "PAID" ? paidOn : null };
      const fingerprint = JSON.stringify(body);
      const cached = JSON.parse(sessionStorage.getItem("sportpass-bill-request") || "null");
      const key = cached?.fingerprint === fingerprint ? cached.key : crypto.randomUUID();
      sessionStorage.setItem("sportpass-bill-request", JSON.stringify({ fingerprint, key }));
      const result = await apiRequest<Bill>("/admin/bills", { method: "POST", body: JSON.stringify({ ...body, idempotency_key: key }) });
      sessionStorage.removeItem("sportpass-bill-request"); setOpen(false); setPreview(result); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not issue bill. Retry with the same details."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function update() {
    if (!action || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const result = await apiRequest<Bill>(`/admin/bills/${action.bill.id}`, { method: "PATCH", body: JSON.stringify({ status: action.status, ...(action.status === "PAID" ? { payment_reference: reference, paid_on: paidOn } : { reason }) }) });
      setAction(null); setPreview(result); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update bill."); }
    finally { lock.current = false; setBusy(false); }
  }
  const errorMessage = error && <p role="alert" className="text-sm text-destructive">{error}</p>;
  return <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-primary" />Bills</CardTitle><CardDescription className="mt-2">Issue a bill for Credits, an event, or other services. Record whether payment is pending or already received.</CardDescription></div><Button onClick={() => { ++customerVersion.current; ++summaryVersion.current; setCustomerLoading(false); setSummaryBusy(false); setForm(initial()); setStatus("PENDING"); setReference(""); setPaidOn(today()); setCustomer(null); setError(""); setReview(false); setOpen(true); }}><Plus className="mr-2 h-4 w-4" />Raise bill</Button></div></CardHeader>
    <CardContent className="space-y-4">{!open && !action && errorMessage}<p className="text-xs text-muted-foreground">Bills do not change Credit balances. For fees already paid through purchased Credits, issue a paid bill to avoid requesting payment again.</p>
      <label className="block text-sm">Filter bills by organizer<select className="mt-1 w-full rounded-md border bg-background p-2" value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}><option value="">All organizers</option>{organizers.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-2">Bill / client</th><th className="p-2">Date</th><th className="p-2">Amount</th><th className="p-2">Status</th><th className="p-2">Actions</th></tr></thead><tbody>{rows.map(b => <tr key={b.id} className="border-b"><td className="p-2 font-medium">{b.number}<span className="block text-xs text-muted-foreground">{b.details.customer_name}</span></td><td className="p-2">{date(b.details.issue_date)}</td><td className="p-2">{money(b.totalPaise)}</td><td className="p-2"><span className={`rounded-full px-2 py-1 text-xs ${b.status === "PAID" ? "bg-emerald-100 text-emerald-800" : b.status === "PENDING" ? "bg-amber-100 text-amber-900" : "bg-muted text-muted-foreground"}`}>{b.status === "PENDING" ? "Payment pending" : b.status === "PAID" ? "Paid" : "Cancelled"}</span></td><td className="flex flex-wrap gap-2 p-2"><Button size="sm" variant="outline" onClick={() => setPreview(b)}>View / print</Button>{b.status === "PENDING" && <><Button size="sm" variant="outline" onClick={() => { setReference(""); setPaidOn(today()); setError(""); setAction({ bill: b, status: "PAID" }); }}>Mark paid</Button><Button size="sm" variant="ghost" onClick={() => { setReason(""); setError(""); setAction({ bill: b, status: "CANCELLED" }); }}>Cancel</Button></>}</td></tr>)}</tbody></table>{!rows.length && <p className="py-6 text-center text-sm text-muted-foreground">No bills issued yet.</p>}</div>
      {total > 20 && <div className="flex items-center justify-between"><Button variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button><span className="text-sm">Page {page} of {Math.ceil(total / 20)}</span><Button variant="outline" disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)}>Next</Button></div>}
    </CardContent>
    <Dialog open={open} onOpenChange={v => { if (!busy) setOpen(v); }}><DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle>{review ? "Review bill before issuing" : "Raise a bill"}</DialogTitle><DialogDescription>Check the client, charges, and payment status. Issued details are retained for your records.</DialogDescription></DialogHeader>{errorMessage}
      {review ? <><BillDocument bill={draft} /><div className="flex justify-end gap-3"><Button variant="outline" disabled={busy} onClick={() => setReview(false)}>Edit details</Button><Button disabled={busy} onClick={() => void issue()}>{busy ? "Issuing…" : "Issue bill"}</Button></div></> : <form className="space-y-5" onSubmit={e => { e.preventDefault(); if (totalPaise < 0 || totalPaise > 100000000) { setError("Check the total and discount amounts."); return; } setError(""); setReview(true); }}>
        <fieldset disabled={busy || summaryBusy} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Organizer<select required className="mt-1 w-full rounded-md border bg-background p-2" value={form.organization_id} onChange={e => void chooseCustomer(e.target.value)}><option value="">Select organizer</option>{organizers.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label><label className="text-sm">Bill for<select className="mt-1 w-full rounded-md border bg-background p-2" value={form.kind} onChange={e => { ++summaryVersion.current; set("kind", e.target.value as Details["kind"]); set("event_id", null); set("event_name", null); set("lines", [{ description: e.target.value === "CREDITS" ? "SportPass Credits supplied" : e.target.value === "EVENT" ? "Event service fee" : "Services supplied", quantity: 1, unit_paise: 0 }]); set("discount_paise", 0); set("notes", ""); }}><option value="CREDITS">Credits supplied</option><option value="EVENT">Event service fee</option><option value="CUSTOM">Other services</option></select></label></div>
          {form.kind === "EVENT" && <div className="flex flex-wrap items-end gap-3"><label className="grow text-sm">Event<select required className="mt-1 w-full rounded-md border bg-background p-2" value={form.event_id || ""} onChange={e => { ++summaryVersion.current; set("event_id", e.target.value || null); set("event_name", customer?.events.find(x => x.id === e.target.value)?.name || null); set("lines", [{ description: "Event service fee", quantity: 1, unit_paise: 0 }]); set("discount_paise", 0); set("notes", ""); }}><option value="">Select event</option>{customer?.events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label><Button type="button" variant="outline" disabled={!form.event_id || customerLoading} onClick={() => void fillEvent()}>Use recorded event fee</Button><p className="w-full text-xs text-muted-foreground">Loads actual Credit charges after existing Credit discounts. Confirm whether the client has already paid for those Credits.</p></div>}
          <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2"><h3 className="font-semibold sm:col-span-2">SportPass business details</h3>{([['issuer_name', 'Business / legal name'], ['issuer_email', 'Email'], ['issuer_phone', 'Phone']] as const).map(([key, label]) => <label key={key} className="text-sm">{label}<Input required type={key === "issuer_email" ? "email" : "text"} maxLength={key === "issuer_phone" ? 25 : 200} value={form[key]} onChange={e => set(key, e.target.value)} /></label>)}<label className="text-sm">Business address<Textarea required maxLength={1000} value={form.issuer_address} onChange={e => set("issuer_address", e.target.value)} /></label></div>
          <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Client / billing name<Input required maxLength={200} value={form.customer_name} onChange={e => set("customer_name", e.target.value)} /></label><label className="text-sm">Client billing address<Textarea required maxLength={1000} value={form.customer_address} onChange={e => set("customer_address", e.target.value)} /></label><label className="text-sm">Issue date<Input required type="date" max={today()} value={form.issue_date} onChange={e => set("issue_date", e.target.value)} /></label><label className="text-sm">Due date (optional)<Input type="date" min={form.issue_date} value={form.due_date || ""} onChange={e => set("due_date", e.target.value || null)} /></label></div>
          <div className="space-y-3"><h3 className="font-semibold">Charges</h3>{form.lines.map((line, index) => <div key={index} className="grid grid-cols-2 items-end gap-2 rounded-lg border p-3 sm:grid-cols-[2fr_1fr_1fr_auto]"><label className="col-span-2 text-sm sm:col-span-1">Description<Input required maxLength={200} value={line.description} onChange={e => set("lines", form.lines.map((l, i) => i === index ? { ...l, description: e.target.value } : l))} /></label><label className="text-sm">Quantity<Input required type="number" min="1" max="1000000" step="1" value={line.quantity} onChange={e => set("lines", form.lines.map((l, i) => i === index ? { ...l, quantity: Number(e.target.value) } : l))} /></label><label className="text-sm">Rate (₹)<MoneyInput value={line.unit_paise} onChange={value => set("lines", form.lines.map((l, i) => i === index ? { ...l, unit_paise: value } : l))} /></label><Button type="button" variant="ghost" disabled={form.lines.length === 1} onClick={() => set("lines", form.lines.filter((_, i) => i !== index))}>Remove</Button></div>)}<Button type="button" variant="outline" disabled={form.lines.length >= 20} onClick={() => set("lines", [...form.lines, { description: "", quantity: 1, unit_paise: 0 }])}>Add line</Button></div>
          <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Bill discount (₹)<MoneyInput value={form.discount_paise} max={Math.max(0, totalPaise + form.discount_paise)} onChange={value => set("discount_paise", value)} /><span className="text-xs text-muted-foreground">Reduces this bill only. Does not return Credits.</span></label><div className="rounded-lg bg-muted p-4"><span className="text-sm">Total · GST not charged</span><p className="text-2xl font-bold">{money(totalPaise)}</p></div><label className="text-sm">Payment status<select className="mt-1 w-full rounded-md border bg-background p-2" value={status} onChange={e => setStatus(e.target.value as typeof status)}><option value="PENDING">Payment pending — client still owes this amount</option><option value="PAID">Paid — payment already received</option></select></label>{status === "PAID" && <><label className="text-sm">Payment date<Input required type="date" max={today()} value={paidOn} onChange={e => setPaidOn(e.target.value)} /></label><label className="text-sm">Payment reference / Credit purchase reference<Input required maxLength={200} value={reference} onChange={e => setReference(e.target.value)} /></label></>}</div>
          <label className="block text-sm">Notes / payment instructions<Textarea maxLength={2000} value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Payment instructions, purchase reference, or agreed terms" /></label>
          <div className="flex justify-end"><Button type="submit" disabled={customerLoading || !customer || summaryBusy}>Review bill</Button></div>
        </fieldset>
      </form>}
    </DialogContent></Dialog>
    <Dialog open={!!preview} onOpenChange={v => { if (!v) setPreview(null); }}><DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle>Bill {preview?.number}</DialogTitle><DialogDescription>Print this bill or choose “Save as PDF” in your browser’s print dialog.</DialogDescription></DialogHeader>{preview && <><div className="flex justify-end"><Button onClick={() => printBill(preview)}><Printer className="mr-2 h-4 w-4" />Print / Save PDF</Button></div><BillDocument bill={preview} /></>}</DialogContent></Dialog>
    <Dialog open={!!action} onOpenChange={v => { if (!busy && !v) setAction(null); }}><DialogContent><DialogHeader><DialogTitle>{action?.status === "PAID" ? "Record payment" : "Cancel bill"}</DialogTitle><DialogDescription>{action?.bill.number} · {money(action?.bill.totalPaise || 0)}</DialogDescription></DialogHeader>{errorMessage}<form className="space-y-4" onSubmit={e => { e.preventDefault(); void update(); }}>{action?.status === "PAID" ? <><label className="block text-sm">Payment reference<Input required maxLength={200} value={reference} onChange={e => setReference(e.target.value)} /></label><label className="block text-sm">Payment date<Input required type="date" max={today()} value={paidOn} onChange={e => setPaidOn(e.target.value)} /></label></> : <label className="block text-sm">Cancellation reason<Textarea required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>}<Button disabled={busy} type="submit">{busy ? "Saving…" : action?.status === "PAID" ? "Mark paid" : "Cancel bill"}</Button></form></DialogContent></Dialog>
  </Card>;
}
