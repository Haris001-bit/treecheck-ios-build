import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLSALeads, useUpdateLSALead, type LSALead } from '@/hooks/useLSA';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Phone, MessageSquare, Settings, Clock } from 'lucide-react';
import { format, formatDistanceStrict } from 'date-fns';
import { WaitlistModal } from '@/components/WaitlistModal';

const statusVariant: Record<string, string> = {
  new: 'bg-blue-100 text-blue-800',
  contacted: 'bg-yellow-100 text-yellow-800',
  booked: 'bg-green-100 text-green-800',
  follow_up: 'bg-orange-100 text-orange-800',
  lost: 'bg-gray-200 text-gray-700',
};

export default function LSALeads() {
  const [status, setStatus] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [active, setActive] = useState<LSALead | null>(null);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const { data: leads = [], isLoading } = useLSALeads({ status, from, to });
  const update = useUpdateLSALead();

  const responseTime = (l: LSALead) =>
    l.first_response_at
      ? formatDistanceStrict(new Date(l.first_response_at), new Date(l.received_at))
      : '—';

  return (
    <div className="container mx-auto p-4 lg:p-8 max-w-7xl">
      <div className="flex items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold leading-tight">LSA Leads</h1>
          <p className="text-sm sm:text-base text-muted-foreground">Local Services Ads auto-response activity</p>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link to="/dashboard/lsa-settings">
            <Settings className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Settings</span>
          </Link>
        </Button>
      </div>

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-[10rem_1fr_1fr_auto] gap-3 items-end">
          <div className="col-span-2 sm:col-span-1">
            <label className="text-xs font-medium block mb-1">Status</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="contacted">Contacted</SelectItem>
                <SelectItem value="booked">Booked</SelectItem>
                <SelectItem value="follow_up">Follow up</SelectItem>
                <SelectItem value="lost">Lost</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium block mb-1">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {(from || to || status !== 'all') && (
            <Button variant="ghost" size="sm" className="col-span-2 sm:col-span-1" onClick={() => { setStatus('all'); setFrom(''); setTo(''); }}>Clear</Button>
          )}
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-3">Type</th>
              <th className="p-3">Customer</th>
              <th className="p-3">Job</th>
              <th className="p-3">Received</th>
              <th className="p-3">Response time</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {!isLoading && leads.length === 0 && (
              <tr><td colSpan={6} className="p-10 text-center">
                <div className="text-muted-foreground mb-4">No LSA leads yet. Feature coming soon.</div>
                <Button onClick={() => setWaitlistOpen(true)}>Get on the waiting list</Button>
              </td></tr>
            )}
            {leads.map((l) => (
              <tr key={l.id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => setActive(l)}>
                <td className="p-3">
                  {l.lead_type === 'call'
                    ? <span className="flex items-center gap-1"><Phone className="w-4 h-4" />Call</span>
                    : <span className="flex items-center gap-1"><MessageSquare className="w-4 h-4" />Msg</span>}
                </td>
                <td className="p-3">
                  <div className="font-medium">{l.customer_name || 'Unknown'}</div>
                  <div className="text-xs text-muted-foreground">{l.customer_phone}</div>
                </td>
                <td className="p-3 text-muted-foreground">{l.job_type || '—'}</td>
                <td className="p-3 whitespace-nowrap">
                  <div>{format(new Date(l.received_at), 'MMM d, h:mm a')}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />{formatDistanceStrict(new Date(l.received_at), new Date())} ago
                  </div>
                </td>
                <td className="p-3">{responseTime(l)}</td>
                <td className="p-3"><Badge className={statusVariant[l.outcome]}>{l.outcome}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Sheet open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {active && (
            <>
              <SheetHeader><SheetTitle>LSA Lead Details</SheetTitle></SheetHeader>
              <div className="space-y-4 mt-4">
                <div>
                  <div className="text-xs text-muted-foreground">Customer</div>
                  <div className="font-semibold">{active.customer_name || 'Unknown'}</div>
                  {active.customer_phone && (
                    <a href={`tel:${active.customer_phone}`} className="text-primary text-sm">{active.customer_phone}</a>
                  )}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Job type</div>
                  <div>{active.job_type || '—'}</div>
                </div>
                {active.message && (
                  <div>
                    <div className="text-xs text-muted-foreground">Message</div>
                    <div className="text-sm bg-muted p-3 rounded">{active.message}</div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground">Received</div>
                    <div className="text-sm">{format(new Date(active.received_at), 'PPp')}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">First response</div>
                    <div className="text-sm">
                      {active.first_response_at ? format(new Date(active.first_response_at), 'PPp') : '—'}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Outcome</label>
                  <Select
                    value={active.outcome}
                    onValueChange={(v) => update.mutate({ id: active.id, updates: { outcome: v as any } })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="contacted">Contacted</SelectItem>
                      <SelectItem value="booked">Booked</SelectItem>
                      <SelectItem value="follow_up">Follow up</SelectItem>
                      <SelectItem value="lost">Lost</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Notes</label>
                  <Textarea
                    defaultValue={active.notes || ''}
                    onBlur={(e) => {
                      if (e.target.value !== (active.notes || '')) {
                        update.mutate({ id: active.id, updates: { notes: e.target.value } });
                      }
                    }}
                    rows={4}
                  />
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <WaitlistModal
        open={waitlistOpen}
        onOpenChange={setWaitlistOpen}
        source="lsa_leads"
        title="Coming Soon"
        message="LSA auto-response is launching soon. Get on the waiting list?"
      />
    </div>
  );
}
