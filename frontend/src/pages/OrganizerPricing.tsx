import { useEffect, useState } from "react";
import { ArrowLeft, ShieldCheck, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { OrganizerWorkspaceTabs } from "@/components/OrganizerWorkspaceTabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/api";

type BillingUnit = "per_event" | "per_registration";

interface BillingRecord {
  id: string | null;
  eventId: string;
  eventName: string;
  eventStatus: string;
  organizationId: string;
  organizationName: string;
  planName: string | null;
  billingUnit: BillingUnit | null;
  confirmedRegistrations: number;
  applicablePricePaise: number;
  discountPaise: number;
  finalAmountPaise: number;
  billingStatus: "waived" | "not_billed" | "payment_due" | "overdue" | "paid_manual";
  dueAt: string | null;
  finalizedAt: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  notes: string | null;
}

function formatINR(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function statusLabel(status: BillingRecord["billingStatus"]) {
  return status === "paid_manual" ? "Paid manually" : status === "payment_due" ? "Payment due" : status === "not_billed" ? "Not billed" : status === "waived" ? "Waived" : "Overdue";
}

function statusVariant(status: BillingRecord["billingStatus"]) {
  if (status === "paid_manual" || status === "waived") return "default" as const;
  if (status === "overdue") return "destructive" as const;
  return "secondary" as const;
}

function billingUnitLabel(unit: BillingUnit | null) {
  return unit === "per_registration" ? "Per registration" : "Per event";
}

const OrganizerPricing = () => {
  const navigate = useNavigate();
  const [billingRecords, setBillingRecords] = useState<BillingRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const records = await apiRequest<BillingRecord[]>("/admin/billing");
      // Filter to show only the current organization's records
      setBillingRecords(records);
    } catch (error) {
      console.error("Could not load billing records:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <OrganizerDashboardLayout showNavigation={false}>
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
        <OrganizerWorkspaceTabs />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/organizer")} aria-label="Back to organizer dashboard">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary"><ShieldCheck className="h-4 w-4" /> Your billing</div>
              <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Event billing</h1>
              <p className="mt-2 max-w-2xl text-muted-foreground">View all finalized billing records for your events. Payment status and dates are tracked here.</p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Billing records</CardTitle>
            <CardDescription>All your finalized event billing with payment status and dates.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead className="border-y bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3">Event</th>
                    <th className="px-5 py-3">Confirmed</th>
                    <th className="px-5 py-3">Plan</th>
                    <th className="px-5 py-3">Amount</th>
                    <th className="px-5 py-3">Due</th>
                    <th className="px-5 py-3">Paid</th>
                    <th className="px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-12 text-center text-muted-foreground">Loading billing records…</td>
                    </tr>
                  ) : billingRecords.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-12 text-center text-muted-foreground">No billing records found.</td>
                    </tr>
                  ) : (
                    billingRecords.map((record) => (
                      <tr key={record.id || record.eventId}>
                        <td className="px-5 py-4">
                          <p className="font-semibold">{record.eventName}</p>
                          <p className="text-xs text-muted-foreground">{record.eventStatus}</p>
                        </td>
                        <td className="px-5 py-4 text-muted-foreground">{record.confirmedRegistrations.toLocaleString("en-IN")}</td>
                        <td className="px-5 py-4">
                          <p>{record.planName ?? "—"}</p>
                          <p className="text-xs text-muted-foreground">{billingUnitLabel(record.billingUnit)}</p>
                        </td>
                        <td className="px-5 py-4">
                          <p className="font-bold">{formatINR(record.finalAmountPaise)}</p>
                          {record.discountPaise > 0 && <p className="text-xs text-accent-foreground">-{formatINR(record.discountPaise)} discount</p>}
                        </td>
                        <td className="px-5 py-4 text-muted-foreground">{formatDate(record.dueAt)}</td>
                        <td className="px-5 py-4 text-muted-foreground">{formatDate(record.paidAt)}</td>
                        <td className="px-5 py-4">
                          <Badge variant={statusVariant(record.billingStatus)}>{statusLabel(record.billingStatus)}</Badge>
                          {record.paymentReference && <p className="mt-1 text-xs text-muted-foreground">Ref: {record.paymentReference}</p>}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </OrganizerDashboardLayout>
  );
};

export default OrganizerPricing;
