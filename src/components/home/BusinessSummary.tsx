// Under "Welcome back" for companies without Financial Pulse numbers: an AI-written, matter-of-fact
// month summary from TreeCheck job activity (home-summary function). Never uses Pulse data.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function BusinessSummary({ uid }: { uid: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['home-ai-summary', uid],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('home-summary', { body: {} });
      if (error || data?.error) throw new Error(data?.error || 'unavailable');
      return data as { summary: string; ai: boolean };
    },
    staleTime: 30 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (isLoading) return <p className="mt-2 min-h-10 text-sm text-muted-foreground" role="status">Summarizing this month…</p>;
  if (isError || !data?.summary) return <p className="mt-2 text-sm text-muted-foreground">This month’s summary isn’t available right now.</p>;
  return (
    <div className="mt-2 max-w-2xl space-y-1">
      <p className="text-sm leading-relaxed">{data.summary}</p>
      {data.ai && <p className="text-xs text-muted-foreground">AI summary of your jobs, quotes and Scout estimates. Check the numbers below.</p>}
    </div>
  );
}
