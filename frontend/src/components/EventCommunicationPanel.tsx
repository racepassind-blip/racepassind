import { Check, Copy, ExternalLink, MessageCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buildRegistrationUrl, buildWhatsAppMessage, formatCommunicationDate, formatCommunicationLocation, type CommunicationEvent } from "@/lib/eventCommunication";

export function EventCommunicationPanel({ event }: { event: CommunicationEvent }) {
  const [copied, setCopied] = useState<"link" | "message" | null>(null);
  const registrationUrl = buildRegistrationUrl(event.id);
  const message = buildWhatsAppMessage(event, registrationUrl);
  const isClosed = event.registrationStatus === "closed";

  const copy = async (value: string, kind: "link" | "message") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      toast.success(kind === "link" ? "Registration link copied." : "WhatsApp message copied.");
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      toast.error("Could not copy automatically. Select the text and copy it manually.");
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
      <Card>
        <CardHeader>
          <CardTitle>Participant registration link</CardTitle>
          <CardDescription>Share this event-specific link with participants. It opens the public page for {event.name}.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-lg border bg-muted/40 p-4 text-sm">
            <p className="font-semibold">{event.name}</p>
            <p className="mt-1 text-muted-foreground">{formatCommunicationDate(event.eventDate)} · {formatCommunicationLocation(event)}</p>
            <p className={`mt-3 font-medium ${isClosed ? "text-amber-700" : "text-emerald-700"}`}>{isClosed ? "Registration is currently closed" : "Registration is open"}</p>
          </div>
          <div className="space-y-2">
            <label htmlFor="registration-link" className="text-sm font-medium">Registration URL</label>
            <div className="flex gap-2">
              <Input id="registration-link" value={registrationUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
              <Button type="button" variant="outline" className="shrink-0 gap-2" onClick={() => void copy(registrationUrl, "link")}><Copy className="h-4 w-4" />{copied === "link" ? <Check className="h-4 w-4" /> : "Copy"}</Button>
            </div>
          </div>
          <Button asChild variant="outline" className="w-full gap-2"><a href={registrationUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Preview participant page</a></Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>WhatsApp message</CardTitle>
          <CardDescription>Copy and paste this ready-made message into WhatsApp, email, or your community group.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea value={message} readOnly className="min-h-64 resize-y font-sans text-sm leading-6" onFocus={(event) => event.currentTarget.select()} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" className="flex-1 gap-2" onClick={() => void copy(message, "message")}><Copy className="h-4 w-4" />{copied === "message" ? "Copied" : "Copy message"}</Button>
            <Button asChild variant="outline" className="flex-1 gap-2"><a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" /> Open WhatsApp</a></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
