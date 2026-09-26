import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { OrganizerWorkspaceTabs } from "@/components/OrganizerWorkspaceTabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/api";

interface CreditAccount { organizationId: string; balancePaise: number; }
interface PaymentSettings { configured: boolean; payeeName?: string; upiId?: string; qrDataUrl?: string; }
interface CreditTransaction { id: string; organizationId: string; type: string; amountPaise: number; balanceAfterPaise: number; eventId: string | null; eventName: string | null; registrationReference: string | null; description: string; reason: string | null; createdAt: string; }
interface EventOption { id: string; name: string; }
interface CreditTopup { id: string; status: "PENDING" | "APPROVED" | "REJECTED"; }
interface PagedResponse<T> { items: T[]; page: number; pageSize: number; total: number; }
interface TopupResponse extends PagedResponse<CreditTopup> { pending: number; }

const PAGE_SIZE = 25;
const money = (paise: number) => `${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })} Credits`;

export default function OrganizerCredits() {
  const [accounts, setAccounts] = useState<CreditAccount[]>([]);
  const [settings, setSettings] = useState<PaymentSettings | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [transactionTotal, setTransactionTotal] = useState(0);
  const [pendingTopups, setPendingTopups] = useState(0);
  const [amount, setAmount] = useState("500");
  const [utr, setUtr] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [eventFilter, setEventFilter] = useState("");
  const [eventOptions, setEventOptions] = useState<EventOption[]>([]);

  const loadWallet = useCallback(async (selected: string) => {
    const amountPaise = Math.max(0, Math.round(Number(selected) * 100));
    const data = await apiRequest<{ accounts: CreditAccount[]; paymentSettings: PaymentSettings }>(`/organizer/credits?amount_paise=${amountPaise}`);
    setAccounts(data.accounts);
    setSettings(data.paymentSettings);
    setOrganizationId((current) => current || data.accounts[0]?.organizationId || "");
  }, []);

  const loadHistory = useCallback(async (targetPage: number) => {
    setLoadingHistory(true);
    try {
      const [transactionsResponse, topupsResponse] = await Promise.all([
        apiRequest<PagedResponse<CreditTransaction> & { eventOptions?: EventOption[] }>(`/organizer/credits/transactions?page=${targetPage}&page_size=${PAGE_SIZE}${eventFilter ? `&event_id=${encodeURIComponent(eventFilter)}` : ""}`),
        apiRequest<TopupResponse>(`/organizer/credits/topups?page=1&page_size=1`),
      ]);
      setTransactions(transactionsResponse.items);
      setTransactionTotal(transactionsResponse.total);
      setEventOptions(transactionsResponse.eventOptions ?? []);
      setPendingTopups(topupsResponse.pending);
    } finally {
      setLoadingHistory(false);
    }
  }, [eventFilter]);

  useEffect(() => { void loadHistory(page); }, [loadHistory, page]);
  useEffect(() => { const timer = window.setTimeout(() => void loadWallet(amount), 250); return () => window.clearTimeout(timer); }, [amount, loadWallet]);

  const submit = async () => {
    try {
      await apiRequest("/organizer/credits/topups", { method: "POST", body: JSON.stringify({ organization_id: organizationId, amount_paise: Math.round(Number(amount) * 100), utr_reference: utr }) });
      setMessage("Top-up submitted for admin approval.");
      setUtr("");
      setPage(1);
      await Promise.all([loadWallet(amount), loadHistory(1)]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not submit top-up");
    }
  };

  const totalPages = Math.max(1, Math.ceil(transactionTotal / PAGE_SIZE));

  return <OrganizerDashboardLayout showNavigation={false}><div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8 lg:py-10"><OrganizerWorkspaceTabs/><div className="mx-auto max-w-5xl space-y-6">
    <div><p className="text-sm font-medium text-primary">Organizer wallet</p><h1 className="text-3xl font-bold tracking-tight">SportPass Credits</h1><p className="mt-1 text-muted-foreground">Every Credit movement is recorded here for your audit.</p></div>
    <div className="grid gap-4 sm:grid-cols-3"><Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Available balance</p><p className="mt-1 text-3xl font-bold">{money(accounts[0]?.balancePaise ?? 0)}</p><p className="text-xs text-muted-foreground">1 Credit = ₹1</p></CardContent></Card><Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Ledger entries</p><p className="mt-1 text-3xl font-bold">{transactionTotal.toLocaleString("en-IN")}</p></CardContent></Card><Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Pending top-ups</p><p className="mt-1 text-3xl font-bold">{pendingTopups.toLocaleString("en-IN")}</p></CardContent></Card></div>
    <Card><CardHeader><CardTitle>Top up Credits · UPI</CardTitle><CardDescription>Pay, then submit the UTR. Credits are added only after admin approval.</CardDescription></CardHeader><CardContent className="space-y-4">{settings?.configured ? <div className="flex flex-col gap-4 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center"><div className="flex-1"><p className="font-semibold">Pay {settings.payeeName}</p><p className="text-sm text-muted-foreground">{settings.upiId}</p><p className="mt-2 text-xs text-muted-foreground">The QR updates for your selected amount and includes your organizer name.</p></div>{settings.qrDataUrl && <img className="h-36 w-36 rounded border bg-white p-1" src={settings.qrDataUrl} alt="UPI QR code"/>}</div> : <p className="text-sm text-muted-foreground">UPI details are not configured yet.</p>}<div className="flex flex-wrap gap-2">{[500, 1000, 2000].map((value) => <Button key={value} variant="outline" onClick={() => setAmount(String(value))}>₹{value}</Button>)}<Input className="w-40" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Custom amount"/></div><div className="flex gap-2"><Input value={utr} onChange={(event) => setUtr(event.target.value)} placeholder="UPI UTR reference"/><Button disabled={!settings?.configured || !utr.trim()} onClick={() => void submit()}>Submit UTR</Button></div>{message && <p className="text-sm text-muted-foreground">{message}</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Credit audit ledger</CardTitle><CardDescription>View additions and deductions by event, with account-level top-ups and adjustments kept visible.</CardDescription><div className="pt-2"><select aria-label="Filter Credit ledger by event" className="h-10 w-full rounded-md border bg-background px-3 text-sm sm:max-w-md" value={eventFilter} onChange={(event) => { setEventFilter(event.target.value); setPage(1); }}><option value="">All events and account activity</option>{eventOptions.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></div></CardHeader><CardContent className="p-0">{loadingHistory && transactions.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">Loading Credit history…</div> : transactions.length === 0 ? <div className="m-6 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No Credit transactions for this view.</div> : <div className="divide-y">{transactions.map((transaction) => <div key={transaction.id} className="p-4 sm:p-5"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><Badge variant={transaction.amountPaise >= 0 ? "secondary" : "destructive"}>{transaction.amountPaise >= 0 ? "Credit added" : "Credit deducted"}</Badge><span className="font-medium">{transaction.type.replaceAll("_", " ")}</span></div><p className="mt-2 text-sm">{transaction.description}</p>{transaction.reason && <p className="text-sm text-muted-foreground">Reason: {transaction.reason}</p>}<p className="mt-1 text-xs text-muted-foreground">{transaction.eventName ? `Event: ${transaction.eventName}` : "Account-level activity"} · {new Date(transaction.createdAt).toLocaleString("en-IN")}</p></div><div className="text-left sm:text-right"><p className={`text-lg font-bold ${transaction.amountPaise >= 0 ? "text-emerald-600" : "text-destructive"}`}>{transaction.amountPaise >= 0 ? "+" : ""}{money(transaction.amountPaise)}</p><p className="text-xs text-muted-foreground">Balance: {money(transaction.balanceAfterPaise)}</p></div></div></div>)}</div>}
      {transactionTotal > PAGE_SIZE && <div className="flex items-center justify-between gap-3 border-t px-4 py-3 sm:px-5"><p className="text-sm text-muted-foreground">Page {page} of {totalPages} · {transactionTotal.toLocaleString("en-IN")} entries</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1 || loadingHistory} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft className="mr-1 h-4 w-4"/>Previous</Button><Button variant="outline" size="sm" disabled={page >= totalPages || loadingHistory} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next<ChevronRight className="ml-1 h-4 w-4"/></Button></div></div>}
    </CardContent></Card>
  </div></div></OrganizerDashboardLayout>;
}
