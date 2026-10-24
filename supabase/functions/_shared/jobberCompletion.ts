// TreeCheck Jobber sync: a job closed in Jobber marks its TreeCheck job complete, which opens the crew
// ratings. Called from jobber-webhook's TreeCheck branch for JOB_ events, behind the company's
// completion_sync switch. Server-side only. Maintained outside Lovable.
//
// The Jobber job is matched to its TreeCheck job through the quote TreeCheck made: Leslee converts that
// quote into the job, and the job keeps a link to it (bid_requests.jobber_quote_id). Jobs that didn't
// come from a TreeCheck quote are left alone.
//
// "Complete" follows jobberStatus.completionDecision: Jobber closed the job, at least one visit was
// completed and none is still open, and the TreeCheck job is still open. A job closed with no visit done
// is left as it is. The update is conditional, so a status the office set by hand is never overwritten.
// Jobber errors are thrown, so the webhook's retries and Jobber's redelivery apply.

import { jobberRead, tokenFor } from "./jobberApi.ts";
import { jobberSwitches, type JobberSwitches } from "./jobberSwitches.ts";
import { completionDecision, OPEN_WORKFLOW } from "./jobberStatus.ts";
import { TC_JobState } from "./jobberQueries.webhook.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

interface JobNode {
  id?: string;
  jobNumber?: number | string | null;
  jobStatus?: string | null;
  completedAt?: string | null;
  quote?: { id?: string | null } | null;
  visitsInfo?: { incompleteTotal?: number | null } | null;
  visits?: { nodes?: Array<{ isComplete?: boolean | null } | null> | null } | null;
}

/** For tests: replacements for the switch read and the token. */
export interface CompletionDeps {
  switches?: (admin: Admin, ownerId: string) => Promise<JobberSwitches>;
  token?: (admin: Admin, ownerId: string) => Promise<string | null>;
}

/**
 * Handles one JOB_ event for the company. Returns the outcome to record (every outcome starts with
 * "tc:"), or null when the company's completion_sync switch is off.
 */
export async function completeFromJobber(
  admin: Admin,
  ownerId: string,
  jobId: string,
  deps: CompletionDeps = {},
): Promise<string | null> {
  const switches = await (deps.switches ?? jobberSwitches)(admin, ownerId);
  if (!switches.completionSync) return null;

  const token = await (deps.token ?? tokenFor)(admin, ownerId);
  if (!token) return "tc: no Jobber token";

  const { data } = await jobberRead<{ job?: JobNode | null }>(token, TC_JobState, { id: jobId }, { retries: 1, retryOn: "throttle" });
  const job = data.job;
  if (!job) return "tc: job not in Jobber any more";
  const quoteId = job.quote?.id;
  if (!quoteId) return "tc: not a TreeCheck job";

  const { data: request } = await admin
    .from("bid_requests")
    .select("id, workflow_status")
    .eq("jobber_quote_id", quoteId)
    .eq("owner_contractor_id", ownerId)
    .maybeSingle();
  if (!request) return "tc: not a TreeCheck job";

  const visits = (job.visits?.nodes ?? []).filter(Boolean);
  const decision = completionDecision(
    {
      jobStatus: job.jobStatus ?? null,
      completedAt: job.completedAt ?? null,
      incompleteVisits: job.visitsInfo?.incompleteTotal ?? null,
      completedVisits: visits.filter((v) => v?.isComplete === true).length,
    },
    { workflowStatus: request.workflow_status ?? null, completionSyncedAt: null, jobberCompletedAt: null },
  );
  if (decision === "cancelled") return "tc: closed in Jobber with no visit done, so left as is";
  if (decision === "record_only") return "tc: already closed in TreeCheck, so left as is";
  if (decision !== "complete") return "tc: not complete yet";

  const { data: updated, error } = await admin
    .from("bid_requests")
    .update({ workflow_status: "job_complete" })
    .eq("id", request.id)
    .in("workflow_status", [...OPEN_WORKFLOW])
    .select("id");
  if (error) throw new Error(`Couldn't mark the job complete: ${error.message ?? error}`);
  if (!updated?.length) return "tc: status changed meanwhile, so left as is";

  const number = job.jobNumber == null ? "" : ` #${job.jobNumber}`;
  try {
    await admin.from("job_activity").insert({
      bid_request_id: request.id,
      kind: "jobber_completed",
      summary: `Marked complete from Jobber (job${number})`,
      actor_user_id: null,
    });
  } catch (e) {
    console.error("job activity not saved", e);
  }
  return `tc: marked complete from Jobber job${number}`;
}
