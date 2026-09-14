import { Check, Copy, ExternalLink, MessageCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buildRegistrationUrl, buildWhatsAppMessage, type CommunicationEvent } from "@/lib/eventCommunication";

export function EventShareDialog({ event, open, onOpenChange }: { event: CommunicationEvent | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [copied, setCopied] = useState<"link" | "message" | null>(null);
  if (!event) return null;

  const registrationUrl = buildRegistrationUrl(event.id);
  const message = buildWhatsAppMessage(event, registrationUrl);
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Share {event.name}</DialogTitle>
          <DialogDescription>Your event is published. Share this participant link and ready-made WhatsApp message to start receiving registrations.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="share-registration-link" className="text-sm font-medium">Participant registration link</label>
            <div className="flex gap-2">
              <Input id="share-registration-link" value={registrationUrl} readOnly onFocus={(input) => input.currentTarget.select()} />
              <Button type="button" variant="outline" className="shrink-0 gap-2" onClick={() => void copy(registrationUrl, "link")}><Copy className="h-4 w-4" />{copied === "link" ? <Check className="h-4 w-4" /> : "Copy"}</Button>
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor="share-whatsapp-message" className="text-sm font-medium">Copy-ready WhatsApp message</label>
            <Textarea id="share-whatsapp-message" value={message} readOnly className="min-h-48 resize-y text-sm leading-6" onFocus={(input) => input.currentTarget.select()} />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button asChild variant="outline" className="gap-2"><a href={registrationUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Preview page</a></Button>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" className="gap-2" onClick={() => void copy(message, "message")}><Copy className="h-4 w-4" />{copied === "message" ? "Copied" : "Copy message"}</Button>
            <Button asChild className="gap-2"><a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" /> Open WhatsApp</a></Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
