import { useEffect, useState } from "react";
import { RefreshCw, Save, ShieldCheck } from "lucide-react";

import { Layout } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/api";

type FeeType = "none" | "fixed_per_registration" | "percentage";

interface OrganizationFee {
  id: string;
  name: string;
  status: string;
  feeType: FeeType;
  feeValuePaise: number;
  feePercentageBasisPoints: number;
  currency: string;
  collectionStatus: "not_collected";
}

interface FeeDraft {
  feeType: FeeType;
  fixedRupees: string;
  percentage: string;
}

function paiseToRupees(paise: number): string {
  return (paise / 100).toFixed(2);
}

function basisPointsToPercentage(basisPoints: number): string {
  return (basisPoints / 100).toFixed(2);
}

function decimalToMinor(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
}

function draftFromOrganization(organization: OrganizationFee): FeeDraft {
  return {
    feeType: organization.feeType,
    fixedRupees: paiseToRupees(organization.feeValuePaise),
    percentage: basisPointsToPercentage(organization.feePercentageBasisPoints),
  };
}

const AdminOrganizerFees = () => {
  const [organizations, setOrganizations] = useState<OrganizationFee[]>([]);
  const [drafts, setDrafts] = useState<Record<string, FeeDraft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});

  const loadOrganizations = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<OrganizationFee[]>("/admin/organizers");
      setOrganizations(response);
      setDrafts(Object.fromEntries(response.map((organization) => [organization.id, draftFromOrganization(organization)])));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load organizer fee settings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOrganizations();
  }, []);

  const updateDraft = (id: string, patch: Partial<FeeDraft>) => {
    setSavedId(null);
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  };

  const saveOrganization = async (organization: OrganizationFee) => {
    const draft = drafts[organization.id];
    if (!draft) return;

    let feeValuePaise = 0;
    let feePercentageBasisPoints = 0;
    if (draft.feeType === "fixed_per_registration") {
      const parsed = decimalToMinor(draft.fixedRupees);
      if (parsed === null) {
        setSaveErrors((current) => ({ ...current, [organization.id]: "Enter a valid non-negative INR amount with up to two decimals." }));
        return;
      }
      feeValuePaise = parsed;
    } else if (draft.feeType === "percentage") {
      const parsed = decimalToMinor(draft.percentage);
      if (parsed === null || parsed > 10_000) {
        setSaveErrors((current) => ({ ...current, [organization.id]: "Enter a percentage from 0 to 100 with up to two decimals." }));
        return;
      }
      feePercentageBasisPoints = parsed;
    }

    setSavingId(organization.id);
    setSavedId(null);
    setSaveErrors((current) => ({ ...current, [organization.id]: "" }));
    try {
      const updated = await apiRequest<OrganizationFee>(`/admin/organizers/${organization.id}/fee-settings`, {
        method: "PUT",
        body: JSON.stringify({
          fee_type: draft.feeType,
          fee_value_paise: feeValuePaise,
          fee_percentage_basis_points: feePercentageBasisPoints,
        }),
      });
      setOrganizations((current) => current.map((item) => item.id === updated.id ? updated : item));
      setDrafts((current) => ({ ...current, [updated.id]: draftFromOrganization(updated) }));
      setSavedId(updated.id);
    } catch (saveError) {
      setSaveErrors((current) => ({
        ...current,
        [organization.id]: saveError instanceof Error ? saveError.message : "Could not save this fee setting.",
      }));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Layout>
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4" /> Admin-only settings</div>
            <h1 className="text-3xl font-extrabold tracking-tight">Organizer fee settings</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">Configure future fee policy per organizer. These values are stored for planning only and do not change participant totals, UPI amounts, payment decisions, or payouts.</p>
          </div>
          <Button variant="outline" onClick={() => void loadOrganizations()} disabled={loading} className="gap-2"><RefreshCw className="h-4 w-4" /> Refresh</Button>
        </div>

        {loading ? <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading organizers…</CardContent></Card> : error ? (
          <Card><CardContent className="space-y-4 p-6"><p role="alert" className="text-sm text-destructive">{error}</p><Button onClick={() => void loadOrganizations()}>Try again</Button></CardContent></Card>
        ) : organizations.length === 0 ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">No organizers have been onboarded yet.</CardContent></Card>
        ) : (
          <div className="space-y-4">
            {organizations.map((organization) => {
              const draft = drafts[organization.id];
              const saveError = saveErrors[organization.id];
              return (
                <Card key={organization.id}>
                  <CardHeader className="pb-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div><CardTitle>{organization.name}</CardTitle><CardDescription className="mt-1">Status: {organization.status}</CardDescription></div>
                      <Badge variant="secondary">{organization.collectionStatus === "not_collected" ? "Configuration only" : organization.collectionStatus}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                      <div className="space-y-2"><Label>Fee model</Label><Select value={draft?.feeType ?? "none"} onValueChange={(value: FeeType) => updateDraft(organization.id, { feeType: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem><SelectItem value="fixed_per_registration">Fixed per registration</SelectItem><SelectItem value="percentage">Percentage</SelectItem></SelectContent></Select></div>
                      <div className="space-y-2"><Label htmlFor={`fee-value-${organization.id}`}>{draft?.feeType === "percentage" ? "Percentage" : "Fixed amount (INR)"}</Label><Input id={`fee-value-${organization.id}`} value={draft?.feeType === "percentage" ? draft.percentage : draft?.fixedRupees ?? "0.00"} onChange={(event) => updateDraft(organization.id, draft?.feeType === "percentage" ? { percentage: event.target.value } : { fixedRupees: event.target.value })} disabled={!draft || draft.feeType === "none"} inputMode="decimal" placeholder={draft?.feeType === "percentage" ? "0.00" : "0.00"} /><p className="text-xs text-muted-foreground">{draft?.feeType === "percentage" ? "0 to 100%, up to two decimals" : "Stored as integer paise"}</p></div>
                      <Button onClick={() => void saveOrganization(organization)} disabled={savingId === organization.id || !draft} className="gap-2"><Save className="h-4 w-4" />{savingId === organization.id ? "Saving…" : savedId === organization.id ? "Saved" : "Save"}</Button>
                    </div>
                    {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
                    <p className="text-xs text-muted-foreground">Currency: {organization.currency}. No fee is currently collected or deducted from registrations.</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
};

export default AdminOrganizerFees;
