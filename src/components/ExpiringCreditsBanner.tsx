import { AlertTriangle } from 'lucide-react';
import { useExpiringCredits } from '@/hooks/useEngagement';
import { useLeads } from '@/hooks/useLeads';
import { useNavigate } from 'react-router-dom';
import { differenceInDays } from 'date-fns';

export function ExpiringCreditsBanner() {
  const { data: expiringCredits } = useExpiringCredits();
  const { data: leads } = useLeads();
  const navigate = useNavigate();

  if (!expiringCredits || expiringCredits.length === 0) return null;

  const totalExpiring = expiringCredits.reduce((sum, c) => sum + c.amount, 0);
  const soonestExpiry = expiringCredits[0]?.expires_at;
  const daysLeft = soonestExpiry
    ? Math.max(0, differenceInDays(new Date(soonestExpiry), new Date()))
    : 0;

  const availableLeadCount = (leads || []).filter(
    (l) => l.status === 'available' && l.purchase_count < 3
  ).length;

  return (
    <button
      onClick={() => navigate('/dashboard')}
      className="mb-6 p-4 rounded-lg border border-warning/40 bg-warning/10 flex items-center gap-3 w-full text-left hover:bg-warning/15 transition-colors"
    >
      <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0" />
      <p className="text-sm text-foreground">
        <span className="font-bold">⚠️ ${totalExpiring} in credits expire in {daysLeft} day{daysLeft !== 1 ? 's' : ''}</span>
        {availableLeadCount > 0 && (
          <span className="text-muted-foreground ml-1">
            — {availableLeadCount} new lead{availableLeadCount !== 1 ? 's' : ''} in your area.
          </span>
        )}
      </p>
    </button>
  );
}
