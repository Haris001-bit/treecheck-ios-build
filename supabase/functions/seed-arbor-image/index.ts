// Retired 2026-09-29 (security hardening before Financial Pulse).
// This function changed real accounts' passwords without checking who was calling.
// It is deployed as this stub first so the live endpoint stops working, then the folder is removed.
Deno.serve(() =>
  new Response(JSON.stringify({ error: "Gone" }), {
    status: 410,
    headers: { "Content-Type": "application/json" },
  })
);
