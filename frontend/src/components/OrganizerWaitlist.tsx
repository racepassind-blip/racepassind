import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock3, MailCheck, Users } from "lucide-react";

type Entry = { id: string; position: number; name: string; email: string; status: string; paymentDueAt: string | null; waivePayment: boolean; emailSent: boolean };

export function OrganizerWaitlist({ eventId }: { eventId: string }) {
  const [busy, setBusy] = useState(false);
  const [waive, setWaive] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const queue = useQuery({ queryKey: ["organizer-waitlist", eventId], queryFn: () => apiRequest<{ items: Entry[] }>(`/organizer/events/${eventId}/waitlist`), refetchInterval: 30000 });
  const next = queue.data?.items.find((entry) => entry.status === "waiting");
  const act = async (id: string, action: "promote" | "cancel") => {
    if (action === "cancel" && !window.confirm("Remove this person from the waiting list and release any invitation hold?")) return;
    setBusy(true);
    try {
      await apiRequest(`/organizer/waitlist/${id}/${action}`, { method: "POST", body: JSON.stringify({ waive_payment: waive }) });
      toast.success(action === "promote" ? "Place reserved. Invitation email queued." : "Waiting list entry removed.");
      await queue.refetch();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update waiting list"); }
    finally { setBusy(false); }
  };
  const items = queue.data?.items ?? [];
  const offered = items.filter((entry) => entry.status === "offered").length;
  const waiting = items.filter((entry) => entry.status === "waiting").length;
  const filteredItems = useMemo(() => items.filter((entry) => {
    const matchesStatus = statusFilter === "all" || entry.status === statusFilter;
    const query = search.trim().toLowerCase();
    return matchesStatus && (!query || entry.name.toLowerCase().includes(query) || entry.email.toLowerCase().includes(query) || String(entry.position) === query);
  }), [items, search, statusFilter]);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const visibleItems = filteredItems.slice((page - 1) * pageSize, page * pageSize);
  return <Card className="overflow-hidden"><CardHeader className="border-b bg-muted/20"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle className="flex items-center gap-2"><Users className="h-5 w-5 text-primary" /> Waiting list</CardTitle><CardDescription className="mt-2 max-w-2xl">Manage the queue in order. Invite the next person when a place opens; they receive a private checkout link and complete their own details and payment.</CardDescription></div><div className="grid grid-cols-2 gap-2 text-center text-xs sm:min-w-44"><div className="rounded-lg border bg-card px-3 py-2"><p className="text-lg font-bold text-foreground">{waiting}</p><p className="text-muted-foreground">Waiting</p></div><div className="rounded-lg border bg-card px-3 py-2"><p className="text-lg font-bold text-foreground">{offered}</p><p className="text-muted-foreground">Invited</p></div></div></div></CardHeader>
    <CardContent className="space-y-4">
      {queue.isError && <p role="alert">Unable to load the waiting list. <Button variant="outline" onClick={() => void queue.refetch()}>Retry</Button></p>}
      {queue.isLoading && <p>Loading waiting list…</p>}
      {next && <div className="space-y-4 rounded-xl border-2 border-primary/20 bg-primary/[0.03] p-4 sm:p-5"><div><p className="text-xs font-bold uppercase tracking-wider text-primary">Next in line · #{next.position}</p><p className="mt-1 text-lg font-bold">{next.name}</p><p className="text-sm text-muted-foreground">{next.email}</p></div><label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-3 text-sm"><input aria-label="Waive payment for next invitation" type="checkbox" className="mt-0.5 h-4 w-4" checked={waive} onChange={(e) => setWaive(e.target.checked)} /><span><span className="font-semibold">Waive payment for this invitation</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Includes the ticket and selected extras. Leave unchecked to charge the normal price.</span></span></label><p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> The invitation is held for 30 minutes. If it expires, the next person is invited at the normal price.</p><Button className="w-full sm:w-auto" disabled={busy} onClick={() => void act(next.id, "promote")}>Invite #{next.position} · {next.name}</Button></div>}
      {queue.data?.items.length === 0 && <p className="text-sm text-muted-foreground">No one is on this event's waiting list yet.</p>}
      <div className="grid gap-2 sm:grid-cols-[1fr_180px]"><Input aria-label="Search waiting list" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search name, email, or queue number" /><select aria-label="Filter waiting list status" className="h-10 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}><option value="all">All statuses</option><option value="waiting">Waiting</option><option value="offered">Invited</option><option value="expired">Expired</option><option value="cancelled">Removed</option></select></div>
      <ul className="divide-y rounded-xl border">{visibleItems.map((entry) => <li key={entry.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-bold">#{entry.position}</span><span className="font-semibold">{entry.name}</span><span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium capitalize">{entry.status}</span></div><p className="mt-1 break-all text-sm text-muted-foreground">{entry.email}</p>{entry.status === "offered" && <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>Claim by {entry.paymentDueAt && new Date(entry.paymentDueAt).toLocaleString()}</span><span className={entry.emailSent ? "flex items-center gap-1 text-emerald-700" : "flex items-center gap-1 text-amber-700"}>{entry.emailSent ? <MailCheck className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}{entry.emailSent ? "Invitation sent" : "Email pending"}</span>{entry.waivePayment && <span>Payment waived</span>}</div>}</div>{["waiting", "offered"].includes(entry.status) && <Button variant="outline" className="min-h-10 w-full sm:w-auto" disabled={busy} onClick={() => void act(entry.id, "cancel")}>Remove</Button>}</li>)}</ul>
      {filteredItems.length === 0 && <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">No waiting-list entries match your search.</p>}
      {pageCount > 1 && <div className="flex items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filteredItems.length)} of {filteredItems.length}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page === pageCount} onClick={() => setPage((current) => current + 1)}>Next</Button></div></div>}
    </CardContent></Card>;
}
