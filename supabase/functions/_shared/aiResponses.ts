// One call to the Lovable AI gateway's Responses API with a strict JSON schema, read from its event stream (the same
// call calibration-analyze makes). No Deno here, so vitest can test readResponsesStream. The caller passes the key.

export const GATEWAY_RESPONSES = "https://ai.gateway.lovable.dev/v1/responses";

/** The output text of a streamed Responses answer (response.output_text.delta events). */
export async function readResponsesStream(body: ReadableStream<Uint8Array>): Promise<{ text: string; failed: boolean }> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  let failed = false;
  const take = (line: string) => {
    const l = line.trim();
    if (!l.startsWith("data:")) return;
    const data = l.slice(5).trim();
    if (!data || data === "[DONE]") return;
    try {
      const ev = JSON.parse(data);
      if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") text += ev.delta;
      if (ev.type === "response.failed" || ev.type === "error") failed = true;
    } catch { /* a partial line */ }
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) { take(buf.slice(0, idx)); buf = buf.slice(idx + 1); }
  }
  if (buf) take(buf);
  return { text, failed };
}

export type AiResult =
  | { kind: "ok"; value: unknown }
  | { kind: "error"; status: number; message: string };

export interface AiCall {
  apiKey: string;
  model: string;
  name: string;
  schema: unknown;
  content: unknown[];
  effort?: "low" | "medium" | "high";
  /** What to tell the person when the gateway refuses the input itself (a 400). */
  unreadable: string;
}

export async function callResponses(c: AiCall, fetcher: typeof fetch = fetch): Promise<AiResult> {
  const res = await fetcher(GATEWAY_RESPONSES, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${c.apiKey}`,
      "Lovable-API-Key": c.apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: c.model,
      stream: true,
      store: false,
      reasoning: { effort: c.effort ?? "low", summary: "auto" },
      include: ["reasoning.encrypted_content"],
      input: [{ role: "user", content: c.content }],
      text: { format: { type: "json_schema", name: c.name, strict: true, schema: c.schema } },
    }),
  });
  if (!res.ok || !res.body) {
    const msg = await res.text().catch(() => "");
    console.error(`ai ${c.name}`, res.status, msg.slice(0, 400));
    if (res.status === 402) return { kind: "error", status: 402, message: "This feature is temporarily unavailable. Please try again later." };
    if (res.status === 429) return { kind: "error", status: 429, message: "The AI is busy. Try again in a minute." };
    if (res.status === 400 || res.status === 413 || res.status === 415) return { kind: "error", status: 400, message: c.unreadable };
    return { kind: "error", status: 502, message: "The AI couldn't answer just now. Try again." };
  }
  const { text, failed } = await readResponsesStream(res.body);
  if (failed && !text) return { kind: "error", status: 502, message: "The AI couldn't answer just now. Try again." };
  try {
    return { kind: "ok", value: JSON.parse(text) };
  } catch {
    return { kind: "error", status: 502, message: c.unreadable };
  }
}
