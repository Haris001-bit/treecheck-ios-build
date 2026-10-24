// Some banks (OAuth) send the owner to their own site to sign in; on phones Plaid then returns here
// with ?oauth_state_id=... and Link must reopen with the same link token to finish.
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Landmark } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import PulseGate from "@/components/pulse/PulseGate";
import { PulseSetupOnWebsite } from "@/components/pulse/NativeLinkNotice";
import PlaidLinkButton, { type PlaidLinkedResult } from "@/components/pulse/PlaidLinkButton";
import { PULSE_ACCESS_QUERY_KEY } from "@/hooks/pulse/usePulseAccess";
import { afterUpdateOutcome, pulseErrorMessage, readLinkSession, type PulseFailure } from "@/lib/pulse/api";
import { cn } from "@/lib/utils";
import { pulseSetupAllowed } from "@/lib/pulse/flags";
import { BAD_TEXT } from "@/components/pulse/tone";

const SETUP_PATH = "/dashboard/pulse/setup";

export default function PulseOAuthReturn() {
  return (
    <PulseGate>
      {pulseSetupAllowed() ? <PulseOAuthReturnContent /> : <PulseSetupOnWebsite />}
    </PulseGate>
  );
}

function PulseOAuthReturnContent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Read once: the token is cleared as soon as Link finishes or closes.
  const [session] = useState(() => readLinkSession());
  const [redirectUri] = useState(() => window.location.href);
  const [problem, setProblem] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);

  const hasOAuthState = new URLSearchParams(window.location.search).has("oauth_state_id");

  if (!session || !hasOAuthState) {
    return (
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <Card className="p-6 space-y-3">
          <div className="font-bold">We couldn't finish linking your bank here</div>
          <p className="text-sm text-muted-foreground">
            The bank sign-in may have opened in a different browser or tab. Go back to setup and press the same button
            again (Link your bank, Link another bank, Reconnect, or Add accounts).
          </p>
          <Button asChild>
            <Link to={SETUP_PATH}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to setup
            </Link>
          </Button>
        </Card>
      </div>
    );
  }

  const handleLinked = (result: PlaidLinkedResult) => {
    void queryClient.invalidateQueries({ queryKey: ["pulse"] });
    if (result.mode === "new") {
      toast.success("Bank linked. Next, choose which of its accounts are for the business.");
    } else {
      const outcome = afterUpdateOutcome(result.sync);
      if (outcome.ok) toast.success(outcome.message);
      else toast.error(outcome.message);
    }
    // After setup, new or added accounts are switched on under Business accounts (the wizard resumes
    // at its own step and ignores this).
    const toAccounts = result.mode === "new" || result.accountSelection;
    navigate(toAccounts ? `${SETUP_PATH}?section=accounts` : SETUP_PATH, { replace: true });
  };

  const handleFailure = (failure: PulseFailure) => {
    setProblem(pulseErrorMessage(failure));
    if (failure.code === "not_enabled") {
      void queryClient.invalidateQueries({ queryKey: [PULSE_ACCESS_QUERY_KEY] });
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2 font-bold">
          <Landmark className="w-5 h-5 text-primary" />
          Finishing your bank connection
        </div>

        {problem ? (
          <div className={cn("flex items-start gap-2 text-sm", BAD_TEXT)}>
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{problem}</span>
          </div>
        ) : closed ? (
          <p className="text-sm text-muted-foreground">The bank connection was closed before it finished.</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Your bank sent you back to TreeCheck. If the Plaid window doesn't open by itself, press Continue.
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          {!problem && !closed && (
            <PlaidLinkButton
              mode={session.context.mode}
              itemRowId={session.context.itemRowId ?? undefined}
              accountSelection={session.context.accountSelection}
              resumeToken={session.token}
              receivedRedirectUri={redirectUri}
              label="Continue"
              onLinked={handleLinked}
              onFailure={handleFailure}
              onExit={() => setClosed(true)}
              className="w-full sm:w-auto"
            />
          )}
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link to={SETUP_PATH}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to setup
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
