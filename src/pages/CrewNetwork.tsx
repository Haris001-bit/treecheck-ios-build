import { useEffect, useState } from 'react';
import { STANDARD_GROUND_RATE, rateValue } from '@/lib/groundRate';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useCrewNetwork, useCompletedCrewWork, useCrewAvailabilityMap, type CrewMember } from '@/hooks/useCrew';
import { Checkbox } from '@/components/ui/checkbox';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HardHat, Loader2, UserPlus, Copy, Star, Check, X, Phone } from 'lucide-react';
import { StarRow } from '@/components/Reviews';
import { toast } from 'sonner';
import { hasWorkedTogether } from '@/lib/crewLists';
import { FindSubsNearYou } from '@/components/SubNetwork';
import { useProfile } from '@/hooks/useProfile';
import { getWebBaseUrl } from '@/lib/platform';

const TRADE_LABEL: Record<string, string> = {
  pending: 'Not chosen yet',
  climber: 'Climber',
  ground: 'Ground crew',
  both: 'Climber + ground',
  stump: 'Stump grinder',
};

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const CAPABILITY_FIELDS: { key: keyof CrewMember; label: string }[] = [
  { key: 'can_skid_steer', label: 'Skid steer' },
  { key: 'mini_skid_experience', label: 'Mini skid steer' },
  { key: 'can_chipper', label: 'Chipper' },
  { key: 'crane_certified', label: 'Crane certified' },
  { key: 'truck_trailer_experience', label: 'Truck + trailer' },
  { key: 'disposal_runs_ok', label: 'Disposal runs' },
  { key: 'owns_saws', label: 'Own saws' },
  { key: 'has_drivers_license', label: "Driver's license" },
  { key: 'wants_ground_work', label: 'Wants ground work' },
];

function availabilityLine(a?: { weekly_days: number[]; unavailable_dates: string[]; taking_work: boolean } | null) {
  if (!a) return 'Availability not set yet';
  const days = (a.weekly_days ?? []).slice().sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7));
  const label = days.length ? days.map((d) => DAY_SHORT[d]).join(', ') : 'no days set';
  const off = (a.unavailable_dates ?? []).length;
  return `Works ${label}${off ? ` · ${off} day${off === 1 ? '' : 's'} blocked off` : ''}`;
}

export default function CrewNetwork() {
  const [tab, setTab] = useState<'mine' | 'find'>('mine');
  // The event demo never lists real subcontractors on a public booth screen.
  const { data: account } = useProfile();
  const isDemo = account?.is_sandbox === true;
  const { effectiveContractorId } = useAuth();
  const qc = useQueryClient();
  const { data: crew, isLoading } = useCrewNetwork();
  const { data: completedIds, isLoading: workLoading, isError: workError } = useCompletedCrewWork();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [autoBroadcast, setAutoBroadcast] = useState(false);
  const [openingLeads, setOpeningLeads] = useState(false);
  const [savingBroadcast, setSavingBroadcast] = useState(false);
  const [editing, setEditing] = useState<CrewMember | null>(null);
  const [capForm, setCapForm] = useState<Record<string, any>>({});

  const openCapabilities = (m: CrewMember) => {
    setEditing(m);
    setCapForm({
      insured: m.insured ?? 'unknown',
      certifications: m.certifications ?? '',
      equipment: m.equipment ?? '',
      hourly_rate: m.hourly_rate == null ? '' : String(m.hourly_rate),
      ...Object.fromEntries(CAPABILITY_FIELDS.map((f) => [f.key, (m as any)[f.key] === true])),
    });
  };

  useEffect(() => {
    if (!effectiveContractorId) return;
    (async () => {
      const { data } = await supabase
        .from('profiles').select('crew_auto_broadcast').eq('id', effectiveContractorId).maybeSingle();
      setAutoBroadcast((data as any)?.crew_auto_broadcast === true);
    })();
  }, [effectiveContractorId]);

  const setAutoBroadcast_ = async (v: boolean) => {
    if (!effectiveContractorId) return;
    setSavingBroadcast(true);
    setAutoBroadcast(v);
    const { error } = await supabase
      .from('profiles').update({ crew_auto_broadcast: v } as any).eq('id', effectiveContractorId);
    setSavingBroadcast(false);
    if (error) {
      setAutoBroadcast(!v);
      toast.error(error.message);
    } else {
      toast.success(v ? 'New website leads will go out for bids automatically' : 'Automatic bid requests turned off');
    }
  };
  const [form, setForm] = useState({
    fullName: '', phone: '', email: '', trade: 'pending', certifications: '', equipment: '',
  });

  const joinLink = effectiveContractorId
    ? `${getWebBaseUrl()}/crew-join?owner=${effectiveContractorId}`
    : '';

  const refresh = () => qc.invalidateQueries({ queryKey: ['crew-network'] });

  const invite = async () => {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('crew-invite', { body: form });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success(
        data?.temp_password
          ? `Invited. Temporary password: ${data.temp_password}`
          : 'Added to your crew network',
      );
      setInviteOpen(false);
      setForm({ fullName: '', phone: '', email: '', trade: 'pending', certifications: '', equipment: '' });
      refresh();
    } catch (e: any) {
      toast.error(e?.message || 'Could not send the invite');
    } finally {
      setSaving(false);
    }
  };

  const openRecentLeads = async () => {
    setOpeningLeads(true);
    try {
      const { data, error } = await supabase.functions.invoke('crew-open-recent-leads', {
        body: { days: 14 },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      const opened = Number(data?.opened ?? 0);
      toast.success(
        opened > 0
          ? `Sent ${opened} job${opened === 1 ? '' : 's'} out for bids`
          : 'Nothing new to send — recent jobs are already out for bids',
      );
    } catch (e: any) {
      toast.error(e?.message || 'Could not send the jobs');
    } finally {
      setOpeningLeads(false);
    }
  };

  const setFirstRefusal = async (m: CrewMember, value: boolean) => {
    setBusyId(m.id);
    const { error } = await supabase
      .from('crew_members').update({ first_refusal: value } as any).eq('id', m.id);
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(
      value
        ? `${m.full_name || 'They'} will see new jobs an hour before everyone else`
        : 'First pick turned off',
    );
    refresh();
  };

  const setStatus = async (m: CrewMember, status: string) => {
    setBusyId(m.id);
    const { error } = await supabase.from('crew_members').update({ status }).eq('id', m.id);
    if (error) { setBusyId(null); toast.error(error.message); return; }

    // Newly active crew get the jobs that are already open for bids.
    if (status === 'active') {
      try {
        const { data } = await supabase.functions.invoke('crew-backfill-bids', {
          body: { crew_member_id: m.id },
        });
        const added = Number(data?.added ?? 0);
        toast.success(
          added > 0
            ? `Approved — sent them ${added} open job${added === 1 ? '' : 's'} to bid on`
            : 'Approved',
        );
      } catch {
        toast.success('Approved');
      }
    } else {
      toast.success(status === 'inactive' ? 'Deactivated' : 'Updated');
    }
    setBusyId(null);
    refresh();
  };

  const pending = (crew ?? []).filter((m) => m.status === 'pending');
  const previous = (crew ?? []).filter((m) => hasWorkedTogether(m, completedIds ?? new Set()));
  const active = previous.filter((m) => m.status !== 'inactive' && m.status !== 'pending');
  const inactive = previous.filter((m) => m.status === 'inactive');
  const markPastWork = async (m: CrewMember, value: boolean) => {
    setBusyId(m.id);
    const { error } = await supabase.from('crew_members').update({ worked_together_before: value }).eq('id', m.id);
    setBusyId(null);
    if (error) return toast.error('Could not save past work');
    toast.success(value ? 'Added to My subs' : 'Past-work mark removed');
    refresh();
  };

  const { data: availability } = useCrewAvailabilityMap((crew ?? []).map((m) => m.id));

  const saveCapabilities = async () => {
    if (!editing) return;
    const r = rateValue(capForm.hourly_rate);
    if (r === undefined) { toast.error('Enter an hourly rate between $0 and $200, or leave it blank'); return; }
    setSaving(true);
    const { error } = await supabase
      .from('crew_members')
      .update({ ...capForm, hourly_rate: rateValue(capForm.hourly_rate) } as any)
      .eq('id', editing.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Capabilities updated');
    setEditing(null);
    refresh();
  };

  const Row = ({ m }: { m: CrewMember }) => {
    const a = availability?.[m.id];
    const chips = CAPABILITY_FIELDS.filter((f) => (m as any)[f.key] === true);
    return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{m.full_name || m.email}</span>
            <Badge variant="secondary" className="text-[10px]">{TRADE_LABEL[m.trade] ?? m.trade}</Badge>
            {Number(m.hourly_rate) > STANDARD_GROUND_RATE && (
              <Badge variant="outline" className="text-[10px]">${Number(m.hourly_rate)}/hr</Badge>
            )}
            {m.first_refusal === true && (
              <Badge className="text-[10px]">First pick</Badge>
            )}
            {m.insured === 'yes' && <Badge variant="outline" className="text-[10px]">Insured</Badge>}
            {m.insured === 'working_on_it' && (
              <Badge variant="outline" className="text-[10px]">Insurance in progress</Badge>
            )}
            {m.status === 'pending' && <Badge className="text-[10px]">Awaiting your approval</Badge>}
            {m.status === 'inactive' && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
          </div>
          <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
            {m.phone && (
              <div className="flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5" />
                <a href={`tel:${m.phone}`} className="hover:text-foreground">{m.phone}</a>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <span
                className={`inline-block w-2 h-2 rounded-full ${a?.taking_work === false ? 'bg-muted-foreground/50' : 'bg-primary'}`}
              />
              {a?.taking_work === false ? 'Not taking work right now' : availabilityLine(a)}
            </div>
            {m.certifications && <div>Certifications: {m.certifications}</div>}
            {m.equipment && <div>Equipment: {m.equipment}</div>}
          </div>
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {chips.map((c) => (
                <Badge key={String(c.key)} variant="outline" className="text-[10px] font-normal">{c.label}</Badge>
              ))}
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="flex items-center gap-1 justify-end text-sm font-semibold">
            {m.rating_avg != null ? <StarRow value={Number(m.rating_avg)} /> : <Star className="w-4 h-4 text-muted-foreground/40" />}
            {m.rating_avg != null ? Number(m.rating_avg).toFixed(1) : '—'}
          </div>
          <div className="text-xs text-muted-foreground">{m.rating_count ?? 0} rated jobs</div>
          <div className="flex gap-1.5 mt-2 justify-end flex-wrap">
            {!completedIds?.has(m.id) && <Button size="sm" variant="outline" disabled={busyId === m.id} onClick={() => markPastWork(m, !m.worked_together_before)}>{m.worked_together_before ? 'Remove past-work mark' : 'Worked together before'}</Button>}
            <Button size="sm" variant="ghost" onClick={() => openCapabilities(m)}>Edit skills</Button>
            <Button
              size="sm"
              variant={m.first_refusal === true ? 'default' : 'outline'}
              disabled={busyId === m.id}
              onClick={() => setFirstRefusal(m, m.first_refusal !== true)}
            >
              {m.first_refusal === true ? 'First pick on' : 'Give first pick'}
            </Button>
            {m.status === 'pending' && (
              <>
                <Button size="sm" disabled={busyId === m.id} onClick={() => setStatus(m, 'active')}>
                  <Check className="w-4 h-4 mr-1" />Approve
                </Button>
                <Button size="sm" variant="outline" disabled={busyId === m.id} onClick={() => setStatus(m, 'inactive')}>
                  <X className="w-4 h-4 mr-1" />Decline
                </Button>
              </>
            )}
            {m.status === 'active' && (
              <Button size="sm" variant="outline" disabled={busyId === m.id} onClick={() => setStatus(m, 'inactive')}>
                Deactivate
              </Button>
            )}
            {m.status === 'inactive' && (
              <Button size="sm" variant="outline" disabled={busyId === m.id} onClick={() => setStatus(m, 'active')}>
                Reactivate
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
    );
  };

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <HardHat className="w-6 h-6 text-primary" />
            Subs
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your contract climbers, ground workers and stump grinders. Only active members get bid requests.
            Give someone first pick and they see new jobs an hour before anyone else.
          </p>
        </div>
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button><UserPlus className="w-4 h-4 mr-1.5" />Invite</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Invite a contract worker</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="cn-name">Name</Label>
                <Input id="cn-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="cn-phone">Mobile number</Label>
                <Input id="cn-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(405) 555-1234" />
              </div>
              <div>
                <Label htmlFor="cn-email">Email</Label>
                <Input id="cn-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <Label>Trade</Label>
                <Select value={form.trade} onValueChange={(v) => setForm({ ...form, trade: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Let them choose</SelectItem>
                    <SelectItem value="climber">Climber</SelectItem>
                    <SelectItem value="ground">Ground crew</SelectItem>
                    <SelectItem value="both">Climber + ground</SelectItem>
                    <SelectItem value="stump">Stump grinder</SelectItem>
                    <SelectItem value="crane">Crane operator</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="cn-cert">Certifications (optional)</Label>
                <Input id="cn-cert" value={form.certifications} onChange={(e) => setForm({ ...form, certifications: e.target.value })} placeholder="ISA, TCIA, CPR" />
              </div>
              <div>
                <Label htmlFor="cn-equip">Equipment they own (optional)</Label>
                <Textarea id="cn-equip" rows={2} value={form.equipment} onChange={(e) => setForm({ ...form, equipment: e.target.value })} placeholder="Saws, ropes, chipper, mini skid" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={invite} disabled={saving || !form.fullName || !form.email}>
                {saving ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Sending…</> : 'Send invite'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="p-4 mb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Send new website leads out for bids automatically</div>
            <p className="text-xs text-muted-foreground mt-1">
              When a job comes in from your website, your active crew instantly get the photo and a short
              description — never the customer's details or any pricing. Turn this off to send them by hand
              from the Bid Board.
            </p>
          </div>
          <Switch
            checked={autoBroadcast}
            disabled={savingBroadcast}
            onCheckedChange={setAutoBroadcast_}
          />
        </div>
      </Card>

      <Card className="p-4 mb-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-sm font-medium">Open recent website jobs for bids</div>
            <p className="text-xs text-muted-foreground mt-1">
              Sends the last two weeks of website jobs to your active crew — photo, work type, city and anything
              the customer wrote. They reply with crew size, hours, equipment, available dates and their
              minimum + ideal pay. Jobs already out for bids are skipped.
            </p>
          </div>
          <Button variant="outline" size="sm" disabled={openingLeads} onClick={openRecentLeads}>
            {openingLeads ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Sending…</> : 'Send recent jobs'}
          </Button>
        </div>
      </Card>

      <Card className="p-4 mb-6">
        <div className="text-sm font-medium">Self-signup link</div>
        <p className="text-xs text-muted-foreground mt-1">
          Share this with contractors. They sign themselves up and wait in your pending list until you approve them.
        </p>
        <div className="flex gap-2 mt-2">
          <Input readOnly value={joinLink} className="text-xs" />
          <Button
            variant="outline"
            size="icon"
            onClick={() => { navigator.clipboard.writeText(joinLink); toast.success('Link copied'); }}
          >
            <Copy className="w-4 h-4" />
          </Button>
        </div>
      </Card>

      <div className="flex gap-2 mb-4">
        <Button size="sm" variant={tab === 'mine' ? 'default' : 'outline'} onClick={() => setTab('mine')}>My subs</Button>
        {!isDemo && (
          <Button size="sm" variant={tab === 'find' ? 'default' : 'outline'} onClick={() => setTab('find')}>Find subs near you</Button>
        )}
      </div>

      {tab === 'find' && !isDemo ? <FindSubsNearYou ownMembers={crew ?? []} renderOwnMember={(m) => <Row m={m} />} /> : isLoading || workLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />Loading crew…
        </div>
      ) : previous.length === 0 && pending.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          <HardHat className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <div className="font-medium text-foreground">{workError ? 'Could not load completed work' : 'No past work recorded yet'}</div>
          {!isDemo && <Button variant="outline" className="mt-3" onClick={() => setTab('find')}>Find subs near you</Button>}
        </Card>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pending approval</div>
              {pending.map((m) => <Row key={m.id} m={m} />)}
            </div>
          )}
          {active.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Previously worked with</div>
              {active.map((m) => <Row key={m.id} m={m} />)}
            </div>
          )}
          {inactive.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Inactive</div>
              {inactive.map((m) => <Row key={m.id} m={m} />)}
            </div>
          )}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.full_name || 'Crew member'} — what they can do</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Insured</Label>
              <Select
                value={capForm.insured ?? 'unknown'}
                onValueChange={(v) => setCapForm({ ...capForm, insured: v === 'unknown' ? null : v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="working_on_it">Working on it</SelectItem>
                  <SelectItem value="unknown">Not sure yet</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {CAPABILITY_FIELDS.map((f) => (
                <label key={String(f.key)} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={capForm[f.key as string] === true}
                    onCheckedChange={(v) => setCapForm({ ...capForm, [f.key as string]: v === true })}
                  />
                  {f.label}
                </label>
              ))}
            </div>
            <div>
              <Label htmlFor="cap-rate">Their hourly rate (ground work)</Label>
              <Input id="cap-rate" type="number" inputMode="decimal" placeholder={`Standard $${STANDARD_GROUND_RATE}`}
                value={capForm.hourly_rate ?? ''} onChange={(e) => setCapForm({ ...capForm, hourly_rate: e.target.value })} />
              <p className="text-xs text-muted-foreground mt-1">Leave blank for the standard ${STANDARD_GROUND_RATE}/hr. Anyone above that only gets alerts after the standard crew has had a chance to claim the job.</p>
            </div>
            <div>
              <Label htmlFor="cap-cert">Certifications</Label>
              <Input
                id="cap-cert"
                value={capForm.certifications ?? ''}
                onChange={(e) => setCapForm({ ...capForm, certifications: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="cap-equip">Equipment they own</Label>
              <Textarea
                id="cap-equip"
                rows={2}
                value={capForm.equipment ?? ''}
                onChange={(e) => setCapForm({ ...capForm, equipment: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={saveCapabilities} disabled={saving}>
              {saving ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Saving…</> : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
