import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { usePurchasedLeads } from '@/hooks/useLeads';
import { EstimateFeedback } from '@/components/EstimateFeedback';
import { RefundRequestModal } from '@/components/RefundRequestModal';
import { CloseoutModal } from '@/components/CloseoutModal';
import { useMyRefundRequests } from '@/hooks/useRefundRequest';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LeadPhoto } from '@/components/LeadPhoto';
import { MapPin, Phone, Mail, User, DollarSign, Clock, Home, Globe, RefreshCcw, CheckCircle2, XCircle, CheckCheck } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { isAppStoreSafeMode } from '@/lib/platform';

const safeMode = isAppStoreSafeMode();

export default function PurchasedLeads() {
  const { user, isAdmin } = useAuth();
  const { data: purchases, isLoading, error } = usePurchasedLeads();
  const { data: refundRequests } = useMyRefundRequests();
  const [refundTarget, setRefundTarget] = useState<{ purchaseId: string; customerName: string; amount: number } | null>(null);
  const [closeoutTarget, setCloseoutTarget] = useState<{ purchaseId: string; leadId: string; customerName: string; customerPhone?: string | null } | null>(null);

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

  const refundsByPurchase = new Map((refundRequests || []).map((r: any) => [r.purchase_id, r]));
  const closeoutsByPurchase = new Map((closeouts || []).map((c: any) => [c.purchase_id, c]));

  return (
    <div className="p-4 sm:p-8 min-h-screen">
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold text-foreground">Your Leads</h1>
        <p className="text-muted-foreground mt-1">
          {safeMode ? 'Leads currently assigned to your account.' : "View contact details for leads you've purchased"}
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="flex gap-6">
                  <Skeleton className="w-40 h-40 rounded-lg" />
                  <div className="flex-1 space-y-4">
                    <Skeleton className="h-6 w-48" />
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-40" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card className="p-8 text-center">
          <p className="text-destructive">Failed to load purchases. Please try again.</p>
        </Card>
      ) : purchases?.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">
            {safeMode ? 'No leads are currently assigned to this account.' : "You haven't purchased any leads yet. Browse available leads to get started!"}
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {purchases?.filter((p: any) => p.leads).map((purchase) => (
            <Card key={purchase.id} className="overflow-hidden">
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row gap-6">
                  {/* Lead Photo */}
                  <div className="w-full md:w-48 flex-shrink-0">
                    <LeadPhoto 
                      photoUrl={purchase.leads.photo_url} 
                      aspectRatio="square" 
                      objectFit="cover"
                      className="rounded-lg"
                    />
                  </div>

                  {/* Lead Details */}
                  <div className="flex-1 space-y-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-display font-semibold text-lg">
                            ${purchase.leads.estimated_cost_min.toLocaleString()} - ${purchase.leads.estimated_cost_max.toLocaleString()} Job
                          </h3>
                          {purchase.leads.source === 'personal' ? (
                            <Badge className="bg-red-600 hover:bg-red-600 text-white flex items-center gap-1">
                              <Globe className="w-3 h-3" />
                              From My Website
                            </Badge>
                          ) : purchase.leads.source === 'scout' ? (
                            <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white flex items-center gap-1">
                              <Globe className="w-3 h-3" />
                              From Scout
                            </Badge>
                          ) : (
                            <Badge className="bg-primary hover:bg-primary text-primary-foreground flex items-center gap-1">
                              <Globe className="w-3 h-3" />
                              From TreeCheck
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground text-sm mt-1">
                          <MapPin className="w-4 h-4" />
                          <span>{purchase.leads.city}</span>
                        </div>
                      </div>
                      {!safeMode && purchase.leads.source !== 'personal' && purchase.leads.source !== 'scout' && (
                        <Badge variant="secondary" className="flex items-center gap-1">
                          <DollarSign className="w-3 h-3" />
                          ${purchase.purchase_amount.toFixed(2)} paid
                        </Badge>
                      )}
                    </div>

                    {/* Customer Contact Info */}
                    <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                      <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">
                        Customer Contact
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-primary" />
                          <span className="font-medium">{purchase.leads.customer_name}</span>
                        </div>
                        <a 
                          href={`tel:${purchase.leads.customer_phone}`}
                          className="flex items-center gap-2 text-primary hover:underline"
                        >
                          <Phone className="w-4 h-4" />
                          <span>{purchase.leads.customer_phone}</span>
                        </a>
                        <a 
                          href={`mailto:${purchase.leads.customer_email}`}
                          className="flex items-center gap-2 text-primary hover:underline"
                        >
                          <Mail className="w-4 h-4" />
                          <span>{purchase.leads.customer_email}</span>
                        </a>
                        {purchase.leads.customer_address && (
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(purchase.leads.customer_address)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-start gap-2 text-primary hover:underline"
                          >
                            <Home className="w-4 h-4 mt-0.5" />
                            <span>{purchase.leads.customer_address}</span>
                          </a>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="w-4 h-4" />
                      <span>{safeMode ? 'Added on' : 'Purchased on'} {format(new Date(purchase.purchased_at), 'MMM d, yyyy')}</span>
                    </div>

                    {/* Estimate Feedback */}
                    <EstimateFeedback
                      leadId={purchase.lead_id}
                      estimateLow={purchase.leads.estimated_cost_min}
                      estimateHigh={purchase.leads.estimated_cost_max}
                      jobType={purchase.leads.job_type || 'Tree Removal'}
                      city={purchase.leads.city}
                    />

                    {/* Closeout */}
                    {(() => {
                      const co: any = closeoutsByPurchase.get(purchase.id);
                      return (
                        <div className="pt-3 border-t border-border">
                          <Button
                            variant={co ? 'secondary' : 'default'}
                            size="sm"
                            onClick={() => setCloseoutTarget({
                              purchaseId: purchase.id,
                              leadId: purchase.lead_id,
                              customerName: purchase.leads.customer_name,
                              customerPhone: purchase.leads.customer_phone,
                            })}
                          >
                            <CheckCheck className="mr-2 h-3.5 w-3.5" />
                            {co
                              ? `Closed out — sold for $${Number(co.sale_amount).toLocaleString()}`
                              : 'Closed out this job?'}
                          </Button>
                        </div>
                      );
                    })()}

                    {/* Refund Request — only TreeCheck-sourced leads, within 7 days */}
                    {!safeMode && purchase.leads.source !== 'personal' && purchase.leads.source !== 'scout' && (() => {
                      const existing: any = refundsByPurchase.get(purchase.id);
                       const ageDays = differenceInDays(new Date(), new Date(purchase.purchased_at));
                       const withinWindow = isAdmin || ageDays <= 7;

                      if (existing) {
                        const variant = existing.status === 'approved' ? 'secondary' : existing.status === 'denied' ? 'destructive' : 'default';
                        const Icon = existing.status === 'approved' ? CheckCircle2 : existing.status === 'denied' ? XCircle : RefreshCcw;
                        const label = existing.status === 'approved' ? `Refunded $${Number(existing.refund_amount || existing.purchase_amount).toFixed(2)} to credits` : existing.status === 'denied' ? 'Refund denied' : 'Refund pending review';
                        return (
                          <div className="pt-3 border-t border-border">
                            <Badge variant={variant} className="flex items-center gap-1.5 w-fit">
                              <Icon className="w-3.5 h-3.5" />{label}
                            </Badge>
                            {existing.status === 'denied' && existing.admin_notes && (
                              <p className="text-xs text-muted-foreground mt-1 italic">"{existing.admin_notes}"</p>
                            )}
                          </div>
                        );
                      }

                      return (
                        <div className="pt-3 border-t border-border">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!withinWindow}
                            onClick={() => setRefundTarget({ purchaseId: purchase.id, customerName: purchase.leads.customer_name, amount: purchase.purchase_amount })}
                          >
                            <RefreshCcw className="mr-2 h-3.5 w-3.5" />
                            {withinWindow ? 'Request a Refund' : 'Refund window expired'}
                          </Button>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {refundTarget && (
        <RefundRequestModal
          open={!!refundTarget}
          onOpenChange={(o) => { if (!o) setRefundTarget(null); }}
          purchaseId={refundTarget.purchaseId}
          customerName={refundTarget.customerName}
          purchaseAmount={refundTarget.amount}
        />
      )}

      {closeoutTarget && (
        <CloseoutModal
          open={!!closeoutTarget}
          onOpenChange={(o) => { if (!o) setCloseoutTarget(null); }}
          purchaseId={closeoutTarget.purchaseId}
          leadId={closeoutTarget.leadId}
          customerName={closeoutTarget.customerName}
          customerPhone={closeoutTarget.customerPhone}
          existing={closeoutsByPurchase.get(closeoutTarget.purchaseId) as any}
        />
      )}
    </div>
  );
}
