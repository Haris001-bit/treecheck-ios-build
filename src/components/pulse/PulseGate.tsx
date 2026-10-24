import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Lock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { usePulseAccess } from "@/hooks/pulse/usePulseAccess";
import { pulseSetupAllowed, pulseSurfaceAllowed } from "@/lib/pulse/flags";
import NativeLinkNotice from "./NativeLinkNotice";

/**
 * Wraps every Financial Pulse page. Only a company owner whose Pulse switch is on sees the page;
 * everyone else sees a short notice and never any data.
 */
export default function PulseGate({ children }: { children: ReactNode }) {
  const { loading, allowed, failed, retry } = usePulseAccess();
  const { isTeamMember } = useAuth();

  if (!pulseSurfaceAllowed()) return <NativeLinkNotice reason="off" />;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24" aria-busy="true">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Loading</span>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <Card className="p-6 space-y-3">
          <div className="font-bold">We couldn't open Financial Pulse right now</div>
          <p className="text-sm text-muted-foreground">Check your internet connection and try again.</p>
          <Button variant="outline" onClick={retry}>
            Try again
          </Button>
        </Card>
      </div>
    );
  }

  if (!allowed && isTeamMember) {
    return (
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <Card className="p-6 space-y-2">
          <div className="flex items-center gap-2 font-bold">
            <Lock className="w-5 h-5 text-primary" />
            Only your company's account owner can open Financial Pulse
          </div>
          <p className="text-sm text-muted-foreground">
            Financial Pulse shows the company's money, so it is for the owner's login only.
          </p>
        </Card>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <Card className="p-6 space-y-2">
          <div className="flex items-center gap-2 font-bold">
            <Lock className="w-5 h-5 text-primary" />
            Financial Pulse isn't switched on for your company yet
          </div>
          <p className="text-sm text-muted-foreground">
            TreeCheck turns Financial Pulse on for each company. Once it is on, the account owner can set it up{" "}
            {pulseSetupAllowed() ? "here" : "on the TreeCheck website"}.
          </p>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
