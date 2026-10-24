import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Navigate } from 'react-router-dom';
import { useAdminRefundRequests, useResolveRefund, REFUND_REASONS } from '@/hooks/useRefundRequest';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { LeadPhoto } from '@/components/LeadPhoto';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, MapPin, User, DollarSign, CheckCircle, XCircle, Phone, Mail } from 'lucide-react';

const REASON_LABELS: Record<string, string> = Object.fromEntries(REFUND_REASONS.map(r => [r.value, r.label]));

export default function AdminRefunds() {
  const { isAdmin } = useAuth();
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'denied' | 'all'>('pending');
  const { data: requests, isLoading } = useAdminRefundRequests(statusFilter);
  const [activeRefund, setActiveRefund] = useState<any | null>(null);
  const [decision, setDecision] = useState<'approved' | 'denied' | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [leadAction, setLeadAction] = useState<'sold_out' | 'available' | 'no_change'>('no_change');
  const resolveMutation = useResolveRefund();

  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  const openResolve = (refund: any, dec: 'approved' | 'denied') => {
    setActiveRefund(refund);
    setDecision(dec);
    setAdminNotes('');
    setLeadAction('no_change');
  };

  const handleResolve = () => {
    if (!activeRefund || !decision) return;
    resolveMutation.mutate(
      {
        refund_id: activeRefund.id,
        decision,
        admin_notes: adminNotes.trim() || undefined,
        lead_action: decision === 'approved' ? leadAction : undefined,
      },
      { onSuccess: () => { setActiveRefund(null); setDecision(null); } }
    );
  };

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-display font-bold">Refund Requests</h1>
        <p className="text-muted-foreground mt-1">Review and resolve contractor refund requests</p>
      </div>

      <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)} className="mb-6">
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="denied">Denied</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : !requests || requests.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">No {statusFilter !== 'all' ? statusFilter : ''} refund requests.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {requests.map((r: any) => (
            <Card key={r.id}>
              <CardContent className="p-6">
                <div className="flex flex-col lg:flex-row gap-4">
                  <div className="lg:w-40 flex-shrink-0">
                    <LeadPhoto photoUrl={r.lead?.photo_url} aspectRatio="square" objectFit="cover" className="rounded-lg" />
                  </div>
                  <div className="flex-1 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-lg">{r.contractor?.company_name || r.contractor?.full_name || 'Contractor'}</h3>
                          <Badge variant={r.status === 'pending' ? 'default' : r.status === 'approved' ? 'secondary' : 'destructive'}>
                            {r.status}
                          </Badge>
                          <Badge variant="outline" className="flex items-center gap-1">
                            <DollarSign className="w-3 h-3" />${Number(r.purchase_amount).toFixed(2)}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mt-1">
                          {r.contractor?.phone && <a href={`tel:${r.contractor.phone}`} className="flex items-center gap-1 hover:text-primary"><Phone className="w-3 h-3" />{r.contractor.phone}</a>}
                          {r.contractor?.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{r.contractor.email}</span>}
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</span>
                    </div>

                    <div className="bg-muted/50 rounded-lg p-3 space-y-2 text-sm">
                      <div className="flex items-center gap-2"><User className="w-4 h-4 text-primary" /><span className="font-medium">{r.lead?.customer_name || '—'}</span></div>
                      <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="w-4 h-4" /><span>{r.lead?.city}</span></div>
                      {r.lead?.customer_phone && <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-primary" /><a href={`tel:${r.lead.customer_phone}`} className="text-primary hover:underline">{r.lead.customer_phone}</a></div>}
                      <div className="text-xs text-muted-foreground">Lead status: <span className="font-medium">{r.lead?.status}</span> · Purchases: {r.lead?.purchase_count}</div>
                    </div>

                    <div className="space-y-1">
                      <p className="text-sm"><span className="font-semibold">Reason:</span> {REASON_LABELS[r.reason_code] || r.reason_code}</p>
                      {r.reason_notes && <p className="text-sm bg-muted/30 rounded p-2 italic">"{r.reason_notes}"</p>}
                    </div>

                    {r.status === 'pending' ? (
                      <div className="flex gap-2 pt-2">
                        <Button onClick={() => openResolve(r, 'approved')} className="gradient-primary">
                          <CheckCircle className="mr-2 h-4 w-4" /> Approve & Refund
                        </Button>
                        <Button onClick={() => openResolve(r, 'denied')} variant="destructive">
                          <XCircle className="mr-2 h-4 w-4" /> Deny
                        </Button>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground pt-2 space-y-1">
                        <p>Resolved {r.resolved_at ? formatDistanceToNow(new Date(r.resolved_at), { addSuffix: true }) : ''}{r.refund_amount ? ` · $${Number(r.refund_amount).toFixed(2)} refunded` : ''}</p>
                        {r.admin_notes && <p className="italic">Admin note: "{r.admin_notes}"</p>}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Resolve modal */}
      <Dialog open={!!activeRefund} onOpenChange={(o) => { if (!o) { setActiveRefund(null); setDecision(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{decision === 'approved' ? 'Approve Refund' : 'Deny Refund'}</DialogTitle>
          </DialogHeader>
          {activeRefund && (
            <div className="space-y-4">
              <div className="text-sm bg-muted/50 rounded p-3">
                <p><strong>{activeRefund.contractor?.company_name || activeRefund.contractor?.full_name}</strong></p>
                <p className="text-muted-foreground">${Number(activeRefund.purchase_amount).toFixed(2)} · {activeRefund.lead?.customer_name}</p>
              </div>

              {decision === 'approved' && (
                <div className="space-y-2">
                  <Label>What should happen to the lead?</Label>
                  <RadioGroup value={leadAction} onValueChange={(v) => setLeadAction(v as any)}>
                    <div className="flex items-start space-x-2 border rounded p-2"><RadioGroupItem value="no_change" id="lc1" className="mt-0.5" /><Label htmlFor="lc1" className="font-normal cursor-pointer">Leave as-is (other contractors keep access)</Label></div>
                    <div className="flex items-start space-x-2 border rounded p-2"><RadioGroupItem value="sold_out" id="lc2" className="mt-0.5" /><Label htmlFor="lc2" className="font-normal cursor-pointer">Mark sold-out (hide from others — bad lead)</Label></div>
                    <div className="flex items-start space-x-2 border rounded p-2"><RadioGroupItem value="available" id="lc3" className="mt-0.5" /><Label htmlFor="lc3" className="font-normal cursor-pointer">Return to available (decrement purchase count)</Label></div>
                  </RadioGroup>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="admin-notes">Internal note {decision === 'denied' && <span className="text-muted-foreground">(shown to contractor)</span>}</Label>
                <Textarea id="admin-notes" value={adminNotes} onChange={(e) => setAdminNotes(e.target.value.slice(0, 500))} rows={3} placeholder="Optional notes..." />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setActiveRefund(null); setDecision(null); }} disabled={resolveMutation.isPending}>Cancel</Button>
                <Button onClick={handleResolve} disabled={resolveMutation.isPending} className={decision === 'approved' ? 'gradient-primary' : ''} variant={decision === 'denied' ? 'destructive' : 'default'}>
                  {resolveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Confirm {decision === 'approved' ? 'Refund' : 'Denial'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
