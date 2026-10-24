import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFreePlan, useStartTrial, useUpgradeCheckout } from '@/hooks/useFreePlan';
import { useCompanyBilling } from '@/hooks/useCompanyBilling';
import { canUseStorePlans, isNativeStoreBilling } from '@/lib/platform';
import { freePlanCta } from '@/lib/freePlan';

/** The one trial / upgrade button a Free owner sees. Renders nothing for subs, team members and paid companies. */
export function FreePlanCta({ className, size }: { className?: string; size?: 'sm' | 'default' }) {
  const free = useFreePlan();
  const billing = useCompanyBilling();
  const startTrial = useStartTrial();
  const upgrade = useUpgradeCheckout();
  const cta = freePlanCta(free.data, { storeBuild: isNativeStoreBilling(), storePlans: canUseStorePlans() });
  if (cta.kind === 'none') return null;
  const busy = startTrial.isPending || upgrade.isPending;
  const spinner = busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />;
  if (cta.kind === 'store_plan') {
    return <Button asChild size={size} className={className}><Link to="/plan">{cta.label}</Link></Button>;
  }
  if (cta.kind === 'upgrade' && billing.data?.billing?.pricing_version === '2026-10') {
    return <Button asChild size={size} className={className}><Link to="/dashboard/team">{cta.label}</Link></Button>;
  }
  return (
    <Button size={size} className={className} disabled={busy} onClick={() => (cta.kind === 'trial' ? startTrial.mutate() : upgrade.mutate())}>
      {spinner}{cta.label}
    </Button>
  );
}
