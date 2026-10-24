import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { CATALOG, NO_PERMISSIONS, PRESETS, requiredSeat, formatCents, type Permissions, type SeatType } from '@/lib/pricing/catalog';
import { useCompanyBillingChange } from '@/hooks/useCompanyBilling';
import { Badge } from '@/components/ui/badge';
import { Pencil, Trash2 } from 'lucide-react';
import { isNativeStoreBilling } from '@/lib/platform';

const labels: Record<keyof Permissions, string> = {
  assignedJobs: 'Assigned-job access', manageJobsSubs: 'Company-wide Jobs & Subs', createScout: 'Create Scout estimates',
  reviewEstimates: 'Review and approve estimates', dmaSubmit: 'Submit DMA photos and voice memos', dmaManage: 'Manage marketing and publishing',
  operationalSettings: 'Operational company settings', viewPulse: 'View Pulse financial information',
};

export function CompanyTeamAccess({ data }: { data: any }) {
  const billing = data.billing;
  const interval = billing.billing_interval === 'year' ? 'year' : 'month';
  // A phone plan is billed by the App Store or Google Play: no Stripe checkout or renewal changes here, seats it includes only.
  const storePlan = billing.provider === 'app_store' || billing.provider === 'play_store';
  const stripeUi = !isNativeStoreBilling() && !storePlan;
  const mutation = useCompanyBillingChange();
  const [email, setEmail] = useState('');
  const [memberId, setMemberId] = useState<string>();
  const [seat, setSeat] = useState<SeatType | null>('field');
  const [kind, setKind] = useState('employee');
  const [permissions, setPermissions] = useState<Permissions>({ ...PRESETS.field_crew.permissions });
  const [preview, setPreview] = useState<any>();
  const [ownerScout, setOwnerScout] = useState(!!billing.capacity?.ownerScout);
  const [dma, setDma] = useState(billing.dma_source === 'paid');
  const [checkoutInterval, setCheckoutInterval] = useState<'month' | 'year'>(interval);
  const [inviteUrl, setInviteUrl] = useState('');
  const [renewalCapacity, setRenewalCapacity] = useState({ scout: billing.capacity.scout, manager: billing.capacity.manager, field: billing.capacity.field });
  const [renewalOpen, setRenewalOpen] = useState(false);
  const payload = { email, memberId, seat, kind, permissions };
  const applyPreset = (key: string) => {
    setPermissions({ ...PRESETS[key].permissions });
    setKind(key === 'marketing_capture' ? 'capture' : key === 'sub_guest' ? 'subcontractor' : 'employee');
    setSeat(key === 'sub_guest' ? null : requiredSeat(PRESETS[key].permissions));
  };
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-bold">Team & company plan</h1>{billing.environment === 'sandbox' && <Badge variant="secondary">Test billing</Badge>}</header>
    <section className="space-y-3 border-b pb-6">
      <h2 className="text-lg font-semibold">{billing.complimentary ? 'Complimentary company access' : 'TreeCheck Core'}</h2>
      <p className="text-sm text-muted-foreground">Core includes one owner and two field users. Scout estimating is purchased separately.</p>
      <p>{billing.status} · {interval === 'year' ? 'Annual, paid upfront' : 'Monthly'}{billing.current_period_end ? ` · Renews ${new Date(billing.current_period_end).toLocaleDateString()}` : ''}</p>
      <p className="text-sm">{billing.dma_source === 'website' ? 'DMA: Included with your website service.' : billing.dma_source === 'paid' ? 'DMA: One company subscription.' : 'DMA not purchased.'}</p>
      {storePlan && <p className="text-sm">Billed through {billing.provider === 'play_store' ? 'Google Play' : 'the App Store'}. Manage it on the phone you subscribed with. Your plan includes you and two Field users.</p>}
      {stripeUi && !billing.stripe_subscription_id && !billing.complimentary && <>
        <div className="flex gap-2"><Button variant={checkoutInterval === 'month' ? 'default' : 'outline'} size="sm" onClick={() => setCheckoutInterval('month')}>Monthly</Button><Button variant={checkoutInterval === 'year' ? 'default' : 'outline'} size="sm" onClick={() => setCheckoutInterval('year')}>Annual, paid upfront</Button></div>
        <Label className="flex items-center gap-2"><Checkbox checked={ownerScout} onCheckedChange={v => setOwnerScout(v === true)} />Owner Scout license · {formatCents(CATALOG.scout[checkoutInterval])}/{checkoutInterval}</Label>
        {billing.dma_source !== 'website' && <Label className="flex items-center gap-2"><Checkbox checked={dma} onCheckedChange={v => setDma(v === true)} />DMA for the company · {formatCents(CATALOG.dma[checkoutInterval])}/{checkoutInterval}</Label>}
        <Button disabled={mutation.isPending} onClick={async () => {
          const result = await mutation.mutateAsync({ action: 'checkout', interval: checkoutInterval, ownerScout, dma, requestKey: crypto.randomUUID() });
          if (result.url) window.location.href = result.url;
        }}>{billing.environment === 'sandbox' ? 'Continue to Stripe test checkout' : 'Continue to secure checkout'}</Button>
      </>}
      {stripeUi && billing.stripe_subscription_id && <div className="space-y-3">
        <h3 className="font-semibold">Next renewal</h3>
        <div className="grid sm:grid-cols-3 gap-3">{(['scout','manager','field'] as const).map(k => <div key={k}><Label htmlFor={`renewal-${k}`}>{CATALOG[k].label}</Label><Input id={`renewal-${k}`} type="number" min={k === 'field' ? 2 : 0} max={billing.capacity[k]} value={renewalCapacity[k]} onChange={e => setRenewalCapacity(p => ({ ...p, [k]: Number(e.target.value) }))} /></div>)}</div>
        <Select value={checkoutInterval} onValueChange={v => setCheckoutInterval(v as 'month'|'year')}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="month">Monthly at renewal</SelectItem><SelectItem value="year">Annual at renewal, paid upfront</SelectItem></SelectContent></Select>
        <Button variant="outline" onClick={() => setRenewalOpen(true)}>Review renewal change</Button>
        {billing.pending_renewal && <div className="space-y-2"><p className="text-sm text-muted-foreground">{billing.pending_renewal.cancellation ? 'Cancellation scheduled for the end of the paid period.' : `Scheduled renewal: ${formatCents(billing.pending_renewal.total)}/${billing.pending_renewal.interval}`}</p>{!billing.pending_renewal.cancellation && <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ action: 'cancel_renewal', requestKey: crypto.randomUUID() })}>Cancel scheduled renewal change</Button>}</div>}
        <Button variant="destructive" disabled={mutation.isPending} onClick={() => { if (window.confirm('Cancel at the end of the current paid period? There is no midterm refund.')) mutation.mutate({ action: 'cancel_subscription', requestKey: crypto.randomUUID() }); }}>Cancel subscription at renewal</Button>
      </div>}
    </section>
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">{memberId ? 'Edit team access' : 'Add a team member'}</h2>
      <Label htmlFor="access-email">Email</Label><Input id="access-email" value={email} onChange={e => setEmail(e.target.value)} type="email" />
      <div className="flex flex-wrap gap-2">{Object.entries(PRESETS).map(([key, value]) => <Button key={key} variant="outline" size="sm" onClick={() => applyPreset(key)}>{value.label}</Button>)}</div>
      <div className="grid sm:grid-cols-2 gap-3">{Object.entries(labels).map(([key, label]) => <Label key={key} className="flex items-start gap-2 leading-5"><Checkbox disabled={key === 'viewPulse'} checked={permissions[key as keyof Permissions]} onCheckedChange={v => setPermissions(p => ({ ...p, [key]: v === true }))} />{key === 'viewPulse' ? 'Pulse financial access — owner only' : label}</Label>)}</div>
      <div className="space-y-2"><Label>Assigned seat</Label><Select value={seat ?? 'none'} onValueChange={v => setSeat(v === 'none' ? null : v as SeatType)}><SelectTrigger className="max-w-sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No paid employee seat</SelectItem>{(['field', 'manager', 'scout'] as const).map(k => <SelectItem key={k} value={k}>{CATALOG[k].label} · {formatCents(CATALOG[k][interval])}/{interval}</SelectItem>)}</SelectContent></Select>
      <p className="text-sm text-muted-foreground">{seat && interval === 'year' ? `${formatCents(CATALOG[seat].year)} annually (${formatCents(CATALOG[seat].year / 12)}/month equivalent).` : 'Included or vacant paid capacity is used first.'}</p></div>
      {permissions.viewPulse && <p role="alert" className="text-destructive text-sm">Pulse remains owner-only. This saved preference does not yet grant teammates financial access.</p>}
      <Button disabled={!email || mutation.isPending} onClick={async () => setPreview(await mutation.mutateAsync({ action: 'preview', ...payload }))}>Preview access change</Button>
      {inviteUrl && <div className="space-y-2"><Label>Invitation link — no email or text sent</Label><Input readOnly value={inviteUrl} /><Button variant="outline" onClick={() => navigator.clipboard.writeText(inviteUrl)}>Copy invitation</Button></div>}
    </section>
    <section className="border-t pt-5 space-y-3"><h2 className="text-lg font-semibold">Members & reserved seats</h2>{data.members.length === 0 && <p className="text-muted-foreground">No assigned members.</p>}{data.members.map((m: any) => <div key={m.id} className="flex items-center justify-between gap-3 border-b py-3"><div className="min-w-0"><p className="break-all">{m.email}</p><p className="text-sm text-muted-foreground">{m.seat_type ?? m.member_kind} · {m.status}</p></div><div className="flex gap-1"><Button variant="ghost" size="icon" aria-label={`Edit ${m.email}`} onClick={() => { setMemberId(m.id); setEmail(m.email); setSeat(m.seat_type); setKind(m.member_kind); setPermissions({ ...NO_PERMISSIONS, ...m.permissions }); }}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" aria-label={`Remove ${m.email}`} onClick={() => mutation.mutate({ action: 'remove', memberId: m.id })}><Trash2 className="h-4 w-4" /></Button></div></div>)}</section>
    <AlertDialog open={!!preview} onOpenChange={open => { if (!open) setPreview(undefined); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Confirm team access</AlertDialogTitle><AlertDialogDescription>{preview?.requiresPurchase ? `Due today: ${formatCents(preview.amountDue)}. Confirm this invoice before assigning the seat.` : 'No billing change.'}<br />Company renewal total before tax: {preview ? formatCents(preview.renewalTotal) : ''}/{interval}<br />{preview?.renewalDate ? `Renewal: ${new Date(preview.renewalDate).toLocaleDateString()}` : ''}{permissions.viewPulse ? <><br />Financial access is sensitive and remains subject to the Pulse access authorization.</> : null}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><Button disabled={mutation.isPending} onClick={async () => {
      if (preview?.requiresPurchase) {
        await mutation.mutateAsync({ action: 'confirm_purchase', changeId: preview.changeId });
        setPreview(await mutation.mutateAsync({ action: 'preview', ...payload }));
        return;
      }
      const saved = await mutation.mutateAsync({ action: 'save_access', ...payload });
      if (saved.inviteUrl) setInviteUrl(saved.inviteUrl);
      setPreview(undefined);
    }}>{preview?.requiresPurchase ? 'Confirm payment' : 'Confirm access'}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={renewalOpen} onOpenChange={setRenewalOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Change next renewal</AlertDialogTitle><AlertDialogDescription>No charge today. The company changes to {checkoutInterval === 'year' ? 'annual billing, paid upfront' : 'monthly billing'} at renewal. Only vacant seats can be reduced. Existing paid capacity stays available until then.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><Button disabled={mutation.isPending} onClick={async () => { await mutation.mutateAsync({ action: 'schedule_renewal', capacity: renewalCapacity, interval: checkoutInterval, requestKey: crypto.randomUUID() }); setRenewalOpen(false); }}>Confirm renewal change</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}