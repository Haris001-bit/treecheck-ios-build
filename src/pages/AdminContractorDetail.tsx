import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Mail, Phone, MapPin, Calendar, DollarSign, Building, User, Globe } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { AdminFreeOverride } from '@/components/free/AdminFreeOverride';

export default function AdminContractorDetail() {
  const { id } = useParams<{ id: string }>();
  const { isAdmin } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-contractor-detail', id],
    enabled: isAdmin && !!id,
    queryFn: async () => {
      const [profileRes, areasRes, purchasesRes, txRes, refundsRes, dmaRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', id!).maybeSingle(),
        supabase.from('service_areas').select('city, region').eq('contractor_id', id!).order('city'),
        supabase
          .from('lead_purchases')
          .select('id, purchased_at, purchase_amount, lead_id, leads!inner(customer_name, city, job_type, status, source, estimated_cost_min, estimated_cost_max)')
          .eq('contractor_id', id!)
          .neq('leads.source', 'personal')
          .order('purchased_at', { ascending: false }),
        supabase
          .from('credit_transactions')
          .select('id, created_at, amount, type, description, reason_code')
          .eq('contractor_id', id!)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('refund_requests')
          .select('id, status, reason_code, created_at, refund_amount, purchase_amount')
          .eq('contractor_id', id!)
          .order('created_at', { ascending: false }),
        supabase
          .from('dma_integrations')
          .select('id, website_url, site_provider')
          .eq('contractor_id', id!)
          .maybeSingle(),
      ]);

      if (profileRes.error) throw profileRes.error;
      return {
        profile: profileRes.data,
        areas: areasRes.data || [],
        purchases: purchasesRes.data || [],
        transactions: txRes.data || [],
        refunds: refundsRes.data || [],
        dma: dmaRes.data,
      };
    },
  });

  if (!isAdmin) return <div className="p-8 text-muted-foreground">Admin access required.</div>;
  if (isLoading) return <div className="p-8 space-y-4"><Skeleton className="h-32 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (!data?.profile) return <div className="p-8">Contractor not found.</div>;

  const p = data.profile;
  const totalSpent = data.purchases.reduce((s: number, x: any) => s + Number(x.purchase_amount || 0), 0);

  return (
    <div className="p-4 sm:p-8 min-h-screen space-y-6">
      <Link to="/dashboard/admin/contractors" className="text-sm text-primary hover:underline">
        ← All contractors
      </Link>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-2xl">{p.company_name || p.full_name || p.email}</CardTitle>
              {p.full_name && p.company_name && (
                <p className="text-muted-foreground mt-1">{p.full_name}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {p.subscription_tier === 'pro' && <Badge>Premium</Badge>}
              {!p.is_active && <Badge variant="destructive">Inactive</Badge>}
              {p.role === 'admin' && <Badge variant="secondary">Admin</Badge>}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {p.email && (
            <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-primary" /><a href={`mailto:${p.email}`} className="text-primary hover:underline">{p.email}</a></div>
          )}
          {p.phone && (
            <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-primary" /><a href={`tel:${p.phone}`} className="text-primary hover:underline">{p.phone}</a></div>
          )}
          {p.company_name && <div className="flex items-center gap-2"><Building className="w-4 h-4 text-muted-foreground" />{p.company_name}</div>}
          <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-muted-foreground" />Joined {format(new Date(p.created_at), 'MMM d, yyyy')}</div>
          <div className="grid grid-cols-3 gap-4 pt-3 border-t border-border">
            <Stat label="Credits" value={`$${Number(p.credit_balance || 0).toFixed(2)}`} />
            <Stat label="Purchases" value={data.purchases.length} />
            <Stat label="Total spent" value={`$${totalSpent.toFixed(2)}`} />
          </div>
        </CardContent>
      </Card>

      {id && <AdminFreeOverride ownerId={id} />}

      <Card>
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><MapPin className="w-4 h-4" /> Service areas ({data.areas.length})</CardTitle></CardHeader>
        <CardContent>
          {data.areas.length === 0 ? (
            <p className="text-sm text-muted-foreground">No service areas set.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.areas.map((a: any, i: number) => (
                <Badge key={i} variant="secondary">{a.city}{a.region ? `, ${a.region}` : ''}</Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Globe className="w-4 h-4" /> Website provider</CardTitle>
          <CardDescription>
            Controls whether "DMA Web" (auto-publish to their website) is available. Only set to First Impression if we built their site.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-sm text-muted-foreground">
            {data.dma?.website_url ? <>Current site: <span className="font-mono">{data.dma.website_url}</span></> : 'No website URL on file.'}
          </div>
          <Select
            value={data.dma?.site_provider ?? 'unset'}
            onValueChange={async (val) => {
              const newVal = val === 'unset' ? null : val;
              if (data.dma?.id) {
                const { error } = await supabase.from('dma_integrations')
                  .update({ site_provider: newVal } as any).eq('id', data.dma.id);
                if (error) return toast.error(error.message);
              } else {
                const { error } = await supabase.from('dma_integrations')
                  .insert({ contractor_id: id!, site_provider: newVal } as any);
                if (error) return toast.error(error.message);
              }
              toast.success('Website provider updated');
              qc.invalidateQueries({ queryKey: ['admin-contractor-detail', id] });
            }}
          >
            <SelectTrigger className="max-w-xs"><SelectValue placeholder="Select provider" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unset">Unknown / not set</SelectItem>
              <SelectItem value="first_impression">First Impression (we built it) — DMA Web enabled</SelectItem>
              <SelectItem value="external">External (they built it) — DMA Web disabled</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>


      <Card>
        <CardHeader><CardTitle className="text-lg">Purchase history ({data.purchases.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {data.purchases.length === 0 ? (
            <p className="text-sm text-muted-foreground">No purchases yet.</p>
          ) : (
            data.purchases.map((pu: any) => (
              <div key={pu.id} className="flex items-center justify-between gap-3 p-3 border border-border rounded-lg">
                <div className="min-w-0">
                  <div className="font-medium truncate">{pu.leads?.customer_name || 'Unknown'} <span className="text-muted-foreground font-normal">— {pu.leads?.city}</span></div>
                  <div className="text-xs text-muted-foreground">
                    {pu.leads?.job_type} • {pu.leads?.source} • {format(new Date(pu.purchased_at), 'MMM d, yyyy')}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">${Number(pu.purchase_amount).toFixed(2)}</div>
                  {pu.leads?.status && <Badge variant="outline" className="text-xs mt-1">{pu.leads.status}</Badge>}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {data.refunds.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Refund requests ({data.refunds.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.refunds.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between p-3 border border-border rounded-lg text-sm">
                <div>
                  <div className="font-medium">{r.reason_code}</div>
                  <div className="text-xs text-muted-foreground">{format(new Date(r.created_at), 'MMM d, yyyy')}</div>
                </div>
                <div className="text-right">
                  <Badge variant={r.status === 'approved' ? 'default' : r.status === 'denied' ? 'destructive' : 'secondary'}>
                    {r.status}
                  </Badge>
                  <div className="text-xs mt-1">${Number(r.refund_amount || r.purchase_amount).toFixed(2)}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-lg">Recent credit transactions</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {data.transactions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No transactions yet.</p>
          ) : (
            data.transactions.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between p-2 border-b border-border last:border-0 text-sm">
                <div className="min-w-0">
                  <div className="truncate">{t.description || t.type}</div>
                  <div className="text-xs text-muted-foreground">{format(new Date(t.created_at), 'MMM d, yyyy h:mm a')}</div>
                </div>
                <div className={`font-semibold ${Number(t.amount) >= 0 ? 'text-primary' : 'text-destructive'}`}>
                  {Number(t.amount) >= 0 ? '+' : ''}${Number(t.amount).toFixed(2)}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground uppercase">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
