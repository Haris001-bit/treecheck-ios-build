import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Globe, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getWebBaseUrl } from "@/lib/platform";
import { isSetupSection, type SetupSection } from "@/components/pulse/setup/setupModel";

/**
 * Why the phone app shows this instead of a Pulse page:
 * - off: the Pulse screen is switched off in the apps (PULSE_NATIVE_ENABLED);
 * - setup: the owner hasn't finished setting up, which happens on the website;
 * - manage: linking or reconnecting a bank, connecting Jobber or changing settings, all on the website.
 */
export type NativeLinkReason = "off" | "setup" | "manage";

const TEXT: Record<NativeLinkReason, { title: string; body: string }> = {
  off: {
    title: "Financial Pulse",
    body: "Financial Pulse is available on the TreeCheck website.",
  },
  setup: {
    title: "Set up Financial Pulse on the website",
    body: "Setting up, linking your bank and card and connecting Jobber happen on the TreeCheck website. It's easiest on a computer. Once that's done, your numbers show here in the app too.",
  },
  manage: {
    title: "This part is on the website",
    body: "Linking or reconnecting a bank or card, connecting Jobber and changing your settings happen on the TreeCheck website. Once you've done it there, your numbers here update by themselves.",
  },
};

/**
 * Shown in the store apps for the parts of Financial Pulse that stay on the website. Open the website is a plain
 * link: inside the app, Capacitor hands it to the phone's own browser (iOS UIApplication.open, Android
 * ACTION_VIEW), so the owner's sign-in and a bank's sign-in return stay in one real browser.
 */
export default function NativeLinkNotice({
  reason = "off",
  section,
  onBack,
  onCheckAgain,
}: {
  reason?: NativeLinkReason;
  section?: SetupSection | null;
  onBack?: () => void;
  onCheckAgain?: () => void;
}) {
  const base = getWebBaseUrl();
  const setupUrl = `${base}/dashboard/pulse/setup${section ? `?section=${section}` : ""}`;
  let host = base;
  try {
    host = new URL(base).host;
  } catch {
    // Keep the base address as it is.
  }
  const text = TEXT[reason];
  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto text-pretty">
      <Card className="p-6 space-y-3">
        <div className="flex items-center gap-2 font-bold">
          <Globe className="w-5 h-5 text-primary shrink-0" />
          {text.title}
        </div>
        <p className="text-sm text-muted-foreground">{text.body}</p>
        {reason === "off" ? (
          <p className="text-sm text-muted-foreground">
            Open <span className="font-normal text-foreground select-all">{host}</span> in your browser.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            The website is <span className="font-normal text-foreground select-all">{host}</span>. It may ask you to sign
            in with your TreeCheck email and password. When you're finished, come back to the app.
          </p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild>
            <a href={setupUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 mr-2" />
              Open the website
            </a>
          </Button>
          {onCheckAgain && (
            <Button variant="outline" onClick={onCheckAgain}>
              <RefreshCw className="w-4 h-4 mr-2" />
              I've finished, check again
            </Button>
          )}
          {onBack && (
            <Button variant="outline" onClick={onBack}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Financial Pulse
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

/** In the phone apps, setup and its settings (and a bank's sign-in return) stay on the website. */
export function PulseSetupOnWebsite() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const asked = params.get("section");
  return (
    <NativeLinkNotice
      reason="manage"
      section={isSetupSection(asked) ? asked : null}
      onBack={() => navigate("/dashboard/pulse", { replace: true })}
    />
  );
}
