import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, Building2, CheckCircle2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { OrganizerOnboardingLayout } from "@/components/OrganizerOnboardingLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, uploadFile } from "@/lib/api";

type Organization = {
  id: string;
  name: string;
  organizationType: string | null;
  city: string | null;
  state: string | null;
  description: string | null;
  website: string | null;
  logoUrl: string | null;
  status: string;
};

type UploadedLogo = {
  logoUrl: string;
};

const ORGANIZATION_TYPES = [
  { value: "running_club", label: "Running club" },
  { value: "cycling_club", label: "Cycling club" },
  { value: "school_college", label: "School / college" },
  { value: "company", label: "Company" },
  { value: "ngo_trust", label: "NGO / trust" },
  { value: "individual_organizer", label: "Individual organizer" },
  { value: "other", label: "Other" },
];

const OrganizerSetup = () => {
  const navigate = useNavigate();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [form, setForm] = useState({ name: "", organizationType: "", city: "", state: "", description: "", website: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadOrganization = async () => {
      try {
        const organizations = await apiRequest<Organization[]>("/organizer/organizations");
        const firstOrganization = organizations[0];
        if (!firstOrganization) throw new Error("No organizer organization is available for this account.");
        const profile = await apiRequest<Organization>(`/organizer/organizations/${firstOrganization.id}`);
        setOrganization(profile);
        setForm({
          name: profile.name,
          organizationType: profile.organizationType ?? "",
          city: profile.city ?? "",
          state: profile.state ?? "",
          description: profile.description ?? "",
          website: profile.website ?? "",
        });
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Could not load your organization profile.");
      } finally {
        setLoading(false);
      }
    };
    void loadOrganization();
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!organization) return;
    if (!form.organizationType || !form.city.trim() || !form.state.trim()) {
      setError("Organization type, city, and state are required to complete onboarding.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const profile = await apiRequest<Organization>(`/organizer/organizations/${organization.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: form.name,
          organization_type: form.organizationType,
          city: form.city,
          state: form.state,
          description: form.description || null,
          website: form.website || null,
        }),
      });
      const updatedProfile = logoFile
        ? { ...profile, logoUrl: (await uploadFile<UploadedLogo>(`/organizer/organizations/${organization.id}/logo`, logoFile)).logoUrl }
        : profile;
      setOrganization(updatedProfile);
      setLogoFile(null);
      setForm({
        name: updatedProfile.name,
        organizationType: updatedProfile.organizationType ?? "",
        city: updatedProfile.city ?? "",
        state: updatedProfile.state ?? "",
        description: updatedProfile.description ?? "",
        website: updatedProfile.website ?? "",
      });
      navigate("/organizer");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save your organization profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <OrganizerOnboardingLayout>
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6 lg:px-8">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">Organizer setup</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Set up your organization</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">Keep it simple. Add the public details participants should see before you create your first event.</p>
        </div>

        {loading ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading your organization…</CardContent></Card>
        ) : error && !organization ? (
          <Card><CardContent className="p-6 text-sm text-destructive">{error}</CardContent></Card>
        ) : organization ? (
          <form onSubmit={submit} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-primary" /> Organization profile</CardTitle>
                <CardDescription>These details can be updated later. Payment verification and payout information are not required here.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="organization-name">Organization name</Label>
                  <Input id="organization-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required minLength={2} maxLength={160} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="organization-type">Organization type</Label>
                  <Select value={form.organizationType || undefined} onValueChange={(value) => setForm((current) => ({ ...current, organizationType: value }))}>
                    <SelectTrigger id="organization-type" aria-required="true"><SelectValue placeholder="Select organization type" /></SelectTrigger>
                    <SelectContent>{ORGANIZATION_TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="organization-city">Primary city</Label>
                    <Input id="organization-city" value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} required minLength={2} maxLength={120} placeholder="e.g. Mysuru" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="organization-state">State</Label>
                    <Input id="organization-state" value={form.state} onChange={(event) => setForm((current) => ({ ...current, state: event.target.value }))} required minLength={2} maxLength={100} placeholder="e.g. Karnataka" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="organization-logo">Organization logo <span className="font-normal text-muted-foreground">(optional)</span></Label>
                  <Input id="organization-logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)} />
                  {organization.logoUrl && <img src={organization.logoUrl} alt="Current organization logo" className="h-16 w-16 rounded-lg border object-cover" />}
                  <p className="text-xs text-muted-foreground">PNG, JPEG, or WebP. The logo is used in participant-facing organization details.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="organization-description">Short description <span className="font-normal text-muted-foreground">(optional)</span></Label>
                  <Textarea id="organization-description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} maxLength={2000} placeholder="Tell participants what your club or organization does." rows={5} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="organization-website">Website <span className="font-normal text-muted-foreground">(optional)</span></Label>
                  <Input id="organization-website" type="url" value={form.website} onChange={(event) => setForm((current) => ({ ...current, website: event.target.value }))} maxLength={320} placeholder="https://your-organization.example" />
                  <p className="text-xs text-muted-foreground">Use a complete URL beginning with https:// or http://.</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="flex gap-3 p-5 text-sm text-muted-foreground">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <p>Your organizer account is already approved. After saving, you can create an event and add its date, location, tickets, rules, and payment instructions there.</p>
              </CardContent>
            </Card>

            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <Button asChild type="button" variant="outline"><Link to="/organizer">Skip for now</Link></Button>
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save and view events"} <ArrowRight className="ml-2 h-4 w-4" /></Button>
            </div>
          </form>
        ) : null}
      </div>
    </OrganizerOnboardingLayout>
  );
};

export default OrganizerSetup;
