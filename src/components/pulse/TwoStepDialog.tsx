// Two-step sign-in before bank linking (Plaid security review, 2026-10-23), with Supabase Auth's
// authenticator-app factor (TOTP). The first time, the owner adds TreeCheck to an authenticator app
// and types its 6-digit code; after that only the code is asked, once per sign-in. plaid-link-token
// and plaid-exchange refuse a session without it (_shared/pulse/twoStep.ts). Signing in and the rest
// of the app don't ask. A verified code makes Supabase sign the owner out on their other devices.
// Lost phone: TreeCheck support deletes the owner's row in auth.mfa_factors.
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { AlertTriangle, Copy, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { BAD_TEXT } from "./tone";

export const WRONG_CODE_MESSAGE =
  "That code didn't work. Type the newest code from your authenticator app. If it keeps failing, check that the time on your phone is set automatically.";
export const TOO_MANY_MESSAGE = "Too many tries. Wait a minute, then try again.";
export const NOT_AVAILABLE_MESSAGE = "Two-step sign-in isn't available right now. Please contact TreeCheck.";
export const START_FAILED_MESSAGE = "We couldn't start two-step sign-in. Check your internet connection and try again.";
export const CHECK_FAILED_MESSAGE = "We couldn't check the code. Check your internet connection and try again.";
export const SETUP_EXPIRED_NOTE =
  "That setup timed out, so this is a new code. Scan it, and delete the older TreeCheck entry from your app if you added one.";

type Step =
  | { kind: "loading" }
  | { kind: "setup"; factorId: string; qr: string; secret: string; uri: string; note?: string }
  | { kind: "code"; factorId: string }
  | { kind: "error"; message: string };

type PendingSetup = { factorId: string; qr: string; secret: string; uri: string };

// A setup the owner started but didn't finish in this page visit. Reopening the window shows the same
// QR code, the one already added to their app, while Supabase still has it.
let pendingSetup: PendingSetup | null = null;

/** For tests: forget an unfinished setup. */
export function resetTwoStepForTests(): void {
  pendingSetup = null;
}

interface AuthErrorLike {
  code?: string;
  status?: number;
}

function errorText(error: AuthErrorLike | null | undefined, fallback: string): string {
  const code = error?.code;
  if (code === "mfa_verification_failed" || code === "mfa_verification_rejected") return WRONG_CODE_MESSAGE;
  if (code === "over_request_rate_limit" || error?.status === 429) return TOO_MANY_MESSAGE;
  if (code === "mfa_totp_enroll_not_enabled" || code === "mfa_totp_verify_not_enabled") return NOT_AVAILABLE_MESSAGE;
  return fallback;
}

/** Supabase gives the QR code as raw SVG behind a data: prefix; encode it so any character is safe. */
export function qrImageSource(qr: string): string {
  const svg = qr.replace(/^data:image\/svg\+xml;[^,]*,/, "");
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** The setup key in groups of four, easier to type into an app. */
function groupKey(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, "$1 ");
}

async function sessionHasTwoStep(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    return data?.currentLevel === "aal2";
  } catch {
    return false;
  }
}

/** Works out what the window shows: the code for a verified authenticator, otherwise a setup. */
async function prepare(note?: string): Promise<Step> {
  try {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error || !data) return { kind: "error", message: START_FAILED_MESSAGE };
    const verified = data.totp[0];
    if (verified) return { kind: "code", factorId: verified.id };

    const unfinished = data.all.filter((f) => f.factor_type === "totp" && f.status !== "verified");
    const kept = pendingSetup;
    if (kept && unfinished.some((f) => f.id === kept.factorId)) return { kind: "setup", ...kept, note };
    // An earlier setup can't be shown again (Supabase gives its code only once), so start a new one.
    const lost = kept !== null;
    pendingSetup = null;
    for (const f of unfinished) {
      try {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      } catch {
        // A leftover setup only matters if enrolling fails, which is reported below.
      }
    }
    const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      issuer: "TreeCheck",
      // Unique: Supabase refuses a name another of the user's factors has.
      friendlyName: `TreeCheck ${new Date().toISOString().slice(0, 19).replace("T", " ")}`,
    });
    if (enrollError || !enrolled?.totp) return { kind: "error", message: errorText(enrollError, START_FAILED_MESSAGE) };
    pendingSetup = {
      factorId: enrolled.id,
      qr: qrImageSource(enrolled.totp.qr_code),
      secret: enrolled.totp.secret,
      uri: enrolled.totp.uri,
    };
    return { kind: "setup", ...pendingSetup, note: note ?? (lost ? SETUP_EXPIRED_NOTE : undefined) };
  } catch {
    return { kind: "error", message: START_FAILED_MESSAGE };
  }
}

// A string "kind", compared with ===: Lovable type-checks with TypeScript 7 and strict off, which
// doesn't narrow a union on a true/false field.
type CheckResult = { kind: "ok" } | { kind: "gone" } | { kind: "failed"; message: string };

async function checkCode(factorId: string, code: string): Promise<CheckResult> {
  try {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (!error) return { kind: "ok" };
    if (error.code === "mfa_factor_not_found") return { kind: "gone" };
    return { kind: "failed", message: errorText(error, CHECK_FAILED_MESSAGE) };
  } catch {
    return { kind: "failed", message: CHECK_FAILED_MESSAGE };
  }
}

function TwoStepDialog({ open, onDone }: { open: boolean; onDone: (ok: boolean) => void }) {
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Bumped on every load and on close, so a late answer from Supabase is dropped.
  const run = useRef(0);

  const load = useCallback(async (note?: string) => {
    const id = ++run.current;
    setStep({ kind: "loading" });
    setCode("");
    setChecking(false);
    setProblem(null);
    const next = await prepare(note);
    if (run.current === id) setStep(next);
  }, []);

  useEffect(() => {
    if (open) void load();
    else run.current++;
  }, [open, load]);

  const canSubmit = (step.kind === "setup" || step.kind === "code") && code.length === 6 && !checking;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit || (step.kind !== "setup" && step.kind !== "code")) return;
    const id = run.current;
    setChecking(true);
    setProblem(null);
    const result = await checkCode(step.factorId, code);
    if (run.current !== id) return;
    if (result.kind === "ok") {
      pendingSetup = null;
      onDone(true);
      return;
    }
    if (result.kind === "gone") {
      pendingSetup = null;
      void load(step.kind === "setup" ? SETUP_EXPIRED_NOTE : undefined);
      return;
    }
    setChecking(false);
    setCode("");
    setProblem(result.message);
  };

  const copyKey = async (secret: string) => {
    try {
      await navigator.clipboard.writeText(secret);
      toast.success("Key copied.");
    } catch {
      toast.error("Couldn't copy. Type the key into your app instead.");
    }
  };

  const setup = step.kind === "setup";
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onDone(false)}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto"
        // Clicking beside the window while reaching for a phone shouldn't close it.
        onInteractOutside={(e) => e.preventDefault()}
        data-pulse-two-step={step.kind}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            {setup ? "Turn on two-step sign-in" : step.kind === "code" ? "Enter your code" : "Two-step sign-in"}
          </DialogTitle>
          <DialogDescription>
            {setup
              ? "Linking a bank needs a second step that keeps your money data safe. You only set this up once."
              : "Linking a bank needs a second step that keeps your money data safe."}
          </DialogDescription>
        </DialogHeader>

        {step.kind === "loading" && (
          <div className="flex items-center justify-center py-8" aria-busy="true">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <span className="sr-only">Loading</span>
          </div>
        )}

        {step.kind === "error" && (
          <div className="space-y-4">
            <div className={cn("flex items-start gap-2 text-sm", BAD_TEXT)}>
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{step.message}</span>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => onDone(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void load()}>
                Try again
              </Button>
            </DialogFooter>
          </div>
        )}

        {(step.kind === "setup" || step.kind === "code") && (
          <form className="space-y-4" onSubmit={(e) => void submit(e)}>
            {step.kind === "setup" && (
              <div className="space-y-3 text-sm">
                {step.note && <p className="text-muted-foreground">{step.note}</p>}
                <ol className="list-decimal pl-5 space-y-1">
                  <li>
                    On your phone, open an authenticator app such as Google Authenticator or Microsoft Authenticator
                    (free in the App Store and Google Play).
                  </li>
                  <li>Add an account and scan this code.</li>
                  <li>Type the 6-digit code the app shows for TreeCheck.</li>
                </ol>
                <div className="flex justify-center">
                  {/* QR codes need a light, plain border to scan, whatever the theme. Shown at its own
                      size: Supabase's SVG has no viewBox, so it wouldn't scale. */}
                  <div className="rounded-lg p-3" style={{ backgroundColor: "#ffffff" }}>
                    <img src={step.qr} alt="QR code for your authenticator app" className="block max-w-full" />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-muted-foreground">Can't scan it, or using this phone? Add this key in the app instead:</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 min-w-0 break-words rounded-md border border-border px-3 py-2 font-mono text-sm">
                      {groupKey(step.secret)}
                    </code>
                    <Button type="button" variant="outline" size="sm" onClick={() => void copyKey(step.secret)}>
                      <Copy className="w-4 h-4 mr-2" />
                      Copy
                    </Button>
                  </div>
                  <a href={step.uri} className="inline-block text-primary underline sm:hidden">
                    Open in my authenticator app
                  </a>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="pulse-two-step-code">6-digit code</Label>
              <Input
                id="pulse-two-step-code"
                value={code}
                // Digits only, so a pasted "123 456" works.
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus={step.kind === "code"}
                disabled={checking}
                className="text-center text-lg tracking-widest font-mono"
              />
              {problem && (
                <div className={cn("flex items-start gap-2 text-sm", BAD_TEXT)} role="alert">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{problem}</span>
                </div>
              )}
              {step.kind === "code" && (
                <p className="text-xs text-muted-foreground">Lost your phone? Contact TreeCheck and we'll reset it.</p>
              )}
              <p className="text-xs text-muted-foreground">You may need to sign in again on your other devices afterwards.</p>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => onDone(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {checking && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {setup ? "Turn on and continue" : "Continue"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export interface TwoStep {
  /** Resolves true once this session has two-step sign-in, false if the owner closed the window. */
  ensure: (options?: { force?: boolean }) => Promise<boolean>;
  /** Render next to the button that needs it; the window opens over the page. */
  dialog: ReactNode;
}

/** Asks for two-step sign-in when the session doesn't have it yet. */
export function useTwoStep(): TwoStep {
  const [open, setOpen] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const settle = useCallback((ok: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setOpen(false);
    resolve?.(ok);
  }, []);

  // Gone while asking: the caller stops.
  useEffect(
    () => () => {
      const resolve = resolver.current;
      resolver.current = null;
      resolve?.(false);
    },
    [],
  );

  const ensure = useCallback(async (options?: { force?: boolean }) => {
    if (!options?.force && (await sessionHasTwoStep())) return true;
    if (resolver.current) return false;
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOpen(true);
    });
  }, []);

  return { ensure, dialog: <TwoStepDialog open={open} onDone={settle} /> };
}
