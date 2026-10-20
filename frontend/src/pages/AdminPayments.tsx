import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AdminDashboardLayout } from "@/components/AdminDashboardLayout";
import { EmbeddedAdminPage } from "@/components/AdminPaymentContext";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api";
import AdminCredits from "./AdminCredits";
import AdminRefunds from "./AdminRefunds";
import AdminSettlements from "./AdminSettlements";
import AdminOrganizerPricing from "./AdminOrganizerPricing";
import AdminOrganizers from "./AdminOrganizers";
import AdminTransactions from "./AdminTransactions";

const tabs = [["attention", "Needs attention"], ["transactions", "Transactions"], ["payouts", "Organizer payouts"], ["credits", "Credits"]];
export default function AdminPayments({ initialTab, initialReview }: { initialTab?: string; initialReview?: string }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || initialTab || "attention";
  const review = params.get("review") || initialReview || "payments";
  const [settingsSection, setSettingsSection] = useState("pricing");
  const scope = useQuery({ queryKey: ["admin-transactions-options"], queryFn: () => apiRequest<{ organizers: { id: string; name: string }[]; events: { id: string; name: string; organization_id: string }[] }>("/admin/transactions/options") });
  const topups = useQuery({ queryKey: ["payment-console-topups"], queryFn: () => apiRequest<{ total: number }>("/admin/credits/topups?status=PENDING&page_size=1") });
  const reviews = useQuery({ queryKey: ["payment-console-reviews"], queryFn: () => apiRequest<{ total: number }>("/admin/cashfree/payment-reviews?page=1&include_resolved=false") });
  const navigate = (key: string, value: string) => { const next = new URLSearchParams(params); next.set(key, value); setParams(next); };
  return <AdminDashboardLayout><div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6">
    <div className="mb-5 flex items-start justify-between gap-4"><div><h1 className="text-3xl font-bold">Payments</h1><p className="mt-2 text-sm text-muted-foreground">Review payments, pay organizers, and manage SportPass Credits.</p></div><Button variant={tab === "settings" ? "default" : "outline"} onClick={() => navigate("tab", "settings")}>Settings</Button></div>
    <nav aria-label="Payment sections" className="mb-6 flex gap-2 overflow-x-auto border-b pb-3">{tabs.map(([key, label]) => <Button key={key} variant={tab === key ? "default" : "ghost"} aria-current={tab === key ? "page" : undefined} onClick={() => navigate("tab", key)}>{label}</Button>)}</nav>
    {(tab === "credits" || tab === "payouts") && <div className="mb-4 grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2">
      <label className="text-xs font-medium">Organizer<select className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={params.get("organization_id") || ""} onChange={e => { const next = new URLSearchParams(params); next.set("organization_id", e.target.value); next.delete("event_id"); setParams(next); }}><option value="">All organizers</option>{scope.data?.organizers.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      <label className="text-xs font-medium">Event<select className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={params.get("event_id") || ""} onChange={e => navigate("event_id", e.target.value)}><option value="">All events</option>{scope.data?.events.filter(e => !params.get("organization_id") || e.organization_id === params.get("organization_id")).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      <p className="text-xs text-muted-foreground sm:col-span-2">Organizer and event selections carry across tabs. Transaction dates and payment statuses apply only to Transactions.</p>
    </div>}
    <EmbeddedAdminPage.Provider value={true}>
      {tab === "attention" && <>
        <p className="mb-4 text-sm text-muted-foreground">Choose a queue to review. Counts cover all organizers.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {[["payments", "Payment issues & refunds", reviews.data ? `${reviews.data.total} booking payments to review` : "Review booking payments and refunds"], ["topups", "Credit top-ups", topups.data ? `${topups.data.total} awaiting verification` : "Verify incoming top-ups"], ["destinations", "Organizer payment access", "Review verification and UPI destinations"]].map(([key, title, description]) => <button key={key} onClick={() => navigate("review", key)} aria-pressed={review === key} className={`rounded-xl border p-4 text-left ${review === key ? "border-primary bg-primary/5" : "bg-card"}`}><p className="font-semibold">{title}</p><p className="mt-1 text-xs text-muted-foreground">{description}</p></button>)}
        </div>
        {review === "topups" ? <AdminCredits view="topups" /> : review === "destinations" ? <AdminOrganizers /> : <AdminRefunds initialStatus="REQUESTED" />}
      </>}
      {tab === "transactions" && <AdminTransactions />}
      {tab === "payouts" && <AdminSettlements />}
      {tab === "credits" && <AdminCredits view="ledger" />}
      {tab === "settings" && <><div className="mb-4 flex flex-wrap gap-2">{[["pricing", "Organizer fees"], ["upi", "Credit top-up UPI"], ["access", "Payment permissions"]].map(([key, label]) => <Button key={key} variant={settingsSection === key ? "default" : "outline"} onClick={() => setSettingsSection(key)}>{label}</Button>)}</div>{settingsSection === "upi" ? <AdminCredits view="settings" /> : settingsSection === "access" ? <AdminOrganizers /> : <AdminOrganizerPricing />}</>}
    </EmbeddedAdminPage.Provider>
  </div></AdminDashboardLayout>;
}
