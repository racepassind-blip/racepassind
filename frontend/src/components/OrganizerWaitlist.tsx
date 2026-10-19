import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Entry = { id: string; position: number; name: string; email: string; status: string; paymentDueAt: string | null; waivePayment: boolean; emailSent: boolean };

export function OrganizerWaitlist({ eventId }: { eventId: string }) {
  const [busy, setBusy] = useState(false);
  const [waive, setWaive] = useState(false);
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
  return <Card><CardHeader><CardTitle>Waiting list</CardTitle><CardDescription>Joining is free. Invite the next person when a place opens. They complete participant details and any required payment through their private email invitation.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {queue.isError && <p role="alert">Unable to load the waiting list. <Button variant="outline" onClick={() => void queue.refetch()}>Retry</Button></p>}
      {queue.isLoading && <p>Loading waiting list…</p>}
      {next && <div className="space-y-3 rounded-lg border p-4"><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} /><span>Waive all payment for the next invitation, including selected extras</span></label><p className="text-xs text-muted-foreground">Otherwise normal prices apply. Unclaimed invitations expire after 30 minutes; the next person is invited at the normal price. UPI payments stay reserved for organizer review once checkout begins.</p><Button disabled={busy} onClick={() => void act(next.id, "promote")}>Invite #{next.position} · {next.name}</Button></div>}
      {queue.data?.items.length === 0 && <p className="text-sm text-muted-foreground">No one is on this event's waiting list yet.</p>}
      <ul className="divide-y">{queue.data?.items.map((entry) => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium">#{entry.position} · {entry.name}</p><p className="text-sm text-muted-foreground">{entry.email} · {entry.status}{entry.waivePayment ? " · payment waived" : ""}</p>{entry.status === "offered" && <p className="text-xs">Claim by {entry.paymentDueAt && new Date(entry.paymentDueAt).toLocaleString()} · {entry.emailSent ? "Email sent" : "Email queued; awaiting delivery"}</p>}</div>{["waiting", "offered"].includes(entry.status) && <Button variant="outline" disabled={busy} onClick={() => void act(entry.id, "cancel")}>Remove</Button>}</li>)}</ul>
    </CardContent></Card>;
}
