import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PasswordRecoveryRedirect } from "@/components/PasswordRecoveryRedirect";
import DashboardLayout from "@/components/DashboardLayout";
import Index from "./pages/Index";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import AcceptInvite from "./pages/AcceptInvite";
import { DashboardLanding } from './components/DashboardLanding';
import Home from "./pages/Home";
import PurchasedLeads from "./pages/PurchasedLeads";
import ServiceAreas from "./pages/ServiceAreas";
import Profile from "./pages/Profile";
import NotFound from "./pages/NotFound";
import Install from "./pages/Install";
import GetApp from "./pages/GetApp";
import ScoutGuide from "./pages/ScoutGuide";
import Pricing from "./pages/Pricing";
import Plans from "./pages/Plans";
import Apply from "./pages/Apply";
import Marketing from "./pages/Marketing";
import DMA from "./pages/DMA";
import GoogleReviews from "./pages/GoogleReviews";
import FrequentlyWrongedAssumptions from "./pages/FrequentlyWrongedAssumptions";
import AdminRefunds from "./pages/AdminRefunds";
import AdminContractors from "./pages/AdminContractors";
import AdminContractorDetail from "./pages/AdminContractorDetail";
import LSALeads from "./pages/LSALeads";
import LSASettings from "./pages/LSASettings";
import InstantEstimator from "./pages/InstantEstimator";
import ScoutInbox from "./pages/ScoutInbox";
import ScoutRates from "./pages/ScoutRates";
import Team from "./pages/Team";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import Support from "./pages/Support";
import StartTrial from "./pages/StartTrial";
import StartTrialSuccess from "./pages/StartTrialSuccess";
import Register from "./pages/Register";
import AppReviewDiagnostics from "./pages/AppReviewDiagnostics";
import NotificationSettings from "./pages/NotificationSettings";
import MobileUnlock from "./pages/MobileUnlock";
import LeadUnlockedReturn from "./pages/LeadUnlockedReturn";
import JobberIntegration from "./pages/JobberIntegration";
import SafeModeInfo from "./pages/SafeModeInfo";
import CrewNetwork from "./pages/CrewNetwork";
import BidBoard from "./pages/BidBoard";
import ScoutStart from "./pages/ScoutStart";
import SettingsAdmin from "./pages/SettingsAdmin";
import ProductionSetup from "./pages/ProductionSetup";
import ProductionEstimate from "./pages/ProductionEstimate";
import ProductionJobs from "./pages/ProductionJobs";
import AdminReviewReports from "./pages/AdminReviewReports";
import { ScoutRequiredGate, CrewMembershipGate } from "./components/PaidFeatureGate";
import CrewBids from "./pages/CrewBids";
import PayWeek from "./pages/PayWeek";
import GroundHours from "./pages/GroundHours";
import CrewAvailability from "./pages/CrewAvailability";
import CrewJoin from "./pages/CrewJoin";
import CrewInstall from "./pages/CrewInstall";
import Onboarding from "./pages/Onboarding";
import StorePlans from "./pages/StorePlans";
import HowWeWork from "./pages/HowWeWork";
import LeadsHub from "./pages/LeadsHub";
import AdminSignupSandbox from "./pages/AdminSignupSandbox";
import AdminGiveaway from "./pages/AdminGiveaway";
import Giveaway from "./pages/Giveaway";
import GiveawayRules from "./pages/GiveawayRules";
import PulseSetup from "./pages/PulseSetup";
import PulseOAuthReturn from "./pages/PulseOAuthReturn";
import PulseTransactions from "./pages/PulseTransactions";
import PulseAdmin from "./pages/PulseAdmin";
import PulseHome from "./pages/PulseHome";
import { GlobalErrorReporter } from "./components/GlobalErrorReporter";
import { CompanyPermissionGate } from './components/CompanyPermissionGate';

import { useNativeBridge } from "@/hooks/useNativeBridge";
import { useRevenueCatIdentity } from "@/hooks/useRevenueCat";
import { PaymentRouteGuard } from "@/components/PaymentRouteGuard";
import { EntitlementGate } from "@/components/EntitlementGate";
import { SafeModeToggle } from "@/components/SafeModeToggle";
import { ReturnToAppButton } from "@/components/ReturnToAppButton";
// Side-effect import: exposes window.__safeModeQA() in dev for App Review QA.
import "@/lib/safeModeQA";
import DebugConsole from "@/components/DebugConsole";

const showDebugConsole = import.meta.env.VITE_DEBUG_CONSOLE === "true";

const queryClient = new QueryClient();

const NativeBridge = () => {
  useNativeBridge();
  useRevenueCatIdentity();
  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <GlobalErrorReporter />
        <BrowserRouter>
          {showDebugConsole && <DebugConsole />}
          <NativeBridge />
          <PasswordRecoveryRedirect />
          <SafeModeToggle />
          <ReturnToAppButton />


          <PaymentRouteGuard>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/register" element={<Register />} />
            <Route path="/accept-invite" element={<AcceptInvite />} />
            <Route path="/apply" element={<Apply />} />
            <Route path="/install" element={<Install />} />
            <Route path="/get" element={<GetApp />} />
            <Route path="/scout-guide" element={<ScoutGuide />} />
            <Route path="/crew-join" element={<CrewJoin />} />
            <Route path="/crew-install" element={<CrewInstall />} />
            <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
            {/* The phone plan screen (App Store and Google Play); the website's plan picker is /dashboard/plans. */}
            <Route path="/plan" element={<ProtectedRoute><StorePlans /></ProtectedRoute>} />
            <Route path="/frequently-wronged-assumptions" element={<FrequentlyWrongedAssumptions />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/giveaway" element={<Giveaway />} />
            <Route path="/giveaway/rules" element={<GiveawayRules />} />

            <Route path="/support" element={<Support />} />
            <Route path="/start-trial" element={<StartTrial />} />
            <Route path="/start-trial/success" element={<StartTrialSuccess />} />
            <Route path="/mobile/unlock" element={<MobileUnlock />} />
            <Route path="/app/lead-unlocked" element={<LeadUnlockedReturn />} />
            
            
            {/* Protected Dashboard Routes */}
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <DashboardLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<DashboardLanding />} />
              <Route path="home" element={<Home />} />
              <Route path="purchased" element={<PurchasedLeads />} />
              <Route path="service-areas" element={<ServiceAreas />} />
              <Route path="profile" element={<Profile />} />
              <Route path="notifications" element={<NotificationSettings />} />

              <Route path="pricing" element={<Pricing />} />
              <Route path="plans" element={<Plans />} />
              <Route path="marketing" element={<Marketing />} />
              <Route path="dma" element={<DMA />} />
              <Route path="google-reviews" element={<GoogleReviews />} />
              <Route path="leads" element={<LeadsHub />} />
              <Route path="lsa" element={<LSALeads />} />
              <Route path="lsa-settings" element={<LSASettings />} />
              <Route path="instant-estimator" element={<CompanyPermissionGate permission="createScout" allowFree><EntitlementGate product="scout" allowFree><InstantEstimator /></EntitlementGate></CompanyPermissionGate>} />
              <Route path="instant-estimator/crew" element={<ProductionEstimate />} />
              <Route path="instant-estimator/crew/:id" element={<ProductionEstimate />} />
              <Route path="scout-inbox" element={<Navigate to="/dashboard/bid-board?tab=review" replace />} />
              <Route path="scout-rates" element={<EntitlementGate product="scout"><ScoutRates /></EntitlementGate>} />


              <Route path="crew-network" element={<ScoutRequiredGate allowFree><CrewNetwork /></ScoutRequiredGate>} />
              <Route path="bid-board" element={<ScoutRequiredGate allowFree><BidBoard /></ScoutRequiredGate>} />
              <Route path="bid-board/crew" element={<ProductionJobs />} />
              <Route path="pay" element={<ScoutRequiredGate><PayWeek /></ScoutRequiredGate>} />
              <Route path="ground-hours" element={<GroundHours />} />
              <Route path="crew-bids" element={<CrewMembershipGate><CrewBids /></CrewMembershipGate>} />
              <Route path="crew-availability" element={<CrewMembershipGate><CrewAvailability /></CrewMembershipGate>} />
              <Route path="team" element={<Team />} />
              <Route path="how-we-work" element={<HowWeWork />} />
              <Route path="integrations/jobber" element={<JobberIntegration />} />
              <Route path="pulse" element={<PulseHome />} />
              <Route path="pulse/setup" element={<PulseSetup />} />
              <Route path="pulse/oauth-return" element={<PulseOAuthReturn />} />
              <Route path="pulse/transactions" element={<PulseTransactions />} />
              <Route path="admin/refunds" element={<AdminRefunds />} />
              <Route path="admin/pulse" element={<PulseAdmin />} />
              <Route path="admin/review-reports" element={<AdminReviewReports />} />
              <Route path="start" element={<ScoutStart />} />
              <Route path="settings/admin" element={<SettingsAdmin />} />
              <Route path="settings/crews" element={<ProductionSetup />} />
              <Route path="admin/contractors" element={<AdminContractors />} />
              <Route path="admin/contractors/:id" element={<AdminContractorDetail />} />
              <Route path="admin/app-review" element={<AppReviewDiagnostics />} />
              <Route path="admin/signup-sandbox" element={<AdminSignupSandbox />} />
              <Route path="admin/giveaway" element={<AdminGiveaway />} />
              <Route path="subscription-info" element={<SafeModeInfo />} />
            </Route>

            {/* Catch-all */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          </PaymentRouteGuard>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
