import { Outlet, NavLink, useNavigate, Navigate, useLocation } from "react-router-dom";
import { useProfile } from '@/hooks/useProfile';
import { Fragment } from "react";

const SETTINGS_PATHS = ['/dashboard/start', '/dashboard/scout-rates', '/dashboard/how-we-work', '/dashboard/settings', '/dashboard/pay', '/dashboard/integrations', '/dashboard/profile'];
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SHOW_LEADS_IN_MENU } from "@/lib/menu-flags";
import { useAuth } from "@/lib/auth";
import { BillingBanner } from "@/components/billing/BillingBanner";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  LayoutDashboard,
  MapPin,
  History,
  User,
  LogOut,
  Users,
  FileText,
  Menu,
  Crown,
  Megaphone,
  Sparkles,
  RefreshCcw,
  Zap,
  Star,
  Inbox,
  Lock,
  Plug,
  SlidersHorizontal,
  HardHat,
  Gavel,
  CalendarDays,
  Settings2, Flag, Rocket, FlaskConical, LineChart, Clock, Target, ClipboardList, Loader2, CreditCard, Gift } from 'lucide-react';
import { usePulseAccess } from '@/hooks/pulse/usePulseAccess';
import { useCompanySettings, usesSubs } from '@/hooks/useCompanySettings';
import { useProductionStatus } from '@/hooks/useProductionStatus';
import { useIsCrewOnly } from '@/hooks/useCrew';
import { isCrewPath } from '@/lib/crewPaths';
import { cn } from '@/lib/utils';
import { HubTabs } from '@/components/HubTabs';
import { DemoSwitchButton } from '@/components/DemoSwitchButton';
import { isAppStoreSafeMode, isNativeStoreBilling, getWebBaseUrl, canUseAppleIAP, canUseStorePlans } from '@/lib/platform';
import { Browser } from '@capacitor/browser';
import { useEntitlements, PRODUCT_MARKETING_URLS, type Product } from '@/hooks/useEntitlements';
import { useFreePlan } from '@/hooks/useFreePlan';
const sidebarLogo = '/treecheck-logo-white.png';
const sidebarLogoFallback = '/treecheck-logo-dark.png';


export default function DashboardLayout() {
  const { isAdmin, isTeamMember, signOut, effectiveContractorId } = useAuth();
  const { hasProduct } = useEntitlements();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  usePushNotifications();
  const [sidebarLogoSrc, setSidebarLogoSrc] = useState(sidebarLogo);
  const [hasTriedLogoFallback, setHasTriedLogoFallback] = useState(false);

  // Hide "Go Premium" when the contractor's market has no Available Leads
  // (matches the empty state on the Available Leads page).
  const { data: leadPresence } = useQuery({
    queryKey: ['leads-presence', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads_secure' as any)
        .select('owner_contractor_id');
      if (error) throw error;
      return data as { owner_contractor_id?: string | null }[];
    },
    enabled: !!user,
    staleTime: 30_000,
  });
  const hasAvailableLeads =
    leadPresence === undefined ? true : leadPresence.some((l) => !l.owner_contractor_id);

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  const handleSidebarLogoError = () => {
    if (!hasTriedLogoFallback) {
      setSidebarLogoSrc(sidebarLogoFallback);
      setHasTriedLogoFallback(true);
    }
  };

  const dmaVisited =
    typeof window !== "undefined" &&
    localStorage.getItem("dma_visited") === "true";

  const safeMode = isAppStoreSafeMode();
  const iap = canUseAppleIAP();
  const storeBuild = isNativeStoreBilling();
  const storePlans = canUseStorePlans();

  const { isCrew, isCrewOnly, loading: crewLoading } = useIsCrewOnly();
  const { data: company, isLoading: companyLoading } = useCompanySettings();
  const subsOn = isAdmin || usesSubs(company);
  // Large-company setup: once the company publishes its crew rates, Jobs also holds its own crews' work. People who
  // can't use the sub bid board (crew leaders, salespeople) go straight to Crew work. Nothing changes for anyone else.
  const { status: production } = useProductionStatus();
  const crewJobs = production.published && (production.can.dispatch || production.can.field || production.can.price);
  const jobsPath = crewJobs && (!subsOn || !production.can.dispatch) ? '/dashboard/bid-board/crew' : subsOn ? '/dashboard/bid-board' : null;
  const needsSetup = !isAdmin && !isTeamMember && !crewLoading && !isCrewOnly && !companyLoading && !company?.onboarding_completed_at;
  const { allowed: pulseAllowed } = usePulseAccess();
  const isDemo = useProfile().data?.is_sandbox === true;
  // Free plan (Oklahoma owners): Scout and Marketing open their preview versions.
  const freePlan = useFreePlan();
  const onFreePlan = freePlan.data?.plan === 'free' && freePlan.data.is_owner === true;

  const { pathname } = useLocation();
  const navItems = useMemo(() => {
    // Legacy safe mode (no IAP): optional external web for some commerce pages.
    // With Apple IAP, keep Pricing / DMA / Marketing in-app.
    const webBase = getWebBaseUrl();
    const ext = (path: string) =>
      safeMode && !iap ? `${webBase}${path}` : undefined;

    // Contract climbers/ground workers only bid on jobs — nothing else.
    if (isCrewOnly) {
      return [
        { to: '/dashboard/crew-bids', icon: Gavel, label: 'Jobs to Bid' },
        { to: '/dashboard/crew-availability', icon: CalendarDays, label: 'My Availability' },
        { to: '/dashboard/ground-hours', icon: Clock, label: 'My Hours' },
        { to: '/dashboard/profile', icon: User, label: 'Profile' },
      ];
    }

    const items: any[] = [];
    // Jobs is also for team members (e.g. LesLee) who compare offers.
    items.push({ to: '/dashboard/home', icon: LayoutDashboard, label: 'Dashboard' });
    if (jobsPath) items.push({ to: jobsPath, icon: ClipboardList, label: 'Jobs', activePaths: ['/dashboard/bid-board'] });
    items.push({ to: '/dashboard/instant-estimator', icon: Zap, label: 'Scout™', product: 'scout' as Product });
    items.push({ to: '/dashboard/dma', icon: Megaphone, label: 'Marketing', product: 'dma' as Product });
    if ((pulseAllowed || isDemo) && !isTeamMember) items.push({ to: '/dashboard/pulse', icon: LineChart, label: 'Pulse' });
    // Team members (e.g. LesLee) manage subs too; seat billing stays owner-only.
    if (!isTeamMember || subsOn) {
      items.push({ to: subsOn ? '/dashboard/crew-network' : '/dashboard/team', icon: Users, label: 'Subs' });
    }
    // Leads (lead aggregator) is hidden from the menu for now; its pages still work.
    if (SHOW_LEADS_IN_MENU) {
      items.push({ to: '/dashboard/leads', icon: Target, label: 'Leads', product: 'leads' as Product });
    }
    if (isCrew) {
      items.push({ to: '/dashboard/crew-bids', icon: Gavel, label: 'Jobs to Bid' });
      items.push({ to: '/dashboard/crew-availability', icon: CalendarDays, label: 'My Availability' });
    }
    // The phone apps sell the company plans through Apple or Google: owners open the plan screen from here (Apple's
    // reviewer couldn't find it under Settings > Profile in 1.2).
    if (storePlans && !isTeamMember) items.push({ to: '/plan', icon: CreditCard, label: 'Plan' });
    // Settings holds Integrations, Profile and Admin as tabs.
    items.push({
      to: isTeamMember ? '/dashboard/settings/admin' : '/dashboard/start',
      icon: Settings2,
      label: 'Settings',
      divider: true,
      activePaths: SETTINGS_PATHS,
    });
    return items;
  }, [isTeamMember, safeMode, effectiveContractorId, iap, storePlans, isCrew, isCrewOnly, hasAvailableLeads, subsOn, pulseAllowed, isDemo, jobsPath]);

  const openExternal = async (url: string) => {
    try {
      await Browser.open({ url, presentationStyle: "popover" });
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const adminItems = [
    { to: "/dashboard/admin/contractors", icon: Users, label: "Contractors" },
    { to: "/dashboard/admin/leads", icon: FileText, label: "Manage Leads" },
    {
      to: "/dashboard/admin/refunds",
      icon: RefreshCcw,
      label: "Refund Requests",
    },
    { to: "/dashboard/admin/review-reports", icon: Flag, label: "Review Reports" },
    { to: "/dashboard/admin/signup-sandbox", icon: FlaskConical, label: "Signup Sandbox" },
    { to: "/dashboard/admin/giveaway", icon: Gift, label: "Giveaway" },
    { to: "/dashboard/admin/pulse", icon: LineChart, label: "Financial Pulse" },
  ];

  const NavContent = ({ onNavigate }: { onNavigate?: () => void }) => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-6 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <img
            src={sidebarLogoSrc}
            alt="TreeCheck Logo"
            onError={handleSidebarLogoError}
            className="h-8 w-auto max-w-[10rem] object-contain"
          />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 min-h-0 overflow-y-auto p-4 space-y-1">
        {navItems.map((item) => {
          const baseClass =
            "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors w-full text-left";
          const locked = item.product ? !hasProduct(item.product) && !(onFreePlan && (item.product === 'scout' || item.product === 'dma')) : false;
          const inner = (
            <>
              <item.icon className={cn('w-5 h-5', locked && 'opacity-50')} />
              <span className={cn('font-medium', locked && 'opacity-60')}>{item.label}</span>
              {item.external && (
                <span className="ml-auto text-[10px] font-medium text-sidebar-foreground/60">
                  Web
                </span>
              )}
              {locked && !item.external && (
                <Lock className="ml-auto w-3.5 h-3.5 text-sidebar-foreground/50" />
              )}
              {!locked && !item.external && item.badge && (
                <span className="ml-auto px-1.5 py-0.5 text-[10px] font-bold rounded bg-primary text-primary-foreground">
                  {item.badge}
                </span>
              )}
            </>
          );

          // Locked product item → open its marketing page on tradesmarketing.ai. Never in the phone apps (iPhone and
          // Android): there the in-app page shows its notice or the phone plan screen, with no outside link.
          if (locked && !storeBuild) {
            const url = PRODUCT_MARKETING_URLS[item.product as Product];
            return (
              <button
                key={item.to}
                type="button"
                onClick={() => {
                  openExternal(url);
                  onNavigate?.();
                }}
                className={cn(
                  baseClass,
                  'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                )}
              >
                {inner}
              </button>
            );
          }

          if (item.external) {
            return (
              <button
                key={item.to}
                type="button"
                onClick={() => {
                  openExternal(item.external);
                  onNavigate?.();
                }}
                className={cn(
                  baseClass,
                  "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                {inner}
              </button>
            );
          }

          const forcedActive = item.activePaths?.some((p: string) => pathname.startsWith(p));
          return (
            <Fragment key={item.to}>
            {item.divider && <div role="separator" className="my-3 border-t border-sidebar-border" />}
            <NavLink
              to={item.to}
              end={item.end}
              onClick={() => {
                if (item.to === "/dashboard/dma") {
                  localStorage.setItem("dma_visited", "true");
                }
                onNavigate?.();
              }}
              className={({ isActive }) =>
                cn(
                  baseClass,
                  isActive || forcedActive
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )
              }
            >
              {inner}
            </NavLink>
            </Fragment>
          );
        })}

        {isAdmin && (
          <>
            <div className="pt-4 pb-2">
              <span className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider px-3">
                Admin
              </span>
            </div>
            {adminItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-primary"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )
                }
              >
                <item.icon className="w-5 h-5" />
                <span className="font-medium">{item.label}</span>
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {/* Sign Out */}
      <div className="p-4 border-t border-sidebar-border">
        {/* Event demo logins only: one tap between the owner's and the climber's view */}
        <DemoSwitchButton className="mb-2" onSwitched={onNavigate} />
        <Button
          variant="ghost"
          onClick={() => {
            handleSignOut();
            onNavigate?.();
          }}
          className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent"
        >
          <LogOut className="w-5 h-5 mr-3" />
          Sign Out
        </Button>
      </div>
    </div>
  );

  // Do not expose company navigation or mount summaries before audience resolution.
  if (crewLoading) return <div className="min-h-screen flex items-center justify-center" role="status" aria-label="Loading"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  // A crew-only account keeps to its own pages; typing an owner page's address (Settings, Jobs, Scout) lands on Jobs to Bid.
  if (isCrewOnly && !isAdmin && !isCrewPath(pathname)) return <Navigate to="/dashboard/crew-bids" replace />;
  if (needsSetup) return <Navigate to="/onboarding" replace />;

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-sidebar border-b border-sidebar-border z-40 flex items-center px-4">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-sidebar-foreground"
            >
              <Menu className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="p-0 w-72 bg-sidebar border-sidebar-border"
          >
            <NavContent onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
        <div className="flex items-center gap-2 ml-3">
          <img
            src={sidebarLogoSrc}
            alt="TreeCheck Logo"
            onError={handleSidebarLogoError}
            className="h-7 w-auto max-w-[9rem] object-contain"
          />
        </div>
        <div className="ml-auto">
          <DemoSwitchButton compact />
        </div>
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden lg:block fixed left-0 top-0 h-full w-64 bg-sidebar border-r border-sidebar-border">
        <NavContent />
      </aside>

      {/* Main Content */}
      <main className="lg:ml-64 min-h-screen pt-16 lg:pt-0 min-w-0 overflow-x-clip">
        <HubTabs />
        <BillingBanner />
        <Outlet />
      </main>
    </div>
  );
}
