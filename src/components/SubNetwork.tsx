import { useState } from 'react';
import { STANDARD_GROUND_RATE, rateValue } from '@/lib/groundRate';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { RatingBadge, ReviewsDialog } from '@/components/Reviews';
import { useProfile } from '@/hooks/useProfile';
import type { CrewMember } from '@/hooks/useCrew';
import { isNewNetworkResult, matchesCrewTrade } from '@/lib/crewLists';
import type { ReactNode } from 'react';

const TRADE_LABEL: Record<string, string> = { climber: 'Climber', ground: 'Ground crew', both: 'Climber + ground', stump: 'Stump grinder' };

/** Owner view: find subs near you from the shared network. */
export function FindSubsNearYou({ ownMembers = [], renderOwnMember }: { ownMembers?: CrewMember[]; renderOwnMember?: (member: CrewMember) => ReactNode }) {
  const { effectiveContractorId } = useAuth();
  const qc = useQueryClient();
  const [trade, setTrade] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewsFor, setReviewsFor] = useState<{ id: string; name: string } | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['network-subs', effectiveContractorId, trade],
    enabled: !!effectiveContractorId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('network_subs', { p_trade: trade === 'all' ? null : trade });
      if (error) throw error;
      return data as any[];
    },
  });

  const own = ownMembers.filter((m) => matchesCrewTrade(m.trade, trade));
  const network = (data ?? []).filter((s) => isNewNetworkResult(s.user_id, ownMembers));

  const add = async (userId: string) => {
    setBusy(userId);
    const { data: res, error } = await supabase.functions.invoke('network-connect', { body: { action: 'request', user_id: userId } });
    setBusy(null);
    if (error || res?.error) return toast.error(res?.error || 'Could not send request');
    toast.success(res?.already ? 'Already one of your subs' : 'Request sent. They will get a text to accept.');
    qc.invalidateQueries({ queryKey: ['network-subs'] });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Select value={trade} onValueChange={setTrade}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All trades</SelectItem>
            <SelectItem value="climber">Climbers</SelectItem>
            <SelectItem value="ground">Ground crew</SelectItem>
            <SelectItem value="stump">Stump grinders</SelectItem>
          </SelectContent>
        </Select>

      </div>
      {own.map((m) => <div key={m.id}>{renderOwnMember?.(m)}</div>)}
      {isError && <p className="text-sm text-destructive">Could not load the shared network.</p>}
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : !network.length && !own.length ? (
        <Card className="p-6 text-center text-sm">No network subs near you yet. As more subs join, they'll show up here.</Card>
      ) : network.map((s) => {
        const skills = [
          s.can_skid_steer && 'Skid steer', s.can_chipper && 'Chipper', s.crane_certified && 'Crane certified',
          s.owns_saws && 'Own saws', s.insured === 'yes' && 'Insured',
        ].filter(Boolean);
        return (
          <Card key={s.user_id} className="p-4 flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold">{s.full_name || 'Sub'}</span>
                <Badge variant="outline" className="text-[10px]">{TRADE_LABEL[s.trade] ?? s.trade}</Badge>
                {!s.taking_work && <Badge variant="outline" className="text-[10px]">Not taking work</Badge>}
              </div>
              <div className="text-xs">
                {s.home_city ? `${s.home_city} · ` : ''}{s.jobs_completed} jobs · <RatingBadge avg={s.rating_avg} count={s.rating_count} />
                {' · '}
                <button type="button" className="underline" onClick={() => setReviewsFor({ id: s.user_id, name: s.full_name || 'Sub' })}>Reviews</button>
              </div>
              {skills.length > 0 && <div className="text-xs">{skills.join(' · ')}</div>}
            </div>
            {s.connection_status === 'active' ? (
              <Badge>Connected</Badge>
            ) : s.connection_status === 'requested' ? (
              <Badge variant="outline">Request sent</Badge>
            ) : (
              <Button size="sm" disabled={busy === s.user_id} onClick={() => add(s.user_id)}>
                {busy === s.user_id && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Connect
              </Button>
            )}
          </Card>
        );
      })}
      <ReviewsDialog userId={reviewsFor?.id ?? null} name={reviewsFor?.name ?? ''} open={!!reviewsFor} onOpenChange={(o) => !o && setReviewsFor(null)} />
    </div>
  );
}

/** Sub view: network opt-in, home city, and company connection requests. */
export function SubNetworkSettings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: account } = useProfile();
  const { data: profile } = useQuery({
    queryKey: ['crew-profile', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await (supabase as any).from('crew_profiles').select('*').eq('user_id', user!.id).maybeSingle();
      return data ?? { user_id: user!.id, network_visible: true, home_city: '', travel_radius_miles: 25 };
    },
  });
  const { data: conns } = useQuery({
    queryKey: ['crew-connections', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase.functions.invoke('network-connect', { body: { action: 'list_requests' } });
      return (data?.items ?? []) as any[];
    },
  });
  const [city, setCity] = useState<string | null>(null);
  const [miles, setMiles] = useState<string | null>(null);
  const [rate, setRate] = useState<string | null>(null);

  const save = async (patch: Record<string, unknown>) => {
    const { error } = await (supabase as any).from('crew_profiles').upsert({
      user_id: user!.id,
      network_visible: profile?.network_visible ?? true,
      home_city: profile?.home_city ?? null,
      travel_radius_miles: profile?.travel_radius_miles ?? 25,
      ...patch,
      updated_at: new Date().toISOString(),
    });
    if (error) return toast.error('Could not save');
    toast.success('Saved');
    qc.invalidateQueries({ queryKey: ['crew-profile', user?.id] });
  };
  const respond = async (id: string, accept: boolean) => {
    await supabase.functions.invoke('network-connect', { body: { action: 'respond', crew_member_id: id, accept } });
    qc.invalidateQueries({ queryKey: ['crew-connections'] });
    qc.invalidateQueries({ queryKey: ['my-crew-memberships'] });
  };
  const hide = async (ownerId: string) => {
    await supabase.functions.invoke('network-connect', { body: { action: 'hide', owner_id: ownerId } });
    toast.success("That company won't see you anymore");
    qc.invalidateQueries({ queryKey: ['crew-connections'] });
  };

  // The event demo's logins stay off the shared network, so real companies never see or link them.
  if (!profile || account?.is_sandbox) return null;
  const requests = (conns ?? []).filter((c) => c.status === 'requested');
  const companies = (conns ?? []).filter((c) => c.status === 'active' || c.status === 'network');

  return (
    <Card className="p-4 space-y-4 mb-4">
      <div className="flex items-center gap-2 font-bold"><Users className="w-5 h-5 text-primary" />Work for other companies</div>
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm">Let other tree companies in my area find me and send me jobs.</div>
        <Switch checked={!!profile.network_visible} onCheckedChange={(v) => save({ network_visible: v })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Home city</Label>
          <Input value={city ?? profile.home_city ?? ''} onChange={(e) => setCity(e.target.value)} onBlur={() => city !== null && save({ home_city: city.trim() || null })} placeholder="Oklahoma City" />
        </div>
        <div>
          <Label>Travel up to (miles)</Label>
          <Input type="number" inputMode="numeric" value={miles ?? String(profile.travel_radius_miles ?? 25)} onChange={(e) => setMiles(e.target.value)} onBlur={() => miles !== null && save({ travel_radius_miles: Number(miles) || 25 })} />
        </div>
      </div>
      <div>
        <Label>My hourly rate (ground work)</Label>
        <Input type="number" inputMode="decimal" placeholder={`Standard $${STANDARD_GROUND_RATE}`}
          value={rate ?? (profile.hourly_rate == null ? '' : String(profile.hourly_rate))}
          onChange={(e) => setRate(e.target.value)}
          onBlur={() => {
            if (rate === null) return;
            const v = rateValue(rate);
            if (v === undefined) return toast.error('Enter an hourly rate between $0 and $200, or leave it blank');
            save({ hourly_rate: v });
          }} />
        <p className="text-xs text-muted-foreground mt-1">Our standard pay is ${STANDARD_GROUND_RATE}/hr. If your rate is higher, you'll still get job alerts, but only after the ${STANDARD_GROUND_RATE}/hr crew has had a chance to claim the job.</p>
      </div>
      {requests.length > 0 && (
        <div className="space-y-2">
          <div className="font-bold text-sm">Companies that want to add you</div>
          {requests.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-md border p-2">
              <div className="text-sm font-bold">{r.company} <RatingBadge avg={r.rating_avg} count={r.rating_count} /></div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => respond(r.id, false)}>Decline</Button>
                <Button size="sm" onClick={() => respond(r.id, true)}>Accept</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {companies.length > 0 && (
        <div className="space-y-1">
          <div className="font-bold text-sm">Companies sending you jobs</div>
          {companies.map((c) => (
            <div key={c.id} className="flex items-center justify-between text-sm">
              <span>{c.company} <RatingBadge avg={c.rating_avg} count={c.rating_count} /></span>
              <button type="button" className="text-xs underline" onClick={() => hide(c.owner_contractor_id)}>Hide me from them</button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
