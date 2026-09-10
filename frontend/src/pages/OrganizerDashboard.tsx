import { Layout } from "@/components/Layout";
import { StatCard } from "@/components/StatCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, DollarSign, Users, TrendingUp, Plus, MoreHorizontal, ClipboardList } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEvents } from "@/hooks/useEvents";

const OrganizerDashboard = () => {
  const navigate = useNavigate();
  const { data: events = [], isLoading, isError } = useEvents();
  const totalRevenue = events.reduce((sum, e) => sum + e.participants * (e.tiers[0]?.price ?? 0), 0);
  const totalParticipants = events.reduce((s, e) => s + e.participants, 0);

  return (
    <Layout>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Organizer Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage your events and track performance</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => navigate("/organizer/registrations")}>
              <ClipboardList className="h-4 w-4" /> Registrations
            </Button>
            <Button className="gap-2" onClick={() => navigate("/organizer/events/new")}>
              <Plus className="h-4 w-4" /> New Event
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard icon={Calendar} label="Active Events" value={String(events.length)} change="+1 this month" />
          <StatCard icon={Users} label="Total Registrations" value={totalParticipants.toLocaleString()} change="+12% vs last month" />
          <StatCard icon={DollarSign} label="Total Revenue" value={`€${(totalRevenue / 1000).toFixed(0)}K`} change="+18% vs last month" />
          <StatCard icon={TrendingUp} label="Avg. Fill Rate" value="68%" change="+5% vs last month" />
        </div>

        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="p-5 border-b">
            <h2 className="font-bold">Your Events</h2>
          </div>
          <div className="divide-y">
            {isLoading ? (
              <div className="p-5 text-sm text-muted-foreground">Loading events…</div>
            ) : isError ? (
              <div className="p-5 text-sm text-muted-foreground">Failed to load events.</div>
            ) : (
              events.map((event) => {
                const fill = Math.round((event.participants / event.maxParticipants) * 100);
                return (
                  <div key={event.id} className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <img
                      src={event.image}
                      alt={event.title}
                      className="rounded-lg w-full sm:w-24 h-16 object-cover"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{event.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(event.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {event.location}
                      </p>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <div className="text-center">
                        <p className="font-semibold">{event.participants.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Registered</p>
                      </div>
                      <div className="text-center">
                        <p className="font-semibold">{fill}%</p>
                        <p className="text-xs text-muted-foreground">Fill Rate</p>
                      </div>
                      <Badge variant={fill > 80 ? "default" : "secondary"}>{fill > 80 ? "Hot" : "Open"}</Badge>
                    </div>
                    <Button variant="ghost" size="icon">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default OrganizerDashboard;
