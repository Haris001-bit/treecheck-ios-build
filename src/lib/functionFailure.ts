// What an edge function call actually said when it failed. supabase.functions.invoke turns any non-2xx answer into
// a generic "Edge Function returned a non-2xx status code"; the function's own message is in the response body.

export interface FunctionFailure {
  message: string;
  /** HTTP status, or null when the call never got an answer (offline, blocked). */
  status: number | null;
}

/** Null when the call worked. */
export async function functionFailure(error: unknown, data: unknown): Promise<FunctionFailure | null> {
  const said = (data as { error?: unknown } | null | undefined)?.error;
  if (typeof said === 'string' && said) return { message: said, status: 200 };
  if (!error) return null;
  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    let message = '';
    try {
      const body = (await context.clone().json()) as { error?: unknown };
      if (typeof body?.error === 'string') message = body.error;
    } catch {
      /* not JSON */
    }
    return { message: message || (error as Error).message || 'Something went wrong', status: context.status };
  }
  return { message: error instanceof Error ? error.message : String(error), status: null };
}

/** A failure the person can fix themselves (wrong password, bad city): show it, don't alert anyone. */
export function isUserFixable(failure: FunctionFailure): boolean {
  return failure.status !== null && failure.status < 500;
}
