import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, CalendarIcon, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/api";
import { cn } from "@/lib/utils";

interface TicketForm {
  id: string;
  name: string;
  price: string;
  quantity: string;
}

interface CategoryForm {
  id: string;
  name: string;
  distance: string;
  tickets: TicketForm[];
}

const sports = ["running", "cycling"];

const newTicket = (): TicketForm => ({ id: crypto.randomUUID(), name: "", price: "", quantity: "" });
const newCategory = (): CategoryForm => ({ id: crypto.randomUUID(), name: "", distance: "", tickets: [newTicket()] });

const OrganizerEventCreate = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [organizationId, setOrganizationId] = useState("");
  const [eventName, setEventName] = useState("");
  const [description, setDescription] = useState("");
  const [sport, setSport] = useState("");
  const [location, setLocation] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [eventDate, setEventDate] = useState<Date>();
  const [maxParticipants, setMaxParticipants] = useState("1000");
  const [upiId, setUpiId] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [paymentInstructions, setPaymentInstructions] = useState("Pay the exact amount using UPI, then submit your UTR/reference.");
  const [qrImageFile, setQrImageFile] = useState<File | null>(null);
  const [categories, setCategories] = useState<CategoryForm[]>([newCategory()]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    apiRequest<Array<{ id: string }>>("/organizer/organizations")
      .then((organizations) => setOrganizationId(organizations[0]?.id ?? ""))
      .catch(() => undefined);
  }, []);

  const updateCategory = (id: string, field: "name" | "distance", value: string) => {
    setCategories((current) => current.map((category) => category.id === id ? { ...category, [field]: value } : category));
  };

  const addCategory = () => setCategories((current) => [...current, newCategory()]);
  const removeCategory = (id: string) => {
    if (categories.length > 1) setCategories((current) => current.filter((category) => category.id !== id));
  };

  const updateTicket = (categoryId: string, ticketId: string, field: "name" | "price" | "quantity", value: string) => {
    setCategories((current) => current.map((category) => category.id !== categoryId ? category : {
      ...category,
      tickets: category.tickets.map((ticket) => ticket.id === ticketId ? { ...ticket, [field]: value } : ticket),
    }));
  };

  const addTicket = (categoryId: string) => {
    setCategories((current) => current.map((category) => category.id === categoryId ? { ...category, tickets: [...category.tickets, newTicket()] } : category));
  };

  const removeTicket = (categoryId: string, ticketId: string) => {
    setCategories((current) => current.map((category) => category.id !== categoryId || category.tickets.length <= 1 ? category : {
      ...category,
      tickets: category.tickets.filter((ticket) => ticket.id !== ticketId),
    }));
  };

  const saveEvent = async (publish: boolean) => {
    if (!organizationId || !eventName || !description || !sport || !location || !eventDate || !upiId || !payeeName) {
      toast.error("Complete event, organizer, and UPI fields first.");
      return;
    }
    if (categories.some((category) => !category.name || !category.distance || category.tickets.some((ticket) => !ticket.name || !ticket.price || !ticket.quantity))) {
      toast.error("Complete every race category and ticket field.");
      return;
    }

    setIsSaving(true);
    try {
      const created = await apiRequest<{ id: string }>("/organizer/events", {
        method: "POST",
        body: JSON.stringify({
          organization_id: organizationId,
          name: eventName,
          description,
          sport,
          event_date: eventDate.toISOString().slice(0, 10),
          location_name: location,
          city: city || null,
          state: state || null,
          country: "India",
          max_participants: Number(maxParticipants),
          rules: [],
          categories: categories.map((category) => ({
            name: category.name,
            distance: category.distance,
            tickets: category.tickets.map((ticket) => ({
              name: ticket.name,
              price_rupees: Number(ticket.price),
              quantity: Number(ticket.quantity),
              max_per_user: 1,
            })),
          })),
        }),
      });

      await apiRequest(`/organizer/events/${created.id}/payment-settings`, {
        method: "PUT",
        body: JSON.stringify({ upi_id: upiId, payee_name: payeeName, instructions: paymentInstructions }),
      });
      if (qrImageFile) {
        const formData = new FormData();
        formData.append("file", qrImageFile);
        await apiRequest(`/organizer/events/${created.id}/payment-settings/qr`, { method: "POST", body: formData });
      }
      if (publish) await apiRequest(`/organizer/events/${created.id}/publish`, { method: "POST", body: "{}" });
      await queryClient.invalidateQueries({ queryKey: ["events"] });
      toast.success(publish ? "Event published successfully." : "Event saved as draft.");
      navigate("/organizer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save event");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Layout>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/organizer")}><ArrowLeft className="h-4 w-4" /></Button>
          <div><h1 className="text-2xl font-extrabold tracking-tight">Create Event</h1><p className="mt-1 text-sm text-muted-foreground">Set up your race, tickets, and manual UPI payment details.</p></div>
        </div>

        <div className="space-y-8">
          <section className="space-y-5 rounded-xl border bg-card p-6">
            <h2 className="text-lg font-bold">Event Information</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2"><Label>Event name *</Label><Input value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="e.g. Bengaluru Monsoon 10K" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Description *</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Tell runners what makes this race special." /></div>
              <div className="space-y-2"><Label>Sport *</Label><Select value={sport} onValueChange={setSport}><SelectTrigger><SelectValue placeholder="Choose sport" /></SelectTrigger><SelectContent>{sports.map((item) => <SelectItem key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Maximum participants *</Label><Input type="number" min="1" value={maxParticipants} onChange={(e) => setMaxParticipants(e.target.value)} /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Location *</Label><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Race venue and city" /></div>
              <div className="space-y-2"><Label>City</Label><Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Bengaluru" /></div>
              <div className="space-y-2"><Label>State</Label><Input value={state} onChange={(e) => setState(e.target.value)} placeholder="Karnataka" /></div>
              <div className="space-y-2"><Label>Event date *</Label><Popover><PopoverTrigger asChild><Button variant="outline" className={cn("w-full justify-start text-left font-normal", !eventDate && "text-muted-foreground")}><CalendarIcon className="mr-2 h-4 w-4" />{eventDate ? format(eventDate, "PPP") : "Pick a date"}</Button></PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={eventDate} onSelect={setEventDate} disabled={(date) => date < new Date()} initialFocus /></PopoverContent></Popover></div>
            </div>
          </section>

          <section className="space-y-5 rounded-xl border bg-card p-6">
            <div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">Race Categories and Tickets</h2><p className="text-sm text-muted-foreground">A single event can have 5K, 10K, cycling, or other categories.</p></div><Button variant="outline" size="sm" onClick={addCategory}><Plus className="mr-1 h-4 w-4" /> Category</Button></div>
            {categories.map((category, categoryIndex) => <div key={category.id} className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center justify-between"><p className="font-semibold">Category #{categoryIndex + 1}</p>{categories.length > 1 && <Button variant="ghost" size="icon" className="text-destructive" onClick={() => removeCategory(category.id)}><Trash2 className="h-4 w-4" /></Button>}</div>
              <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Category name *</Label><Input value={category.name} onChange={(e) => updateCategory(category.id, "name", e.target.value)} placeholder="10K Open" /></div><div className="space-y-2"><Label>Distance *</Label><Input value={category.distance} onChange={(e) => updateCategory(category.id, "distance", e.target.value)} placeholder="10 km" /></div></div>
              {category.tickets.map((ticket, ticketIndex) => <div key={ticket.id} className="space-y-3 rounded-md bg-muted/40 p-4"><div className="flex items-center justify-between"><p className="text-sm font-medium">Ticket #{ticketIndex + 1}</p>{category.tickets.length > 1 && <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeTicket(category.id, ticket.id)}><Trash2 className="h-3.5 w-3.5" /></Button>}</div><div className="grid gap-3 sm:grid-cols-3"><div className="space-y-1"><Label className="text-xs">Name *</Label><Input value={ticket.name} onChange={(e) => updateTicket(category.id, ticket.id, "name", e.target.value)} placeholder="Early Bird" /></div><div className="space-y-1"><Label className="text-xs">Price (₹) *</Label><Input type="number" min="1" step="0.01" value={ticket.price} onChange={(e) => updateTicket(category.id, ticket.id, "price", e.target.value)} placeholder="499" /></div><div className="space-y-1"><Label className="text-xs">Places *</Label><Input type="number" min="1" value={ticket.quantity} onChange={(e) => updateTicket(category.id, ticket.id, "quantity", e.target.value)} placeholder="100" /></div></div></div>)}
              <Button variant="outline" size="sm" onClick={() => addTicket(category.id)}><Plus className="mr-1 h-4 w-4" /> Ticket tier</Button>
            </div>)}
          </section>

          <section className="space-y-5 rounded-xl border bg-card p-6">
            <div><h2 className="text-lg font-bold">Manual UPI Payment</h2><p className="text-sm text-muted-foreground">Runners pay you directly. RacePass will record the UTR and let you approve the registration.</p></div>
            <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>UPI ID *</Label><Input value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="yourname@upi" /></div><div className="space-y-2"><Label>Payee name *</Label><Input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} placeholder="Your club or organization" /></div><div className="space-y-2 sm:col-span-2"><Label>Payment instructions *</Label><Textarea value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} /></div><div className="space-y-2 sm:col-span-2"><Label htmlFor="qr-image">Organizer QR image (optional)</Label><Input id="qr-image" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setQrImageFile(event.target.files?.[0] ?? null)} /><p className="text-xs text-muted-foreground">Upload a private PNG, JPEG, or WebP QR image. RacePass also generates a QR from the UPI ID.</p></div></div>
          </section>

          <div className="flex flex-wrap justify-end gap-3"><Button variant="outline" size="lg" onClick={() => saveEvent(false)} disabled={isSaving}><Save className="mr-2 h-4 w-4" /> Save draft</Button><Button size="lg" onClick={() => saveEvent(true)} disabled={isSaving}><Save className="mr-2 h-4 w-4" /> {isSaving ? "Saving..." : "Publish event"}</Button></div>
        </div>
      </div>
    </Layout>
  );
};

export default OrganizerEventCreate;
