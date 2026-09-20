import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, GripVertical, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/api";
import { useFreeEventLock } from "@/hooks/useFreeEventLock";

interface Checkpoint { id: string; eventId: string; name: string; position: number; }
interface SuggestedAddon { addonId: string; name: string; }
interface CheckpointResponse { eventId: string; eventName: string; checkpoints: Checkpoint[]; suggestedAddons: SuggestedAddon[]; }

const OrganizerEventCheckpoints = () => {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { locked } = useFreeEventLock(eventId);
  const [eventName, setEventName] = useState("");
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestedAddon[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const activeEventIdRef = useRef<string | undefined>(eventId);
  const loadVersionRef = useRef(0);
  activeEventIdRef.current = eventId;

  const load = useCallback(async () => {
    const requestedEventId = eventId;
    if (!requestedEventId) {
      ++loadVersionRef.current;
      setEventName("");
      setCheckpoints([]);
      setSuggestions([]);
      setName("");
      setLoading(false);
      return;
    }
    if (activeEventIdRef.current !== requestedEventId) return;
    const loadVersion = ++loadVersionRef.current;
    setLoading(true);
    setEventName("");
    setCheckpoints([]);
    setSuggestions([]);
    setName("");
    try {
      const response = await apiRequest<CheckpointResponse>(`/organizer/events/${requestedEventId}/checkpoints`);
      if (loadVersion !== loadVersionRef.current || activeEventIdRef.current !== requestedEventId) return;
      if (response.eventId !== requestedEventId) {
        toast.error("Checkpoint data did not match the selected event.");
        return;
      }
      setEventName(response.eventName);
      setCheckpoints(response.checkpoints.filter((checkpoint) => checkpoint.eventId === requestedEventId));
      setSuggestions(response.suggestedAddons);
    } catch (error) {
      if (loadVersion === loadVersionRef.current && activeEventIdRef.current === requestedEventId) {
        toast.error(error instanceof Error ? error.message : "Could not load checkpoints");
      }
    } finally {
      if (loadVersion === loadVersionRef.current && activeEventIdRef.current === requestedEventId) setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  const addCheckpoint = async (checkpointName: string, addonId?: string) => {
    const normalized = checkpointName.trim();
    if (!normalized || !eventId) return;
    setSaving(true);
    try {
      await apiRequest(`/organizer/events/${eventId}/checkpoints`, {
        method: "POST",
        body: JSON.stringify({ name: normalized, position: checkpoints.length + 1, ...(addonId ? { addon_id: addonId } : {}) }),
      });
      setName("");
      await load();
      toast.success(`${normalized} checkpoint added.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add checkpoint");
    } finally { setSaving(false); }
  };

  const updateCheckpoint = async (checkpoint: Checkpoint) => {
    if (!eventId || !checkpoint.name.trim()) return;
    setSaving(true);
    try {
      await apiRequest(`/organizer/events/${eventId}/checkpoints/${checkpoint.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: checkpoint.name.trim(), position: checkpoint.position }),
      });
      await load();
      toast.success("Checkpoint updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update checkpoint");
    } finally { setSaving(false); }
  };

  const deleteCheckpoint = async (checkpoint: Checkpoint) => {
    if (!eventId || !window.confirm(`Delete ${checkpoint.name}? Checkpoints with scans cannot be deleted.`)) return;
    setSaving(true);
    try {
      await apiRequest(`/organizer/events/${eventId}/checkpoints/${checkpoint.id}`, { method: "DELETE" });
      await load();
      toast.success("Checkpoint deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete checkpoint");
    } finally { setSaving(false); }
  };

  if (locked) {
    return (
      <OrganizerDashboardLayout eventId={eventId}>
        <div className="mx-auto max-w-3xl px-4 py-20">
          <Card>
            <CardHeader>
              <CardTitle>Checkpoints locked</CardTitle>
              <CardDescription>Checkpoints and QR scanning are available for paid events. Free events get only basic registration and participant management.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Upgrade to a paid event to set up event stations and track participant check-ins.
              </p>
              <p className="text-xs text-muted-foreground">
                Need custom check-in features? <a href="mailto:hello@sportpass.in" className="font-medium text-primary hover:underline">Contact SportPass India</a> for custom pricing.
              </p>
              <Button variant="outline" onClick={() => navigate(`/organizer/events/${eventId}`)}>Back to event</Button>
            </CardContent>
          </Card>
        </div>
      </OrganizerDashboardLayout>
    );
  }

  return (
    <OrganizerDashboardLayout eventId={eventId}>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/organizer/events/${eventId}`)} aria-label="Back to event dashboard"><ArrowLeft className="h-4 w-4" /></Button>
          <div><h1 className="text-2xl font-extrabold tracking-tight">Checkpoints</h1><p className="text-sm text-muted-foreground">Configure the physical stations for {eventName || "this event"}. The same participant QR works at every station.</p></div>
        </div>

        <Card>
          <CardHeader><CardTitle>Add a checkpoint</CardTitle><CardDescription>Use a descriptive station name and arrange checkpoints in the order participants encounter them.</CardDescription></CardHeader>
          <CardContent>
            <form className="flex flex-col gap-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void addCheckpoint(name); }}>
              <div className="flex-1 space-y-2"><Label htmlFor="checkpoint-name">Checkpoint name</Label><Input id="checkpoint-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Breakfast" maxLength={160} /></div>
              <Button type="submit" className="mt-auto gap-2" disabled={saving || !name.trim()}><Plus className="h-4 w-4" />Add checkpoint</Button>
            </form>
          </CardContent>
        </Card>

        {suggestions.length > 0 && <Card className="border-primary/30 bg-primary/5"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-primary" />Suggested from add-ons</CardTitle><CardDescription>Add-ons and checkpoints remain separate: these suggestions only save typing when a purchased item has a matching physical station.</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2">{suggestions.map((suggestion) => <Button key={suggestion.addonId} variant="outline" size="sm" onClick={() => void addCheckpoint(suggestion.name, suggestion.addonId)} disabled={saving}><Plus className="mr-1 h-3 w-3" />{suggestion.name}</Button>)}</CardContent></Card>}

        <Card><CardHeader><CardTitle>Configured checkpoints</CardTitle><CardDescription>{checkpoints.length} checkpoint{checkpoints.length === 1 ? "" : "s"}. Scanned checkpoints are protected from deletion so the audit trail stays intact.</CardDescription></CardHeader><CardContent>{loading ? <p className="py-6 text-center text-sm text-muted-foreground">Loading checkpoints…</p> : checkpoints.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No checkpoints configured.</p> : <div className="space-y-3">{checkpoints.map((checkpoint) => <div key={checkpoint.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-end"><GripVertical className="hidden h-5 w-5 text-muted-foreground sm:block" /><div className="w-20 space-y-2"><Label htmlFor={`position-${checkpoint.id}`}>Order</Label><Input id={`position-${checkpoint.id}`} type="number" min={1} value={checkpoint.position} onChange={(event) => setCheckpoints((current) => current.map((item) => item.id === checkpoint.id ? { ...item, position: Number(event.target.value) } : item))} /></div><div className="flex-1 space-y-2"><Label htmlFor={`name-${checkpoint.id}`}>Name</Label><Input id={`name-${checkpoint.id}`} value={checkpoint.name} onChange={(event) => setCheckpoints((current) => current.map((item) => item.id === checkpoint.id ? { ...item, name: event.target.value } : item))} maxLength={160} /></div><div className="flex gap-2"><Button variant="outline" className="gap-2" onClick={() => void updateCheckpoint(checkpoint)} disabled={saving}><Save className="h-4 w-4" />Save</Button><Button variant="ghost" className="gap-2 text-destructive hover:text-destructive" onClick={() => void deleteCheckpoint(checkpoint)} disabled={saving}><Trash2 className="h-4 w-4" />Delete</Button></div></div>)}</div>}</CardContent></Card>
      </div>
    </OrganizerDashboardLayout>
  );
};

export default OrganizerEventCheckpoints;
