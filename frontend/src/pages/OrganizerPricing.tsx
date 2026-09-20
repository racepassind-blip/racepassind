import { Fragment, useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Receipt, ShieldCheck, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { OrganizerWorkspaceTabs } from "@/components/OrganizerWorkspaceTabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/api";

function formatINR(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// SportPass platform fee (5% + ₹10 per paid registration)
// ---------------------------------------------------------------------------

type PlatformFeeStatus = "accruing" | "payment_due" | "paid" | "overdue" | "waived";

interface FeeBreakdown {
  percentageBasisPoints: number;
  percentagePercent: number;
  registrationRevenuePaise: number;
  percentageComponentPaise: number;
  perRegistrationPaise: number;
  paidRegistrationCount: number;
  flatComponentPaise: number;
  grossFeePaise: number;
  discountPaise: number;
  finalAmountPaise: number;
}

interface CategoryBreakdown {
  categoryId: string | null;
  categoryName: string;
  paidRegistrations: number;
  freeRegistrations: number;
  revenuePaise: number;
  unitPricePaise: number;
}

interface PlatformFeeRecord {
  id: string | null;
  eventId: string;
  eventName: string;
  eventStatus: string;
  organizationId: string;
  organizationName: string;
  invoiceNumber: string | null;
  paidRegistrationCount: number;
  registrationRevenuePaise: number;
  percentageBasisPoints: number;
  perRegistrationPaise: number;
  grossFeePaise: number;
  discountPaise: number;
  finalAmountPaise: number;
  currency: string;
  billingStatus: PlatformFeeStatus;
  dueAt: string | null;
  finalizedAt: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  notes: string | null;
  feeBreakdown: FeeBreakdown;
  categoryBreakdown: CategoryBreakdown[];
}

interface PlatformFeeConfig {
  label: string;
  percentageBasisPoints: number;
  percentagePercent: number;
  perRegistrationPaise: number;
  currency: string;
  defaultDueDays: number;
  updatedAt: string | null;
}

interface PlatformFeeSummary {
  accruedFeePaise: number;
  outstandingPaise: number;
  currency: string;
}

interface PlatformFeeResponse {
  config: PlatformFeeConfig;
  records: PlatformFeeRecord[];
  summary: PlatformFeeSummary;
}

function feeStatusLabel(status: PlatformFeeStatus) {
  return status === "payment_due" ? "Payment Due" : status === "accruing" ? "Accruing" : status.charAt(0).toUpperCase() + status.slice(1);
}

function feeStatusVariant(status: PlatformFeeStatus) {
  if (status === "paid" || status === "waived") return "default" as const;
  if (status === "overdue") return "destructive" as const;
  return "secondary" as const;
}

// Build a fee breakdown from a record's own fields when the API hasn't
// supplied one (e.g. an older backend response), so the UI never crashes.
function breakdownFor(record: PlatformFeeRecord): FeeBreakdown {
  if (record.feeBreakdown) return record.feeBreakdown;
  const percentageComponentPaise = Math.round(record.registrationRevenuePaise * record.percentageBasisPoints / 10000);
  const flatComponentPaise = record.perRegistrationPaise * record.paidRegistrationCount;
  return {
    percentageBasisPoints: record.percentageBasisPoints,
    percentagePercent: record.percentageBasisPoints / 100,
    registrationRevenuePaise: record.registrationRevenuePaise,
    percentageComponentPaise,
    perRegistrationPaise: record.perRegistrationPaise,
    paidRegistrationCount: record.paidRegistrationCount,
    flatComponentPaise,
    grossFeePaise: record.grossFeePaise,
    discountPaise: record.discountPaise,
    finalAmountPaise: record.finalAmountPaise,
  };
}

// A friendly, spelled-out version of the fee maths for a single event.
const FeeCalculation = ({ breakdown }: { breakdown: FeeBreakdown }) => (
  <div className="rounded-lg border bg-muted/20 p-4">
    <p className="mb-3 text-sm font-semibold">How this fee is calculated</p>
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">{breakdown.percentagePercent}% of registration revenue ({formatINR(breakdown.registrationRevenuePaise)})</span>
        <span className="font-medium">{formatINR(breakdown.percentageComponentPaise)}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">{formatINR(breakdown.perRegistrationPaise)} × {breakdown.paidRegistrationCount} paid registration{breakdown.paidRegistrationCount === 1 ? "" : "s"}</span>
        <span className="font-medium">{formatINR(breakdown.flatComponentPaise)}</span>
      </div>
      <div className="flex items-center justify-between gap-4 border-t pt-2">
        <span className="font-medium">Gross SportPass fee</span>
        <span className="font-semibold">{formatINR(breakdown.grossFeePaise)}</span>
      </div>
      {breakdown.discountPaise > 0 && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Discount</span>
          <span className="font-medium text-accent-foreground">-{formatINR(breakdown.discountPaise)}</span>
        </div>
      )}
      <div className="flex items-center justify-between gap-4 border-t pt-2">
        <span className="font-bold">Amount payable</span>
        <span className="text-base font-black">{formatINR(breakdown.finalAmountPaise)}</span>
      </div>
    </div>
  </div>
);

// Per-category paid / free split for a single event.
const CategoryDetail = ({ categories }: { categories: CategoryBreakdown[] }) => {
  if (!categories || categories.length === 0) {
    return <p className="text-sm text-muted-foreground">No registrations yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-2">Category</th>
            <th className="px-4 py-2">Type</th>
            <th className="px-4 py-2">Paid regs</th>
            <th className="px-4 py-2">Free regs</th>
            <th className="px-4 py-2">Price / reg</th>
            <th className="px-4 py-2">Revenue</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {categories.map((category) => {
            const isPaid = category.paidRegistrations > 0 || category.unitPricePaise > 0;
            return (
              <tr key={category.categoryId ?? category.categoryName}>
                <td className="px-4 py-2 font-medium">{category.categoryName}</td>
                <td className="px-4 py-2"><Badge variant={isPaid ? "secondary" : "outline"}>{isPaid ? "Paid" : "Free"}</Badge></td>
                <td className="px-4 py-2 text-muted-foreground">{category.paidRegistrations.toLocaleString("en-IN")}</td>
                <td className="px-4 py-2 text-muted-foreground">{category.freeRegistrations.toLocaleString("en-IN")}</td>
                <td className="px-4 py-2 text-muted-foreground">{category.unitPricePaise > 0 ? formatINR(category.unitPricePaise) : "—"}</td>
                <td className="px-4 py-2 font-medium">{formatINR(category.revenuePaise)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const OrganizerPricing = () => {
  const navigate = useNavigate();
  const [config, setConfig] = useState<PlatformFeeConfig | null>(null);
  const [records, setRecords] = useState<PlatformFeeRecord[]>([]);
  const [summary, setSummary] = useState<PlatformFeeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiRequest<PlatformFeeResponse>("/organizer/platform-fees");
      setConfig(data.config);
      setRecords(data.records);
      setSummary(data.summary);
    } catch (error) {
      console.error("Could not load platform fees:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const toggle = (eventId: string) => setExpanded((current) => ({ ...current, [eventId]: !current[eventId] }));

  // Worked example straight from the introductory pricing: a ₹600 registration.
  const examplePct = config ? Math.round(60000 * config.percentageBasisPoints / 10000) : 3000;
  const exampleFlat = config ? config.perRegistrationPaise : 1000;

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
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary"><ShieldCheck className="h-4 w-4" /> Pricing &amp; billing</div>
              <h1 className="text-3xl font-black tracking-tight sm:text-4xl">SportPass pricing</h1>
              <p className="mt-2 max-w-2xl text-muted-foreground">Your current pricing and SportPass platform-fee billing for paid events. Free events never accrue a fee.</p>
            </div>
          </div>
        </div>

        {/* Current pricing */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> Current pricing</CardTitle>
              <Badge>{config?.label ?? "Introductory Pricing"}</Badge>
            </div>
            <CardDescription>
              {config ? `${config.percentagePercent}% of the registration fee + ${formatINR(config.perRegistrationPaise)} per paid registration.` : "5% of the registration fee + ₹10 per paid registration."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border bg-muted/30 p-5">
              <p className="text-sm font-semibold text-muted-foreground">Example</p>
              <div className="mt-2 space-y-1 text-sm">
                <p>{formatINR(60000)} registration</p>
                <p>{config ? config.percentagePercent : 5}% = {formatINR(examplePct)}</p>
                <p>+ {formatINR(exampleFlat)}</p>
                <p className="text-base font-bold text-foreground">SportPass Fee = {formatINR(examplePct + exampleFlat)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Billing summary */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Card><CardContent className="flex items-center gap-3 p-5"><Receipt className="h-5 w-5 text-muted-foreground" /><div><p className="text-2xl font-black">{formatINR(summary?.accruedFeePaise ?? 0)}</p><p className="text-sm text-muted-foreground">Accrued SportPass fee (not yet billed)</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-5"><ShieldCheck className="h-5 w-5 text-primary" /><div><p className="text-2xl font-black">{formatINR(summary?.outstandingPaise ?? 0)}</p><p className="text-sm text-muted-foreground">Outstanding amount</p></div></CardContent></Card>
        </div>

        {/* Event-wise bills */}
        <Card>
          <CardHeader>
            <CardTitle>Organizer billing</CardTitle>
            <CardDescription>Event-wise SportPass platform fees for your paid events. Select an event to see the calculation and the per-category paid / free split.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px] text-left text-sm">
                <thead className="border-y bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3">Event</th>
                    <th className="px-5 py-3">Invoice</th>
                    <th className="px-5 py-3">Paid regs</th>
                    <th className="px-5 py-3">Revenue</th>
                    <th className="px-5 py-3">SportPass fee</th>
                    <th className="px-5 py-3">Discount</th>
                    <th className="px-5 py-3">Payable</th>
                    <th className="px-5 py-3">Due</th>
                    <th className="px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loading ? (
                    <tr><td colSpan={9} className="px-5 py-12 text-center text-muted-foreground">Loading billing…</td></tr>
                  ) : records.length === 0 ? (
                    <tr><td colSpan={9} className="px-5 py-12 text-center text-muted-foreground">No paid events yet. Free events do not accrue a SportPass fee.</td></tr>
                  ) : (
                    records.map((record) => {
                      const isOpen = !!expanded[record.eventId];
                      return (
                        <Fragment key={record.eventId}>
                          <tr className="cursor-pointer hover:bg-muted/30" onClick={() => toggle(record.eventId)}>
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-2">
                                {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                                <div>
                                  <p className="font-semibold">{record.eventName}</p>
                                  <p className="text-xs text-muted-foreground">{record.eventStatus}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-5 py-4 text-muted-foreground">{record.invoiceNumber ?? "—"}</td>
                            <td className="px-5 py-4 text-muted-foreground">{record.paidRegistrationCount.toLocaleString("en-IN")}</td>
                            <td className="px-5 py-4 text-muted-foreground">{formatINR(record.registrationRevenuePaise)}</td>
                            <td className="px-5 py-4">{formatINR(record.grossFeePaise)}</td>
                            <td className="px-5 py-4 text-muted-foreground">{record.discountPaise > 0 ? `-${formatINR(record.discountPaise)}` : "—"}</td>
                            <td className="px-5 py-4"><p className="font-bold">{formatINR(record.finalAmountPaise)}</p></td>
                            <td className="px-5 py-4 text-muted-foreground">{formatDate(record.dueAt)}</td>
                            <td className="px-5 py-4">
                              <Badge variant={feeStatusVariant(record.billingStatus)}>{feeStatusLabel(record.billingStatus)}</Badge>
                              {record.paymentReference && <p className="mt-1 text-xs text-muted-foreground">Ref: {record.paymentReference}</p>}
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="bg-muted/10">
                              <td colSpan={9} className="px-5 py-5">
                                <div className="grid gap-5 lg:grid-cols-2">
                                  <FeeCalculation breakdown={breakdownFor(record)} />
                                  <div>
                                    <p className="mb-3 text-sm font-semibold">Registrations by category</p>
                                    <CategoryDetail categories={record.categoryBreakdown ?? []} />
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })
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
