// Opens Plaid Link from Plaid's official CDN script (no npm package) and finishes the link:
// new links are exchanged by plaid-exchange; update mode (Reconnect / Add accounts) re-syncs that
// bank with after_update, and the caller reports the sync outcome (see afterUpdateOutcome).
// Two-step sign-in comes first (TwoStepDialog): the server opens Link and saves a bank only for a
// session that finished it.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  CONSENT_VERSION,
  GENERIC_ERROR,
  TWO_STEP_CODE,
  clearLinkSession,
  exchange,
  linkToken,
  pulseErrorMessage,
  saveLinkSession,
  sync,
  type ExchangeBody,
  type ExchangeMetadata,
  type LinkTokenBody,
  type PulseFailure,
  type SyncResult,
} from "@/lib/pulse/api";
import { useTwoStep } from "./TwoStepDialog";

// ---- Minimal Plaid Link types (only what this file uses) ----------------------------------------
interface PlaidInstitutionMeta {
  name?: string | null;
  institution_id?: string | null;
}
interface PlaidAccountMeta {
  id?: string | null;
  name?: string | null;
  mask?: string | null;
  type?: string | null;
  subtype?: string | null;
}
interface PlaidSuccessMetadata {
  institution?: PlaidInstitutionMeta | null;
  accounts?: PlaidAccountMeta[] | null;
  link_session_id?: string | null;
}
interface PlaidLinkError {
  error_code?: string | null;
  display_message?: string | null;
}
interface PlaidLinkHandler {
  open: () => void;
  exit: (options?: { force?: boolean }) => void;
  destroy: () => void;
}
interface PlaidCreateConfig {
  token: string;
  receivedRedirectUri?: string;
  onSuccess: (publicToken: string, metadata: PlaidSuccessMetadata) => void;
  onExit?: (error: PlaidLinkError | null, metadata: unknown) => void;
}
interface PlaidLinkFactory {
  create: (config: PlaidCreateConfig) => PlaidLinkHandler;
}
type WindowWithPlaid = Window & { Plaid?: PlaidLinkFactory };

const PLAID_SCRIPT_SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
const SCRIPT_TIMEOUT_MS = 20_000;
let plaidScript: Promise<PlaidLinkFactory> | null = null;

function currentPlaid(): PlaidLinkFactory | undefined {
  return (window as WindowWithPlaid).Plaid;
}

/** Injects Plaid's script once and waits for window.Plaid. */
function loadPlaid(): Promise<PlaidLinkFactory> {
  const ready = currentPlaid();
  if (ready) return Promise.resolve(ready);
  if (plaidScript) return plaidScript;

  plaidScript = new Promise<PlaidLinkFactory>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(`script[src="${PLAID_SCRIPT_SRC}"]`);
    const timer = window.setTimeout(() => reject(new Error("plaid_timeout")), SCRIPT_TIMEOUT_MS);
    const finish = () => {
      window.clearTimeout(timer);
      const plaid = currentPlaid();
      if (plaid) resolve(plaid);
      else reject(new Error("plaid_unavailable"));
    };
    const fail = () => {
      window.clearTimeout(timer);
      script?.remove();
      reject(new Error("plaid_load_failed"));
    };
    if (!script) {
      script = document.createElement("script");
      script.src = PLAID_SCRIPT_SRC;
      script.async = true;
      script.addEventListener("load", finish, { once: true });
      script.addEventListener("error", fail, { once: true });
      document.head.appendChild(script);
    } else {
      script.addEventListener("load", finish, { once: true });
      script.addEventListener("error", fail, { once: true });
    }
  });
  // Let a later click try again after a failed load.
  plaidScript.catch(() => {
    plaidScript = null;
  });
  return plaidScript;
}

function cleanMetadata(metadata: PlaidSuccessMetadata | null | undefined): ExchangeMetadata {
  const inst = metadata?.institution;
  const accounts = Array.isArray(metadata?.accounts) ? metadata.accounts : [];
  return {
    institution:
      inst && typeof inst.institution_id === "string" && inst.institution_id
        ? { institution_id: inst.institution_id, name: typeof inst.name === "string" ? inst.name : "" }
        : null,
    accounts: accounts
      .filter((a): a is PlaidAccountMeta => !!a && typeof a.id === "string" && !!a.id)
      .map((a) => ({
        id: a.id as string,
        name: typeof a.name === "string" ? a.name : "",
        mask: typeof a.mask === "string" ? a.mask : null,
        type: typeof a.type === "string" ? a.type : "",
        subtype: typeof a.subtype === "string" ? a.subtype : null,
      })),
    link_session_id: typeof metadata?.link_session_id === "string" ? metadata.link_session_id : null,
  };
}

// ---- Component ------------------------------------------------------------------------------------
export type PlaidLinkedResult =
  | { mode: "new"; itemRowId: string; accounts: number }
  /** Plaid Link finished; `sync` is the after_update sync of that bank (may carry problems). */
  | { mode: "update"; itemRowId: string; sync: SyncResult; accountSelection: boolean };

export interface PlaidLinkButtonProps {
  mode: "new" | "update";
  /** Required for update mode: the plaid_items row to reconnect or add accounts to. */
  itemRowId?: string;
  /** Update mode only: let the owner pick more accounts at this bank. */
  accountSelection?: boolean;
  label: string;
  onLinked: (result: PlaidLinkedResult) => void;
  /** Called with a refusal or error. Without it the button shows a toast. */
  onFailure?: (failure: PulseFailure) => void;
  /** Called when the owner closes Plaid without finishing. */
  onExit?: () => void;
  /** OAuth return only: reopen Link with this stored token instead of asking for a new one. */
  resumeToken?: string;
  /** OAuth return only: the full return URL Plaid sent the owner back to. Opens Link at once. */
  receivedRedirectUri?: string;
  disabled?: boolean;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  icon?: ReactNode;
}

type Busy = null | "starting" | "open" | "saving";

export default function PlaidLinkButton({
  mode,
  itemRowId,
  accountSelection,
  label,
  onLinked,
  onFailure,
  onExit,
  resumeToken,
  receivedRedirectUri,
  disabled,
  variant,
  size,
  className,
  icon,
}: PlaidLinkButtonProps) {
  const [busy, setBusy] = useState<Busy>(null);
  const busyRef = useRef<Busy>(null);
  const handlerRef = useRef<PlaidLinkHandler | null>(null);
  const mountedRef = useRef(true);
  const autoStarted = useRef(false);
  const twoStep = useTwoStep();
  const ensureTwoStep = twoStep.ensure;

  // Latest callbacks, so a Link session that outlives a re-render calls the current ones.
  const callbacks = useRef({ onLinked, onFailure, onExit });
  callbacks.current = { onLinked, onFailure, onExit };

  const setBusyState = useCallback((next: Busy) => {
    busyRef.current = next;
    if (mountedRef.current) setBusy(next);
  }, []);

  const report = useCallback((failure: PulseFailure) => {
    const handler = callbacks.current.onFailure;
    if (handler) handler(failure);
    else toast.error(pulseErrorMessage(failure));
  }, []);

  const destroyHandler = useCallback(() => {
    const handler = handlerRef.current;
    handlerRef.current = null;
    if (!handler) return;
    try {
      handler.destroy();
    } catch {
      // Already gone.
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      destroyHandler();
    };
  }, [destroyHandler]);

  const finish = useCallback(
    async (publicToken: string, metadata: PlaidSuccessMetadata) => {
      setBusyState("saving");
      try {
        if (mode === "new") {
          const body: ExchangeBody = {
            public_token: publicToken,
            metadata: cleanMetadata(metadata),
            consent_version: CONSENT_VERSION,
          };
          let res = await exchange(body);
          // The session lost its two-step sign-in during Link: ask for the code, then save the same bank.
          if (res.ok === false && res.code === TWO_STEP_CODE && (await ensureTwoStep({ force: true }))) {
            res = await exchange(body);
          }
          if (res.ok === false) {
            report(res);
            return;
          }
          callbacks.current.onLinked({ mode: "new", itemRowId: res.item_row_id, accounts: res.accounts });
        } else {
          if (!itemRowId) {
            report({ ok: false, code: "network", error: GENERIC_ERROR });
            return;
          }
          // Plaid Link's update mode succeeded for this bank: the only place after_update is sent.
          const res = await sync({ item_row_id: itemRowId, after_update: true, account_selection: accountSelection === true });
          callbacks.current.onLinked({ mode: "update", itemRowId, sync: res, accountSelection: accountSelection === true });
        }
      } catch {
        report({ ok: false, code: "network", error: GENERIC_ERROR });
      } finally {
        clearLinkSession();
        destroyHandler();
        setBusyState(null);
      }
    },
    [mode, itemRowId, accountSelection, report, destroyHandler, setBusyState, ensureTwoStep],
  );

  const start = useCallback(async () => {
    if (busyRef.current) return;
    setBusyState("starting");
    try {
      let token = resumeToken;
      if (!token) {
        if (mode === "update" && !itemRowId) {
          report({ ok: false, code: "network", error: GENERIC_ERROR });
          setBusyState(null);
          return;
        }
        const body: LinkTokenBody =
          mode === "new"
            ? { mode: "new" }
            : { mode: "update", item_row_id: itemRowId as string, ...(accountSelection ? { account_selection: true } : {}) };
        // Two-step sign-in before Plaid Link opens. Closing its window stops here, like closing Plaid.
        if (!(await ensureTwoStep())) {
          setBusyState(null);
          return;
        }
        let res = await linkToken(body);
        if (res.ok === false && res.code === TWO_STEP_CODE) {
          // The server saw a sign-in without it: ask for the code once more, then try again.
          if (!(await ensureTwoStep({ force: true }))) {
            setBusyState(null);
            return;
          }
          res = await linkToken(body);
        }
        if (res.ok === false) {
          report(res);
          setBusyState(null);
          return;
        }
        token = res.link_token;
        saveLinkSession(token, { mode, itemRowId: itemRowId ?? null, accountSelection: !!accountSelection });
      }

      let plaid: PlaidLinkFactory;
      try {
        plaid = await loadPlaid();
      } catch {
        report({
          ok: false,
          code: "network",
          error: "We couldn't open the bank connection window. Check your internet connection and try again.",
        });
        setBusyState(null);
        return;
      }
      if (!mountedRef.current) return;

      destroyHandler();
      const handler = plaid.create({
        token,
        ...(receivedRedirectUri ? { receivedRedirectUri } : {}),
        onSuccess: (publicToken, metadata) => {
          void finish(publicToken, metadata);
        },
        onExit: (error) => {
          clearLinkSession();
          destroyHandler();
          setBusyState(null);
          if (error) {
            const text =
              typeof error.display_message === "string" && error.display_message.trim()
                ? error.display_message.trim()
                : "The bank connection didn't finish. Please try again.";
            toast.error(text);
          }
          callbacks.current.onExit?.();
        },
      });
      handlerRef.current = handler;
      setBusyState("open");
      handler.open();
    } catch {
      report({ ok: false, code: "network", error: GENERIC_ERROR });
      destroyHandler();
      setBusyState(null);
    }
  }, [
    resumeToken,
    receivedRedirectUri,
    mode,
    itemRowId,
    accountSelection,
    report,
    finish,
    destroyHandler,
    setBusyState,
    ensureTwoStep,
  ]);

  // OAuth return: reopen Link straight away with the stored token.
  useEffect(() => {
    if (!resumeToken || !receivedRedirectUri || autoStarted.current) return;
    autoStarted.current = true;
    void start();
  }, [resumeToken, receivedRedirectUri, start]);

  const working = busy !== null;
  return (
    <>
      <Button
        type="button"
        onClick={() => void start()}
        disabled={disabled || working}
        variant={variant}
        size={size}
        className={className}
      >
        {working ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            {busy === "saving" ? "Saving..." : "Opening..."}
          </>
        ) : (
          <>
            {icon}
            {label}
          </>
        )}
      </Button>
      {twoStep.dialog}
    </>
  );
}
