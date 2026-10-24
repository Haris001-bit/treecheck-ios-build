import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Flag, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Stars } from '@/components/Reviews';

const REASON: Record<string, string> = {
  offensive: 'Offensive language', false: 'False / unrelated', personal_info: 'Personal info', harassment: 'Harassment', other: 'Other',
};

export default function AdminReviewReports() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['review-reports'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('review-moderate', { body: { action: 'list' } });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      return data.items as any[];
    },
  });
  const resolve = async (id: string, decision: 'keep' | 'hide_comment' | 'remove') => {
    const { data: res, error } = await supabase.functions.invoke('review-moderate', { body: { action: 'resolve', review_id: id, decision } });
    if (error || res?.error) return toast.error('Could not update');
    toast.success('Done');
    qc.invalidateQueries({ queryKey: ['review-reports'] });
  };

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold flex items-center gap-2"><Flag className="w-6 h-6 text-primary" />Review Reports</h1>
      {isLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : !data?.length ? (
        <Card className="p-8 text-center">Nothing to review.</Card>
      ) : data.map((r) => (
        <Card key={r.id} className="p-4 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm"><strong>{r.reviewer_name}</strong> rated <strong>{r.reviewee_name}</strong></div>
            <Stars value={r.stars} size="sm" />
          </div>
          {r.status === 'pending_review' && <Badge variant="outline">Held automatically</Badge>}
          {r.comment && <p className="text-sm bg-muted/40 rounded p-2">{r.comment}</p>}
          <div className="text-xs">
            {r.reports.map((rep: any) => `${REASON[rep.reason] ?? rep.reason}${rep.notes ? ` (${rep.notes})` : ''}`).join(' · ')}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => resolve(r.id, 'keep')}>Keep</Button>
            <Button size="sm" variant="outline" onClick={() => resolve(r.id, 'hide_comment')}>Hide comment (keep stars)</Button>
            <Button size="sm" variant="destructive" onClick={() => resolve(r.id, 'remove')}>Remove review</Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
