import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, ChevronLeft, ChevronRight, Clock3, CreditCard, ReceiptText, ShieldCheck } from "lucide-react";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { OrganizerWorkspaceTabs } from "@/components/OrganizerWorkspaceTabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/api";
import "./OrganizerCredits.css";

interface CreditAccount { organizationId: string; balancePaise: number; }
interface PaymentSettings { configured: boolean; payeeName?: string; upiId?: string; qrDataUrl?: string | null; }
interface CreditTransaction { id: string; organizationId: string; type: string; amountPaise: number; balanceAfterPaise: number; eventId: string | null; eventName: string | null; registrationReference: string | null; description: string; reason: string | null; createdAt: string; }
interface EventOption { id: string; name: string; }
interface CreditTopup { id: string; amountPaise: number; utrReference: string; status: "PENDING" | "APPROVED" | "REJECTED"; requestedAt: string; rejectionReason: string | null; }
interface PagedResponse<T> { items: T[]; page: number; pageSize: number; total: number; }
interface TransactionResponse extends PagedResponse<CreditTransaction> { eventOptions: EventOption[]; }
interface TopupResponse extends PagedResponse<CreditTopup> { pending: number; }

const PAGE_SIZE = 25;
const TOPUP_PAGE_SIZE = 5;
const creditValue = (paise: number) => (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const dateTime = (value: string) => new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
const parseAmountPaise = (value: string) => {
  const numeric = Number(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim()) || numeric <= 0) return null;
  const paise = Math.round(numeric * 100);
  return Number.isSafeInteger(paise) ? paise : null;
};

export default function OrganizerCredits() {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("500");
  const [qrAmount, setQrAmount] = useState("500");
  const [utr, setUtr] = useState("");
  const [page, setPage] = useState(1);
  const [eventFilter, setEventFilter] = useState("");
  const [activityMonth, setActivityMonth] = useState("");
  const [activityDirection, setActivityDirection] = useState("");
  const [topupPage, setTopupPage] = useState(1);
  const [topupMonth, setTopupMonth] = useState("");
  const [topupStatus, setTopupStatus] = useState<"" | CreditTopup["status"]>("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const amountPaise = parseAmountPaise(amount);
  const qrAmountPaise = parseAmountPaise(qrAmount);

  useEffect(() => {
    const timer = window.setTimeout(() => setQrAmount(amount), 250);
    return () => window.clearTimeout(timer);
  }, [amount]);

  const walletQuery = useQuery({
    queryKey: ["organizer-credits", "wallet", qrAmountPaise ?? 0],
    queryFn: () => apiRequest<{ accounts: CreditAccount[]; paymentSettings: PaymentSettings }>(`/organizer/credits?amount_paise=${qrAmountPaise ?? 0}`),
    placeholderData: (previous) => previous,
  });
  const ledgerQuery = useQuery({
    queryKey: ["organizer-credits", "transactions", page, eventFilter, activityMonth, activityDirection],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      if (eventFilter) params.set("event_id", eventFilter);
      if (activityDirection) params.set("direction", activityDirection);
      if (activityMonth) {
        params.set("month", activityMonth);
        params.set("timezone_offset_minutes", String(new Date(`${activityMonth}-01T12:00:00`).getTimezoneOffset()));
      }
      return apiRequest<TransactionResponse>(`/organizer/credits/transactions?${params}`);
    },
    placeholderData: (previous) => previous,
  });
  const topupsQuery = useQuery({
    queryKey: ["organizer-credits", "topups", topupPage, topupMonth, topupStatus],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(topupPage), page_size: String(TOPUP_PAGE_SIZE) });
      if (topupMonth) {
        params.set("month", topupMonth);
        params.set("timezone_offset_minutes", String(new Date(`${topupMonth}-01T12:00:00`).getTimezoneOffset()));
      }
      if (topupStatus) params.set("topup_status", topupStatus);
      return apiRequest<TopupResponse>(`/organizer/credits/topups?${params}`);
    },
    placeholderData: (previous) => previous,
  });

  const account = walletQuery.data?.accounts[0];
  const settings = walletQuery.data?.paymentSettings;
  const paymentDetailsCurrent = amountPaise !== null && amountPaise === qrAmountPaise && !walletQuery.isPlaceholderData && !walletQuery.isError;
  const qrReady = paymentDetailsCurrent && Boolean(settings?.configured && settings.qrDataUrl);
  const canSubmit = paymentDetailsCurrent && Boolean(settings?.configured && account?.organizationId) && utr.trim().length >= 3 && !submitting;
  const transactions = ledgerQuery.isPlaceholderData ? [] : ledgerQuery.data?.items ?? [];
  const transactionTotal = ledgerQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(transactionTotal / PAGE_SIZE));
  const topupTotal = topupsQuery.data?.total ?? 0;
  const topupTotalPages = Math.max(1, Math.ceil(topupTotal / TOPUP_PAGE_SIZE));

  useEffect(() => {
    if (!ledgerQuery.isPlaceholderData && ledgerQuery.data && page > totalPages) setPage(totalPages);
  }, [ledgerQuery.data, ledgerQuery.isPlaceholderData, page, totalPages]);

  useEffect(() => {
    if (!topupsQuery.isPlaceholderData && topupsQuery.data && topupPage > topupTotalPages) setTopupPage(topupTotalPages);
  }, [topupsQuery.data, topupsQuery.isPlaceholderData, topupPage, topupTotalPages]);

  const submit = async () => {
    if (!canSubmit || amountPaise === null || !account) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      await apiRequest("/organizer/credits/topups", {
        method: "POST",
        body: JSON.stringify({ organization_id: account.organizationId, amount_paise: amountPaise, utr_reference: utr.trim() }),
      });
      setUtr("");
      setPage(1);
      setTopupMonth("");
      setTopupStatus("");
      setTopupPage(1);
      setFeedback({ kind: "success", text: "Top-up submitted. Credits will appear after your payment is approved." });
      await queryClient.invalidateQueries({ queryKey: ["organizer-credits"] });
    } catch (error) {
      setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Could not submit your top-up. Please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <OrganizerDashboardLayout showNavigation={false}>
      <div className="credits-page">
        <OrganizerWorkspaceTabs />
        <main className="credits-content">
          <header className="credits-heading">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">Organizer workspace</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">SportPass Credits</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Manage your balance, top-up requests, and credit activity.</p>
            </div>
            <a className="credits-text-link" href="#credit-activity">View credit activity <ArrowUpRight size={15} /></a>
          </header>

          <section className="credits-overview" aria-label="Credit account overview">
            <div className="credits-balance">
              <p className="credits-label">Available balance</p>
              <div className="credits-balance-value">
                {walletQuery.isPending ? "—" : walletQuery.isError ? "Unavailable" : creditValue(account?.balancePaise ?? 0)}
                {!walletQuery.isPending && !walletQuery.isError && <span>Credits</span>}
              </div>
              {walletQuery.isError
                ? <Button variant="link" size="sm" onClick={() => void walletQuery.refetch()}>Retry loading balance</Button>
                : <p className="credits-caption">1 Credit = ₹1</p>}
            </div>
            <div className="credits-summary">
              <span className="credits-label"><Clock3 size={15} /> Pending top-ups</span>
              <strong>{topupsQuery.isPending || topupsQuery.isError ? "—" : topupsQuery.data?.pending ?? 0}</strong>
              <p className="credits-caption">Awaiting payment approval</p>
            </div>
            <div className="credits-summary credits-summary-note">
              <span className="credits-label"><ShieldCheck size={16} /> How top-ups work</span>
              <p>Pay by UPI and submit your transaction reference. Credits are added after approval.</p>
            </div>
          </section>

          <section className="credits-panel" aria-labelledby="topup-title">
            <div className="credits-panel-heading">
              <div><h2 id="topup-title">Add Credits</h2><p>Choose an amount, pay by UPI, then submit your payment reference.</p></div>
              <span className="credits-method"><CreditCard size={15} /> UPI payment</span>
            </div>
            <form className="credits-payment-grid" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
              <div className="credits-payment-form">
                <div className="credits-field">
                  <Label htmlFor="credit-amount">Top-up amount</Label>
                  <div className="credits-amount-input">
                    <span>₹</span>
                    <Input id="credit-amount" type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setFeedback(null); }} aria-describedby="credit-amount-help" aria-invalid={amount.length > 0 && amountPaise === null} />
                  </div>
                  <div className="credits-presets">
                    {[500, 1000, 2000].map((value) => <Button key={value} type="button" variant="outline" size="sm" aria-pressed={amount === String(value)} onClick={() => { setAmount(String(value)); setFeedback(null); }}>₹{value.toLocaleString("en-IN")}</Button>)}
                  </div>
                  <p id="credit-amount-help" className={amountPaise === null ? "text-xs text-destructive" : "credits-caption"}>{amountPaise === null ? "Enter an amount greater than ₹0 with up to two decimal places." : `You will receive ${creditValue(amountPaise)} Credits after approval.`}</p>
                </div>
                <div className="credits-field">
                  <Label htmlFor="credit-utr">Payment reference (UTR)</Label>
                  <Input id="credit-utr" value={utr} onChange={(event) => { setUtr(event.target.value); setFeedback(null); }} placeholder="Enter your UPI transaction reference" maxLength={160} autoComplete="off" aria-describedby="credit-utr-help" />
                  <p id="credit-utr-help" className="credits-caption">Complete your payment first. Find the UTR in your UPI app’s transaction details.</p>
                </div>
                <div className="credits-submit">
                  <Button type="submit" disabled={!canSubmit}>{submitting ? "Submitting…" : "Submit payment for approval"}</Button>
                  {feedback && <p role="status" className={`credits-feedback ${feedback.kind === "success" ? "credits-feedback-success" : "credits-feedback-error"}`}>{feedback.text}</p>}
                </div>
              </div>
              <aside className="credits-payment-details" aria-label="UPI payment details">
                <p className="credits-label">Scan to pay</p>
                {walletQuery.isPending ? <p className="credits-caption">Loading UPI details…</p> : walletQuery.isError ? <div><p className="text-sm text-destructive">Could not load payment details.</p><Button type="button" variant="link" size="sm" onClick={() => void walletQuery.refetch()}>Try again</Button></div> : !settings?.configured ? <p className="credits-caption">UPI top-ups are not available yet. Please check back after payment details are configured.</p> : <>
                  <div className="credits-qr">{qrReady ? <img width="160" height="160" src={settings.qrDataUrl ?? ""} alt={`UPI QR code for ₹${creditValue(amountPaise ?? 0)}`} /> : <p>{amountPaise === null ? "Enter a valid amount to show the QR code." : paymentDetailsCurrent ? "QR unavailable. Pay using the UPI ID below." : "Updating payment QR…"}</p>}</div>
                  <strong className="credits-pay-amount">{amountPaise === null ? "Choose an amount" : `₹${creditValue(amountPaise)}`}</strong>
                  <div><p className="credits-payee">{settings.payeeName}</p><p className="credits-upi-id">{settings.upiId}</p></div>
                  <p className="credits-caption">Check the payee and amount before paying.</p>
                </>}
              </aside>
            </form>
          </section>

          <section className="credits-panel" aria-labelledby="topup-history-title">
            <div className="credits-panel-heading">
              <div><h2 id="topup-history-title">Recent top-up requests</h2><p>Review your submitted payments and approval status.</p></div>
              {!topupsQuery.isPending && !topupsQuery.isError && !topupsQuery.isPlaceholderData && <span className="credits-caption">{topupTotal.toLocaleString("en-IN")} {topupMonth || topupStatus ? "matching" : "total"} requests</span>}
            </div>
            <div className="credits-filters">
              <div className="credits-filter">
                <Label htmlFor="topup-month-filter">Month</Label>
                <Input id="topup-month-filter" type="month" value={topupMonth} onChange={(event) => { setTopupMonth(event.target.value); setTopupPage(1); }} />
              </div>
              <div className="credits-filter">
                <Label htmlFor="topup-status-filter">Status</Label>
                <select id="topup-status-filter" value={topupStatus} onChange={(event) => { setTopupStatus(event.target.value as "" | CreditTopup["status"]); setTopupPage(1); }}>
                  <option value="">All statuses</option><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option>
                </select>
              </div>
              {(topupMonth || topupStatus) && <Button type="button" variant="ghost" size="sm" onClick={() => { setTopupMonth(""); setTopupStatus(""); setTopupPage(1); }}>Clear filters</Button>}
            </div>
            {topupsQuery.isPending || topupsQuery.isPlaceholderData ? <p className="credits-empty" role="status">Loading requests…</p> : topupsQuery.isError ? <div className="credits-empty">Could not load requests. <Button variant="link" onClick={() => void topupsQuery.refetch()}>Try again</Button></div> : !topupsQuery.data?.items.length ? <div className="credits-empty"><ReceiptText size={24} /><strong>{topupMonth || topupStatus ? "No matching requests" : "No top-up requests yet"}</strong><p>{topupMonth || topupStatus ? "Try another month or clear your filters." : "Submitted payments will appear here for you to track."}</p></div> : <div className="credits-table-scroll" role="region" aria-label="Top-up request history" tabIndex={0}>
              <table className="credits-table">
                <thead><tr><th scope="col">Submitted</th><th scope="col">Payment reference</th><th scope="col" className="credits-numeric">Credits</th><th scope="col">Status</th></tr></thead>
                <tbody>{topupsQuery.data.items.map((request) => <tr key={request.id}>
                  <td className="credits-date">{dateTime(request.requestedAt)}</td>
                  <td><span className="credits-reference">{request.utrReference}</span>{request.rejectionReason && <p className="credits-rejection">{request.rejectionReason}</p>}</td>
                  <td className="credits-numeric credits-number">{creditValue(request.amountPaise)}</td>
                  <td><span className={`credits-status credits-status-${request.status.toLowerCase()}`}><span aria-hidden="true" />{request.status.toLowerCase()}</span></td>
                </tr>)}</tbody>
              </table>
            </div>}
            {!topupsQuery.isPending && !topupsQuery.isError && !topupsQuery.isPlaceholderData && topupTotal > 0 && <div className="credits-pagination">
              <p>{(topupPage - 1) * TOPUP_PAGE_SIZE + 1}–{Math.min(topupPage * TOPUP_PAGE_SIZE, topupTotal)} of {topupTotal.toLocaleString("en-IN")} requests</p>
              <div><Button variant="outline" size="sm" disabled={topupPage <= 1} onClick={() => setTopupPage((current) => Math.max(1, current - 1))}><ChevronLeft size={14} /> Previous</Button><span>Page {topupPage} of {topupTotalPages}</span><Button variant="outline" size="sm" disabled={topupPage >= topupTotalPages} onClick={() => setTopupPage((current) => Math.min(topupTotalPages, current + 1))}>Next <ChevronRight size={14} /></Button></div>
            </div>}
          </section>

          <section id="credit-activity" className="credits-panel" aria-labelledby="credit-activity-title">
            <div className="credits-panel-heading">
              <div><h2 id="credit-activity-title">Credit activity</h2><p>Every addition and deduction, with your balance after each entry.</p></div>
              {!ledgerQuery.isPending && !ledgerQuery.isError && !ledgerQuery.isPlaceholderData && <span className="credits-caption">{transactionTotal.toLocaleString("en-IN")} {eventFilter || activityMonth || activityDirection ? "matching" : "total"} entries</span>}
            </div>
            <div className="credits-filters">
              <div className="credits-filter"><Label htmlFor="activity-month">Month</Label><Input id="activity-month" type="month" value={activityMonth} onChange={(event) => { setActivityMonth(event.target.value); setPage(1); }} /></div>
              <div className="credits-filter"><Label htmlFor="activity-direction">Activity</Label><select id="activity-direction" value={activityDirection} onChange={(event) => { setActivityDirection(event.target.value); setPage(1); }}><option value="">All activity</option><option value="CREDIT">Credits added</option><option value="DEBIT">Credits deducted</option></select></div>
              <div className="credits-filter credits-event-filter"><Label htmlFor="credit-event-filter">Event</Label><select id="credit-event-filter" value={eventFilter} onChange={(event) => { setEventFilter(event.target.value); setPage(1); }}><option value="">All events and account activity</option>{ledgerQuery.data?.eventOptions.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></div>
              {(eventFilter || activityMonth || activityDirection) && <Button type="button" variant="ghost" size="sm" onClick={() => { setEventFilter(""); setActivityMonth(""); setActivityDirection(""); setPage(1); }}>Clear filters</Button>}
            </div>
            {ledgerQuery.isPending || ledgerQuery.isPlaceholderData ? <p className="credits-empty" role="status">Loading activity…</p> : ledgerQuery.isError ? <div className="credits-empty">Could not load activity. <Button variant="link" onClick={() => void ledgerQuery.refetch()}>Try again</Button></div> : transactions.length === 0 ? <div className="credits-empty"><ReceiptText size={24} /><strong>No credit activity</strong><p>{eventFilter || activityMonth || activityDirection ? "No entries match these filters. Try another selection or clear your filters." : "Credits added or used will appear here."}</p></div> : <div className="credits-table-scroll" role="region" aria-label="Credit activity history" tabIndex={0}>
              <table className="credits-table credits-ledger">
                <thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col" className="credits-numeric">Credits</th><th scope="col" className="credits-numeric">Balance</th></tr></thead>
                <tbody>{transactions.map((transaction) => <tr key={transaction.id}>
                  <td className="credits-date">{dateTime(transaction.createdAt)}</td>
                  <td><p className="credits-description">{transaction.description}</p><p className="credits-caption">{transaction.eventName ?? "Account activity"}</p>{transaction.reason && <p className="credits-caption">{transaction.reason}</p>}</td>
                  <td className={`credits-numeric credits-number ${transaction.amountPaise >= 0 ? "credits-positive" : ""}`}>{transaction.amountPaise >= 0 ? "+" : "−"}{creditValue(Math.abs(transaction.amountPaise))}</td>
                  <td className="credits-numeric">{creditValue(transaction.balanceAfterPaise)}</td>
                </tr>)}</tbody>
              </table>
            </div>}
            {!ledgerQuery.isPending && !ledgerQuery.isError && !ledgerQuery.isPlaceholderData && transactionTotal > 0 && <div className="credits-pagination">
              <p>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, transactionTotal)} of {transactionTotal.toLocaleString("en-IN")} entries</p>
              <div><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={14} /> Previous</Button><span>Page {page} of {totalPages}</span><Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next <ChevronRight size={14} /></Button></div>
            </div>}
          </section>
        </main>
      </div>
    </OrganizerDashboardLayout>
  );
}
