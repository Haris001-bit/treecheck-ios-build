import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useCompanySettings, usesSubs as companyUsesSubs } from '@/hooks/useCompanySettings';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Camera, CheckCircle2, Circle, Phone, Sparkles, SlidersHorizontal } from 'lucide-react';
import { otherCrmName } from '../../supabase/functions/_shared/crmChoice';

/** First stop for new owners: price a job in Scout, then finish setup. */
export default function ScoutStart() {
  const navigate = useNavigate();
  const { effectiveContractorId } = useAuth();
  const { data: company } = useCompanySettings();
  const { data: status } = useQuery({
    queryKey: ['setup-checklist', effectiveContractorId],
    enabled: !!effectiveContractorId,
    queryFn: async () => {
      const id = effectiveContractorId!;
      const [caps, rates, crew, jobber] = await Promise.all([
        supabase.from('scout_captures').select('id', { count: 'exact', head: true }).eq('owner_id', id),
        supabase.from('scout_rate_cards').select('id', { count: 'exact', head: true }).eq('contractor_id', id),
        supabase.from('crew_members').select('id', { count: 'exact', head: true }).eq('owner_contractor_id', id),
        supabase.from('jobber_tokens').select('id', { count: 'exact', head: true }).eq('contractor_id', id),
      ]);
      return { scout: (caps.count ?? 0) > 0, rates: (rates.count ?? 0) > 0, subs: (crew.count ?? 0) > 0, crm: (jobber.count ?? 0) > 0 };
    },
  });

  const go = (mode: 'ai' | 'manual') => navigate(`/dashboard/instant-estimator?mode=${mode}`);
  const usesSubs = companyUsesSubs(company);
  // A company on another CRM has nothing to connect yet: the team calls them (crm-interest-alert texts Mark).
  const otherCrm = otherCrmName(company?.crm, company?.crm_other);

  const steps = [
    { done: status?.scout, label: 'Price your first job in Scout', to: '/dashboard/instant-estimator' },
    { done: status?.rates, label: 'Set your rates', to: '/dashboard/scout-rates' },
    ...(usesSubs ? [{ done: status?.subs, label: 'Invite or find subs', to: '/dashboard/crew-network' }] : []),
    ...(otherCrm ? [] : [{ done: status?.crm, label: 'Connect your CRM', to: '/dashboard/integrations/jobber' }]),
  ];

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-black">Start with Scout</h1>
        <p className="mt-1">Snap a photo of the tree. Scout turns it into a price you can send.</p>
      </div>

      <Card className="p-6 space-y-4 border-primary">
        <div className="flex items-center gap-3">
          <Camera className="w-8 h-8 text-primary" />
          <div>
            <div className="text-xl font-black">Price your first job</div>
            <div className="text-sm">A photo is required so the AI and your subs can see the tree.</div>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <button type="button" onClick={() => go('ai')} className="rounded-lg border-2 border-primary p-4 text-left hover:bg-primary/5">
            <Sparkles className="w-6 h-6 text-primary mb-2" />
            <div className="font-black">Let AI estimate it</div>
            <div className="text-sm">Add a photo and a few notes. AI suggests the price, difficulty and risk. You can adjust it.</div>
          </button>
          <button type="button" onClick={() => go('manual')} className="rounded-lg border-2 border-input p-4 text-left hover:bg-muted/40">
            <SlidersHorizontal className="w-6 h-6 text-primary mb-2" />
            <div className="font-black">I'll price it myself</div>
            <div className="text-sm">Fill in climber, crew, hours, loads, crane, stump and chipper. The total uses your rates.</div>
          </button>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="font-black">Setup checklist</div>
        {steps.map((s) => (
          <Link key={s.label} to={s.to} className="flex items-center gap-3 rounded-md p-2 hover:bg-muted/40">
            {s.done ? <CheckCircle2 className="w-5 h-5 text-primary" /> : <Circle className="w-5 h-5" />}
            <span className={s.done ? 'line-through' : 'font-bold'}>{s.label}</span>
          </Link>
        ))}
        {otherCrm && (
          <div className="flex items-center gap-3 rounded-md p-2">
            <Phone className="w-5 h-5 shrink-0" />
            <span>{otherCrm} doesn't sync with TreeCheck yet. Our team will reach out to help you get set up.</span>
          </div>
        )}
      </Card>

      <Button variant="outline" className="w-full" onClick={() => navigate('/dashboard')}>Go to my dashboard</Button>
    </div>
  );
}
