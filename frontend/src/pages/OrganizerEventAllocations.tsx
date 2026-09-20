import { useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Search, Filter, ArrowLeft, CalendarDays, User, MapPin, Settings, CheckCircle2, AlertCircle,
  Save, RefreshCw, Play, ListFilter, Hash, MoreHorizontal, ArrowUp, ArrowDown, Copy, ExternalLink
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge as BadgeComp } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { useFreeEventLock } from "@/hooks/useFreeEventLock";
import { useAllocations, useBatchAllocate, usePublishAllocations, useEditAllocation, useAllocationConfig } from "@/hooks/useAllocations";
import type { AllocationRegistration } from "@/hooks/useAllocations";
import { getSportConfig } from "@/data/sportConfig";
import { format } from "date-fns";

interface AllocationStatus {
  value: string;
  label: string;
  variant: "default" | "secondary" | "outline";
}

const statusConfig: Record<string, AllocationStatus> = {
  unassigned: { value: "unassigned", label: "Unassigned", variant: "secondary" },
  draft: { value: "draft", label: "Draft", variant: "outline" },
  published: { value: "published", label: "Published", variant: "default" },
};

const OrganizerEventAllocations = () => {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const queryClient = useQueryClient();

  const { data: dashboard, locked } = useFreeEventLock(eventId);
  const { data: allocations = [], isLoading: isLoadingAllocations, refetch: refetchAllocations } = useAllocations(eventId || "");
  const { data: allocationSummary = [], isLoading: isLoadingSummary } = useAllocations(eventId || "");
  const { data: sportConfig } = useAllocationConfig(eventId || "");

  const batchAllocate = useBatchAllocate(eventId || "");
  const publishAllocations = usePublishAllocations(eventId || "");
  const editAllocation = useEditAllocation(eventId || "");

  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [rangeStart, setRangeStart] = useState<number>(1);
  const [rangeEnd, setRangeEnd] = useState<number>(100);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  // Ordered list of registration ids used to build the preview. Organizers can
  // reorder these rows; numbers are assigned sequentially from rangeStart.
  const [previewOrder, setPreviewOrder] = useState<string[]>([]);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [notifyOnPublish, setNotifyOnPublish] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingRegistration, setEditingRegistration] = useState<string | null>(null);
  const [newNumber, setNewNumber] = useState<number | "">("");
  const [notifyOnEdit, setNotifyOnEdit] = useState(false);

  const event = dashboard?.event;

  // Sport-specific configuration
  const sportConfigData = useMemo(() => {
    if (!event?.sport) return null;
    return getSportConfig(event.sport);
  }, [event?.sport]);

  const numberLabel = sportConfigData?.numberLabel || "Number";

  // Filtered allocations
  const filteredAllocations = useMemo(() => {
    return allocations.filter((alloc) => {
      const matchesSearch = alloc.participant_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (alloc.allocation_number?.toString() || "").includes(searchTerm);
      const matchesStatus = filterStatus === "all" || alloc.allocation_status === filterStatus;
      const matchesCategory = filterCategory === "all" || alloc.category_name === filterCategory;
      return matchesSearch && matchesStatus && matchesCategory;
    });
  }, [allocations, searchTerm, filterStatus, filterCategory]);

  // Summary by category
  const summaryByCategory = useMemo(() => {
    const summary: Record<string, { total: number; unassigned: number; draft: number; published: number }> = {};
    allocations.forEach((alloc) => {
      const cat = alloc.category_name || "Uncategorized";
      if (!summary[cat]) {
        summary[cat] = { total: 0, unassigned: 0, draft: 0, published: 0 };
      }
      summary[cat].total++;
      if (alloc.allocation_status === "unassigned") summary[cat].unassigned++;
      else if (alloc.allocation_status === "draft") summary[cat].draft++;
      else if (alloc.allocation_status === "published") summary[cat].published++;
    });
    return summary;
  }, [allocations]);

  // Participants eligible for this batch: only those matching the current
  // filters AND still unassigned. This is what the preview is built from.
  const batchEligible = useMemo(() => {
    return filteredAllocations.filter((a) => a.allocation_status === "unassigned");
  }, [filteredAllocations]);

  // Ordered preview rows. Uses previewOrder when available (so reordering
  // sticks), otherwise falls back to the eligible list order.
  const orderedPreview = useMemo(() => {
    const byId = new Map(batchEligible.map((a) => [a.id, a]));
    const ordered = previewOrder
      .map((id) => byId.get(id))
      .filter((a): a is AllocationRegistration => Boolean(a));
    // Append any eligible rows not yet in previewOrder (e.g. first open).
    for (const a of batchEligible) {
      if (!previewOrder.includes(a.id)) ordered.push(a);
    }
    return ordered;
  }, [batchEligible, previewOrder]);

  const rangeCapacity = Math.max(0, rangeEnd - rangeStart + 1);
  const rangeInsufficient = orderedPreview.length > rangeCapacity;

  const openPreview = () => {
    if (batchEligible.length === 0) {
      toast.error("No unassigned participants match the current filters");
      return;
    }
    setPreviewOrder(batchEligible.map((a) => a.id));
    setShowPreviewDialog(true);
  };

  const movePreviewRow = (index: number, direction: -1 | 1) => {
    setPreviewOrder((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleBatchAllocate = async () => {
    if (!eventId) return;
    if (rangeInsufficient) {
      toast.error(`Range ${rangeStart}-${rangeEnd} only fits ${rangeCapacity} numbers, but ${orderedPreview.length} participants are selected`);
      return;
    }
    // Build explicit assignments: sequential numbers from rangeStart following
    // the (possibly reordered) preview order.
    const assignments = orderedPreview.map((alloc, idx) => ({
      registration_id: alloc.id,
      allocation_number: rangeStart + idx,
    }));
    try {
      const result = await batchAllocate.mutateAsync({ assignments });
      if (result.skipped > 0) {
        toast.warning(`${result.assigned} assigned, ${result.skipped} skipped. ${result.errors[0] ?? ""}`);
      } else {
        toast.success(`${result.assigned} ${numberLabel.toLowerCase()}s allocated`);
      }
      setShowPreviewDialog(false);
      refetchAllocations();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to allocate numbers");
    }
  };

  const publicNumberListUrl = eventId ? `${window.location.origin}/event/${eventId}/number-list` : "";

  const copyPublicLink = async () => {
    if (!publicNumberListUrl) return;
    try {
      await navigator.clipboard.writeText(publicNumberListUrl);
      toast.success("Public link copied. Only published numbers are visible.");
    } catch {
      toast.error("Could not copy. The public link is: " + publicNumberListUrl);
    }
  };

  const handlePublish = async () => {
    if (!eventId) return;
    try {
      await publishAllocations.mutateAsync({ notify_participants: notifyOnPublish });
      toast.success("Allocations published");
      setShowPublishDialog(false);
      refetchAllocations();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to publish allocations");
    }
  };

  const handleEditAllocation = async () => {
    if (!eventId || !editingRegistration || typeof newNumber !== "number") return;
    try {
      await editAllocation.mutateAsync({
        registrationId: editingRegistration,
        payload: { new_number: newNumber, notify_participant: notifyOnEdit },
      });
      toast.success("Allocation updated");
      setShowEditDialog(false);
      setEditingRegistration(null);
      setNewNumber("");
      refetchAllocations();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update allocation");
    }
  };

  const getStatusVariant = (status: string) => {
    return statusConfig[status]?.variant || "secondary";
  };

  const getStatusLabel = (status: string) => {
    return statusConfig[status]?.label || status;
  };

  if (!event || locked) {
    if (locked) {
      return (
        <OrganizerDashboardLayout eventId={eventId}>
          <div className="mx-auto max-w-3xl px-4 py-20">
            <Card>
              <CardHeader>
                <CardTitle>Bib Management locked</CardTitle>
                <CardDescription>Bib allocation and number management are available for paid events. Free events get only basic registration and participant management.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Upgrade to a paid event to assign bib numbers, jersey numbers, or court/player IDs to participants.
                </p>
                <p className="text-xs text-muted-foreground">
                  Need custom number management features? <a href="mailto:hello@sportpass.in" className="font-medium text-primary hover:underline">Contact SportPass India</a> for custom pricing.
                </p>
                <Button variant="outline" onClick={() => navigate(`/organizer/events/${eventId}`)}>Back to event</Button>
              </CardContent>
            </Card>
          </div>
        </OrganizerDashboardLayout>
      );
    }
    return <OrganizerDashboardLayout eventId={eventId}><div>Loading...</div></OrganizerDashboardLayout>;
  }

  const categories = Array.from(new Set(allocations.map(a => a.category_name).filter(Boolean) as string[]));

  return (
    <OrganizerDashboardLayout eventId={eventId}>
      <div className="mx-auto max-w-[1500px] space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Button variant="ghost" className="mb-2 -ml-3 gap-2 px-3 text-muted-foreground" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" /> Back to event
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-primary">Number allocation</p>
              <BadgeComp variant="outline" className="capitalize">{event.sport?.replaceAll("_", " ")}</BadgeComp>
            </div>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{numberLabel} allocation</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Allocate and manage {numberLabel.toLowerCase()} for participants. Numbers can be edited at any time.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={copyPublicLink}
              disabled={allocations.filter(a => a.allocation_status === "published").length === 0}
              title={allocations.filter(a => a.allocation_status === "published").length === 0 ? "Publish numbers first to share the public link" : "Copy the public list link"}
            >
              <Copy className="h-4 w-4" /> Copy public link
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowPublishDialog(true)}
              disabled={allocations.filter(a => a.allocation_status === "draft").length === 0}
            >
              <Play className="h-4 w-4" /> Publish All Draft
            </Button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Total Participants</CardDescription>
              <CardTitle className="text-2xl">{allocations.length}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-muted-foreground">
                {Object.values(summaryByCategory).reduce((a, b) => a + b.total, 0)} entries
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Unassigned</CardDescription>
              <CardTitle className="text-2xl text-muted-foreground">
                {allocations.filter(a => a.allocation_status === "unassigned").length}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-muted-foreground">
                Need allocation
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Published</CardDescription>
              <CardTitle className="text-2xl text-primary">
                {allocations.filter(a => a.allocation_status === "published").length}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-muted-foreground">
                Visible to participants
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Category summary */}
        <Card>
          <CardHeader>
            <CardTitle>Allocation by Category</CardTitle>
            <CardDescription>Overview of allocation status for each event category</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(summaryByCategory).map(([category, stats]) => (
                <div key={category} className="rounded-lg border p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="font-medium">{category}</h4>
                    <BadgeComp variant="outline">{stats.total} entries</BadgeComp>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Unassigned</span>
                      <BadgeComp variant="secondary">{stats.unassigned}</BadgeComp>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Draft</span>
                      <BadgeComp variant="outline">{stats.draft}</BadgeComp>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Published</span>
                      <BadgeComp>{stats.published}</BadgeComp>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Filter and Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Filter & Batch Actions</CardTitle>
            <CardDescription>Narrow down participants and allocate numbers in batches</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or number..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Status</label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {Object.entries(statusConfig).map(([value, config]) => (
                      <SelectItem key={value} value={value}>{config.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Category</label>
                <Select value={filterCategory} onValueChange={setFilterCategory}>
                  <SelectTrigger>
                    <SelectValue placeholder="All categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {categories.map(cat => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-end sm:gap-6">
              <div className="flex-1 space-y-2">
                <label className="text-sm font-medium">Number Range</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 space-y-1">
                    <span className="text-xs text-muted-foreground">From</span>
                    <Input
                      type="number"
                      value={rangeStart}
                      onChange={(e) => setRangeStart(Number(e.target.value))}
                      min={1}
                    />
                  </div>
                  <div className="flex-1 space-y-1">
                    <span className="text-xs text-muted-foreground">To</span>
                    <Input
                      type="number"
                      value={rangeEnd}
                      onChange={(e) => setRangeEnd(Number(e.target.value))}
                      min={rangeStart}
                    />
                  </div>
                </div>
              </div>
              <Button
                className="w-full sm:w-auto"
                onClick={openPreview}
                disabled={isLoadingAllocations || batchEligible.length === 0}
              >
                <Save className="h-4 w-4" /> Preview Batch ({batchEligible.length})
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Participants Table */}
        <Card>
          <CardHeader>
            <CardTitle>All Participants</CardTitle>
            <CardDescription>
              {filteredAllocations.length} of {allocations.length} participants
              {searchTerm && ` matching "${searchTerm}"`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{numberLabel}</TableHead>
                    <TableHead>Participant</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Registered</TableHead>
                    <TableHead className="w-[100px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAllocations.map((alloc) => (
                    <TableRow key={alloc.id}>
                      <TableCell>
                        {alloc.allocation_number ? (
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold">{alloc.allocation_number}</span>
                            {alloc.allocation_status === "published" && (
                              <BadgeComp variant="outline" className="text-xs">Public</BadgeComp>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground italic">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{alloc.participant_name}</span>
                          <span className="text-xs text-muted-foreground">
                            {alloc.team_name || alloc.participant_email || alloc.participant_phone || "No contact"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{alloc.category_name || "Uncategorized"}</TableCell>
                      <TableCell>
                        <BadgeComp variant={getStatusVariant(alloc.allocation_status)}>
                          {getStatusLabel(alloc.allocation_status)}
                        </BadgeComp>
                      </TableCell>
                      <TableCell>
                        {format(new Date(alloc.created_at), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingRegistration(alloc.id);
                            setNewNumber(alloc.allocation_number || "");
                            setShowEditDialog(true);
                          }}
                        >
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredAllocations.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        No participants found matching your filters
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Preview Dialog */}
      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Batch Allocation Preview</DialogTitle>
            <DialogDescription>
              {orderedPreview.length} participant{orderedPreview.length === 1 ? "" : "s"}
              {filterCategory !== "all" && ` in "${filterCategory}"`} will get {numberLabel.toLowerCase()}s
              {" "}from range <span className="font-mono font-semibold">{rangeStart}</span> onwards.
              Reorder rows to change who gets which number.
            </DialogDescription>
          </DialogHeader>

          {rangeInsufficient && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                The range {rangeStart}–{rangeEnd} only fits {rangeCapacity} number{rangeCapacity === 1 ? "" : "s"},
                but {orderedPreview.length} participants are selected. Widen the range or reduce the batch.
              </span>
            </div>
          )}

          <div className="max-h-[400px] overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[70px]">Order</TableHead>
                  <TableHead>Participant</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="w-[110px]">{numberLabel}</TableHead>
                  <TableHead className="w-[90px] text-right">Reorder</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderedPreview.map((alloc, idx) => {
                  const assignedNumber = rangeStart + idx;
                  const overCapacity = assignedNumber > rangeEnd;
                  return (
                    <TableRow key={alloc.id}>
                      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{alloc.participant_name}</span>
                          <span className="text-xs text-muted-foreground">{alloc.team_name || alloc.registration_reference}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{alloc.category_name || "Uncategorized"}</TableCell>
                      <TableCell className={`font-mono font-semibold ${overCapacity ? "text-destructive" : ""}`}>{assignedNumber}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={idx === 0} onClick={() => movePreviewRow(idx, -1)}>
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={idx === orderedPreview.length - 1} onClick={() => movePreviewRow(idx, 1)}>
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPreviewDialog(false)}>Cancel</Button>
            <Button onClick={handleBatchAllocate} disabled={batchAllocate.isPending || rangeInsufficient}>
              {batchAllocate.isPending ? "Allocating..." : `Allocate ${orderedPreview.length} ${numberLabel}s`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Publish Dialog */}
      <Dialog open={showPublishDialog} onOpenChange={setShowPublishDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish {numberLabel}s</DialogTitle>
            <DialogDescription>
              Publish all draft {numberLabel.toLowerCase()}s? This will make them visible to participants.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border p-4">
            <div className="space-y-2">
              <p className="text-sm">
                <strong>{allocations.filter(a => a.allocation_status === "draft").length}</strong> allocations in draft status
              </p>
              <p className="text-sm">
                <strong>{allocations.filter(a => a.allocation_status === "published").length}</strong> already published
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2 rounded-lg border p-3">
            <input
              id="notify-publish"
              type="checkbox"
              checked={notifyOnPublish}
              onChange={(e) => setNotifyOnPublish(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="notify-publish" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Send notification to participants
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPublishDialog(false)}>Cancel</Button>
            <Button onClick={handlePublish} disabled={publishAllocations.isPending}>
              {publishAllocations.isPending ? "Publishing..." : "Publish All Draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {numberLabel}</DialogTitle>
            <DialogDescription>
              Update the {numberLabel.toLowerCase()} for this participant
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium">{allocations.find(a => a.id === editingRegistration)?.participant_name}</p>
              <p className="text-xs text-muted-foreground">{allocations.find(a => a.id === editingRegistration)?.category_name}</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">New {numberLabel}</label>
              <Input
                type="number"
                value={newNumber}
                onChange={(e) => setNewNumber(Number(e.target.value))}
                placeholder={`Enter new ${numberLabel.toLowerCase()}...`}
              />
            </div>
            <div className="flex items-center space-x-2 rounded-lg border p-3">
              <input
                id="notify-edit"
                type="checkbox"
                checked={notifyOnEdit}
                onChange={(e) => setNotifyOnEdit(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <label htmlFor="notify-edit" className="text-sm font-medium leading-none">
                Notify participant of this change
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
            <Button onClick={handleEditAllocation} disabled={editAllocation.isPending || !newNumber}>
              {editAllocation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </OrganizerDashboardLayout>
  );
};

export default OrganizerEventAllocations;
