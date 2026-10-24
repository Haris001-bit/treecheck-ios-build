import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { functionFailure } from '@/lib/functionFailure';

/**
 * "Where is your business based?" Asked once of company owners. The saved state comes from the map lookup on the
 * server, never from what was typed. Neutral wording: it never mentions a Free plan.
 */
export function BusinessLocationForm({ onSaved, title = 'Where is your business based?' }: { onSaved?: () => void; title?: string }) {
  const qc = useQueryClient();
  const suggestion = useQuery({
    queryKey: ['company-location'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('company-location', { body: { action: 'get' } });
      const failure = await functionFailure(error, data);
      if (failure) throw new Error(failure.message);
      return data as { location: { city: string; state: string } | null; suggestion: { city: string; state: string } | null };
    },
  });
  const [city, setCity] = useState<string | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cityValue = city ?? suggestion.data?.location?.city ?? suggestion.data?.suggestion?.city ?? '';
  const stateValue = state ?? suggestion.data?.location?.state ?? suggestion.data?.suggestion?.state ?? '';
  const save = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('company-location', { body: { action: 'save', city: cityValue.trim(), state: stateValue.trim() } });
      const failure = await functionFailure(error, data);
      if (failure) { toast.error(failure.message); return; }
      toast.success(`Saved: ${data.location.label}`);
      await qc.invalidateQueries({ queryKey: ['free-plan'] });
      await qc.invalidateQueries({ queryKey: ['company-location'] });
      onSaved?.();
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <h3 className="font-bold flex items-center gap-2"><MapPin className="w-4 h-4 text-primary" />{title}</h3>
      <p className="text-sm text-muted-foreground">Your company's main location. We ask once.</p>
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <div><Label htmlFor="biz-city">City</Label><Input id="biz-city" value={cityValue} onChange={(e) => setCity(e.target.value)} placeholder="Edmond" maxLength={100} /></div>
        <div><Label htmlFor="biz-state">State</Label><Input id="biz-state" value={stateValue} onChange={(e) => setState(e.target.value)} placeholder="OK" maxLength={40} /></div>
      </div>
      <Button onClick={save} disabled={busy || cityValue.trim().length < 2 || stateValue.trim().length < 2}>
        {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Save location
      </Button>
    </div>
  );
}
