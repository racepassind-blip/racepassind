import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type MerchandiseOrder = {
  id: string; buyer_name: string; buyer_email: string; buyer_phone: string; status: string; payment_reference: string | null;
  snapshot: { total_paise: number; lines: Array<{ product_name: string; variant_label: string; quantity: number; customization?: string | null; customization_label?: string | null }> };
};
type Store = { id: string; name: string; status: string; catalog: { products: Array<{ variants: Array<{ stock: number }> }> } };
const money = (amount: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount / 100);
const labels: Record<string, string> = { published: "Live", draft: "Draft", closed: "Closed", awaiting_payment: "Awaiting payment", under_review: "Payment review", confirmed: "Ready for pickup", fulfilled: "Collected", rejected: "Rejected", expired: "Expired" };
function Status({ value }: { value: string }) {
  return <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${["published", "confirmed", "fulfilled"].includes(value) ? "bg-emerald-50 text-emerald-800" : value === "under_review" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{labels[value] || value}</span>;
}
function Pages({ page, count, setPage }: { page: number; count: number; setPage: (page: number) => void }) {
  return count > 1 && <div className="flex items-center justify-between gap-3 border-t pt-4"><Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-sm text-slate-500">Page {page} of {count}</span><Button variant="outline" disabled={page === count} onClick={() => setPage(page + 1)}>Next</Button></div>;
}
const selectClass = "h-10 rounded-md border border-input bg-background px-3 text-sm";

export function StorefrontDirectory({ stores, onCreate }: { stores: Store[]; onCreate: () => void }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const filtered = stores.filter((store) => (status === "all" || store.status === status) && store.name.toLowerCase().includes(search.toLowerCase().trim()));
  const count = Math.max(1, Math.ceil(filtered.length / 8));
  const current = Math.min(page, count);
  return <section className="space-y-5 rounded-2xl border bg-white p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-2xl font-semibold">Your storefronts</h2><p className="mt-1 text-sm text-slate-500">{stores.length} stores · {stores.filter((store) => store.status === "published").length} live</p></div><Button onClick={onCreate}>Create storefront</Button></div><div className="flex flex-col gap-3 sm:flex-row"><Input aria-label="Search storefronts" placeholder="Search storefronts…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /><select aria-label="Storefront status" className={selectClass} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="all">All statuses</option>{["published", "draft", "closed"].map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select></div><div className="divide-y">{filtered.slice((current - 1) * 8, current * 8).map((store) => <div key={store.id} className="flex flex-col justify-between gap-4 py-5 sm:flex-row sm:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-3"><Link to={`/organizer/products/${store.id}`} className="break-words font-semibold hover:underline">{store.name}</Link><Status value={store.status} /></div><p className="mt-2 text-sm text-slate-500">{store.catalog.products.length} products · {store.catalog.products.reduce((total, product) => total + product.variants.reduce((sum, variant) => sum + variant.stock, 0), 0)} units available</p></div><Button asChild variant="outline" className="shrink-0"><Link to={`/organizer/products/${store.id}`}>Manage store →</Link></Button></div>)}</div>{filtered.length === 0 && <p className="py-8 text-center text-sm text-slate-500">{stores.length ? "No storefronts match your search." : "Create your first race merchandise storefront."}</p>}<Pages page={current} count={count} setPage={setPage} /></section>;
}

export function OrderDashboard({ orders, onDecision, onRefresh, busy, error }: { orders: MerchandiseOrder[]; onDecision: (order: MerchandiseOrder, decision: "approve" | "reject" | "fulfilled") => Promise<void>; onRefresh: () => Promise<void>; busy: boolean; error: string }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [confirmReject, setConfirmReject] = useState<string | null>(null);
  const filtered = orders.filter((order) => (status === "all" || order.status === status) && [order.id, order.buyer_name, order.buyer_email, order.buyer_phone, order.payment_reference, ...order.snapshot.lines.map((line) => `${line.product_name} ${line.variant_label}`)].join(" ").toLowerCase().includes(search.toLowerCase().trim()));
  const count = Math.max(1, Math.ceil(filtered.length / 10));
  const current = Math.min(page, count);
  const paid = orders.filter((order) => ["confirmed", "fulfilled"].includes(order.status));
  return <section className="space-y-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-semibold">Order dashboard</h2><p className="mt-1 text-sm text-slate-500">Review payments and manage race-day pickups.</p></div><Button variant="outline" disabled={busy} onClick={() => void onRefresh()}>{busy ? "Updating…" : "Refresh orders"}</Button></div>{orders.length >= 500 && <p className="text-sm text-slate-500">Showing the latest 500 orders. Totals and filters apply to these orders.</p>}<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Orders", orders.length], ["Payment review", orders.filter((order) => order.status === "under_review").length], ["Ready for pickup", orders.filter((order) => order.status === "confirmed").length], ["Confirmed order value", money(paid.reduce((sum, order) => sum + order.snapshot.total_paise, 0))]].map(([label, value]) => <div key={label} className="rounded-2xl border bg-white p-4 sm:p-5"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 break-words text-2xl font-semibold">{value}</p></div>)}</div>{error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}<div className="space-y-4 rounded-2xl border bg-white p-4 sm:p-6"><div className="flex flex-col gap-3 sm:flex-row"><Input aria-label="Search orders" placeholder="Search buyer, order, product or payment reference…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /><select aria-label="Order status" className={selectClass} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="all">All orders</option>{["under_review", "confirmed", "awaiting_payment", "fulfilled", "rejected", "expired"].map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select></div><p className="text-xs text-slate-500">{filtered.length} matching orders · newest first</p><div className="overflow-x-auto rounded-xl border border-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500" role="region" aria-label="Orders table, scroll horizontally to see all columns" tabIndex={0}>
          <table className="w-full min-w-[960px] text-left text-sm">
            <caption className="sr-only">Merchandise orders and payment actions</caption>
            <thead className="border-b bg-slate-50 text-xs text-slate-500"><tr>
              {["Buyer / order", "Products / sizes", "Qty", "Total", "Payment reference", "Status", "Actions"].map((heading) => <th key={heading} scope="col" className={`px-4 py-3 font-medium ${["Qty", "Total"].includes(heading) ? "text-right" : ""}`}>{heading}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.slice((current - 1) * 10, current * 10).map((order) => <tr key={order.id} className="align-top transition-colors hover:bg-slate-50/70">
                <th scope="row" className="max-w-[230px] px-4 py-4 font-normal">
                  <p className="break-words font-semibold text-slate-900">{order.buyer_name}</p>
                  <p className="mt-1 text-xs text-slate-500">#{order.id.slice(0, 8)}</p>
                  <details className="mt-2 text-xs"><summary className="cursor-pointer text-slate-600">Contact & full order ID</summary><div className="mt-2 space-y-1 break-all text-slate-500"><p>{order.buyer_email}</p><p>{order.buyer_phone}</p><p>{order.id}</p></div></details>
                </th>
                <td className="min-w-[180px] max-w-[260px] px-4 py-4"><div className="space-y-3">{order.snapshot.lines.map((line, index) => <div key={index}><p className="break-words font-medium">{line.product_name}</p><p className="mt-1 text-xs text-slate-500">{line.variant_label} × {line.quantity}</p>{line.customization && <p className="mt-1 break-words text-xs text-slate-500">{line.customization_label || "Customization"}: {line.customization}</p>}</div>)}</div></td>
                <td className="px-4 py-4 text-right tabular-nums">{order.snapshot.lines.reduce((sum, line) => sum + line.quantity, 0)}</td>
                <td className="whitespace-nowrap px-4 py-4 text-right font-semibold tabular-nums">{money(order.snapshot.total_paise)}</td>
                <td className="max-w-[180px] break-all px-4 py-4 text-xs"><span className={order.payment_reference ? "font-mono text-slate-700" : "text-slate-400"}>{order.payment_reference || "Not submitted"}</span></td>
                <td className="px-4 py-4"><div className="whitespace-nowrap"><Status value={order.status} /></div></td>
                <td className="min-w-[175px] px-4 py-4">
                  {order.status === "under_review" ? <div className="space-y-2">{confirmReject === order.id ? <><p className="text-xs text-slate-600">Reject payment and return stock?</p><Button size="sm" disabled={busy} variant="destructive" onClick={() => { setConfirmReject(null); void onDecision(order, "reject"); }}>Confirm rejection</Button><Button size="sm" variant="ghost" onClick={() => setConfirmReject(null)}>Cancel</Button></> : <><Button size="sm" disabled={busy} onClick={() => void onDecision(order, "approve")}>Approve payment</Button><Button size="sm" disabled={busy} variant="ghost" className="block text-slate-500" onClick={() => setConfirmReject(order.id)}>Reject</Button></>}</div> : order.status === "confirmed" ? <Button size="sm" disabled={busy} onClick={() => void onDecision(order, "fulfilled")}>Mark collected</Button> : <span className="text-xs text-slate-400">{order.status === "awaiting_payment" ? "Waiting for UTR" : "No action needed"}</span>}
                </td>
              </tr>)}
              {!filtered.length && <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">{orders.length ? "No orders match your filters." : "No orders yet. Orders will appear here when customers check out."}</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">Verify the payment reference in your payment account before approving.<span className="block mt-1 lg:hidden">Swipe the table sideways to see all columns and actions.</span></p><Pages page={current} count={count} setPage={setPage} /></div></section>;
}
