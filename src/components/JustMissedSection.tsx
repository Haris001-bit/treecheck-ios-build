import { useJustMissedLeads } from '@/hooks/useEngagement';
import { useSubscription } from '@/hooks/useSubscription';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Lock, Clock, Crown } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { shouldHidePurchaseCTA } from '@/lib/platform';

export function JustMissedSection() {
  const { data: missedLeads, isLoading } = useJustMissedLeads();
  const { data: subscription } = useSubscription();
  const navigate = useNavigate();
  const isPremium = subscription?.tier === 'premium';

  if (isLoading || !missedLeads || missedLeads.length === 0) return null;

  return (
    <div className="mt-10">
      <div className="mb-4">
        <h2 className="text-xl font-display font-bold text-muted-foreground">Just Missed</h2>
        <p className="text-sm text-muted-foreground">Recently claimed leads in your area</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {missedLeads.slice(0, 6).map((lead: any) => {
          const isSoldOut = lead.purchase_count >= 3 || lead.status === 'sold_out';
          const claimedAgo = lead.last_purchased_at
            ? formatDistanceToNow(new Date(lead.last_purchased_at), { addSuffix: true })
            : 'recently';

          return (
            <Card
              key={lead.id}
              className={cn(
                "overflow-hidden opacity-50 grayscale-[60%] pointer-events-none select-none relative",
                isSoldOut && "opacity-40"
              )}
            >
              <div className="absolute inset-0 z-10 flex items-center justify-center">
                <Lock className="h-8 w-8 text-muted-foreground/60" />
              </div>

              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">
                    {lead.job_type || 'Tree Removal'}
                  </span>
                  {isSoldOut ? (
                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                      SOLD OUT
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {lead.purchase_count}/3 claimed
                    </Badge>
                  )}
                </div>

                <p className="text-xs text-muted-foreground">
                  {lead.city} area
                </p>

                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>Claimed {claimedAgo}</span>
                </div>
              </CardContent>

              {!isPremium && !shouldHidePurchaseCTA() && (
                <div className="border-t border-border px-4 py-2 bg-muted/50">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate('/dashboard/pricing');
                    }}
                    className="pointer-events-auto text-[11px] text-primary font-semibold flex items-center gap-1 hover:underline"
                  >
                    <Crown className="h-3 w-3" />
                    Go Premium for a 60-min head start
                  </button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
