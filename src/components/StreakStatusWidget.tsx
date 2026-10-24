import { useEngagement, useMetroRank } from '@/hooks/useEngagement';
import { useSubscription } from '@/hooks/useSubscription';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Zap, Crown, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';

export function StreakStatusWidget() {
  const { data: engagement } = useEngagement();
  const { data: rank } = useMetroRank();
  const { data: subscription } = useSubscription();

  const isPremium = subscription?.tier === 'premium';
  const streak = engagement?.current_streak || 0;
  const metroRank = rank?.rank || 0;
  const totalContractors = rank?.total_contractors || 0;
  const totalPurchases = rank?.total_purchases || 0;

  return (
    <Card className="mb-6">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Streak */}
          <div className="flex items-center gap-2">
            <div className={cn(
              "flex items-center justify-center h-8 w-8 rounded-full",
              streak > 0 ? "bg-warning/20" : "bg-muted"
            )}>
              <Zap className={cn("h-4 w-4", streak > 0 ? "text-warning" : "text-muted-foreground")} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Response Streak</p>
              <p className="text-sm font-bold text-foreground">
                {streak > 0 ? `🔥 ${streak} in a row` : 'No streak'}
              </p>
            </div>
          </div>

          {/* Divider */}
          <div className="h-8 w-px bg-border hidden sm:block" />

          {/* Tier Badge */}
          <div className="flex items-center gap-2">
            <div className={cn(
              "flex items-center justify-center h-8 w-8 rounded-full",
              isPremium ? "bg-primary/20" : "bg-muted"
            )}>
              <Crown className={cn("h-4 w-4", isPremium ? "text-primary" : "text-muted-foreground")} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Current Tier</p>
              <Badge variant={isPremium ? "default" : "secondary"} className="text-xs">
                {isPremium ? 'Premium' : 'Standard'}
              </Badge>
            </div>
          </div>

          {/* Divider */}
          <div className="h-8 w-px bg-border hidden sm:block" />

          {/* Leaderboard */}
          <div className="flex items-center gap-2">
            <div className={cn(
              "flex items-center justify-center h-8 w-8 rounded-full",
              metroRank > 0 && metroRank <= 3 ? "bg-warning/20" : "bg-muted"
            )}>
              <Trophy className={cn(
                "h-4 w-4",
                metroRank > 0 && metroRank <= 3 ? "text-warning" : "text-muted-foreground"
              )} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Metro Rank (30d)</p>
              <p className="text-sm font-bold text-foreground">
                {metroRank > 0
                  ? `#${metroRank} of ${totalContractors}`
                  : 'No rank yet'}
                {totalPurchases > 0 && (
                  <span className="text-xs font-normal text-muted-foreground ml-1">
                    ({totalPurchases} leads)
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
