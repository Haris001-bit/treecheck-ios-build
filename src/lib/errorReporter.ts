import { supabase } from '@/integrations/supabase/client';
const ignored = /network|offline|failed to fetch|load failed|cancel/i;
export function reportSeriousError(action: string, error: unknown, journey = 'app', email?: string | null) {
  const summary = error instanceof Error ? error.message : String(error || 'Unexpected error');
  if (!summary || ignored.test(summary)) return;
  void supabase.functions.invoke('report-serious-error', {
    body: { journey, action, summary: summary.slice(0, 500), email: email || null, fingerprint: `${journey}:${action}:${summary.slice(0, 160)}` },
  }).catch(() => {});
}
export function installGlobalErrorReporter() {
  const onError = (event: ErrorEvent) => reportSeriousError('uncaught error', event.error || event.message);
  const onRejection = (event: PromiseRejectionEvent) => reportSeriousError('unhandled action', event.reason);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
}
