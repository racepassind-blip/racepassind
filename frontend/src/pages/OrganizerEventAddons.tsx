import { Download, Loader2, Package, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOrganizerEventDashboard } from "@/hooks/useEvents";
import { apiRequest } from "@/lib/api";

const money = (paise: number) => paise === 0 ? "Free" : `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export default function OrganizerEventAddons() {
  const { eventId } = useParams();
  const { data, isLoading, isError } = useOrganizerEventDashboard(eventId);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState("");
  const [addonFilter, setAddonFilter] = useState("all");
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const addons = data?.byAddon ?? [];
  const visibleAddons = useMemo(() => {
    const query = search.trim().toLowerCase();
    return addons.filter((addon) => addonFilter === "all" || addon.addonId === addonFilter).map((addon) => ({
      ...addon,
      entries: addon.entries.filter((entry) => !query || [entry.participantName, entry.registrationReference, entry.selection].some((value) => value?.toLowerCase().includes(query))),
    })).filter((addon) => !query || addon.entries.length > 0 || addon.addonName.toLowerCase().includes(query));
  }, [addons, addonFilter, search]);
  const totalSelections = addons.reduce((sum, addon) => sum + addon.totalQuantity, 0);
  const totalRevenue = addons.reduce((sum, addon) => sum + addon.totalRevenuePaise, 0);
  const totalParticipants = new Set(addons.flatMap((addon) => addon.entries.map((entry) => entry.registrationReference))).size;
  const exportCsv = async () => {
    setExporting(true);
    try {
      const content = await apiRequest<string>(`/organizer/events/${eventId}/addons.csv`);
      const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `addons-${eventId}.csv`; anchor.click(); URL.revokeObjectURL(url);
      toast.success("Add-on CSV downloaded.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not export add-ons."); }
    finally { setExporting(false); }
  };
  const summarizeWithAi = async () => {
    setSummarizing(true);
    try {
      const result = await apiRequest<{ summary: string }>(`/organizer/events/${eventId}/addons/ai-summary`, { method: "POST", body: JSON.stringify({ confirmed_participants: data?.overview.confirmedParticipants ?? 0, addons: addons.map((addon) => ({ name: addon.addonName, total_quantity: addon.totalQuantity, options: addon.byOption.map((option) => ({ name: option.option, count: option.count })) })) }) });
      setAiSummary(result.summary);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not create an AI summary."); }
    finally { setSummarizing(false); }
  };
  return <OrganizerDashboardLayout eventId={eventId}>
    <div className="mx-auto max-w-[1200px] space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Event operations</p><h1 className="mt-2 text-3xl font-black tracking-tight">Add-ons & fulfilment</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Prepare food, merchandise, and other extras using selections from confirmed registrations.</p></div>
        <Button variant="outline" onClick={() => void exportCsv()} disabled={exporting || !addons.length} className="gap-2"><Download className="h-4 w-4" />{exporting ? "Exporting…" : "Export CSV"}</Button>
      </div>
      {isLoading ? <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Loading add-on selections…</CardContent></Card> : isError || !data ? <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Could not load add-on selections.</CardContent></Card> : !addons.length ? <Card><CardContent className="py-12 text-center"><Package className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 font-semibold">No add-on selections yet</p><p className="mt-1 text-sm text-muted-foreground">Selections will appear here after confirmed participants choose an add-on.</p></CardContent></Card> : <>
        <Card className="border-violet-200 bg-gradient-to-br from-violet-50 via-background to-sky-50 dark:border-violet-500/30 dark:from-violet-950/30 dark:to-sky-950/20"><CardHeader className="flex-row items-start justify-between gap-4 space-y-0"><div><div className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-violet-600" /><CardTitle>AI preparation summary</CardTitle><Badge variant="outline">Beta</Badge></div><CardDescription className="mt-1">A quick summary based only on the add-on counts shown below.</CardDescription></div><Button onClick={() => void summarizeWithAi()} disabled={summarizing} className="shrink-0 gap-2">{summarizing ? <><Loader2 className="h-4 w-4 animate-spin" />Summarizing…</> : <><Sparkles className="h-4 w-4" />Summarize with AI</>}</Button></CardHeader>{aiSummary && <CardContent><div className="rounded-lg border border-violet-200 bg-background/80 p-4 text-sm leading-6 dark:border-violet-900/60"><p>{aiSummary}</p><p className="mt-3 text-xs text-muted-foreground">Review all quantities before ordering or preparing. AI does not change your event data.</p></div></CardContent>}</Card>
        <div className="grid gap-3 sm:grid-cols-4"><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Confirmed participants</p><p className="mt-2 text-2xl font-black">{data.overview.confirmedParticipants.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">Total event registrations</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Add-on quantity</p><p className="mt-2 text-2xl font-black">{totalSelections.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">Across {addons.length} add-on{addons.length === 1 ? "" : "s"}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Participants with add-ons</p><p className="mt-2 text-2xl font-black">{totalParticipants.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">Unique confirmed participants</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Add-on value</p><p className="mt-2 text-2xl font-black">{money(totalRevenue)}</p><p className="mt-1 text-xs text-muted-foreground">Based on selected quantities</p></CardContent></Card></div>
        <Card className="print:hidden"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row"><input aria-label="Search add-on selections" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search participant, reference, or size…" className="h-10 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" /><select aria-label="Filter by add-on" value={addonFilter} onChange={(event) => setAddonFilter(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="all">All add-ons</option>{addons.map((addon) => <option key={addon.addonId} value={addon.addonId}>{addon.addonName}</option>)}</select><Button variant="outline" onClick={() => window.print()}>Print preparation list</Button></CardContent></Card>
        {visibleAddons.length === 0 ? <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No matching add-on selections.</CardContent></Card> : <div className="space-y-5">{visibleAddons.map((addon) => <Card key={addon.addonId}><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>{addon.addonName}</CardTitle><CardDescription>{addon.type === "single_select" ? "Choose one option" : "Quantity selection"} · {money(addon.pricePaise)}</CardDescription></div><div className="text-right"><p className="text-2xl font-black">{addon.totalQuantity.toLocaleString()}</p><p className="text-xs text-muted-foreground">{addon.type === "single_select" ? "selections" : "total quantity"}</p></div></div></CardHeader><CardContent className="space-y-4">{addon.type === "single_select" && addon.byOption.length > 0 && <div className="rounded-xl border bg-muted/20 p-4"><p className="mb-3 text-sm font-semibold">{/(shirt|t-shirt|size)/i.test(addon.addonName) ? "Size breakdown" : "Selection breakdown"}</p><div className="space-y-3">{addon.byOption.map((item) => { const max = Math.max(...addon.byOption.map((option) => option.count), 1); return <div key={item.option} className="grid grid-cols-[64px_minmax(0,1fr)_40px] items-center gap-3 text-sm"><span className="truncate font-medium">{item.option}</span><div className="h-3 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max((item.count / max) * 100, item.count ? 6 : 0)}%` }} /></div><span className="text-right font-semibold">{item.count}</span></div>; })}</div></div>}<div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>Participant</TableHead><TableHead>Reference</TableHead>{addon.type === "single_select" && <TableHead>Option</TableHead>}<TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader><TableBody>{addon.entries.map((entry) => <TableRow key={`${addon.addonId}-${entry.registrationReference}`}><TableCell className="font-medium">{entry.participantName}</TableCell><TableCell className="font-mono text-xs">{entry.registrationReference || "—"}</TableCell>{addon.type === "single_select" && <TableCell>{entry.selection || "—"}</TableCell>}<TableCell className="text-right">{entry.quantity}</TableCell><TableCell className="text-right">{money(entry.amountPaise)}</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>)}</div>}
      </>}
    </div>
  </OrganizerDashboardLayout>;
}
