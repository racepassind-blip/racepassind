import { Clock3, MapPin, QrCode, Ticket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ParticipantRegistration } from "@/hooks/useParticipantRegistrations";
import { formatRegistrationAmount, formatRegistrationDate, registrationStatusDetails } from "@/lib/registration-format";

export function RegistrationStatusBadge({ status }: { status: string }) {
  const details = registrationStatusDetails[status] ?? { label: status, variant: "outline" as const, icon: Clock3 };
  const StatusIcon = details.icon;
  return (
    <Badge variant={details.variant} className="gap-1.5">
      <StatusIcon className="h-3.5 w-3.5" />
      {details.label}
    </Badge>
  );
}

export function ParticipantRegistrationCard({ registration }: { registration: ParticipantRegistration }) {
  const checkedInLabel = registration.checkInStatus === "checked_in"
    ? `Checked in${registration.checkedInAt ? ` · ${new Date(registration.checkedInAt).toLocaleString("en-IN")}` : ""}`
    : "Not checked in";

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-xl">{registration.event.name}</CardTitle>
            <CardDescription className="mt-1 flex items-center gap-1.5">
              {formatRegistrationDate(registration.event.date)}
              <span aria-hidden="true">·</span>
              <MapPin className="h-3.5 w-3.5" />
              {registration.event.location}
            </CardDescription>
          </div>
          <RegistrationStatusBadge status={registration.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Registration reference</p>
            <p className="mt-1 font-mono font-semibold">{registration.registrationReference}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Ticket</p>
            <p className="mt-1 flex items-center gap-1.5 font-medium"><Ticket className="h-3.5 w-3.5 text-muted-foreground" />{registration.ticketType.name}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Payment</p>
            <p className="mt-1 font-medium capitalize">{registration.paymentStatus.replaceAll("_", " ")}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Amount</p>
            <p className="mt-1 font-semibold text-primary">{formatRegistrationAmount(registration.amountPaise, registration.currency)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Check-in</p>
            <p className="mt-1 font-medium">{checkedInLabel}</p>
          </div>
        </div>

        {registration.ticket && (
          <div className="border-t border-dashed pt-5 text-center">
            <p className="mb-3 flex items-center justify-center gap-2 text-sm font-semibold"><QrCode className="h-4 w-4 text-accent" />Event ticket QR</p>
            <img src={registration.ticket.qrDataUrl} alt={`Ticket QR for ${registration.event.name}`} className="mx-auto h-52 w-52 rounded-lg bg-white p-2" />
            <p className="mt-3 text-xs text-muted-foreground">This QR contains only an opaque ticket credential. Keep it private and show it at check-in.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
