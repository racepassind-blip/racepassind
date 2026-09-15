import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AuthProvider } from "@/contexts/AuthContext";
import Index from "./pages/Index";
import Login from "./pages/Login";
import EventDetail from "./pages/EventDetail";
import PublicEventResults from "./pages/PublicEventResults";
import Checkout from "./pages/Checkout";
import Dashboard from "./pages/Dashboard";
import DashboardUpcoming from "./pages/DashboardUpcoming";
import DashboardPast from "./pages/DashboardPast";
import DashboardProfile from "./pages/DashboardProfile";
import ParticipantRegistrations from "./pages/ParticipantRegistrations";
import OrganizerInfo from "./pages/OrganizerInfo";
import OrganizerDashboard from "./pages/OrganizerDashboard";
import OrganizerCheckin from "./pages/OrganizerCheckin";
import OrganizerRegistrations from "./pages/OrganizerRegistrations";
import OrganizerEventCreate from "./pages/OrganizerEventCreate";
import OrganizerEventDashboard from "./pages/OrganizerEventDashboard";
import OrganizerEventCheckpoints from "./pages/OrganizerEventCheckpoints";
import OrganizerCheckinMatrix from "./pages/OrganizerCheckinMatrix";
import OrganizerManualParticipant from "./pages/OrganizerManualParticipant";
import OrganizerEventCommunications from "./pages/OrganizerEventCommunications";
import OrganizerEventTournament from "./pages/OrganizerEventTournament";
import OrganizerEventTournamentMatches from "./pages/OrganizerEventTournamentMatches";
import OrganizerEventTournamentScoring from "./pages/OrganizerEventTournamentScoring";
import OrganizerEventTournamentResults from "./pages/OrganizerEventTournamentResults";
import OrganizerEventTournamentBracket from "./pages/OrganizerEventTournamentBracket";
import OrganizerPricing from "./pages/OrganizerPricing";
import FederationsAssociationsComingSoon from "./pages/FederationsAssociationsComingSoon";
import OrganizerSetup from "./pages/OrganizerSetup";
import AdminDashboard from "./pages/AdminDashboard";
import AdminEventRecovery from "./pages/AdminEventRecovery";
import AdminOrganizerFees from "./pages/AdminOrganizerFees";
import AdminPlans from "./pages/AdminPlans";
import AdminBilling from "./pages/AdminBilling";
import AdminOrganizerApplications from "./pages/AdminOrganizerApplications";
import Signup from "./pages/Signup";
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
            <Route path="/signup" element={<Signup />} />
            <Route path="/organizers" element={<OrganizerInfo />} />
            <Route path="/federations-associations" element={<FederationsAssociationsComingSoon />} />
            <Route path="/event/:id" element={<EventDetail />} />
            <Route path="/event/:id/results" element={<PublicEventResults />} />
            <Route path="/checkout/:eventId" element={<Checkout />} />
            <Route path="/checkout/:eventId/:tierId" element={<Checkout />} />
            <Route path="/confirmation" element={<Confirmation />} />

            {/* Participant routes */}
            <Route path="/dashboard" element={<ProtectedRoute allowedRoles={["participant", "user"]}><Dashboard /></ProtectedRoute>} />
            <Route path="/dashboard/registrations" element={<ProtectedRoute allowedRoles={["participant", "user"]}><ParticipantRegistrations /></ProtectedRoute>} />
            <Route path="/dashboard/upcoming" element={<ProtectedRoute allowedRoles={["participant", "user"]}><DashboardUpcoming /></ProtectedRoute>} />
            <Route path="/dashboard/past" element={<ProtectedRoute allowedRoles={["participant", "user"]}><DashboardPast /></ProtectedRoute>} />
            <Route path="/dashboard/profile" element={<ProtectedRoute allowedRoles={["participant", "user"]}><DashboardProfile /></ProtectedRoute>} />

            {/* Admin routes */}
            <Route path="/admin" element={<ProtectedRoute allowedRoles={["admin"]}><AdminDashboard /></ProtectedRoute>} />
            <Route path="/admin/events" element={<ProtectedRoute allowedRoles={["admin"]}><AdminEventRecovery /></ProtectedRoute>} />
            <Route path="/admin/organizer-fees" element={<ProtectedRoute allowedRoles={["admin"]}><AdminOrganizerFees /></ProtectedRoute>} />
            <Route path="/admin/plans" element={<ProtectedRoute allowedRoles={["admin"]}><AdminPlans /></ProtectedRoute>} />
            <Route path="/admin/billing" element={<ProtectedRoute allowedRoles={["admin"]}><AdminBilling /></ProtectedRoute>} />
            <Route path="/admin/organizer-applications" element={<ProtectedRoute allowedRoles={["admin"]}><AdminOrganizerApplications /></ProtectedRoute>} />

            {/* Admin/Organizer routes */}
            <Route path="/organizer" element={<ProtectedRoute allowedRoles={["admin", "organizer"]}><OrganizerDashboard /></ProtectedRoute>} />
            <Route path="/organizer/check-in" element={<ProtectedRoute allowedRoles={["admin", "organizer"]}><OrganizerCheckin /></ProtectedRoute>} />
            <Route path="/organizer/registrations" element={<ProtectedRoute allowedRoles={["admin", "organizer"]}><OrganizerRegistrations /></ProtectedRoute>} />
            <Route path="/organizer/events/new" element={<ProtectedRoute allowedRoles={["admin", "organizer"]}><OrganizerEventCreate /></ProtectedRoute>} />
            <Route path="/organizer/events/:eventId/edit" element={<ProtectedRoute allowedRoles={["admin", "organizer"]}><OrganizerEventCreate /></ProtectedRoute>} />
            <Route path="/organizer/events/:eventId/checkpoints" element={<ProtectedRoute allowedRoles={["admin", "organizer"]}><OrganizerEventCheckpoints /></ProtectedRoute>} />
            <Route path="/organizer/events/:eventId/check-in" element={<ProtectedRoute allowedRoles={["admin", "organizer"]}><OrganizerCheckinMatrix /></ProtectedRoute>} />
            <Route path="/organizer/events/:eventId/communications" element={<ProtectedRoute allowedRoles={["admin", "organizer"]}><OrganizerEventCommunications /></ProtectedRoute>} />
            <Route path="/organizer/events/:eventId/participants/new" element={<ProtectedRoute allowedRoles={["admin", "organizer"]}><OrganizerManualParticipant /></ProtectedRoute>} />
            <Route path="/organizer/events/:eventId/tournament" element={<ProtectedRoute allowedRoles={["admin", "organizer"]}><OrganizerEventTournament /></ProtectedRoute>} />
            <Route path="/organizer/events/:eventId/tournament/matches" element={<ProtectedRoute allowedRoles={["admin", "organizer"]}><OrganizerEventTournamentMatches /></ProtectedRoute>} />
            <Route path="/organizer/events/:eventId/tournament/scoring" element={<ProtectedRoute allowedRoles={["admin", "organizer"]}><OrganizerEventTournamentScoring /></ProtectedRoute>} />
            <Route path="/organizer/events/:eventId/tournament/results" element={<ProtectedRoute allowedRoles={["admin", "organizer"]}><OrganizerEventTournamentResults /></ProtectedRoute>} />
            <Route path="/organizer/events/:eventId/tournament/bracket" element={<ProtectedRoute allowedRoles={["admin", "organizer"]}><OrganizerEventTournamentBracket /></ProtectedRoute>} />
            <Route path="/organizer/events/:eventId" element={<ProtectedRoute allowedRoles={["admin", "organizer"]}><OrganizerEventDashboard /></ProtectedRoute>} />
            <Route path="/organizer/pricing" element={<ProtectedRoute allowedRoles={["admin", "organizer"]}><OrganizerPricing /></ProtectedRoute>} />
            <Route path="/organizer/setup" element={<ProtectedRoute allowedRoles={["admin", "organizer"]}><OrganizerSetup /></ProtectedRoute>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
