import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { supabase } from '@/integrations/supabase/client';
import { useLeads, useHasPurchasedLead } from '@/hooks/useLeads';
import { LeadPhoto } from '@/components/LeadPhoto';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MapPin, Loader2, ExternalLink, CalendarClock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { getLeadPrice, STANDARD_FEE_RATE, getStandardRateForLead } from '@/lib/subscriptions';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Props {
  lead: any;
  isPremium: boolean;
}

/**
 * iOS lead preview card for the US-storefront external-purchase flow.
 * Shows the lead preview + estimated fee, and opens the TreeCheck website
 * in a system browser to complete payment. Never reveals homeowner PII.
 */
export function IOSLeadPreviewCard({ lead, isPremium }: Props) {
  const { data: hasPurchased } = useHasPurchasedLead(lead.id);
  const [loading, setLoading] = useState(false);

  const rate = isPremium ? 0.025 : getStandardRateForLead(lead.created_at);
  const fee = getLeadPrice(lead.estimated_cost_min, lead.estimated_cost_max, rate);

  const isSoldOut = (lead.purchase_count ?? 0) >= 3 || lead.status === 'sold_out';

  const handleUnlock = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        'create-mobile-lead-unlock-intent',
        { body: { lead_id: lead.id } },
      );
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const url = (data as any).unlock_url as string;
      if (!url) throw new Error('No unlock URL returned');
      if (Capacitor.isNativePlatform()) {
        await Browser.open({ url, presentationStyle: 'popover' });
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not start unlock');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className={cn('overflow-hidden hover:shadow-lg transition-shadow', isSoldOut && 'opacity-60')}>
      <div className="relative">
        <LeadPhoto photoUrl={lead.photo_url} aspectRatio="4/3" objectFit="contain" />
        {isSoldOut && (
          <div className="absolute top-3 right-3">
            <Badge className="bg-destructive text-destructive-foreground">Sold Out</Badge>
          </div>
        )}
      </div>

      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <MapPin className="w-4 h-4" />
            <span>{lead.city}</span>
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            {lead.job_type || 'Tree Removal'}
          </span>
        </div>
        {lead.urgency && lead.urgency !== 'Flexible' && (
          <div className="flex items-center gap-1 mt-1">
            <CalendarClock className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-xs font-medium text-amber-500">{lead.urgency}</span>
          </div>
        )}
        <CardTitle className="text-lg font-display">
          Estimated job value: ${Number(lead.estimated_cost_min).toLocaleString()} – ${Number(lead.estimated_cost_max).toLocaleString()}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="text-sm text-foreground">
          Unlock fee: <span className="font-semibold">${fee.toFixed(2)}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}
        </div>

        {hasPurchased ? (
          <Button disabled className="w-full">Already in Your Leads</Button>
        ) : isSoldOut ? (
          <Button disabled className="w-full">No longer available</Button>
        ) : (
          <>
            <Button onClick={handleUnlock} disabled={loading} className="w-full gradient-primary">
              {loading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening secure checkout…</>
              ) : (
                <><ExternalLink className="mr-2 h-4 w-4" /> Unlock This Lead</>
              )}
            </Button>
            <p className="text-[11px] text-center text-muted-foreground">
              Completed securely on TreeCheck Web
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
