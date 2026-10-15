import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bell, CalendarDays, Copy, Pin, Share2 } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

import { Layout } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/api";
import { EventPushPrompt } from "@/components/EventPushPrompt";

type PublicAnnouncement = {
  id: string;
  title: string;
  body: string;
  publishedAt: string | null;
  updatedAt: string | null;
  isPinned: boolean;
};

type PublicAnnouncementsResponse = {
  event: { id: string; title: string; date: string; category: string };
  announcements: PublicAnnouncement[];
};

function formatDate(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Clipboard unavailable");
}

function announcementUrl(eventId: string, announcementId: string) {
  return new URL(`/event/${eventId}/announcements/${announcementId}`, window.location.origin).toString();
}

async function shareAnnouncement(eventId: string, eventTitle: string, announcement: PublicAnnouncement) {
  const url = announcementUrl(eventId, announcement.id);
  const text = `${announcement.title} · ${eventTitle}\n\n${url}`;
  if (navigator.share) {
    await navigator.share({ title: announcement.title, text, url });
  } else {
    await copyText(url);
  }
}

const PublicEventAnnouncements = () => {
  const { eventId, announcementId } = useParams();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["public-event-announcements", eventId],
    enabled: Boolean(eventId),
    queryFn: () => apiRequest<PublicAnnouncementsResponse>(`/events/${eventId}/announcements`),
  });

  useEffect(() => {
    if (!announcementId || !data) return;
    const target = document.getElementById(`announcement-${announcementId}`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [announcementId, data]);

  const handleCopy = async (announcement: PublicAnnouncement) => {
    if (!eventId) return;
    try {
      await copyText(announcementUrl(eventId, announcement.id));
      setCopiedId(announcement.id);
      toast.success("Announcement link copied");
      window.setTimeout(() => setCopiedId((current) => current === announcement.id ? null : current), 2200);
    } catch {
      toast.error("Could not copy the link. Please copy the URL from your browser.");
    }
  };

  const handleShare = async (announcement: PublicAnnouncement) => {
    if (!eventId || !data) return;
    try {
      await shareAnnouncement(eventId, data.event.title, announcement);
      if (!navigator.share) toast.success("Announcement link copied");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error("Could not share this announcement");
    }
  };

  return (
    <Layout>
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:py-12">
        <Link to={eventId ? `/event/${eventId}` : "/events"} className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to event
        </Link>
        {isLoading && <div className="py-20 text-center text-sm text-muted-foreground">Loading announcements…</div>}
        {(isError || !data) && !isLoading && <Card><CardContent className="p-10 text-center"><Bell className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-4 font-semibold">Announcements are unavailable</p><p className="mt-1 text-sm text-muted-foreground">This event may not be published yet.</p></CardContent></Card>}
        {data && <>
          <header className="mb-8">
            <Badge variant="outline" className="gap-1.5"><Bell className="h-3.5 w-3.5" /> Event updates</Badge>
            <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">{data.event.title}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">The latest updates published by the event organizer.</p>
          </header>
          {eventId && <EventPushPrompt eventId={eventId} />}
          {data.announcements.length === 0 ? <Card className="border-dashed"><CardContent className="p-12 text-center"><Bell className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-4 font-semibold">No announcements yet</p><p className="mt-1 text-sm text-muted-foreground">The organizer will publish updates here when there is news to share.</p></CardContent></Card> : <div className="space-y-4">
            {data.announcements.map((announcement) => <Card id={`announcement-${announcement.id}`} key={announcement.id} className={`scroll-mt-6 transition-shadow ${announcement.isPinned ? "border-primary/40 shadow-sm" : ""} ${announcement.id === announcementId ? "ring-2 ring-primary/30" : ""}`}>
              <CardHeader className="space-y-3 pb-3"><div className="flex flex-wrap items-start gap-2"><div className="min-w-0 flex-1"><p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">Organizer update</p><CardTitle className="text-2xl leading-tight">{announcement.title}</CardTitle></div>{announcement.isPinned && <Badge className="gap-1"><Pin className="h-3 w-3" /> Pinned</Badge>}</div><p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" /><span>Published {formatDate(announcement.publishedAt)}</span>{announcement.updatedAt && announcement.updatedAt !== announcement.publishedAt && <span>· Updated {formatDate(announcement.updatedAt)}</span>}</p></CardHeader>
              <CardContent><p className="whitespace-pre-line text-base leading-8 text-foreground/80">{announcement.body}</p><div className="mt-6 flex flex-wrap gap-2 border-t pt-4"><button type="button" onClick={() => void handleShare(announcement)} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition-colors hover:bg-muted"><Share2 className="h-4 w-4" /> Share</button><button type="button" onClick={() => void handleCopy(announcement)} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition-colors hover:bg-muted"><Copy className="h-4 w-4" /> {copiedId === announcement.id ? "Copied" : "Copy link"}</button></div></CardContent>
            </Card>)}
          </div>}
        </>}
      </main>
    </Layout>
  );
};

export default PublicEventAnnouncements;
