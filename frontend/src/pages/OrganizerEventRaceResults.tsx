/**
 * OrganizerEventRaceResults — organizer editor for running/cycling timed results.
 *
 * Save Draft and Publish are both category-scoped when a category chip is active.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Clock, Download, ExternalLink, Eye, EyeOff, Flag, RotateCcw, Save, Search, Users } from "lucide-react";
import { toast } from "sonner";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiRequest } from "@/lib/api";
import {
  useOrganizerRaceResults,
  usePublishRaceResults,
  useSaveRaceResultsDraft,
  useUnpublishRaceResults,
  type ResultStatus,
} from "@/hooks/useRaceTimeResults";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConfirmedRegistration {
  id: string;
  registrationReference: string;
  participant: { name: string; email: string | null };
  ticket: { id: string; name: string; category: string | null; categoryId: string | null };
  categoryId: string | null;
  allocationNumber: number | null;
  status: string;
}

interface RegistrationPage {
  items: ConfirmedRegistration[];
  hasMore: boolean;
  nextCursor: string | null;
}

interface RowState {
  registrationId: string;
  participantName: string;
  bibNumber: number | null;
  categoryId: string | null;       // real UUID or null
  categoryKey: string;              // UUID or "__none__" — stable map key
  categoryName: string | null;
  resultStatus: ResultStatus;
  finishTimeHhmmss: string;
}

const STATUSES: ResultStatus[] = ["Finished", "DNS", "DNF", "DSQ"];

const STATUS_COLORS: Record<ResultStatus, string> = {
  Finished: "bg-green-100 text-green-800 border-green-200",
  DNS:      "bg-slate-100 text-slate-600 border-slate-200",
  DNF:      "bg-amber-100 text-amber-800 border-amber-200",
  DSQ:      "bg-red-100 text-red-800 border-red-200",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidTime(s: string): boolean {
  if (!s) return false;
  const parts = s.split(":");
  if (parts.length !== 3) return false;
  const [h, m, sec] = parts.map(Number);
  return (
    !Number.isNaN(h) && !Number.isNaN(m) && !Number.isNaN(sec) &&
    h >= 0 && h < 100 && m >= 0 && m < 60 && sec >= 0 && sec < 60
  );
}

function categoryKey(categoryId: string | null): string {
  return categoryId ?? "__none__";
}

function formatPace(v: number | null) {
  if (v === null) return "—";
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")} /km`;
}

function formatSpeed(v: number | null) {
  if (v === null) return "—";
  return `${(v / 100).toFixed(2)} km/h`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OrganizerEventRaceResults() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();

  const { data: savedResults, isLoading: resultsLoading } = useOrganizerRaceResults(eventId);
  const saveDraft = useSaveRaceResultsDraft(eventId!);
  const publish   = usePublishRaceResults(eventId!);
  const unpublish = useUnpublishRaceResults(eventId!);

  // ── Confirmed registrations ───────────────────────────────────────────────
  const [registrations, setRegistrations] = useState<ConfirmedRegistration[]>([]);
  const [regsLoading, setRegsLoading] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    setRegsLoading(true);
    const params = new URLSearchParams({ event_id: eventId, status: "confirmed", page_size: "500" });
    apiRequest<RegistrationPage>(`/organizer/registrations?${params.toString()}`)
      .then((page) => setRegistrations(page.items))
      .catch(() => toast.error("Could not load registrations"))
      .finally(() => setRegsLoading(false));
  }, [eventId]);

  // ── Row state ─────────────────────────────────────────────────────────────
  // Always seed from registrations (all confirmed participants).
  // Overlay saved result data (status, time) on top when available.
  const [rows, setRows] = useState<RowState[]>([]);
  const [dirtyCategoryKeys, setDirtyCategoryKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (resultsLoading || registrations.length === 0) return;

    // Build a lookup of saved entries by registrationId
    const savedMap = new Map<string, { resultStatus: ResultStatus; finishTimeHhmmss: string }>();
    for (const e of savedResults?.entries ?? []) {
      const key = e.registrationId ?? e.participantId;
      savedMap.set(key, {
        resultStatus: e.resultStatus,
        finishTimeHhmmss: e.finishTimeHhmmss ?? "",
      });
    }

    setRows(
      registrations.map((r) => {
        const saved = savedMap.get(r.id);
        return {
          registrationId: r.id,
          participantName: r.participant.name,
          bibNumber: r.allocationNumber,
          categoryId: r.ticket.categoryId ?? null,
          categoryKey: categoryKey(r.ticket.categoryId ?? null),
          categoryName: r.ticket.category ?? null,
          resultStatus: saved?.resultStatus ?? "Finished",
          finishTimeHhmmss: saved?.finishTimeHhmmss ?? "",
        };
      }),
    );
    setDirtyCategoryKeys(new Set());
  }, [savedResults, registrations, resultsLoading]);

  // ── Categories derived from rows ──────────────────────────────────────────
  const categories = useMemo(() => {
    const seen = new Map<string, string>(); // key → name
    for (const row of rows) {
      if (!seen.has(row.categoryKey)) seen.set(row.categoryKey, row.categoryName ?? "General");
    }
    return Array.from(seen.entries()); // [[key, name], ...]
  }, [rows]);

  // ── Filter state ──────────────────────────────────────────────────────────
  const [selectedKey, setSelectedKey] = useState<string>("all");
  const [searchText, setSearchText]   = useState("");
  const [statusFilter, setStatusFilter] = useState<ResultStatus | "all">("all");
  const [page, setPage] = useState(1);

  const filteredRows = useMemo(() => {
    let result = rows;
    if (selectedKey !== "all") result = result.filter((r) => r.categoryKey === selectedKey);
    if (statusFilter !== "all") result = result.filter((r) => r.resultStatus === statusFilter);
    if (searchText.trim()) {
      const term = searchText.trim().toLowerCase();
      result = result.filter(
        (r) =>
          r.participantName.toLowerCase().includes(term) ||
          (r.bibNumber !== null && String(r.bibNumber).includes(term)),
      );
    }
    return result;
  }, [rows, selectedKey, searchText, statusFilter]);

  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageOffset = (safePage - 1) * pageSize;
  const visibleRows = filteredRows.slice(pageOffset, pageOffset + pageSize);

  // ── Per-category publish status from server ───────────────────────────────
  const catStatuses = savedResults?.categoryStatuses ?? {};

  // Category being operated on (actual UUID or null, for API calls)
  const scopedCategoryId: string | null | undefined =
    selectedKey === "all"
      ? undefined                          // undefined → no scoping (all)
      : selectedKey === "__none__"
        ? null                             // null → uncategorised group
        : selectedKey;                     // UUID string

  // Is the currently selected category published?
  const selectedCatStatus: string =
    selectedKey === "all"
      ? (savedResults?.resultSetStatus ?? "draft")
      : (catStatuses[selectedKey] ?? "draft");

  const isCategoryPublished = selectedCatStatus === "published";

  // ── Rank lookup ───────────────────────────────────────────────────────────
  const rankMap = useMemo(() => {
    const m = new Map<string, { rank: number | null; pace: number | null; speed: number | null }>();
    for (const e of savedResults?.entries ?? []) {
      m.set(e.registrationId ?? e.participantId, { rank: e.rank, pace: e.paceSecondsPerKm, speed: e.speedKmhX100 });
    }
    return m;
  }, [savedResults]);

  // ── Row mutation ──────────────────────────────────────────────────────────
  function updateRow(filteredIdx: number, patch: Partial<RowState>) {
    const targetId = filteredRows[filteredIdx].registrationId;
    const gi = rows.findIndex((r) => r.registrationId === targetId);
    setRows((prev) => {
      const next = [...prev];
      next[gi] = { ...next[gi], ...patch };
      if (patch.resultStatus && patch.resultStatus !== "Finished") next[gi].finishTimeHhmmss = "";
      return next;
    });
    setDirtyCategoryKeys((current) => new Set(current).add(filteredRows[filteredIdx].categoryKey));
  }

  // ── Save draft (category-scoped) ──────────────────────────────────────────
  async function handleSaveDraft() {
    const rowsToSave = selectedKey === "all"
      ? rows
      : rows.filter((r) => r.categoryKey === selectedKey);

    const invalid = rowsToSave.filter(
      (r) => r.resultStatus === "Finished" && !isValidTime(r.finishTimeHhmmss),
    );
    if (invalid.length > 0) {
      toast.error(`${invalid.length} row(s) marked Finished but missing a valid time (HH:MM:SS).`);
      return;
    }

    await saveDraft.mutateAsync({
      entries: rowsToSave.map((r) => ({
        registrationId: r.registrationId,
        categoryId: r.categoryId,
        resultStatus: r.resultStatus,
        finishTimeHhmmss: r.resultStatus === "Finished" ? r.finishTimeHhmmss : null,
      })),
      categoryId: selectedKey === "all" ? null : (rowsToSave[0]?.categoryId ?? null),
    });

    const label = selectedKey === "all" ? "All results" : `${rowsToSave[0]?.categoryName ?? "Category"} results`;
    setDirtyCategoryKeys((current) => {
      if (selectedKey === "all") return new Set();
      const next = new Set(current);
      next.delete(selectedKey);
      return next;
    });
    toast.success(`${label} saved as draft — ranks recalculated.`);
  }

  // ── Publish / unpublish (category-scoped) ─────────────────────────────────
  async function handlePublish() {
    const scopeIsDirty = selectedKey === "all" ? dirtyCategoryKeys.size > 0 : dirtyCategoryKeys.has(selectedKey);
    if (scopeIsDirty) {
      toast.error("Save your draft before publishing these changes.");
      return;
    }
    const rowsInScope = selectedKey === "all"
      ? rows
      : rows.filter((r) => r.categoryKey === selectedKey);

    if (rowsInScope.some((r) => r.resultStatus === "Finished" && !isValidTime(r.finishTimeHhmmss))) {
      toast.error("Save a valid draft before publishing.");
      return;
    }
    await publish.mutateAsync(scopedCategoryId);
    const label = selectedKey === "all" ? "All results" : `${rowsInScope[0]?.categoryName ?? "Category"} results`;
    toast.success(`${label} published — visible to participants now.`);
  }

  async function handleUnpublish() {
    await unpublish.mutateAsync(scopedCategoryId);
    const rowsInScope = selectedKey === "all" ? rows : rows.filter((r) => r.categoryKey === selectedKey);
    const label = selectedKey === "all" ? "All results" : `${rowsInScope[0]?.categoryName ?? "Category"} results`;
    toast.success(`${label} reverted to draft.`);
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const isLoading  = resultsLoading || regsLoading;
  const isMutating = saveDraft.isPending || publish.isPending || unpublish.isPending;
  const sport      = savedResults?.sport ?? "";
  const isCycling  = sport === "cycling";
  const validFinishCount = rows.filter((row) => row.resultStatus === "Finished" && isValidTime(row.finishTimeHhmmss)).length;
  const missingTimeCount = rows.filter((row) => row.resultStatus === "Finished" && !isValidTime(row.finishTimeHhmmss)).length;
  const nonFinisherCount = rows.filter((row) => row.resultStatus !== "Finished").length;
  const publishedCategoryCount = categories.filter(([key]) => (catStatuses[key] ?? "draft") === "published").length;
  const scopeLabel = selectedKey === "all" ? "All categories" : categories.find(([key]) => key === selectedKey)?.[1] ?? "Selected category";
  const scopeIsDirty = selectedKey === "all" ? dirtyCategoryKeys.size > 0 : dirtyCategoryKeys.has(selectedKey);

  function exportCurrentView() {
    if (filteredRows.length === 0) {
      toast.error("There are no results in the current view to export.");
      return;
    }
    const escapeCsv = (value: string | number | null) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const lines = [
      ["Participant", "Bib", "Category", "Status", "Finish time", isCycling ? "Average speed" : "Pace", "Rank"].map(escapeCsv).join(","),
      ...filteredRows.map((row) => {
        const saved = rankMap.get(row.registrationId);
        return [row.participantName, row.bibNumber, row.categoryName, row.resultStatus, row.finishTimeHhmmss, isCycling ? formatSpeed(saved?.speed ?? null) : formatPace(saved?.pace ?? null), saved?.rank ?? ""].map(escapeCsv).join(",");
      }),
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `race-results-${eventId}-${selectedKey === "all" ? "all" : selectedKey}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <OrganizerDashboardLayout eventId={eventId}>
      <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-3"><Button variant="ghost" size="icon" className="mt-0.5 shrink-0" onClick={() => navigate(`/organizer/events/${eventId}`)} aria-label="Back to event dashboard"><ArrowLeft className="h-4 w-4" /></Button><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Race results</p><h1 className="mt-1 truncate text-2xl font-black tracking-tight sm:text-3xl">{savedResults?.eventName ?? "Results workspace"}</h1><p className="mt-1 text-sm text-muted-foreground">Enter finish times, calculate rankings, and publish results category by category.</p></div></div>
            <Button variant="outline" className="w-fit gap-2 lg:ml-4" onClick={() => window.open(`/event/${eventId}/results`, "_blank", "noopener,noreferrer")}><ExternalLink className="h-4 w-4" /> View public results</Button>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-4 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1.5 capitalize"><Flag className="h-3.5 w-3.5 text-primary" />{sport || "Race event"}</span><span>{categories.length} categor{categories.length === 1 ? "y" : "ies"}</span><span>{publishedCategoryCount} published</span></div>
        </section>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border bg-card p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm font-medium text-muted-foreground">Confirmed participants</p><Users className="h-5 w-5 text-primary" /></div><p className="mt-3 text-3xl font-black">{rows.length.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">Available for result entry</p></div>
          <div className="rounded-xl border bg-card p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm font-medium text-muted-foreground">Valid finish times</p><CheckCircle2 className="h-5 w-5 text-emerald-600" /></div><p className="mt-3 text-3xl font-black">{validFinishCount.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">Ready for ranking</p></div>
          <div className={`rounded-xl border bg-card p-5 shadow-sm ${missingTimeCount > 0 ? "border-amber-300" : ""}`}><div className="flex items-center justify-between"><p className="text-sm font-medium text-muted-foreground">Missing or invalid times</p><AlertTriangle className={`h-5 w-5 ${missingTimeCount > 0 ? "text-amber-600" : "text-muted-foreground"}`} /></div><p className="mt-3 text-3xl font-black">{missingTimeCount.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">Must be fixed before saving</p></div>
          <div className="rounded-xl border bg-card p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm font-medium text-muted-foreground">DNS, DNF or DSQ</p><Flag className="h-5 w-5 text-slate-500" /></div><p className="mt-3 text-3xl font-black">{nonFinisherCount.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">No finish time required</p></div>
        </div>

        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="space-y-5 border-b p-4 sm:p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-black tracking-tight">{scopeLabel}</h2><span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${isCategoryPublished ? "border-green-200 bg-green-100 text-green-800" : "border-amber-200 bg-amber-100 text-amber-800"}`}>{isCategoryPublished ? <><Eye className="h-3 w-3" /> Published</> : <><EyeOff className="h-3 w-3" /> Draft</>}</span>{scopeIsDirty && <Badge variant="secondary">Unsaved changes</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">Saving and publishing apply to this category scope. Search and status filters only change the rows shown below.</p></div>
              <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" className="gap-2" onClick={exportCurrentView} disabled={filteredRows.length === 0}><Download className="h-4 w-4" /> Export view</Button><Button variant="outline" size="sm" disabled={isMutating || isLoading || !scopeIsDirty} onClick={handleSaveDraft} className="gap-2"><Save className="h-4 w-4" />{selectedKey !== "all" ? "Save category" : "Save draft"}</Button>{isCategoryPublished ? <Button variant="outline" size="sm" disabled={isMutating || scopeIsDirty} onClick={handleUnpublish} className="gap-2"><RotateCcw className="h-4 w-4" />{selectedKey !== "all" ? "Unpublish category" : "Unpublish all"}</Button> : <Button size="sm" disabled={isMutating || isLoading || rows.length === 0 || scopeIsDirty} onClick={handlePublish} className="gap-2" title={scopeIsDirty ? "Save the draft before publishing" : undefined}><CheckCircle2 className="h-4 w-4" />{selectedKey !== "all" ? "Publish category" : "Publish all"}</Button>}</div>
            </div>

            {scopeIsDirty && <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>Save this draft before publishing. This prevents older server results from being published accidentally.</p></div>}

            {!isLoading && <><div className="flex gap-1 overflow-x-auto rounded-lg bg-muted/60 p-1" role="tablist" aria-label="Result category"><button type="button" role="tab" aria-selected={selectedKey === "all"} disabled={scopeIsDirty && selectedKey !== "all"} title={scopeIsDirty && selectedKey !== "all" ? "Save the current category before switching" : undefined} onClick={() => { setSelectedKey("all"); setPage(1); }} className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${selectedKey === "all" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>All <span className="ml-1 text-xs text-muted-foreground">{rows.length}</span></button>{categories.map(([key, name]) => { const count = rows.filter((row) => row.categoryKey === key).length; const status = catStatuses[key] ?? "draft"; const switchDisabled = scopeIsDirty && selectedKey !== key; return <button key={key} type="button" role="tab" aria-selected={selectedKey === key} disabled={switchDisabled} title={switchDisabled ? "Save the current scope before switching categories" : undefined} onClick={() => { setSelectedKey(key); setPage(1); }} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${selectedKey === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}><span className={`h-1.5 w-1.5 rounded-full ${status === "published" ? "bg-green-500" : "bg-amber-400"}`} />{name} <span className="text-xs text-muted-foreground">{count}</span></button>; })}</div><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="relative w-full lg:max-w-md"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search participant or bib number" value={searchText} onChange={(event) => { setSearchText(event.target.value); setPage(1); }} /></div><div className="flex gap-1 overflow-x-auto rounded-lg bg-muted/60 p-1" role="tablist" aria-label="Result status">{(["all", ...STATUSES] as Array<ResultStatus | "all">).map((status) => <button key={status} type="button" role="tab" aria-selected={statusFilter === status} onClick={() => { setStatusFilter(status); setPage(1); }} className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${statusFilter === status ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{status === "all" ? "All statuses" : status}</button>)}</div></div></>}
          </div>

          {isLoading ? <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Clock className="h-4 w-4 animate-spin" /> Loading participants…</div> : <>
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3 text-xs text-muted-foreground sm:px-5"><span>{filteredRows.length === 0 ? "No participants in this view" : `Showing ${pageOffset + 1}–${Math.min(pageOffset + pageSize, filteredRows.length)} of ${filteredRows.length} filtered participants`}</span>{(selectedKey !== "all" || searchText || statusFilter !== "all") && <Button variant="ghost" size="sm" className="h-7" onClick={() => { if (!scopeIsDirty) setSelectedKey("all"); setSearchText(""); setStatusFilter("all"); setPage(1); }}>Clear view filters</Button>}</div>
            <div className="overflow-x-auto"><Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Participant</TableHead>
                    <TableHead className="w-20">Bib</TableHead>
                    <TableHead className="w-36">Category</TableHead>
                    <TableHead className="w-36">Status</TableHead>
                    <TableHead className="w-40">Finish time</TableHead>
                    <TableHead className="w-24 text-right">{isCycling ? "Avg Speed" : "Pace"}</TableHead>
                    <TableHead className="w-14 text-right">Rank</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.length === 0 ? (
                    <TableRow>
                        <TableCell colSpan={8} className="py-16 text-center"><Flag className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-4 font-semibold">{rows.length === 0 ? "No confirmed participants" : "No matching results"}</p><p className="mt-1 text-sm text-muted-foreground">{rows.length === 0 ? "Confirm registrations before entering race results." : "Try a different participant, bib, category, or result status."}</p></TableCell>
                    </TableRow>
                  ) : (
                    visibleRows.map((row, vi) => {
                      const filteredIndex = pageOffset + vi;
                      const saved = rankMap.get(row.registrationId);
                      const timeError =
                        row.resultStatus === "Finished" &&
                        row.finishTimeHhmmss !== "" &&
                        !isValidTime(row.finishTimeHhmmss);
                      const timeMissing = row.resultStatus === "Finished" && row.finishTimeHhmmss === "";

                      return (
                        <TableRow key={row.registrationId}>
                          <TableCell className="text-xs text-muted-foreground">{filteredIndex + 1}</TableCell>
                          <TableCell className="font-semibold">{row.participantName}</TableCell>
                          <TableCell>{row.bibNumber != null ? <span className="font-mono font-semibold">#{row.bibNumber}</span> : <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{row.categoryName ?? "—"}</TableCell>

                          {/* Status */}
                          <TableCell>
                            <Select
                              value={row.resultStatus}
                              onValueChange={(v) => updateRow(filteredIndex, { resultStatus: v as ResultStatus })}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {STATUSES.map((s) => (
                                  <SelectItem key={s} value={s}>
                                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[s]}`}>
                                      {s}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>

                          {/* Time */}
                          <TableCell>
                            {row.resultStatus === "Finished" ? (
                              <div><Input
                                className={`h-9 w-32 font-mono text-sm ${timeError ? "border-red-400 focus-visible:ring-red-400" : timeMissing ? "border-amber-300" : ""}`}
                                placeholder="HH:MM:SS"
                                value={row.finishTimeHhmmss}
                                onChange={(e) => updateRow(filteredIndex, { finishTimeHhmmss: e.target.value })}
                              />{timeError && <p className="mt-1 text-[11px] text-red-600">Use HH:MM:SS</p>}</div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>

                          {/* Pace / Speed */}
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {row.resultStatus === "Finished"
                              ? isCycling ? formatSpeed(saved?.speed ?? null) : formatPace(saved?.pace ?? null)
                              : "—"}
                          </TableCell>

                          {/* Rank */}
                          <TableCell className="text-right">
                            {row.resultStatus === "Finished" && saved?.rank != null ? (
                              <Badge variant="outline" className="font-mono">#{saved.rank}</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table></div>
            {filteredRows.length > pageSize && <div className="flex flex-col gap-3 border-t px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-5"><span className="text-muted-foreground">Page {safePage} of {pageCount}</span><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft className="h-4 w-4" /> Previous</Button><Button variant="outline" size="sm" disabled={safePage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next <ChevronRight className="h-4 w-4" /></Button></div></div>}
            <div className="border-t bg-muted/20 px-4 py-3 text-xs leading-5 text-muted-foreground sm:px-5">Ranks and {isCycling ? "average speeds" : "paces"} are recalculated whenever you save. Finish time is required only for participants marked <strong>Finished</strong>. Each category can be published independently.</div>
          </>}
        </section>
      </div>
    </OrganizerDashboardLayout>
  );
}
