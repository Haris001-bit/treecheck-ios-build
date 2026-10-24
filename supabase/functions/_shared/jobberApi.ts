// TreeCheck's own Jobber API wrapper (Jobber milestone). Server-side only. Maintained outside Lovable.
// Every TreeCheck call to Jobber's GraphQL API goes through this file. Financial Pulse keeps its own
// calls in _shared/jobber.ts and _shared/pulse/, which this file never changes.
//
// The token rule: tokenFor (getJobberToken) always runs to completion before any time budget starts.
// Jobber rotates refresh tokens, so a refresh cut short could lose the new token and disconnect the
// company. Budgets are only ever AbortSignals on the GraphQL fetches below (see deadline); nothing
// here, and nothing that calls it, may run Promise.race on a chain that contains the token.
//
// Reads (jobberRead) retry THROTTLED and HTTP 429 a bounded number of times, and 5xx too unless the
// caller passes retryOn "throttle" (the older webhook part retries reads only after THROTTLED or 429).
// Mutations (jobberMutate) are never retried, and every failure says whether Jobber ran it:
// * JobberDefiniteError, Jobber certainly did not run it: nothing was sent, HTTP 4xx (429 included),
//   THROTTLED, GraphQL errors that came with no data key (parse and validation errors, which stop a
//   request before Jobber runs any of it), a reply with neither data nor errors (an empty payload
//   included), or userErrors on the payload. Safe to try again later.
// * JobberUncertainError, Jobber may have run it: HTTP 5xx, a timeout, abort or network error once the
//   request was on its way, a reply that could not be read, or GraphQL errors that came with a data key
//   ("data": null included: the GraphQL spec, section 7.1.2, sends data once execution has started) or
//   that point at a field of the result. Never resend it. Read Jobber first to find out what happened.

import { getJobberToken, JOBBER_GRAPHQL_URL } from "./jobber.ts";

/** The Jobber API version every TreeCheck call sends. */
export const TC_JOBBER_VERSION = "2026-09-25";

/** Time limit for one read attempt when the caller gives none. */
const READ_TIMEOUT_MS = 10_000;
/** Time limit for a mutation when the caller gives none: longer, so fewer outcomes are uncertain. */
const MUTATE_TIMEOUT_MS = 15_000;
/** Extra read attempts after THROTTLED, 429 or 5xx when the caller gives none. */
const READ_RETRIES = 2;
const BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 4_000;
/** Longest text shortJobberError returns. */
const SHORT_MAX = 200;
/** Words that jobber-webhook's isRetryable looks for; shortJobberError never drops them. */
const MARKERS = ["not found in Jobber", "No Jobber token connected", "reconnect"];
const NO_TOKEN = "No Jobber token connected";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** Jobber's rate-limit state from a reply's extensions.cost (a bucket of query points that refills). */
export interface JobberThrottle {
  maximumAvailable: number;
  currentlyAvailable: number;
  /** Points restored per second. */
  restoreRate: number;
  /** What the query asked for, when Jobber said. */
  requestedQueryCost: number | null;
}

/** A successful Jobber call: the reply's data and Jobber's rate-limit state, when it sent one. */
export interface JobberReply<T> {
  data: T;
  throttle: JobberThrottle | null;
}

/** Options for one Jobber call: `signal` is the caller's whole budget (see deadline), `timeoutMs` limits one attempt. */
export interface JobberCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Which replies jobberRead tries again: THROTTLED and HTTP 429 only, or those and HTTP 5xx (the default). */
export type JobberRetryOn = "throttle" | "throttle_or_5xx";

/** Read options: `retries` is how many extra attempts the replies `retryOn` names get. */
export interface JobberReadOptions extends JobberCallOptions {
  retries?: number;
  retryOn?: JobberRetryOn;
}

/** How a Jobber call failed. */
export type JobberErrorKind =
  | "no_token" // no access token was given
  | "throttled" // Jobber's rate limit: THROTTLED or HTTP 429
  | "http" // Jobber answered with an HTTP error status
  | "graphql" // Jobber answered with GraphQL errors
  | "user_errors" // a mutation's payload listed userErrors
  | "no_data" // Jobber answered with no data
  | "bad_reply" // the answer could not be read as JSON
  | "timeout" // no answer within timeoutMs
  | "aborted" // the caller's signal ended (its budget ran out)
  | "network"; // the request failed on its way

/** A failed Jobber call. Reads throw this; mutations throw JobberDefiniteError or JobberUncertainError. */
export class JobberCallError extends Error {
  readonly kind: JobberErrorKind;
  /** The HTTP status when Jobber answered, otherwise null. */
  readonly status: number | null;
  constructor(kind: JobberErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "JobberCallError";
    this.kind = kind;
    this.status = status;
  }
}

/** A mutation Jobber certainly did not run. Safe to try again later. */
export class JobberDefiniteError extends JobberCallError {
  /** The payload's userErrors messages, when they were the reason. */
  readonly userErrors: string[];
  constructor(kind: JobberErrorKind, message: string, status: number | null = null, userErrors: string[] = []) {
    super(kind, message, status);
    this.name = "JobberDefiniteError";
    this.userErrors = userErrors;
  }
}

/** A mutation Jobber may have run. Never resend it: read Jobber first. */
export class JobberUncertainError extends JobberCallError {
  constructor(kind: JobberErrorKind, message: string, status: number | null = null) {
    super(kind, message, status);
    this.name = "JobberUncertainError";
  }
}

/** The company's Jobber access token, or null when not connected; pass the owner's id and await it before any budget starts. */
export async function tokenFor(admin: Admin, ownerId: string): Promise<string | null> {
  return await getJobberToken(admin, ownerId);
}

/** An AbortSignal that ends after `ms`, the budget for the Jobber calls after it; create it only once tokenFor has returned. */
export function deadline(ms: number): AbortSignal {
  const ctl = new AbortController();
  const timer = setTimeout(
    () => ctl.abort(new DOMException("Jobber time budget used up", "TimeoutError")),
    Math.max(0, ms),
  );
  unrefTimer(timer);
  return ctl.signal;
}

/** Runs one read, retrying THROTTLED, HTTP 429 and (unless retryOn is "throttle") 5xx up to `retries` times; throws JobberCallError. */
export async function jobberRead<T = unknown>(
  token: string,
  doc: string,
  vars: Record<string, unknown> = {},
  opts: JobberReadOptions = {},
): Promise<JobberReply<T>> {
  if (!token) throw new JobberCallError("no_token", NO_TOKEN);
  const retries = Math.max(0, Math.floor(opts.retries ?? READ_RETRIES));
  const retryServerErrors = opts.retryOn !== "throttle";
  for (let attempt = 0; ; attempt++) {
    if (opts.signal?.aborted) throw new JobberCallError("aborted", "Time ran out before Jobber answered");
    const answer = await post(token, doc, vars, opts, READ_TIMEOUT_MS);
    const { status, body } = answer;
    const errors = errorList(body);
    const throttled = status === 429 || errors.some(isThrottled);
    if ((throttled || (retryServerErrors && status >= 500)) && attempt < retries) {
      await pause(backoffMs(attempt, throttleOf(body?.extensions)), opts.signal);
      continue;
    }
    if (throttled) throw new JobberCallError("throttled", "Jobber is busy (rate limit)", status);
    if (status >= 500) throw new JobberCallError("http", `Jobber had a server error (HTTP ${status})`, status);
    if (!answer.ok) throw new JobberCallError("http", refused(status, errors, token), status);
    if (!body) throw new JobberCallError("bad_reply", "Jobber's reply could not be read", status);
    if (errors.length) throw new JobberCallError("graphql", `Jobber error: ${messages(errors, token)}`, status);
    if (!isObject(body.data)) throw new JobberCallError("no_data", "Jobber sent back no data", status);
    return { data: body.data as T, throttle: throttleOf(body.extensions) };
  }
}

/** Runs one mutation, never retried; its payload must select only ids, numbers and userErrors { message path }. */
export async function jobberMutate<T = unknown>(
  token: string,
  doc: string,
  vars: Record<string, unknown> = {},
  opts: JobberCallOptions = {},
): Promise<JobberReply<T>> {
  // Selecting only ids and numbers keeps a reply from failing on a field after Jobber saved the record,
  // which would turn a success into an uncertain outcome. Read anything else afterwards with jobberRead.
  if (!token) throw new JobberDefiniteError("no_token", NO_TOKEN);
  if (opts.signal?.aborted) throw new JobberDefiniteError("aborted", "Time ran out before this was sent to Jobber");
  let answer: Answer;
  try {
    answer = await post(token, doc, vars, opts, MUTATE_TIMEOUT_MS);
  } catch (e) {
    // Anything other than a JobberCallError was thrown before sending (variables that cannot be sent).
    if (!(e instanceof JobberCallError)) throw e;
    throw new JobberUncertainError(e.kind, maySaved(e.message));
  }
  const { status, body } = answer;
  const errors = errorList(body);
  if (status >= 500) throw new JobberUncertainError("http", maySaved(`Jobber had a server error (HTTP ${status})`), status);
  if (status === 429 || errors.some(isThrottled)) {
    throw new JobberDefiniteError("throttled", "Jobber is busy (rate limit) and did not save this", status);
  }
  if (!answer.ok) throw new JobberDefiniteError("http", refused(status, errors, token), status);
  if (!body) throw new JobberUncertainError("bad_reply", maySaved("Jobber's reply could not be read"), status);
  const data = body.data;
  if (errors.length) {
    const text = `Jobber error: ${messages(errors, token)}`;
    // A data key, even "data": null, means Jobber had started running the mutation, and so does an
    // error raised by a field of the result. Only parse and validation errors come with neither.
    if ("data" in body || errors.some(raisedByResultField)) throw new JobberUncertainError("graphql", maySaved(text), status);
    throw new JobberDefiniteError("graphql", text, status);
  }
  if (!isObject(data) || Object.values(data).every((v) => v == null)) {
    throw new JobberDefiniteError("no_data", "Jobber sent back no data", status);
  }
  const userErrors = payloadUserErrors(data, token);
  if (userErrors.length) {
    throw new JobberDefiniteError("user_errors", `Jobber did not accept it: ${userErrors.join("; ")}`, status, userErrors);
  }
  return { data: data as T, throttle: throttleOf(body.extensions) };
}

/** Jobber's rate-limit state from a reply's extensions (cost.throttleStatus), or null when missing or malformed. */
export function throttleOf(extensions: unknown): JobberThrottle | null {
  const cost = isObject(extensions) && isObject(extensions.cost) ? extensions.cost : null;
  const status = cost && isObject(cost.throttleStatus) ? cost.throttleStatus : null;
  if (!cost || !status) return null;
  const maximumAvailable = num(status.maximumAvailable);
  const currentlyAvailable = num(status.currentlyAvailable);
  const restoreRate = num(status.restoreRate);
  if (maximumAvailable === null || currentlyAvailable === null || restoreRate === null) return null;
  return { maximumAvailable, currentlyAvailable, restoreRate, requestedQueryCost: num(cost.requestedQueryCost) };
}

/** A plain, one-line error text of at most 200 characters; keeps the retry markers, never "pulse: " or a token. */
export function shortJobberError(e: unknown): string {
  const text = oneLine(hideTokens(rawText(e))).replace(/(pulse):/gi, "$1") || "Unknown Jobber error";
  if (text.length <= SHORT_MAX) return text;
  const lower = text.toLowerCase();
  const present = MARKERS.filter((m) => lower.includes(m.toLowerCase()));
  const room = SHORT_MAX - 3 - (present.length ? present.join(", ").length + 3 : 0);
  const head = text.slice(0, room).trimEnd();
  const missing = present.filter((m) => !head.toLowerCase().includes(m.toLowerCase()));
  return `${head}...${missing.length ? ` (${missing.join(", ")})` : ""}`;
}

// ---------------------------------------------------------------------------------------------------

interface JobberBody {
  data?: unknown;
  errors?: unknown;
  extensions?: unknown;
}

interface Answer {
  status: number;
  ok: boolean;
  /** The parsed reply, or null when it was not a JSON object. */
  body: JobberBody | null;
}

/** POSTs one document and reads the whole reply; throws JobberCallError (timeout, aborted, network) when none arrived. */
async function post(
  token: string,
  doc: string,
  vars: Record<string, unknown>,
  opts: JobberCallOptions,
  defaultTimeoutMs: number,
): Promise<Answer> {
  const payload = JSON.stringify({ query: doc, variables: vars });
  const ctl = new AbortController();
  let why: "timeout" | "aborted" | null = null;
  const stop = (reason: "timeout" | "aborted") => {
    if (!why) why = reason;
    ctl.abort();
  };
  const onAbort = () => stop("aborted");
  opts.signal?.addEventListener("abort", onAbort);
  if (opts.signal?.aborted) stop("aborted");
  const timer = setTimeout(() => stop("timeout"), Math.max(0, opts.timeoutMs ?? defaultTimeoutMs));
  try {
    const res = await fetch(JOBBER_GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-JOBBER-GRAPHQL-VERSION": TC_JOBBER_VERSION,
      },
      body: payload,
      signal: ctl.signal,
    });
    const text = await res.text();
    const body = parseBody(text);
    noteVersionWarning(body);
    return { status: res.status, ok: res.ok, body };
  } catch (e) {
    if (why === "timeout") throw new JobberCallError("timeout", "Jobber did not answer in time");
    if (why === "aborted") throw new JobberCallError("aborted", "Time ran out before Jobber answered");
    const detail = clean(rawText(e), token, 120);
    throw new JobberCallError("network", `The connection to Jobber failed${detail ? ` (${detail})` : ""}`);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

function parseBody(text: string): JobberBody | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

let versionWarned = false;

/** Logs Jobber's API version warning (the pinned version is ending) once per isolate. */
function noteVersionWarning(body: JobberBody | null): void {
  if (versionWarned || !body || !isObject(body.extensions)) return;
  const versioning = body.extensions.versioning;
  const warning = isObject(versioning) ? versioning.warning : null;
  if (warning == null || warning === "") return;
  versionWarned = true;
  console.warn(`[jobberApi] Jobber API version ${TC_JOBBER_VERSION} warning: ${oneLine(rawText(warning)).slice(0, 300)}`);
}

/** Waits before a retry; ends early with JobberCallError("aborted") when the signal ends. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const ranOut = () => new JobberCallError("aborted", "Time ran out while waiting to try Jobber again");
    if (signal?.aborted) return reject(ranOut());
    const onAbort = () => {
      clearTimeout(timer);
      reject(ranOut());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** A short step per attempt, or long enough for Jobber's bucket to refill when it said how empty it is. */
function backoffMs(attempt: number, throttle: JobberThrottle | null): number {
  const step = BACKOFF_MS * (attempt + 1);
  if (!throttle || throttle.restoreRate <= 0 || throttle.requestedQueryCost === null) return Math.min(MAX_BACKOFF_MS, step);
  const refill = Math.ceil(((throttle.requestedQueryCost - throttle.currentlyAvailable) / throttle.restoreRate) * 1000);
  return Math.min(MAX_BACKOFF_MS, Math.max(step, refill));
}

/** Lets a pending timer not hold the isolate open (Deno and Node each have their own hook). */
function unrefTimer(timer: unknown): void {
  const deno = (globalThis as unknown as { Deno?: { unrefTimer?: (id: number) => void } }).Deno;
  if (typeof timer === "number") deno?.unrefTimer?.(timer);
  else (timer as { unref?: () => void } | null)?.unref?.();
}

function errorList(body: JobberBody | null): unknown[] {
  if (!body || body.errors == null) return [];
  return Array.isArray(body.errors) ? body.errors : [body.errors];
}

/**
 * True for an error raised while a field of the result ran: its path starts with a result field
 * ("quoteCreate"). A validation error from Jobber's GraphQL server (graphql-ruby) also carries a
 * path, but into the document, starting with the operation ("mutation TC_QuoteCreate") or a fragment.
 */
function raisedByResultField(error: unknown): boolean {
  if (!isObject(error) || !Array.isArray(error.path) || error.path.length === 0) return false;
  const head = error.path[0];
  return !(typeof head === "string" && /^(?:query|mutation|subscription|fragment)(?:\s|$)/.test(head));
}

function isThrottled(error: unknown): boolean {
  if (!isObject(error)) return false;
  const code = isObject(error.extensions) ? error.extensions.code : null;
  return code === "THROTTLED" || (typeof error.message === "string" && /^throttled$/i.test(error.message.trim()));
}

/** The GraphQL errors' messages, joined, without the token. */
function messages(errors: unknown[], token: string): string {
  const list = errors.map((e) => clean(isObject(e) && typeof e.message === "string" ? e.message : rawText(e), token, 200));
  return list.filter(Boolean).join("; ").slice(0, 400) || "unknown error";
}

function refused(status: number, errors: unknown[], token: string): string {
  return `Jobber refused the request (HTTP ${status})${errors.length ? `: ${messages(errors, token)}` : ""}`;
}

function maySaved(message: string): string {
  return `${message}, so it may have saved this`;
}

/** userErrors messages from every payload in a mutation's data. */
function payloadUserErrors(data: Record<string, unknown>, token: string): string[] {
  const out: string[] = [];
  for (const payload of Object.values(data)) {
    const list = isObject(payload) ? payload.userErrors : null;
    if (!Array.isArray(list)) continue;
    for (const u of list) {
      out.push(clean(isObject(u) && typeof u.message === "string" ? u.message : "invalid input", token, 200));
    }
  }
  return out;
}

/** One line of text from Jobber or the network, without the token, at most `max` characters. */
function clean(text: string, token: string, max: number): string {
  const hidden = token && token.length >= 8 ? text.split(token).join("[token]") : text;
  return oneLine(hideTokens(hidden)).slice(0, max);
}

/** Hides anything that looks like a bearer token or a JWT. */
function hideTokens(text: string): string {
  return text
    .replace(/Bearer\s+[\w.~+/=-]+/gi, "Bearer [hidden]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, "[hidden]");
}

/** Plain words on one line: no em or en dashes, no line breaks. */
function oneLine(text: string): string {
  return text
    .replace(/\s+[–—]\s+/g, ", ")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function rawText(e: unknown): string {
  if (e == null) return "";
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
