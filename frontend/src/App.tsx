import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import Login from "./pages/Login";
import EventDetail from "./pages/EventDetail";
import Checkout from "./pages/Checkout";
import Dashboard from "./pages/Dashboard";
import DashboardUpcoming from "./pages/DashboardUpcoming";
import DashboardPast from "./pages/DashboardPast";
import DashboardProfile from "./pages/DashboardProfile";
import ParticipantRegistrations from "./pages/ParticipantRegistrations";
import OrganizerDashboard from "./pages/OrganizerDashboard";
import OrganizerCheckin from "./pages/OrganizerCheckin";
import OrganizerRegistrations from "./pages/OrganizerRegistrations";
import OrganizerEventCreate from "./pages/OrganizerEventCreate";
import AdminOrganizerFees from "./pages/AdminOrganizerFees";
import Confirmation from "./pages/Confirmation";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/login" element={<Login />} />
            <Route path="/event/:id" element={<EventDetail />} />
            <Route path="/checkout/:eventId/:tierId" element={<Checkout />} />
            <Route path="/confirmation" element={<Confirmation />} />

            {/* Participant routes */}
            <Route path="/dashboard" element={<ProtectedRoute allowedRoles={["participant", "user"]}><Dashboard /></ProtectedRoute>} />
            <Route path="/dashboard/registrations" element={<ProtectedRoute allowedRoles={["participant", "user"]}><ParticipantRegistrations /></ProtectedRoute>} />
            <Route path="/dashboard/upcoming" element={<ProtectedRoute allowedRoles={["participant", "user"]}><DashboardUpcoming /></ProtectedRoute>} />
            <Route path="/dashboard/past" element={<ProtectedRoute allowedRoles={["participant", "user"]}><DashboardPast /></ProtectedRoute>} />
            <Route path="/dashboard/profile" element={<ProtectedRoute allowedRoles={["participant", "user"]}><DashboardProfile /></ProtectedRoute>} />

            {/* Admin routes */}
            <Route path="/admin/organizer-fees" element={<ProtectedRoute allowedRoles={["admin"]}><AdminOrganizerFees /></ProtectedRoute>} />

            {/* Admin/Organizer routes */}
            <Route path="/organizer" element={<ProtectedRoute allowedRoles={["admin", "organizer"]}><OrganizerDashboard /></ProtectedRoute>} />
            <Route path="/organizer/check-in" element={<ProtectedRoute allowedRoles={["admin", "organizer"]}><OrganizerCheckin /></ProtectedRoute>} />
            <Route path="/organizer/registrations" element={<ProtectedRoute allowedRoles={["admin", "organizer"]}><OrganizerRegistrations /></ProtectedRoute>} />
            <Route path="/organizer/events/new" element={<ProtectedRoute allowedRoles={["admin", "organizer"]}><OrganizerEventCreate /></ProtectedRoute>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
