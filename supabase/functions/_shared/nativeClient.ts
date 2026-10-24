// Requests from the TreeCheck phone apps (payments milestone, 2026-10-21). capacitor.config.ts turns on CapacitorHttp,
// so the apps' calls go through native HTTP and carry no Origin header, while a browser always sends one on these
// cross-origin POSTs. The WebView origins are matched too, in case CapacitorHttp is ever turned off.
// A Stripe purchase from inside the apps breaks Apple's and Google Play's payment rules, so the functions that start a
// Stripe charge or checkout refuse these requests. Pure, no imports, so vitest can run it.

export const NATIVE_PURCHASE_REFUSAL = "Purchases aren't available in the app yet.";

const NATIVE_ORIGINS = ["https://localhost", "capacitor://localhost"];

export function fromNativeApp(req: { headers: { get(name: string): string | null } }): boolean {
  const origin = (req.headers.get("origin") ?? "").trim().toLowerCase();
  return origin === "" || NATIVE_ORIGINS.includes(origin);
}

/** 409, so the app shows the message and nobody gets an error alert. */
export function nativePurchaseRefusal(cors: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: NATIVE_PURCHASE_REFUSAL }), {
    status: 409,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
