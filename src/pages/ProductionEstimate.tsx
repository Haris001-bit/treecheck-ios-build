import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileText, Loader2, Plus, Save, Send, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useProductionStatus } from '@/hooks/useProductionStatus';
import { useProductionCard, productionCall } from '@/hooks/useProductionWork';
import { productionDb } from '@/lib/production/client';
import { priceEstimate, type PricedEstimate, type PricedItem } from '@/lib/production/estimate';
import { factsToAnswers, type FactValue } from '@/lib/production/aiFacts';
import { buildProposal } from '@/lib/production/proposal';
import { isOffered, type EstimateTotals } from '@/lib/production/pricing';
import { dollars } from '@/lib/production/answers';
import { useAuth } from '@/lib/auth';
import { Section, TextField, ChoiceField } from '@/components/production/setup/fields';
import { today } from '@/components/production/setup/types';
import { TreeCard, type TreeDraft, type AnalyzeResult } from '@/components/production/estimate/TreeCard';
import { WorkItemCard } from '@/components/production/estimate/WorkItemCard';
import { startingAnswers, type ItemDraft } from '@/components/production/estimate/choices';
import { PhotoStrip } from '@/components/production/estimate/PhotoStrip';

type Customer = { name: string; phone: string; email: string; address: string; gateCode: string; accessNotes: string; jobberRequestId?: string };
type Window = { from?: string; to?: string };
const EMPTY_CUSTOMER: Customer = { name: '', phone: '', email: '', address: '', gateCode: '', accessNotes: '' };
const LOST_REASONS = ['Price', 'Went with another company', 'Timing', 'No response', 'Other'];
const OPEN = ['draft', 'sent', 'changes_requested'];
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', sent: 'Sent', changes_requested: 'Changes requested', approved: 'Approved', lost: 'Lost', archived: 'Replaced by a revision',
};
const newKey = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const firstTree = (): TreeDraft => ({ key: 't1', label: 'Tree 1', photos: [], voice: null });
const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** Scout > Crew estimate: trees with photos and a voice memo, AI pre-fill, prices from the company's published rates. */
export default function ProductionEstimate() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { status, isLoading: statusLoading } = useProductionStatus();
  const allowed = status.published && status.can.price;
  const card = useProductionCard(allowed);
  const def = card.data?.def ?? null;
  // Names the folder for photos taken before the first save.
  const [estimateKey] = useState(() => id ?? newKey('e'));
  // Started from a Jobber request (Crew work, approval extras): the customer comes filled in.
  const fromRequest = (useLocation().state as { fromRequest?: Partial<Customer> } | null)?.fromRequest;
  const [customer, setCustomer] = useState<Customer>(() => (id || !fromRequest ? EMPTY_CUSTOMER : { ...EMPTY_CUSTOMER, ...fromRequest }));
  const [window_, setWindow] = useState<Window>({});
  const [trees, setTrees] = useState<TreeDraft[]>([firstTree()]);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [discountKey, setDiscountKey] = useState<string | null>(null);
  const [paymentPlanKey, setPaymentPlanKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [approving, setApproving] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [losing, setLosing] = useState(false);
  const [lostReason, setLostReason] = useState(LOST_REASONS[0]);

  const loaded = useQuery({
    queryKey: ['production-estimate', id],
    enabled: allowed && !!id,
    queryFn: async () => {
      const [e, c] = await Promise.all([
        productionDb.from('production_estimates').select('*').eq('id', id).maybeSingle(),
        productionDb.from('production_estimate_costs').select('totals').eq('estimate_id', id).maybeSingle(),
      ]);
      if (e.error) throw e.error;
      return { row: e.data, costs: (c.data?.totals ?? null) as { cost?: number; margin?: number; commissionBasis?: number } | null };
    },
  });
  const row = loaded.data?.row ?? null;
  const jobber = useQuery({
    queryKey: ['production-jobber-connected'],
    enabled: allowed,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => (await productionCall<{ connected: boolean }>('production-estimate', { action: 'jobber' })).connected,
  });
  useEffect(() => {
    if (!row) return;
    setCustomer({ ...EMPTY_CUSTOMER, ...(row.customer ?? {}) });
    setWindow(row.promised_window ?? {});
    setTrees(row.trees?.length ? row.trees : [firstTree()]);
    setItems(((row.work_items ?? []) as PricedItem[]).map((p) => ({
      id: p.id, serviceKey: p.serviceKey, treeKey: p.treeKey, kind: p.kind, answers: p.answers, answerSources: p.answerSources,
      sell: p.override ? p.override.to : null, overrideReason: p.override?.reason ?? null, selected: p.selected,
    })));
    setDiscountKey(row.totals?.discountKey ?? null);
    setPaymentPlanKey(row.totals?.paymentPlanKey ?? null);
  }, [row]);
  const readOnly = !!row && row.status !== 'draft';
  const savedPhotos = useMemo(() => new Map(((row?.trees ?? []) as TreeDraft[]).map((t) => [t.key, t.photos ?? []])), [row]);

  // A draft is priced live from today's rates (saving prices it the same way on the server). Anything sent or decided
  // shows the prices it was saved with, even if the rates changed since.
  const priced = useMemo((): PricedEstimate | null => {
    if (!def) return null;
    if (readOnly) return { items: (row.work_items ?? []) as PricedItem[], totals: row.totals as EstimateTotals, ok: true, problems: [] };
    return priceEstimate(def, items, { day: today(), settings: card.data?.settings, discountKey, paymentPlanKey });
  }, [def, readOnly, row, items, card.data?.settings, discountKey, paymentPlanKey]);
  const byId = useMemo(() => new Map((priced?.items ?? []).map((p) => [p.id, p])), [priced]);

  if (statusLoading || card.isLoading || (id && loaded.isLoading)) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!allowed || !def) {
    return (
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <Card className="p-6 text-sm text-muted-foreground">Crew estimates open once your company publishes its rates (Settings, Crews and pricing).</Card>
      </div>
    );
  }

  const addItem = (treeKey: string) => {
    const s = def.services.find((x) => isOffered(x, today()).kind === 'ok')?.key;
    if (s) setItems((cur) => [...cur, { id: newKey('w'), serviceKey: s, treeKey, kind: 'required', answers: startingAnswers(def, s) }]);
  };

  const analyze = async (input: { treeKey: string; photos: string[]; voice?: string; notes?: string }): Promise<AnalyzeResult> => {
    const r = await productionCall<AnalyzeResult>('production-ai', { action: 'analyze_tree', estimateKey: row?.id ?? estimateKey, ...input });
    const found = r.trees[0];
    if (found) {
      setItems((cur) => {
        const next = [...cur];
        for (const sk of found.services) {
          const service = def.services.find((s) => s.key === sk);
          if (!service) continue;
          const filled = factsToAnswers(service, found.facts as Record<string, FactValue>, def.crews);
          const at = next.findIndex((i) => i.treeKey === input.treeKey && i.serviceKey === sk);
          if (at >= 0) {
            // What the salesperson already answered stays; the AI only fills the gaps.
            const old = next[at];
            const kept = Object.entries(old.answers).filter(([, v]) => v !== null && v !== undefined && v !== '');
            const keptKeys = new Set(kept.map(([k]) => k));
            next[at] = {
              ...old,
              answers: { ...filled.answers, ...Object.fromEntries(kept) },
              answerSources: { ...filled.sources, ...Object.fromEntries(Object.entries(old.answerSources ?? {}).filter(([k]) => keptKeys.has(k))) },
              uncertain: filled.uncertain.filter((k) => !keptKeys.has(k)),
            };
          } else {
            next.push({
              id: newKey('w'), serviceKey: sk, treeKey: input.treeKey, kind: 'required',
              answers: { ...startingAnswers(def, sk), ...filled.answers }, answerSources: filled.sources, uncertain: filled.uncertain,
            });
          }
        }
        return next;
      });
    }
    return r;
  };

  /** Saves the screen as it is. The server prices it again from the rate card in force; its price is the one kept. */
  const persist = () => productionCall<{ ok: true; estimate: { id: string; number: number }; problems: string[] }>('production-estimate', {
    action: 'save', estimateId: row?.id, customer, trees, discountKey, paymentPlanKey,
    promisedWindow: window_.from || window_.to ? window_ : null,
    items: items.map(({ uncertain: _uncertain, ...i }) => i),
  });

  const save = async () => {
    setBusy(true);
    try {
      const r = await persist();
      toast.success(r.problems.length ? `Saved #${r.estimate.number}. Still to finish: ${r.problems[0]}` : `Saved #${r.estimate.number}`);
      await qc.invalidateQueries({ queryKey: ['production-estimates'] });
      if (!row) nav(`/dashboard/instant-estimator/crew/${r.estimate.id}`, { replace: true });
      else await loaded.refetch();
    } catch (e) {
      toast.error(message(e, 'Could not save'));
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!row) return;
    setBusy(true);
    try {
      if (row.status === 'draft') await persist();
      const r = await productionCall<{ ok: true; packets: number }>('production-estimate', { action: 'approve', estimateId: row.id, chosen });
      toast.success(`Approved. ${r.packets} job packet${r.packets === 1 ? '' : 's'} ready in Crew work.`);
      setApproving(false);
      await Promise.all([loaded.refetch(), qc.invalidateQueries({ queryKey: ['production-packets'] }), qc.invalidateQueries({ queryKey: ['production-estimates'] })]);
    } catch (e) {
      toast.error(message(e, 'Could not approve'));
    } finally {
      setBusy(false);
    }
  };

  const markLost = async () => {
    if (!row) return;
    setBusy(true);
    try {
      await productionCall('production-estimate', { action: 'lost', estimateId: row.id, reason: lostReason });
      toast.success('Marked lost');
      setLosing(false);
      await Promise.all([loaded.refetch(), qc.invalidateQueries({ queryKey: ['production-estimates'] })]);
    } catch (e) {
      toast.error(message(e, 'Could not save'));
    } finally {
      setBusy(false);
    }
  };

  const revise = async () => {
    if (!row) return;
    setBusy(true);
    try {
      const r = await productionCall<{ ok: true; estimate: { id: string } }>('production-estimate', { action: 'revise', estimateId: row.id });
      await qc.invalidateQueries({ queryKey: ['production-estimates'] });
      if (row.jobber_quote_id) toast.info(`New version made. Archive quote #${row.jobber_quote_number ?? ''} in Jobber once the new one goes out.`);
      nav(`/dashboard/instant-estimator/crew/${r.estimate.id}`);
    } catch (e) {
      toast.error(message(e, 'Could not revise'));
    } finally {
      setBusy(false);
    }
  };

  /** Makes the draft quote in Jobber from the estimate as saved (a draft is saved first). The office sends it from Jobber. */
  const toJobber = async (action: 'send' | 'check') => {
    if (!row) return;
    setBusy(true);
    try {
      if (action === 'send' && row.status === 'draft') await persist();
      const r = await productionCall<{ ok: true; message: string }>('production-estimate', { action, estimateId: row.id });
      toast.success(r.message);
    } catch (e) {
      toast.error(message(e, 'Could not reach Jobber'));
    } finally {
      await Promise.all([loaded.refetch(), qc.invalidateQueries({ queryKey: ['production-estimates'] })]);
      setBusy(false);
    }
  };

  const sign = async (path: string) => (await productionCall<{ url: string }>('production-estimate', { action: 'media', estimateId: row?.id, path })).url;
  const optionals = items.filter((i) => i.kind !== 'required');
  // Approving needs every item that counts to have a price: the required ones and the options the customer took.
  const unfinished = (priced?.items ?? []).filter((p) => (p.kind === 'required' || chosen.includes(p.id)) && p.status !== 'ok');
  const proposal = buildProposal(def, {
    items: (priced?.items ?? []).flatMap((p) => {
      const service = def.services.find((s) => s.key === p.serviceKey);
      return service && p.price !== null ? [{
        id: p.id, service, answers: p.answers, price: p.price, kind: p.kind, selected: p.selected, recurring: p.recurring,
        treeLabel: trees.find((t) => t.key === p.treeKey)?.label ?? null,
      }] : [];
    }),
    isa: user?.id ? card.data?.settings?.isa_credentials?.[user.id] ?? null : null, discountKey, paymentPlanKey,
  });
  const t = priced?.totals;
  const costs = loaded.data?.costs;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4 pb-28">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{row ? `Crew estimate #${row.number}` : 'New crew estimate'}</h1>
          <p className="text-sm text-muted-foreground">Rates version {card.data?.card?.version}{card.data?.card?.label ? `, ${card.data.card.label}` : ''}</p>
        </div>
        <div className="flex items-center gap-3">
          {row && <Badge variant={row.status === 'approved' ? 'default' : 'secondary'}>{STATUS_LABEL[row.status] ?? row.status}</Badge>}
          <Link to="/dashboard/bid-board/crew" className="text-sm text-primary underline">Crew work</Link>
        </div>
      </div>
      {readOnly && (
        <Card className="p-3 text-sm flex flex-wrap items-center justify-between gap-2">
          <span>
            {row.status === 'approved' ? 'Approved. The job packets are in Crew work.'
              : row.status === 'lost' ? `Lost: ${row.lost_reason ?? ''}`
                : row.status === 'archived' ? 'A newer version of this estimate replaced it.'
                  : 'This estimate has been sent. Revise it to change anything.'}
          </span>
          {(row.status === 'sent' || row.status === 'changes_requested') && <Button size="sm" variant="outline" onClick={revise} disabled={busy}>Revise</Button>}
        </Card>
      )}
      {row && (row.jobber_quote_id || row.quote_state) && (
        <Card className="p-3 text-sm flex flex-wrap items-center justify-between gap-2">
          <span>
            {row.jobber_quote_id
              ? `In Jobber as quote #${row.jobber_quote_number ?? ''}. The office checks it and sends it to the customer from Jobber.`
              : row.quote_state === 'creating' ? 'The Jobber quote is being made.'
                : row.quote_state === 'uncertain' ? 'Jobber may have made the quote without confirming it. Check Jobber before sending again.'
                  : row.quote_state === 'failed' ? `The Jobber quote wasn't made: ${row.quote_error ?? 'try again'}`
                    : 'Not in Jobber yet.'}
          </span>
          {!row.jobber_quote_id && (row.quote_state === 'uncertain' || row.quote_state === 'creating') && (
            <Button size="sm" variant="outline" onClick={() => toJobber('check')} disabled={busy}>Check Jobber</Button>
          )}
        </Card>
      )}

      <fieldset disabled={readOnly} className="space-y-4">
        <Section title="Customer and property" hint={customer.jobberRequestId ? 'From a Jobber request. The Jobber quote is linked to it.' : undefined}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Name" value={customer.name} max={120} onChange={(v) => setCustomer({ ...customer, name: v })} />
            <TextField label="Phone" value={customer.phone} max={40} onChange={(v) => setCustomer({ ...customer, phone: v })} />
            <TextField label="Email" value={customer.email} max={200} onChange={(v) => setCustomer({ ...customer, email: v })} />
            <TextField label="Address" value={customer.address} max={300} onChange={(v) => setCustomer({ ...customer, address: v })} />
            <TextField label="Gate code" value={customer.gateCode} max={40} onChange={(v) => setCustomer({ ...customer, gateCode: v })} />
            <TextField label="Access notes" value={customer.accessNotes} max={500} onChange={(v) => setCustomer({ ...customer, accessNotes: v })} />
            <div className="space-y-1">
              <Label htmlFor="pw-from" className="text-xs">Work can start (optional)</Label>
              <Input id="pw-from" type="date" value={window_.from ?? ''} onChange={(e) => setWindow({ ...window_, from: e.target.value || undefined })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pw-to" className="text-xs">Promised by (optional)</Label>
              <Input id="pw-to" type="date" value={window_.to ?? ''} onChange={(e) => setWindow({ ...window_, to: e.target.value || undefined })} />
            </div>
          </div>
        </Section>

        {trees.map((tree, ti) => (
          <TreeCard key={tree.key} tree={tree} analyze={analyze}
            saved={row && (savedPhotos.get(tree.key) ?? []).length > 0 ? <PhotoStrip scope={row.id} paths={savedPhotos.get(tree.key) ?? []} sign={sign} /> : null}
            onChange={(nt) => setTrees((cur) => cur.map((x, j) => (j === ti ? nt : x)))}
            onRemove={() => { setTrees((cur) => cur.filter((_, j) => j !== ti)); setItems((cur) => cur.filter((i) => i.treeKey !== tree.key)); }}>
            {items.filter((i) => i.treeKey === tree.key).map((it) => (
              <WorkItemCard key={it.id} def={def} item={it} priced={byId.get(it.id)}
                onChange={(ni) => setItems((cur) => cur.map((x) => (x.id === it.id ? ni : x)))}
                onRemove={() => setItems((cur) => cur.filter((x) => x.id !== it.id))} />
            ))}
            <Button type="button" size="sm" variant="outline" onClick={() => addItem(tree.key)}><Plus className="w-4 h-4 mr-1" />Add work for this tree</Button>
          </TreeCard>
        ))}
        <Button type="button" variant="outline" onClick={() => setTrees((cur) => [...cur, { key: newKey('t'), label: `Tree ${cur.length + 1}`, photos: [], voice: null }])}>
          <Plus className="w-4 h-4 mr-1" />Add another tree
        </Button>

        <Section title="Totals">
          <div className="grid gap-3 sm:grid-cols-2">
            <ChoiceField<string> label="Discount" value={discountKey ?? 'none'}
              options={[['none', 'None'], ...def.policies.discounts.map((d): [string, string] => [d.key, `${d.label} (${d.percent}%)`])]}
              onChange={(v) => setDiscountKey(v === 'none' ? null : v)} />
            <ChoiceField<string> label="Payment plan" value={paymentPlanKey ?? 'none'}
              options={[['none', 'None'], ...def.policies.paymentPlans.map((p): [string, string] => [p.key, p.label])]}
              onChange={(v) => setPaymentPlanKey(v === 'none' ? null : v)} />
          </div>
          {t && (
            <div className="text-sm space-y-1">
              <div className="flex justify-between"><span>Work</span><span>{dollars(t.subtotal)}</span></div>
              {t.optionalTotal > 0 && <div className="flex justify-between text-muted-foreground"><span>Options not included</span><span>{dollars(t.optionalTotal)}</span></div>}
              {t.discount && <div className="flex justify-between"><span>{t.discount.label}</span><span>-{dollars(t.discount.amount)}</span></div>}
              <div className="flex justify-between font-semibold text-base"><span>Total</span><span>{dollars(t.total)}</span></div>
              {t.deposit && <div className="flex justify-between text-muted-foreground"><span>Deposit ({t.deposit.percent}%)</span><span>{dollars(t.deposit.amount)}</span></div>}
              {costs && (
                <div className="border-t pt-1 text-muted-foreground space-y-0.5">
                  <div className="flex justify-between"><span>Cost at last save</span><span>{dollars(costs.cost ?? 0)}</span></div>
                  <div className="flex justify-between"><span>Margin</span><span>{Math.round((costs.margin ?? 0) * 100)}%</span></div>
                  <div className="flex justify-between"><span>Commission basis</span><span>{dollars(costs.commissionBasis ?? 0)}</span></div>
                </div>
              )}
            </div>
          )}
          {priced && priced.problems.length > 0 && <ul className="text-xs text-muted-foreground list-disc pl-5">{priced.problems.slice(0, 5).map((p) => <li key={p}>{p}</li>)}</ul>}
        </Section>
      </fieldset>

      <div className="fixed bottom-0 left-0 right-0 lg:left-64 border-t bg-background/95 backdrop-blur p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex flex-wrap justify-center gap-2 z-20">
        <Button variant="outline" onClick={() => setPreview(true)} disabled={!items.length}><FileText className="w-4 h-4 mr-1" />Proposal</Button>
        {!readOnly && (
          <Button onClick={save} disabled={busy || !items.length}>{busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}Save</Button>
        )}
        {row && row.status === 'draft' && !row.jobber_quote_id && row.quote_state !== 'uncertain' && jobber.data === true && (
          <Button variant="secondary" onClick={() => toJobber('send')} disabled={busy || !items.length}><Send className="w-4 h-4 mr-1" />Send to Jobber</Button>
        )}
        {row && OPEN.includes(row.status) && (
          <>
            <Button variant="secondary" disabled={busy} onClick={() => { setChosen(optionals.filter((i) => i.kind === 'recommended' && i.selected !== false).map((i) => i.id)); setApproving(true); }}>
              <CheckCircle2 className="w-4 h-4 mr-1" />Mark approved
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setLosing(true)}><XCircle className="w-4 h-4 mr-1" />Mark lost</Button>
          </>
        )}
      </div>

      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="max-h-[85vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>{proposal.title}</DialogTitle></DialogHeader>
          {proposal.consultationText && <p className="text-sm">{proposal.consultationText}</p>}
          <div className="divide-y text-sm">
            {proposal.lines.map((l) => (
              <div key={l.workItemId} className="py-2">
                <div className="flex justify-between gap-2 font-medium">
                  <span>{l.name}{l.optional ? (l.recommended ? ' (recommended)' : ' (optional)') : ''}</span><span>{dollars(l.total)}</span>
                </div>
                <div className="text-muted-foreground text-xs">{l.description}</div>
              </div>
            ))}
          </div>
          {proposal.termsLines.map((x) => <p key={x} className="text-xs text-muted-foreground">{x}</p>)}
          <div className="flex justify-between font-semibold"><span>Total</span><span>{dollars(proposal.totals.total)}</span></div>
        </DialogContent>
      </Dialog>

      <Dialog open={approving} onOpenChange={setApproving}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader><DialogTitle>The customer approved</DialogTitle></DialogHeader>
          {optionals.length > 0 ? (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">Tick the options the customer chose.</p>
              {optionals.map((i) => {
                const p = byId.get(i.id);
                return (
                  <label key={i.id} className="flex items-center gap-2">
                    <Checkbox checked={chosen.includes(i.id)} onCheckedChange={(c) => setChosen((cur) => (c ? [...cur, i.id] : cur.filter((x) => x !== i.id)))} />
                    {p?.serviceName ?? i.serviceKey}{p?.price !== null && p?.price !== undefined ? `, ${dollars(p.price)}` : ''}
                  </label>
                );
              })}
            </div>
          ) : <p className="text-sm text-muted-foreground">TreeCheck makes the job packets and tasks for the crews.</p>}
          {unfinished.length > 0 && <p className="text-sm text-destructive">Finish this first: {unfinished[0].serviceName}, {unfinished[0].message ?? 'no price yet'}.</p>}
          <DialogFooter>
            <Button onClick={approve} disabled={busy || unfinished.length > 0}>{busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Approve</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={losing} onOpenChange={setLosing}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Why was it lost?</DialogTitle></DialogHeader>
          <div className="flex flex-wrap gap-2">
            {LOST_REASONS.map((r) => <Button key={r} size="sm" variant={lostReason === r ? 'default' : 'outline'} onClick={() => setLostReason(r)}>{r}</Button>)}
          </div>
          <DialogFooter><Button onClick={markLost} disabled={busy}>Mark lost</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
