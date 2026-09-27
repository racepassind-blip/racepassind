import { FormEvent, useEffect, useState } from "react";
import { BadgeCheck, Clock, FileCheck2, ShieldCheck, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/api";

type PaidVerificationStatus = "NOT_SUBMITTED" | "UNDER_REVIEW" | "VERIFIED" | "REJECTED";

type PaidVerification = {
  organizationId: string;
  paidVerificationStatus: PaidVerificationStatus;
  panNumber: string | null;
  nameAsPerPan: string | null;
  gstRegistered: boolean;
  gstNumber: string | null;
  billingName: string | null;
  billingAddress: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingPincode: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
};

interface PaidVerificationProps {
  organizationId: string;
}

const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PIN_PATTERN = /^[0-9]{6}$/;

const STATUS_META: Record<PaidVerificationStatus, { label: string; icon: typeof ShieldCheck; className: string }> = {
  NOT_SUBMITTED: { label: "Not Submitted", icon: ShieldCheck, className: "border-muted-foreground/30 text-muted-foreground" },
  UNDER_REVIEW: { label: "Under Review", icon: Clock, className: "border-amber-300 text-amber-700" },
  VERIFIED: { label: "Verified", icon: BadgeCheck, className: "border-emerald-300 text-emerald-700" },
  REJECTED: { label: "Rejected", icon: XCircle, className: "border-destructive/40 text-destructive" },
};

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

const emptyForm = {
  panNumber: "",
  nameAsPerPan: "",
  gstRegistered: "no" as "yes" | "no",
  gstNumber: "",
  billingName: "",
  billingAddress: "",
  billingCity: "",
  billingState: "",
  billingPincode: "",
  acceptTerms: false,
};

const PaidVerification = ({ organizationId }: PaidVerificationProps) => {
  const [verification, setVerification] = useState<PaidVerification | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const update = <K extends keyof typeof form>(field: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const load = async () => {
    try {
      const data = await apiRequest<PaidVerification>(`/organizer/organizations/${organizationId}/paid-verification`);
      setVerification(data);
      setForm({
        panNumber: data.panNumber ?? "",
        nameAsPerPan: data.nameAsPerPan ?? "",
        gstRegistered: data.gstRegistered ? "yes" : "no",
        gstNumber: data.gstNumber ?? "",
        billingName: data.billingName ?? "",
        billingAddress: data.billingAddress ?? "",
        billingCity: data.billingCity ?? "",
        billingState: data.billingState ?? "",
        billingPincode: data.billingPincode ?? "",
        acceptTerms: false,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load verification status.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const gstYes = form.gstRegistered === "yes";
  const pan = form.panNumber.trim().toUpperCase();

  // Button enables once every required field is filled and terms are accepted.
  // Format checks (PAN/GSTIN/PIN shape) are enforced on submit with a clear message,
  // so the button never sits disabled without the user knowing why.
  const allFilled =
    form.panNumber.trim().length > 0 &&
    form.nameAsPerPan.trim().length > 0 &&
    (!gstYes || form.gstNumber.trim().length > 0) &&
    form.billingName.trim().length > 0 &&
    form.billingAddress.trim().length > 0 &&
    form.billingCity.trim().length > 0 &&
    form.billingState.trim().length > 0 &&
    form.billingPincode.trim().length > 0 &&
    form.acceptTerms;

  const getValidationError = (): string | null => {
    if (!PAN_PATTERN.test(pan)) return "Enter a valid 10-character PAN (e.g. ABCDE1234F).";
    if (form.nameAsPerPan.trim().length < 2) return "Enter the name as printed on the PAN.";
    if (gstYes && form.gstNumber.trim().length !== 15) return "Enter a valid 15-character GSTIN.";
    if (form.billingName.trim().length < 2) return "Enter the billing / legal name.";
    if (form.billingAddress.trim().length < 5) return "Enter the billing address.";
    if (form.billingCity.trim().length < 2) return "Enter the billing city.";
    if (form.billingState.trim().length < 2) return "Enter the billing state.";
    if (!PIN_PATTERN.test(form.billingPincode.trim())) return "Enter a valid 6-digit PIN code.";
    return null;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationError = getValidationError();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/organizer/organizations/${organizationId}/paid-verification`, {
        method: "POST",
        body: JSON.stringify({
          pan_number: pan,
          name_as_per_pan: form.nameAsPerPan.trim(),
          gst_registered: gstYes,
          gst_number: gstYes ? form.gstNumber.trim().toUpperCase() : null,
          billing_name: form.billingName.trim(),
          billing_address: form.billingAddress.trim(),
          billing_city: form.billingCity.trim(),
          billing_state: form.billingState.trim(),
          billing_pincode: form.billingPincode.trim(),
          accept_terms: form.acceptTerms,
          terms_accepted_at: new Date().toISOString(),
        }),
      });
      toast.success("Verification submitted. We'll review it shortly.");
      setLoading(true);
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not submit verification.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading verification status…</CardContent></Card>;
  }

  const status = verification?.paidVerificationStatus ?? "NOT_SUBMITTED";
  const meta = STATUS_META[status];
  const StatusIcon = meta.icon;
  const isEditable = status === "NOT_SUBMITTED" || status === "REJECTED";

  return (
    <Card id="paid-verification">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><FileCheck2 className="h-5 w-5 text-primary" /> Paid event verification</CardTitle>
            <CardDescription>Verify your organization once to publish paid events. You can run free events without completing this step.</CardDescription>
          </div>
          <Badge variant="outline" className={`w-fit gap-1.5 ${meta.className}`}><StatusIcon className="h-3.5 w-3.5" /> {meta.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {status === "VERIFIED" && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-100">
            <p className="font-semibold">Your organization is verified for paid events.</p>
            <p className="mt-1">You can now publish events that charge a registration fee.{verification?.reviewedAt ? ` Verified on ${formatDate(verification.reviewedAt)}.` : ""}</p>
          </div>
        )}

        {status === "UNDER_REVIEW" && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">
            <p className="font-semibold">Your verification is under review.</p>
            <p className="mt-1">We'll notify you once it's approved.{verification?.submittedAt ? ` Submitted on ${formatDate(verification.submittedAt)}.` : ""}</p>
          </div>
        )}

        {status === "REJECTED" && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <p className="font-semibold">Your verification was rejected.</p>
            {verification?.rejectionReason && <p className="mt-1">Reason: {verification.rejectionReason}</p>}
            <p className="mt-1">Update the details below and resubmit.</p>
          </div>
        )}

        {isEditable ? (
          <form onSubmit={submit} className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pv-pan">PAN</Label>
                <Input id="pv-pan" value={form.panNumber} onChange={(event) => update("panNumber", event.target.value.toUpperCase())} maxLength={10} placeholder="ABCDE1234F" autoComplete="off" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pv-pan-name">Name as per PAN</Label>
                <Input id="pv-pan-name" value={form.nameAsPerPan} onChange={(event) => update("nameAsPerPan", event.target.value)} minLength={2} maxLength={200} placeholder="Name printed on the PAN card" required />
              </div>
            </div>

            <div className="space-y-2">
              <Label>GST Registered?</Label>
              <RadioGroup value={form.gstRegistered} onValueChange={(value) => update("gstRegistered", value as "yes" | "no")} className="flex gap-6">
                <div className="flex items-center gap-2"><RadioGroupItem value="yes" id="pv-gst-yes" /><Label htmlFor="pv-gst-yes" className="font-normal">Yes</Label></div>
                <div className="flex items-center gap-2"><RadioGroupItem value="no" id="pv-gst-no" /><Label htmlFor="pv-gst-no" className="font-normal">No</Label></div>
              </RadioGroup>
            </div>

            {gstYes && (
              <div className="space-y-2">
                <Label htmlFor="pv-gst">GSTIN</Label>
                <Input id="pv-gst" value={form.gstNumber} onChange={(event) => update("gstNumber", event.target.value.toUpperCase())} maxLength={15} placeholder="27ABCDE1234F1Z5" autoComplete="off" required />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="pv-billing-name">Billing / Legal Name</Label>
              <Input id="pv-billing-name" value={form.billingName} onChange={(event) => update("billingName", event.target.value)} minLength={2} maxLength={200} placeholder="Registered legal name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pv-billing-address">Billing Address</Label>
              <Textarea id="pv-billing-address" value={form.billingAddress} onChange={(event) => update("billingAddress", event.target.value)} minLength={5} maxLength={1000} rows={3} placeholder="Street address" required />
            </div>
            <div className="grid gap-5 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="pv-city">City</Label>
                <Input id="pv-city" value={form.billingCity} onChange={(event) => update("billingCity", event.target.value)} minLength={2} maxLength={120} placeholder="e.g. Mysuru" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pv-state">State</Label>
                <Input id="pv-state" value={form.billingState} onChange={(event) => update("billingState", event.target.value)} minLength={2} maxLength={120} placeholder="e.g. Karnataka" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pv-pin">PIN Code</Label>
                <Input id="pv-pin" value={form.billingPincode} onChange={(event) => update("billingPincode", event.target.value.replace(/[^0-9]/g, ""))} maxLength={6} inputMode="numeric" placeholder="570001" required />
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-lg border p-4">
              <Checkbox id="pv-terms" checked={form.acceptTerms} onCheckedChange={(checked) => update("acceptTerms", checked === true)} className="mt-0.5" />
              <Label htmlFor="pv-terms" className="text-sm font-normal leading-6 text-muted-foreground">
                I accept the <Link to="/terms-and-conditions" target="_blank" className="font-semibold text-primary hover:underline">Organizer Terms</Link> and the current SportPass pricing (4%, with a ₹20 minimum and ₹60 maximum per paid registration).
              </Label>
            </div>

            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

            <div className="flex justify-end">
              <Button type="submit" disabled={saving || !allFilled}>{saving ? "Submitting…" : status === "REJECTED" ? "Resubmit Verification" : "Submit Verification"}</Button>
            </div>
          </form>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2">
            <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">PAN</dt><dd className="mt-1 font-medium">{verification?.panNumber ?? "—"}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Name as per PAN</dt><dd className="mt-1 font-medium">{verification?.nameAsPerPan ?? "—"}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">GST Registered</dt><dd className="mt-1 font-medium">{verification?.gstRegistered ? "Yes" : "No"}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">GSTIN</dt><dd className="mt-1 font-medium">{verification?.gstNumber ?? "—"}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Billing / Legal Name</dt><dd className="mt-1 font-medium">{verification?.billingName ?? "—"}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Billing Address</dt><dd className="mt-1 whitespace-pre-line font-medium">{verification?.billingAddress ?? "—"}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">City</dt><dd className="mt-1 font-medium">{verification?.billingCity ?? "—"}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">State</dt><dd className="mt-1 font-medium">{verification?.billingState ?? "—"}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">PIN Code</dt><dd className="mt-1 font-medium">{verification?.billingPincode ?? "—"}</dd></div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
};

export default PaidVerification;
