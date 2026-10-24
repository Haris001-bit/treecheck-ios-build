import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { functionFailure } from '@/lib/functionFailure';

/** Admin only: a company's business location and a manual Free-plan switch for exceptions (e.g. a border town). */
export function AdminFreeOverride({ ownerId }: { ownerId: string }) {
  const qc = useQueryClient();
  const location = useQuery({
    queryKey: ['admin-company-location', ownerId],
    queryFn: async () => {
      const { data, error } = await supabase.from('company_locations').select('label, state, free_override, free_grace_until').eq('owner_id', ownerId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const set = async (value: boolean | null) => {
    const { data, error } = await supabase.functions.invoke('company-location', { body: { action: 'override', owner_id: ownerId, free_override: value } });
    const failure = await functionFailure(error, data);
    if (failure) { toast.error(failure.message); return; }
    toast.success(value === null ? 'Free plan follows the business location again.' : value ? 'Free plan turned on.' : 'Free plan turned off.');
    void qc.invalidateQueries({ queryKey: ['admin-company-location', ownerId] });
  };
  const l = location.data;
  const rule = !l ? 'No business location saved yet.' : l.free_override === true ? 'Free: on by hand' : l.free_override === false ? 'Free: off by hand' : `Free follows the location (${l.state === 'OK' ? 'Oklahoma, eligible' : 'not eligible'})`;
  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Business location and Free plan</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>{l?.label ?? 'Not set'}</p>
        <p className="text-muted-foreground">{rule}</p>
        {l && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={l.free_override === true ? 'default' : 'outline'} onClick={() => set(true)}>Turn Free on</Button>
            <Button size="sm" variant={l.free_override === false ? 'default' : 'outline'} onClick={() => set(false)}>Turn Free off</Button>
            <Button size="sm" variant={l.free_override === null ? 'default' : 'outline'} onClick={() => set(null)}>Follow location</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
