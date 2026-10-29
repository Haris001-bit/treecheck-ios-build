import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CheckCircle2, ArrowLeft } from 'lucide-react';
import crewJoinLogo from '@/assets/crew-join-logo.png.asset.json';
import { assetUrl } from '@/lib/platform';
import { toast } from 'sonner';
import { CREW_TRADES } from '@/lib/plans';
import { reportSeriousError } from '@/lib/errorReporter';
import { functionFailure, isUserFixable } from '@/lib/functionFailure';

type Step = 'market' | 'you' | 'skills';

export default function CrewJoin() {
  const [params] = useSearchParams();
  const owner = params.get('owner') ?? '';
  // Whose crew this link joins, so the sub isn't left guessing.
  const [company, setCompany] = useState<string | null>(null);
  useEffect(() => {
    if (!owner) return;
    supabase.functions.invoke('crew-market-quote', { body: { owner } })
      .then(({ data }) => setCompany(typeof data?.company === 'string' && data.company ? data.company : null))
      .catch(() => setCompany(null));
  }, [owner]);
  const [step, setStep] = useState<Step>(owner ? 'you' : 'market');
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [location, setLocation] = useState('');
  const [market, setMarket] = useState<{ company_count: number; monthly_price: number; latitude: number; longitude: number; location_label: string } | null>(null);
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    email: '',
    password: '',
    trade: 'climber',
    certifications: '',
    equipment: '',
    insured: 'yes',
    wantsGroundWork: false,
    canSkidSteer: false,
    miniSkidExperience: false,
    canChipper: false,
    craneCertified: false,
    truckTrailerExperience: false,
    disposalRunsOk: false,
    ownsSaws: false,
    hasDriversLicense: false,
    treeExperienceLevel: 'some',
    yearsClimbing: '',
  });

  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const doesClimbing = form.trade === 'climber' || form.trade === 'both';
  const doesGround = form.trade === 'ground' || form.trade === 'both';
  const isCrane = form.trade === 'crane';

  const submit = async () => {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('crew-join', {
        body: { ...form, yearsClimbing: form.yearsClimbing ? Number(form.yearsClimbing) : null, owner, latitude: market?.latitude, longitude: market?.longitude, locationLabel: market?.location_label },
      });
      const failure = await functionFailure(error, data);
      if (failure) {
        toast.error(failure.message || 'Could not complete signup');
        if (!isUserFixable(failure)) reportSeriousError('subcontractor signup', failure.message, 'subcontractor signup', form.email);
        return;
      }
      setDone(true);
    } catch (e: any) {
      toast.error(e?.message || 'Could not complete signup');
      reportSeriousError('subcontractor signup', e, 'subcontractor signup', form.email);
    } finally {
      setSaving(false);
    }
  };

  const checkMarket = async () => {
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke('crew-market-quote', { body: { location } });
      const failure = await functionFailure(error, data);
      if (failure) throw new Error(failure.message);
      setMarket(data); setStep('you');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not check your area'); }
    finally { setChecking(false); }
  };

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="p-8 max-w-md text-center">
          <CheckCircle2 className="w-10 h-10 text-primary mx-auto mb-3" />
          <h1 className="text-xl font-bold">You're on the list</h1>
          <p className="text-sm text-muted-foreground mt-2">
            {owner ? `${company ?? 'The company owner'} has to approve you before you start getting jobs.` : "Your network profile is ready. We'll show you local opportunities as companies participate."}
          </p>
          <Button asChild className="mt-5"><Link to="/login">Sign in</Link></Button>
          <p className="text-xs text-muted-foreground mt-3">
            Add the app to your phone: <Link to="/crew-install" className="underline">app.treecheck.ai/crew-install</Link>
          </p>
        </Card>
      </div>
    );
  }

  const check = (
    id: string,
    label: string,
    key: keyof typeof form,
  ) => (
    <label htmlFor={id} className="flex items-start gap-2.5 py-1.5 cursor-pointer">
      <Checkbox
        id={id}
        checked={form[key] as boolean}
        onCheckedChange={(v) => set({ [key]: v === true } as Partial<typeof form>)}
        className="mt-0.5"
      />
      <span className="text-sm leading-snug">{label}</span>
    </label>
  );

  return (
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-6">
      <Card className="p-6 w-full max-w-md">
        <div className="flex items-center gap-2 mb-1">
          <img src={assetUrl(crewJoinLogo)} alt="" className="w-10 h-10 rounded-md object-contain" />
          <h1 className="text-xl font-bold">{company ? `Join ${company}'s crew` : 'Join the crew network'}</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          Get texted when tree jobs open for bids. You tell them your minimum and ideal pay, the crew you need, and
          the days you're free.
        </p>

        {step === 'market' && <div className="space-y-4"><div><Label htmlFor="cj-location">Your city and state</Label><Input id="cj-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Oklahoma City, OK" /></div><p className="text-sm text-muted-foreground">We use a 30-mile radius to show how many participating tree companies can send you offers and what membership will cost.</p><Button className="w-full" onClick={checkMarket} disabled={checking || location.trim().length < 2}>{checking && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Check my area</Button></div>}

        {step === 'you' && market && <div className="rounded-md border p-3 mb-4"><div className="font-bold">{market.company_count} participating {market.company_count === 1 ? 'company' : 'companies'} within 30 miles</div><div className="text-sm text-muted-foreground">{market.monthly_price === 0 ? 'Membership is free.' :`14 days free, then $${market.monthly_price}/month. We’ll notify you before local pricing changes.`}</div></div>}

        {step === 'you' ? (
          <>
            <div className="space-y-3">
              <div>
                <Label htmlFor="cj-name">Name</Label>
                <Input id="cj-name" value={form.fullName} onChange={(e) => set({ fullName: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="cj-phone">Mobile number</Label>
                <Input id="cj-phone" value={form.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="(405) 555-1234" />
              </div>
              <div>
                <Label htmlFor="cj-email">Email</Label>
                <Input id="cj-email" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="cj-pass">Create a password</Label>
                <Input id="cj-pass" type="password" value={form.password} onChange={(e) => set({ password: e.target.value })} placeholder="At least 8 characters, or your TreeCheck password" />
              </div>
              <div>
                <Label>What do you do?</Label>
                <Select value={form.trade} onValueChange={(v) => set({ trade: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CREW_TRADES.map((trade) => <SelectItem key={trade.value} value={trade.value}>{trade.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              className="w-full mt-5"
              onClick={() => setStep('skills')}
              disabled={!form.fullName || !form.email || !form.password || !form.phone}
            >
              Next: what you can do
            </Button>
          </>
        ) : (
          <>
            <h2 className="font-semibold mb-1">What can you do?</h2>
            <p className="text-sm text-muted-foreground mb-3">
              This isn't a test — it just tells the company what work to send you.
            </p>

            <div className="space-y-1">
              {/* 1. Experience — depends on the trade picked on the last screen. */}
              <h3 className="text-sm font-bold">Your experience</h3>
              {doesClimbing && (
                <div className="pb-1">
                  <Label htmlFor="cj-years">Years climbing</Label>
                  <Input
                    id="cj-years"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={form.yearsClimbing}
                    onChange={(e) => set({ yearsClimbing: e.target.value })}
                    placeholder="5"
                  />
                </div>
              )}
              {!doesClimbing && (
                <div className="pb-1">
                  <Label>Have you worked tree jobs before?</Label>
                  <Select value={form.treeExperienceLevel} onValueChange={(v) => set({ treeExperienceLevel: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="never">Never</SelectItem>
                      <SelectItem value="some">Some</SelectItem>
                      <SelectItem value="experienced">Experienced</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {(doesClimbing || isCrane) && check('cj-crane', isCrane ? "I'm a certified crane operator" : "I'm certified for crane work", 'craneCertified')}
              {!doesGround && check('cj-wants-ground', "I'd take ground work too, on days I'm not busy with my own trade", 'wantsGroundWork')}

              {/* 2. Equipment and driving — every machine in one place. */}
              <div className="pt-2 border-t mt-2" />
              <h3 className="text-sm font-bold">Equipment you can run</h3>
              {check('cj-chipper', 'I can run a chipper', 'canChipper')}
              {check('cj-skid', 'I can run a skid steer', 'canSkidSteer')}
              {check('cj-mini-skid', "I'm experienced with a mini skid steer", 'miniSkidExperience')}
              {check('cj-license', 'I have a valid driver\u2019s license', 'hasDriversLicense')}
              {check('cj-truck', "I'm proficient driving a truck and trailer", 'truckTrailerExperience')}
              {check('cj-disposal', "I'm comfortable making disposal runs (hauling debris to the dump site)", 'disposalRunsOk')}

              {/* 3. Own gear and paperwork. */}
              <div className="pt-2 border-t mt-2" />
              <h3 className="text-sm font-bold">Your gear and paperwork</h3>
              {check('cj-saws', 'I have my own chainsaws and hand tools', 'ownsSaws')}
              <div className="pt-1">
                <Label>Do you carry your own insurance?</Label>
                <Select value={form.insured} onValueChange={(v) => set({ insured: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                    <SelectItem value="working_on_it">Working on it</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="pt-2">
                <Label htmlFor="cj-cert">Certifications (optional)</Label>
                <Input id="cj-cert" value={form.certifications} onChange={(e) => set({ certifications: e.target.value })} placeholder="ISA, TCIA, CPR" />
              </div>

              <div className="pt-2 border-t mt-3" />
              <div className="pt-1">
                <Label htmlFor="cj-equip">Anything else we should know (optional)</Label>
                <Textarea id="cj-equip" rows={2} value={form.equipment} onChange={(e) => set({ equipment: e.target.value })} placeholder={form.trade === 'stump' ? 'Your grinder (make, size), trucks, availability notes' : 'Equipment you own, trucks, availability notes'} />
              </div>
            </div>


            <Button className="w-full mt-5" onClick={submit} disabled={saving}>
              {saving ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Submitting…</> : 'Request to join'}
            </Button>
            <Button variant="ghost" className="w-full mt-2" onClick={() => setStep('you')} disabled={saving}>
              <ArrowLeft className="w-4 h-4 mr-1.5" />Back
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}
