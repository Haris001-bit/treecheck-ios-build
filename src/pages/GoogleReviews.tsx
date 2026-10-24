import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ExternalLink, Loader2, Save, Star, User } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { isAppStoreSafeMode } from '@/lib/platform';
import { useDMAIntegration, useUpsertDMAIntegration } from '@/hooks/useDMA';
import { usePurchasedLeads } from '@/hooks/useLeads';

export default function GoogleReviews() {
  const { user } = useAuth();
  const { data: integration } = useDMAIntegration();
  const { data: purchases, isLoading } = usePurchasedLeads();
  const upsertIntegration = useUpsertDMAIntegration();
  const [reviewLink, setReviewLink] = useState(integration?.google_review_link || '');

  useEffect(() => {
    setReviewLink(integration?.google_review_link || '');
  }, [integration?.google_review_link]);

  const { data: closeouts } = useQuery({
    queryKey: ['lead-closeouts', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lead_closeouts' as any)
        .select('*')
        .eq('contractor_id', user!.id);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!user,
  });

  const closeoutsByPurchase = new Map((closeouts || []).map((c: any) => [c.purchase_id, c]));
  const recentLeads = (purchases || []).slice(0, 5);

  const saveReviewLink = async () => {
    await upsertIntegration.mutateAsync({ google_review_link: reviewLink.trim() || null });
    toast.success(isAppStoreSafeMode() ? 'Review link saved' : 'Google review link saved');
  };

  const openReviewLink = () => {
    const url = reviewLink.trim();
    if (!url) {
      toast.error(isAppStoreSafeMode() ? 'Add your review link first' : 'Add your Google review link first');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const safeMode = isAppStoreSafeMode();
  const pageTitle = safeMode ? 'Customer Reviews' : 'Google Reviews';
  const cardTitle = safeMode ? 'Review Link' : 'Review request link';
  const cardDesc = safeMode
    ? 'Save your public review page link and open it whenever you need to request a review.'
    : 'This is the same link used by job closeout and your Digital Marketing Agent.';
  const fieldLabel = safeMode ? 'Profile Review Link' : 'Google review URL';
  const fieldHelp = safeMode
    ? 'Paste your public review page link here.'
    : 'Find it in your Google Business Profile → Ask for reviews → Share.';
  const fieldPlaceholder = safeMode ? 'https://your-review-link.com' : 'https://g.page/r/...';

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold text-foreground">{pageTitle}</h1>
        <p className="text-muted-foreground mt-1">Save your review link and open it whenever you need to request a review.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Star className="h-5 w-5 text-primary" />
              {cardTitle}
            </CardTitle>
            <CardDescription>{cardDesc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="google-review-link">{fieldLabel}</Label>
              <Input
                id="google-review-link"
                type="url"
                value={reviewLink}
                onChange={(e) => setReviewLink(e.target.value)}
                placeholder={fieldPlaceholder}
              />
              <p className="text-xs text-muted-foreground">{fieldHelp}</p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={openReviewLink} className="gradient-primary">
                <ExternalLink className="mr-2 h-4 w-4" />
                Open Review Link
              </Button>
              <Button
                variant="outline"
                onClick={saveReviewLink}
                disabled={upsertIntegration.isPending || reviewLink === (integration?.google_review_link || '')}
              >
                {upsertIntegration.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Link
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Where job-specific requests live</CardTitle>
            <CardDescription>For a specific customer, use closeout from Your Leads.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button asChild variant="secondary" className="w-full justify-start">
              <Link to="/dashboard/purchased">Open Your Leads</Link>
            </Button>
            <p className="text-sm text-muted-foreground">Tap a lead, close out the job, then request the {safeMode ? 'review' : 'Google review'} from that customer.</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-lg">Recent customers</CardTitle>
          <CardDescription>Use these to find the right job closeout fast.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading recent leads…</div>
          ) : recentLeads.length === 0 ? (
            <div className="text-sm text-muted-foreground">No purchased leads yet.</div>
          ) : (
            <div className="divide-y divide-border">
              {recentLeads.map((purchase) => {
                const closeout = closeoutsByPurchase.get(purchase.id) as any;
                return (
                  <div key={purchase.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-primary" />
                        <p className="font-medium text-foreground">{purchase.leads.customer_name}</p>
                        {closeout?.review_requested && <Badge variant="secondary">Review requested</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        ${purchase.leads.estimated_cost_min.toLocaleString()} - ${purchase.leads.estimated_cost_max.toLocaleString()} · {format(new Date(purchase.purchased_at), 'MMM d, yyyy')}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/dashboard/purchased">Go to closeout</Link>
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}