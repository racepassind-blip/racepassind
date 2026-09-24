/**
 * OrganizerEventRaceResults — organizer editor for running/cycling timed results.
 *
 * Save Draft and Publish are both category-scoped when a category chip is active.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Clock, Eye, EyeOff, RotateCcw, Save, Search } from "lucide-react";
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

  const filteredRows = useMemo(() => {
    let result = rows;
    if (selectedKey !== "all") result = result.filter((r) => r.categoryKey === selectedKey);
    if (searchText.trim()) {
      const term = searchText.trim().toLowerCase();
      result = result.filter(
        (r) =>
          r.participantName.toLowerCase().includes(term) ||
          (r.bibNumber !== null && String(r.bibNumber).includes(term)),
      );
    }
    return result;
  }, [rows, selectedKey, searchText]);

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
    toast.success(`${label} saved as draft — ranks recalculated.`);
  }

  // ── Publish / unpublish (category-scoped) ─────────────────────────────────
  async function handlePublish() {
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

  return (
    <OrganizerDashboardLayout eventId={eventId}>
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-8">

        {/* ── Header ── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="gap-1"
              onClick={() => navigate(`/organizer/events/${eventId}`)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                {savedResults?.eventName ?? "Race Results"}
              </h1>
              <p className="text-sm text-muted-foreground capitalize">{sport}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Scope label */}
            {selectedKey !== "all" && (
              <span className="text-xs text-muted-foreground">
                {categories.find(([k]) => k === selectedKey)?.[1] ?? "Category"}:
              </span>
            )}

            {/* Publish status badge for current scope */}
            <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${
              isCategoryPublished
                ? "border-green-200 bg-green-100 text-green-800"
                : "border-amber-200 bg-amber-100 text-amber-800"
            }`}>
              {isCategoryPublished
                ? <><Eye className="h-3 w-3" /> Published</>
                : <><EyeOff className="h-3 w-3" /> Draft</>}
            </span>

            <Button variant="outline" size="sm" disabled={isMutating || isLoading}
              onClick={handleSaveDraft} className="gap-1">
              <Save className="h-4 w-4" />
              {selectedKey !== "all" ? "Save Category Draft" : "Save Draft"}
            </Button>

            {isCategoryPublished ? (
              <Button variant="outline" size="sm" disabled={isMutating} onClick={handleUnpublish} className="gap-1">
                <RotateCcw className="h-4 w-4" />
                {selectedKey !== "all" ? "Unpublish Category" : "Unpublish All"}
              </Button>
            ) : (
              <Button size="sm" disabled={isMutating || isLoading || rows.length === 0}
                onClick={handlePublish} className="gap-1">
                <CheckCircle2 className="h-4 w-4" />
                {selectedKey !== "all" ? "Publish Category" : "Publish All"}
              </Button>
            )}
          </div>
        </div>

        {/* ── Filter bar ── */}
        {!isLoading && (
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">

            {/* Category chips with per-category status indicator */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Category:
              </span>

              {/* All chip */}
              <button
                onClick={() => setSelectedKey("all")}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  selectedKey === "all"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-muted"
                }`}
              >
                All ({rows.length})
              </button>

              {/* Per-category chips */}
              {categories.map(([key, name]) => {
                const count   = rows.filter((r) => r.categoryKey === key).length;
                const status  = catStatuses[key] ?? "draft";
                const active  = selectedKey === key;
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedKey(key)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background hover:bg-muted"
                    }`}
                  >
                    {/* Published dot */}
                    <span className={`h-1.5 w-1.5 rounded-full ${
                      status === "published" ? "bg-green-500" : "bg-amber-400"
                    }`} />
                    {name} ({count})
                  </button>
                );
              })}

              {/* Legend */}
              {categories.length > 0 && (
                <span className="ml-1 text-xs text-muted-foreground">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" /> published
                  &nbsp;
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" /> draft
                </span>
              )}
            </div>

            {/* Search */}
            <div className="relative shrink-0">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="w-full pl-9 sm:w-60"
                placeholder="Search name or bib…"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* ── Loading ── */}
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Clock className="h-4 w-4 animate-spin" /> Loading participants…
          </div>
        )}

        {/* ── Table ── */}
        {!isLoading && (
          <>
            <p className="text-xs text-muted-foreground">
              Showing {filteredRows.length} of {rows.length} participant{rows.length !== 1 ? "s" : ""}.
              {(selectedKey !== "all" || searchText) ? " Clear filters to see all." : ""}
            </p>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Participant</TableHead>
                    <TableHead className="w-20">Bib</TableHead>
                    <TableHead className="w-36">Category</TableHead>
                    <TableHead className="w-36">Status</TableHead>
                    <TableHead className="w-36">Time (HH:MM:SS)</TableHead>
                    <TableHead className="w-24 text-right">{isCycling ? "Avg Speed" : "Pace"}</TableHead>
                    <TableHead className="w-14 text-right">Rank</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-16 text-center text-sm text-muted-foreground">
                        {rows.length === 0
                          ? "No confirmed participants found for this event."
                          : "No participants match the current filter."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRows.map((row, vi) => {
                      const saved = rankMap.get(row.registrationId);
                      const timeError =
                        row.resultStatus === "Finished" &&
                        row.finishTimeHhmmss !== "" &&
                        !isValidTime(row.finishTimeHhmmss);

                      return (
                        <TableRow key={row.registrationId}>
                          <TableCell className="text-xs text-muted-foreground">{vi + 1}</TableCell>
                          <TableCell className="font-medium">{row.participantName}</TableCell>
                          <TableCell className="text-muted-foreground">{row.bibNumber ?? "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{row.categoryName ?? "—"}</TableCell>

                          {/* Status */}
                          <TableCell>
                            <Select
                              value={row.resultStatus}
                              onValueChange={(v) => updateRow(vi, { resultStatus: v as ResultStatus })}
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
                              <Input
                                className={`h-8 w-32 font-mono text-xs ${timeError ? "border-red-400" : ""}`}
                                placeholder="HH:MM:SS"
                                value={row.finishTimeHhmmss}
                                onChange={(e) => updateRow(vi, { finishTimeHhmmss: e.target.value })}
                              />
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
              </Table>
            </div>
          </>
        )}

        <p className="text-xs text-muted-foreground">
          Ranks and {isCycling ? "speeds" : "paces"} are recalculated on each save.
          Time is required only for <strong>Finished</strong> participants.
          Publish category-by-category — each category's results go live independently.
        </p>
      </div>
    </OrganizerDashboardLayout>
  );
}
