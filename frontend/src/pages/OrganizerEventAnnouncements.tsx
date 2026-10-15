import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowLeft, Bell, CalendarX, Copy, ExternalLink, Mail, Pin, Plus, RotateCcw, Save, Share2, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useOrganizerEventDashboard } from "@/hooks/useEvents";
import { apiRequest } from "@/lib/api";

type Announcement = { id: string; eventId: string; title: string; body: string; status: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED"; scheduledFor: string | null; publishedAt: string | null; updatedAt: string | null; isPinned: boolean };
type AnnouncementDraft = { title: string; body: string; status: Announcement["status"]; scheduled_for?: string; is_pinned?: boolean };

const statusLabel: Record<Announcement["status"], string> = { DRAFT: "Draft", SCHEDULED: "Scheduled", PUBLISHED: "Published", ARCHIVED: "Archived" };
const statusFilters: Array<Announcement["status"] | "ALL"> = ["ALL", "PUBLISHED", "SCHEDULED", "DRAFT", "ARCHIVED"];

function formatDateTime(value: string | null) {
  if (!value) return "Not published";
  return new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

const OrganizerEventAnnouncements = () => {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: dashboard, isLoading: eventLoading } = useOrganizerEventDashboard(eventId);
  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ["organizer-event-announcements", eventId],
    enabled: Boolean(eventId),
    queryFn: () => apiRequest<Announcement[]>(`/organizer/events/${eventId}/announcements`),
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AnnouncementDraft>({ title: "", body: "", status: "DRAFT" });
  const [filter, setFilter] = useState<Announcement["status"] | "ALL">("ALL");
  const [confirmation, setConfirmation] = useState<"archive" | "restore" | "delete" | "cancel-schedule" | null>(null);
  const selected = announcements.find((item) => item.id === selectedId);
  const counts = useMemo(() => announcements.reduce<Record<Announcement["status"], number>>((result, item) => ({ ...result, [item.status]: result[item.status] + 1 }), { DRAFT: 0, SCHEDULED: 0, PUBLISHED: 0, ARCHIVED: 0 }), [announcements]);
  const filteredAnnouncements = filter === "ALL" ? announcements : announcements.filter((item) => item.status === filter);
  const save = useMutation({
    mutationFn: async () => {
      const payload = { ...draft, scheduled_for: draft.status === "SCHEDULED" && draft.scheduled_for ? new Date(draft.scheduled_for).toISOString() : undefined };
      return selectedId ? apiRequest<Announcement>(`/organizer/events/${eventId}/announcements/${selectedId}`, { method: "PATCH", body: JSON.stringify(payload) }) : apiRequest<Announcement>(`/organizer/events/${eventId}/announcements`, { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: (saved) => { queryClient.invalidateQueries({ queryKey: ["organizer-event-announcements", eventId] }); setSelectedId(saved.id); setDraft({ title: saved.title, body: saved.body, status: saved.status, scheduled_for: saved.scheduledFor ?? undefined, is_pinned: saved.isPinned }); toast.success(saved.status === "PUBLISHED" ? "Announcement published" : "Announcement saved"); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save announcement"),
  });
  const email = useMutation({
    mutationFn: (announcementId: string) => apiRequest<{ sent: number; pending: number; failed: number; skipped: number }>(`/organizer/events/${eventId}/announcements/${announcementId}/broadcast-email`, { method: "POST", body: "{}" }),
    onSuccess: (summary) => toast.success(`Email delivery started · ${summary.sent} sent, ${summary.pending} queued`),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not send announcement email"),
  });
  const changeStatus = useMutation({
    mutationFn: ({ announcementId, status }: { announcementId: string; status: Announcement["status"] }) => apiRequest<Announcement>(`/organizer/events/${eventId}/announcements/${announcementId}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["organizer-event-announcements", eventId] });
      setSelectedId(saved.id);
      setDraft({ title: saved.title, body: saved.body, status: saved.status, scheduled_for: saved.scheduledFor ?? undefined, is_pinned: saved.isPinned });
      toast.success(saved.status === "ARCHIVED" ? "Announcement hidden from the public page" : saved.status === "PUBLISHED" ? "Announcement is public again" : "Scheduled announcement moved to drafts");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update announcement"),
  });
  const removeDraft = useMutation({
    mutationFn: (announcementId: string) => apiRequest<void>(`/organizer/events/${eventId}/announcements/${announcementId}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["organizer-event-announcements", eventId] }); startNew(); toast.success("Draft removed"); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not remove draft"),
  });

  const startNew = () => { setSelectedId(null); setDraft({ title: "", body: "", status: "DRAFT" }); };
  const edit = (item: Announcement) => { setSelectedId(item.id); setDraft({ title: item.title, body: item.body, status: item.status, scheduled_for: item.scheduledFor ?? undefined, is_pinned: item.isPinned }); };
  const disabled = eventLoading || isLoading || save.isPending || changeStatus.isPending || removeDraft.isPending;

  const confirmAction = () => {
    if (!selected || !confirmation) return;
    if (confirmation === "delete") removeDraft.mutate(selected.id);
    else if (confirmation === "archive") changeStatus.mutate({ announcementId: selected.id, status: "ARCHIVED" });
    else if (confirmation === "restore") changeStatus.mutate({ announcementId: selected.id, status: "PUBLISHED" });
    else changeStatus.mutate({ announcementId: selected.id, status: "DRAFT" });
    setConfirmation(null);
  };
  const shareSelected = async () => {
    if (!selected) return;
    const url = `${window.location.origin}/event/${eventId}/announcements/${selected.id}`;
    const text = `${selected.title} · ${dashboard?.event.title ?? "Event"}\n${url}`;
    if (navigator.share) {
      await navigator.share({ title: selected.title, text, url }).catch(() => undefined);
      return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  };

  return <OrganizerDashboardLayout eventId={eventId}>
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><Button variant="ghost" className="mb-3 -ml-3 gap-2 px-3 text-muted-foreground" onClick={() => navigate(`/organizer/events/${eventId}`)}><ArrowLeft className="h-4 w-4" /> Back to event</Button><div className="flex items-center gap-2"><Bell className="h-5 w-5 text-primary" /><p className="text-sm font-semibold text-primary">Public updates</p></div><h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Announcements</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Publish clear updates once and give participants one reliable page to check.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" asChild><Link to={`/event/${eventId}/announcements`} target="_blank"><ExternalLink className="mr-2 h-4 w-4" /> Public page</Link></Button><Button onClick={startNew}><Plus className="mr-2 h-4 w-4" /> New announcement</Button></div></div>
      {dashboard?.event.isArchived && <Card className="border-amber-300 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/20"><CardHeader><CardTitle className="text-amber-950 dark:text-amber-100">This event is archived</CardTitle><CardDescription className="text-amber-900/80 dark:text-amber-100/80">You can review announcements, but archived events cannot publish new updates.</CardDescription></CardHeader></Card>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] lg:items-start">
        <Card><CardHeader><CardTitle>Announcement history</CardTitle><CardDescription>Drafts stay private. You can hide published updates without losing the record.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{(["PUBLISHED", "SCHEDULED", "DRAFT", "ARCHIVED"] as Announcement["status"][]).map((status) => <button key={status} type="button" onClick={() => setFilter(status)} className={`rounded-lg border px-3 py-2 text-left transition-colors ${filter === status ? "border-primary bg-primary/[0.06]" : "hover:bg-muted/40"}`}><span className="block text-lg font-bold">{counts[status]}</span><span className="text-xs text-muted-foreground">{statusLabel[status]}</span></button>)}</div><div className="flex gap-2 overflow-x-auto pb-1">{statusFilters.map((status) => <Button key={status} size="sm" variant={filter === status ? "default" : "outline"} onClick={() => setFilter(status)}>{status === "ALL" ? `All (${announcements.length})` : statusLabel[status]}</Button>)}</div>{isLoading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading announcements…</p> : announcements.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center"><Bell className="mx-auto h-7 w-7 text-muted-foreground" /><p className="mt-3 font-semibold">No announcements yet</p><p className="mt-1 text-sm text-muted-foreground">Create the first update when you have news for participants.</p></div> : filteredAnnouncements.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No {statusLabel[filter as Announcement["status"]]?.toLowerCase()} announcements.</p> : filteredAnnouncements.map((item) => <button key={item.id} type="button" onClick={() => edit(item)} className={`w-full rounded-xl border p-4 text-left transition-colors hover:bg-muted/40 ${item.id === selectedId ? "border-primary bg-primary/[0.035]" : ""}`}><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{item.title}</p>{item.isPinned && <Pin className="h-3.5 w-3.5 text-primary" />}</div><p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.body}</p><p className="mt-2 text-xs text-muted-foreground">{item.status === "SCHEDULED" ? `Scheduled for ${formatDateTime(item.scheduledFor)}` : item.status === "PUBLISHED" ? `Published ${formatDateTime(item.publishedAt)}` : `Updated ${formatDateTime(item.updatedAt)}`}</p></div><Badge variant={item.status === "PUBLISHED" ? "default" : "secondary"}>{statusLabel[item.status]}</Badge></div></button>)}</CardContent></Card>
        <Card><CardHeader><CardTitle>{selected ? "Edit announcement" : "Create announcement"}</CardTitle><CardDescription>{selected?.status === "ARCHIVED" ? "This announcement is hidden from the public page. You can restore it when it is relevant again." : "Keep the title specific and put one change or update in each post."}</CardDescription></CardHeader><CardContent className="space-y-4"><div><div className="flex items-center justify-between"><label htmlFor="announcement-title" className="text-sm font-medium">Title</label><span className="text-xs text-muted-foreground">{draft.title.length}/180</span></div><Input id="announcement-title" className="mt-1.5" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Route change for Sunday" maxLength={180} disabled={selected?.status === "ARCHIVED"} /></div><div><div className="flex items-center justify-between"><label htmlFor="announcement-body" className="text-sm font-medium">Message</label><span className="text-xs text-muted-foreground">{draft.body.length.toLocaleString()}/10,000</span></div><Textarea id="announcement-body" className="mt-1.5 min-h-40" value={draft.body} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} placeholder="Tell participants what changed and what they should do next." maxLength={10_000} disabled={selected?.status === "ARCHIVED"} /></div>{selected?.status !== "ARCHIVED" && <><div><label htmlFor="announcement-status" className="text-sm font-medium">Publication</label><select id="announcement-status" className="mt-1.5 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as Announcement["status"] }))} disabled={dashboard?.event.isArchived && draft.status !== "DRAFT"}><option value="DRAFT">Keep as draft</option><option value="PUBLISHED">Publish now</option><option value="SCHEDULED">Schedule for later</option></select></div>{draft.status === "SCHEDULED" && <div><label htmlFor="announcement-schedule" className="text-sm font-medium">Publish at</label><Input id="announcement-schedule" className="mt-1.5" type="datetime-local" value={draft.scheduled_for?.slice(0, 16) ?? ""} onChange={(event) => setDraft((current) => ({ ...current, scheduled_for: event.target.value }))} /><p className="mt-1 text-xs text-muted-foreground">Uses your device time and is stored in UTC.</p></div>}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(draft.is_pinned)} onChange={(event) => setDraft((current) => ({ ...current, is_pinned: event.target.checked }))} disabled={draft.status !== "PUBLISHED"} /> Pin this update on the public page</label><div className="rounded-lg border bg-muted/20 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Public preview</p><p className="mt-2 font-semibold">{draft.title || "Announcement title"}</p><p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{draft.body || "Your message will appear here."}</p></div><Button className="w-full" onClick={() => void save.mutate()} disabled={disabled || !draft.title.trim() || !draft.body.trim() || (draft.status === "SCHEDULED" && !draft.scheduled_for)}><Save className="mr-2 h-4 w-4" /> {save.isPending ? "Saving…" : selected?.status === "PUBLISHED" ? "Save public changes" : draft.status === "PUBLISHED" ? "Publish announcement" : selected ? "Save changes" : "Create announcement"}</Button></>}{selected?.status === "PUBLISHED" && <><div className="grid grid-cols-3 gap-2"><Button variant="outline" onClick={() => void navigator.clipboard?.writeText(`${window.location.origin}/event/${eventId}/announcements/${selected.id}`)}><Copy className="mr-2 h-4 w-4" /> Copy</Button><Button variant="outline" onClick={() => void shareSelected()}><Share2 className="mr-2 h-4 w-4" /> Share</Button><Button variant="outline" onClick={() => void email.mutate(selected.id)} disabled={email.isPending}><Mail className="mr-2 h-4 w-4" /> {email.isPending ? "Sending…" : "Email"}</Button></div><Button className="w-full" variant="outline" onClick={() => setConfirmation("archive")} disabled={disabled}><Archive className="mr-2 h-4 w-4" /> Hide from public page</Button></>}{selected?.status === "SCHEDULED" && <Button className="w-full" variant="outline" onClick={() => setConfirmation("cancel-schedule")} disabled={disabled}><CalendarX className="mr-2 h-4 w-4" /> Move to drafts</Button>}{selected?.status === "DRAFT" && <Button className="w-full" variant="outline" onClick={() => setConfirmation("delete")} disabled={disabled}><Trash2 className="mr-2 h-4 w-4" /> Delete draft</Button>}{selected?.status === "ARCHIVED" && <Button className="w-full" onClick={() => setConfirmation("restore")} disabled={disabled || dashboard?.event.isArchived}><RotateCcw className="mr-2 h-4 w-4" /> Restore to public page</Button>}</CardContent></Card>
      </div>
      <AlertDialog open={confirmation !== null} onOpenChange={(open) => !open && setConfirmation(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation === "archive" ? "Hide this announcement?" : confirmation === "restore" ? "Restore this announcement?" : confirmation === "delete" ? "Delete this draft?" : "Move this scheduled announcement to drafts?"}</AlertDialogTitle>
            <AlertDialogDescription>{confirmation === "archive" ? "It will disappear from the public event page immediately. You can restore it later from Archived." : confirmation === "restore" ? "It will be visible on the public event page again." : confirmation === "delete" ? "This permanently removes the private draft and cannot be undone." : "It will no longer publish at the scheduled time and will remain private."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={confirmAction}>{confirmation === "archive" ? "Hide announcement" : confirmation === "restore" ? "Restore announcement" : confirmation === "delete" ? "Delete draft" : "Move to drafts"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  </OrganizerDashboardLayout>;
};

export default OrganizerEventAnnouncements;
