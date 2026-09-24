/**
 * PublicRaceTimeResults — public results page for running/cycling events.
 *
 * Shows:
 *   - Category chips with participant count
 *   - Per-category table: Rank | Participant | Bib | Status | Time | Pace/Speed
 *   - Running → Pace column; Cycling → Avg Speed column
 *   - Finished participants ranked by time; DNS/DNF/DSQ shown below
 *
 * Isolated from match/tournament result components.
 */
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Timer, Trophy } from "lucide-react";

import { Layout } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePublicRaceResults } from "@/hooks/useRaceTimeResults";
import type { PublicRaceResultEntry } from "@/hooks/useRaceTimeResults";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadge(status: string) {
  const map: Record<string, string> = {
    Finished: "bg-green-100 text-green-800 border-green-200",
    DNS: "bg-slate-100 text-slate-600 border-slate-200",
    DNF: "bg-amber-100 text-amber-800 border-amber-200",
    DSQ: "bg-red-100 text-red-800 border-red-200",
  };
  const cls = map[status] ?? "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}
    >
      {status}
    </span>
  );
}

function rankCell(rank: number | null, status: string) {
  if (status !== "Finished") return <span className="text-muted-foreground">—</span>;
  if (rank === null) return <span className="text-muted-foreground">—</span>;
  if (rank === 1)
    return (
      <span className="inline-flex items-center gap-1 font-bold text-amber-500">
        <Trophy className="h-3.5 w-3.5" /> 1
      </span>
    );
  if (rank === 2)
    return <span className="font-bold text-slate-400">2</span>;
  if (rank === 3)
    return <span className="font-bold text-amber-700">3</span>;
  return <span className="font-mono text-sm">{rank}</span>;
}

// ---------------------------------------------------------------------------
// Category table
// ---------------------------------------------------------------------------

interface CategoryTableProps {
  entries: PublicRaceResultEntry[];
  isCycling: boolean;
}

function CategoryTable({ entries, isCycling }: CategoryTableProps) {
  // Finished first (already sorted by rank from server), then others
  const finished = entries.filter((e) => e.resultStatus === "Finished");
  const others = entries.filter((e) => e.resultStatus !== "Finished");
  const ordered = [...finished, ...others];

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-14">Rank</TableHead>
          <TableHead>Participant</TableHead>
          <TableHead className="w-16">Bib</TableHead>
          <TableHead className="w-24">Status</TableHead>
          <TableHead className="w-28">Time</TableHead>
          <TableHead className="w-28 text-right">
            {isCycling ? "Avg Speed" : "Pace"}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ordered.map((entry, i) => (
          <TableRow
            key={`${entry.participantName}-${i}`}
            className={entry.resultStatus !== "Finished" ? "opacity-60" : ""}
          >
            <TableCell>{rankCell(entry.rank, entry.resultStatus)}</TableCell>
            <TableCell className="font-medium">{entry.participantName}</TableCell>
            <TableCell className="text-muted-foreground">
              {entry.bibNumber ?? "—"}
            </TableCell>
            <TableCell>{statusBadge(entry.resultStatus)}</TableCell>
            <TableCell className="font-mono text-sm">
              {entry.finishTimeHhmmss ?? "—"}
            </TableCell>
            <TableCell className="text-right text-sm text-muted-foreground">
              {entry.resultStatus === "Finished"
                ? isCycling
                  ? (entry.speedDisplay ?? "—")
                  : (entry.paceDisplay ?? "—")
                : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PublicRaceTimeResults() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError } = usePublicRaceResults(id);

  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);

  const isCycling = data?.sport === "cycling";

  // Once data loads, default to the first category
  const categories = data?.categories ?? [];
  const resolvedCategoryId =
    activeCategoryId ??
    (categories.length > 0 ? (categories[0].categoryId ?? null) : null);

  const activeCategory =
    categories.find(
      (c) =>
        (c.categoryId ?? null) ===
        (resolvedCategoryId ?? null),
    ) ?? categories[0];

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-24">
          <Timer className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  // ── Error / no results ───────────────────────────────────────────────────
  if (isError || !data || data.resultSetStatus !== "published" || categories.length === 0) {
    return (
      <Layout>
        <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-24 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Timer className="h-7 w-7" />
          </div>
          <h1 className="mt-5 text-2xl font-black tracking-tight">
            Results not yet available
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The organizer hasn't published results for this event yet. Check
            back after the event.
          </p>
          <Button
            variant="outline"
            className="mt-6 gap-2"
            onClick={() =>
              navigate(id ? `/event/${encodeURIComponent(id)}` : "/")
            }
          >
            <ArrowLeft className="h-4 w-4" /> Back to event
          </Button>
        </div>
      </Layout>
    );
  }

  // ── Results ──────────────────────────────────────────────────────────────
  return (
    <Layout>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-10">
        {/* Back + heading */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Button
              variant="ghost"
              size="sm"
              className="mb-1 gap-1 pl-0"
              onClick={() =>
                navigate(id ? `/event/${encodeURIComponent(id)}` : "/")
              }
            >
              <ArrowLeft className="h-4 w-4" /> Back to event
            </Button>
            <h1 className="text-2xl font-black tracking-tight">
              {data.eventName}
            </h1>
            <p className="text-sm capitalize text-muted-foreground">
              {data.sport} · Official Results
            </p>
          </div>
          <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700 capitalize">
            Published
          </Badge>
        </div>

        {/* Category chips */}
        {categories.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => {
              const isActive =
                (cat.categoryId ?? null) === (resolvedCategoryId ?? null);
              return (
                <button
                  key={cat.categoryId ?? "none"}
                  onClick={() =>
                    setActiveCategoryId(cat.categoryId ?? null)
                  }
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    isActive
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background hover:bg-muted"
                  }`}
                >
                  {cat.categoryName}
                  {cat.distance ? ` · ${cat.distance}` : ""}
                  <span className="ml-1 opacity-60">({cat.participantCount})</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Active category header */}
        {activeCategory && (
          <div className="space-y-1">
            <div className="flex items-baseline gap-3">
              <h2 className="text-lg font-bold">{activeCategory.categoryName}</h2>
              {activeCategory.distance && (
                <span className="text-sm text-muted-foreground">
                  {activeCategory.distance}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {activeCategory.participantCount} participant
              {activeCategory.participantCount !== 1 ? "s" : ""}
            </p>
          </div>
        )}

        {/* Results table */}
        {activeCategory && activeCategory.entries.length > 0 ? (
          <div className="rounded-md border">
            <CategoryTable
              entries={activeCategory.entries}
              isCycling={isCycling}
            />
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No results for this category.
          </p>
        )}
      </div>
    </Layout>
  );
}
