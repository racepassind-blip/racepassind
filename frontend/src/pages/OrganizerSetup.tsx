import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, Building2, CheckCircle2, ImagePlus, ShieldCheck } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { OrganizerOnboardingLayout } from "@/components/OrganizerOnboardingLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import PaidVerification from "@/components/PaidVerification";
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

interface OrganizerSetupProps {
  embedded?: boolean;
}

const OrganizerSetup = ({ embedded = false }: OrganizerSetupProps) => {
  const navigate = useNavigate();
  const [section, setSection] = useState<"profile" | "verification">(window.location.hash === "#paid-verification" ? "verification" : "profile");
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", organizationType: "", city: "", state: "", description: "", website: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!logoFile) { setLogoPreviewUrl(null); return; }
    const url = URL.createObjectURL(logoFile);
    setLogoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

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
    setSaved(false);
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
      setSaved(true);
      if (!embedded) navigate("/organizer");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save your organization profile.");
    } finally {
      setSaving(false);
    }
  };

  const displayedLogo = logoPreviewUrl || organization?.logoUrl;

  const content = (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">Organizer settings</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Your organization</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">Manage your public profile and verification in one place.</p>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-xl border bg-muted/40 p-1.5" role="tablist" aria-label="Organization settings">
          {([{ id: "profile", title: "Public profile", detail: "Logo and organization details", icon: Building2 }, { id: "verification", title: "Paid event verification", detail: "Required for paid events only", icon: ShieldCheck }] as const).map((item) => <button key={item.id} id={`organization-tab-${item.id}`} type="button" role="tab" aria-selected={section === item.id} aria-controls={`organization-panel-${item.id}`} onClick={() => setSection(item.id)} className={`flex items-start gap-3 rounded-lg p-3 text-left transition-colors sm:p-4 ${section === item.id ? "bg-background text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-background/60"}`}><item.icon className={`mt-0.5 hidden h-5 w-5 shrink-0 sm:block ${section === item.id ? "text-primary" : ""}`} /><span><span className="block text-sm font-semibold">{item.title}</span><span className="mt-1 hidden text-xs text-muted-foreground sm:block">{item.detail}</span></span></button>)}
        </div>
        <div id="organization-panel-profile" role="tabpanel" aria-labelledby="organization-tab-profile" hidden={section !== "profile"}>
        {loading ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading your organization…</CardContent></Card>
        ) : error && !organization ? (
          <Card><CardContent className="p-6 text-sm text-destructive">{error}</CardContent></Card>
        ) : organization ? (
          <form onSubmit={submit} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-primary" /> Organization profile</CardTitle>
                <CardDescription>Your public identity. You can update these details whenever they change.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="rounded-xl border bg-muted/25 p-4 sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-white">
                      {displayedLogo && displayedLogo !== failedLogoUrl ? <img src={displayedLogo} alt="Organization logo preview" onError={() => setFailedLogoUrl(displayedLogo)} className="h-full w-full object-contain p-2" /> : <ImagePlus className="h-8 w-8 text-slate-400" />}
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <Label htmlFor="organization-logo" className="text-base font-semibold">Organization logo <span className="text-sm font-normal text-muted-foreground">(optional)</span></Label>
                      <p className="text-sm text-muted-foreground">Shown alongside your name on the public event registration page.</p>
                      <Input id="organization-logo" type="file" accept="image/png,image/jpeg,image/webp" disabled={saving} onChange={(event) => { setLogoFile(event.target.files?.[0] ?? null); setSaved(false); }} className="bg-background" />
                      <p className="text-xs text-muted-foreground">PNG, JPEG, or WebP. Use a clear logo with some space around it.</p>
                      {logoFile && <p className="text-xs font-medium text-primary">{logoFile.name} · Save changes to upload</p>}
                      {displayedLogo && displayedLogo === failedLogoUrl && <p role="alert" className="text-xs text-destructive">The logo could not load. Choose a replacement or try reloading the page.</p>}
                    </div>
                  </div>
                </div>
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

            {error && <p className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{error}</p>}
            {saved && <p role="status" className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Organization profile saved.</p>}

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              {!embedded && <Button asChild type="button" variant="outline"><Link to="/organizer">Back to events</Link></Button>}
              <Button type="submit" disabled={saving}>{saving ? "Saving changes…" : embedded ? "Save changes" : "Save and view events"} <ArrowRight className="ml-2 h-4 w-4" /></Button>
            </div>
          </form>
        ) : null}

        </div>
        <div id="organization-panel-verification" role="tabpanel" aria-labelledby="organization-tab-verification" hidden={section !== "verification"}>
          {organization ? <PaidVerification organizationId={organization.id} /> : <p className="p-6 text-sm text-muted-foreground">{loading ? "Loading organization…" : "Organization details could not be loaded. Reload to try again."}</p>}
        </div>
      </div>
  );

  return embedded ? content : <OrganizerOnboardingLayout>{content}</OrganizerOnboardingLayout>;
};

export default OrganizerSetup;
