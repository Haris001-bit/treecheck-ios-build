import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, Pencil, Inbox, Phone, Mail, MapPin, Send, Gavel } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { approveCapture, type ScoutCapture } from '@/lib/estimatorService';
import { SendPostcardDialog } from '@/components/SendPostcardDialog';
import { ScoutEditEstimateDialog } from '@/components/ScoutEditEstimateDialog';
import { useScoutRates } from '@/hooks/useScoutRates';
import { calculateWorksheet, worksheetFromRow, worksheetSummary } from '@/lib/scoutWorksheet';
import { RequestCrewBidsDialog, type RequestCrewBidsSeed } from '@/components/RequestCrewBidsDialog';
import { ProductionPlanCard } from '@/components/production/ProductionPlanCard';
import { useCompanySettings, usesProductionPlan } from '@/hooks/useCompanySettings';
import { useProductionStatus } from '@/hooks/useProductionStatus';
import { LockedScoutEstimate } from '@/components/free/LockedScoutEstimate';

interface InboxRow extends ScoutCapture {
  signed_photo?: string | null;
  rep_name?: string | null;
  bid_request_id?: string | null;
}

const money = (v: number | null | undefined) => v == null ? '—' : `$${Number(v).toLocaleString()}`;
const priceRange = (min?: number | null, max?: number | null) => {
  if (min == null && max == null) return '—';
  if (min != null && max != null && min !== max) return `${money(min)} – ${money(max)}`;
  return money(max ?? min);
};

export default function ScoutInbox({ embedded = false }: { embedded?: boolean } = {}) {
  const { data: companySettings } = useCompanySettings();
  // Once a company starts the large-company setup, its production costs are for the people it picked to see costs.
  const { status: production } = useProductionStatus();
  const showProduction = usesProductionPlan(companySettings) && (!production.started || production.can.costs);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { rates } = useScoutRates();
  const [rows, setRows] = useState<InboxRow[] | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [postcardCapture, setPostcardCapture] = useState<ScoutCapture | null>(null);
  const [editCapture, setEditCapture] = useState<InboxRow | null>(null);
  const [bidSeed, setBidSeed] = useState<RequestCrewBidsSeed | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('scout_captures')
      .select('*')
      .eq('owner_id', user.id)
      .eq('status', 'awaiting_review')
      .order('created_at', { ascending: false });
    if (error) {
      toast.error(error.message);
      setRows([]);
      return;
    }
    const list = (data ?? []) as InboxRow[];

    // Sign photos + fetch rep names in parallel
    const repIds = Array.from(new Set(list.map(r => r.contractor_id).filter(id => id && id !== user.id)));
    const [signed, repProfiles] = await Promise.all([
      Promise.all(list.map(async (r) => {
        if (!r.photo_path) return null;
        const { data: s } = await supabase.storage.from('scout-media').createSignedUrl(r.photo_path, 60 * 60);
        return s?.signedUrl ?? null;
      })),
      repIds.length
        ? supabase.from('profiles').select('id, full_name, email').in('id', repIds)
        : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null; email: string }> }),
    ]);
    const repMap: Record<string, string> = {};
    for (const p of (repProfiles.data ?? []) as Array<{ id: string; full_name: string | null; email: string }>) {
      repMap[p.id] = p.full_name || p.email || 'Team rep';
    }
    const bidMap: Record<string, string> = {};
    if (list.length) {
      const { data: brs } = await supabase
        .from('bid_requests')
        .select('id, capture_id')
        .in('capture_id', list.map(r => r.id));
      for (const b of (brs ?? []) as Array<{ id: string; capture_id: string | null }>) {
        if (b.capture_id) bidMap[b.capture_id] = b.id;
      }
    }
    list.forEach((r, i) => {
      r.signed_photo = signed[i];
      r.rep_name = r.contractor_id === user.id ? null : (repMap[r.contractor_id] ?? 'Team rep');
      r.bid_request_id = bidMap[r.id] ?? null;
    });
    setRows(list);
  }, [user]);

  useEffect(() => {
    load();
    if (!user) return;
    const channel = supabase
      .channel('scout-inbox')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'scout_captures', filter: `owner_id=eq.${user.id}` },
        () => load(),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, load]);

  const approve = async (r: InboxRow, priceSource: 'ai' | 'worksheet' = 'ai') => {
    setWorking(r.id);
    try {
      const wk = calculateWorksheet(worksheetFromRow(r), rates);
      await approveCapture(r, {
        priceSource,
        worksheetTotal: priceSource === 'worksheet' && wk.hasInput ? wk.total : null,
      });
      toast.success('Approved — added to Your Leads');
      setRows((curr) => curr?.filter((x) => x.id !== r.id) ?? null);
    } catch (e: any) {
      toast.error(e?.message || 'Could not approve');
    } finally {
      setWorking(null);
    }
  };

  if (rows === null) {
    return (
      <div className="p-6 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading inbox…
      </div>
    );
  }

  return (
    <div className={embedded ? '' : 'p-4 sm:p-6 max-w-3xl mx-auto'}>
      <div className={embedded ? 'mb-4' : 'mb-6'} hidden={embedded}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Inbox className="w-6 h-6 text-primary" />
          Scout Approval Inbox
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review AI estimates from your field reps. Approving sends the lead straight to <strong>Your Leads</strong>.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          <Inbox className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <div className="font-medium text-foreground">All caught up</div>
          <div className="text-sm mt-1">No captures are waiting for review.</div>
        </Card>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => {
            const addr = [r.address_street, r.address_city, r.address_state, r.address_zip].filter(Boolean).join(', ');
            // Free plan preview: no price or notes are in the app yet, so nothing to review or approve.
            if ((r as { free_preview_locked?: boolean }).free_preview_locked) {
              return (
                <Card key={r.id} className="overflow-hidden">
                  <div className="grid sm:grid-cols-[140px_1fr] gap-0">
                    {r.signed_photo ? (
                      <img src={r.signed_photo} alt="Capture" className="w-full h-40 sm:h-full object-contain bg-muted" />
                    ) : (
                      <div className="w-full h-40 sm:h-full bg-muted flex items-center justify-center text-xs text-muted-foreground">No photo</div>
                    )}
                    <div className="p-4 space-y-3">
                      {addr && <div className="text-sm flex items-start gap-1.5"><MapPin className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" /><span>{addr}</span></div>}
                      <LockedScoutEstimate service={r.ai_service ?? r.requested_service} />
                    </div>
                  </div>
                </Card>
              );
            }
            const wkInputs = worksheetFromRow(r);
            const wk = calculateWorksheet(wkInputs, rates);
            const aiMid = r.ai_price_min != null && r.ai_price_max != null
              ? (Number(r.ai_price_min) + Number(r.ai_price_max)) / 2
              : (r.ai_price_max ?? r.ai_price_min ?? null);
            const variance = wk.hasInput && aiMid ? ((wk.total - Number(aiMid)) / Number(aiMid)) * 100 : null;
            return (
              <Card key={r.id} className="overflow-hidden">
                <div className="grid sm:grid-cols-[140px_1fr] gap-0">
                  {r.signed_photo ? (
                    <img src={r.signed_photo} alt="Capture" className="w-full h-40 sm:h-full object-contain bg-muted" />
                  ) : (
                    <div className="w-full h-40 sm:h-full bg-muted flex items-center justify-center text-xs text-muted-foreground">No photo</div>
                  )}
                  <div className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{r.ai_service ?? r.requested_service ?? 'Tree job'}</span>
                          <Badge variant="default" className="text-[10px]">Ready to review</Badge>
                          {r.rep_name && <Badge variant="secondary" className="text-[10px]">From {r.rep_name}</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                        </div>
                      </div>
                      <div className="text-lg font-bold text-primary">
                        {priceRange(r.ai_price_min, r.ai_price_max)}
                      </div>
                    </div>

                    {showProduction && !/stump|prun|trim/i.test(r.final_service || r.ai_service || r.requested_service || '') && (
                      <ProductionPlanCard capture={r} />
                    )}

                    {addr && (
                      <div className="text-sm flex items-start gap-1.5">
                        <MapPin className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                        <span>{addr}</span>
                      </div>
                    )}

                    {(r.customer_name || r.customer_phone || r.customer_email) && (
                      <div className="text-sm rounded-md bg-muted/50 p-2 space-y-0.5">
                        {r.customer_name && <div className="font-medium">{r.customer_name}</div>}
                        {r.customer_phone && (
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Phone className="w-3.5 h-3.5" />
                            <a href={`tel:${r.customer_phone}`} className="hover:text-foreground">{r.customer_phone}</a>
                          </div>
                        )}
                        {r.customer_email && (
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Mail className="w-3.5 h-3.5" />
                            <a href={`mailto:${r.customer_email}`} className="hover:text-foreground">{r.customer_email}</a>
                          </div>
                        )}
                      </div>
                    )}

                    {r.ai_notes && (
                      <div className="text-sm text-muted-foreground whitespace-pre-wrap">{r.ai_notes}</div>
                    )}

                    {wk.hasInput && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-md border p-2">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">AI estimate</div>
                            <div className="font-bold">{priceRange(r.ai_price_min, r.ai_price_max)}</div>
                            {r.ai_difficulty && <div className="text-[11px] text-muted-foreground">difficulty: {r.ai_difficulty}</div>}
                          </div>
                          <div className="rounded-md border border-primary/30 bg-primary/5 p-2">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Your worksheet</div>
                            <div className="font-bold text-primary">{money(wk.total)}</div>
                            <div className="text-[11px] text-muted-foreground">{worksheetSummary(wkInputs)}</div>
                          </div>
                        </div>
                        {variance != null && (
                          <div className="text-xs text-muted-foreground text-center">
                            Worksheet is {Math.abs(variance).toFixed(0)}% {variance < 0 ? 'below' : 'above'} the AI midpoint
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex gap-2 pt-1 flex-wrap">
                      <Button
                        size="sm"
                        onClick={() => approve(r, 'ai')}
                        disabled={working === r.id}
                      >
                        {working === r.id ? (
                          <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Approving…</>
                        ) : (
                          <><CheckCircle2 className="w-4 h-4 mr-1.5" />{wk.hasInput ? 'Use AI price' : 'Approve'}</>
                        )}
                      </Button>
                      {wk.hasInput && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => approve(r, 'worksheet')}
                          disabled={working === r.id}
                        >
                          <CheckCircle2 className="w-4 h-4 mr-1.5" />Use worksheet ({money(wk.total)})
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditCapture(r)}
                      >
                        <Pencil className="w-4 h-4 mr-1.5" />Edit estimate
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPostcardCapture(r)}
                      >
                        <Send className="w-4 h-4 mr-1.5" />Send Postcard
                      </Button>
                      {r.bid_request_id ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate('/dashboard/bid-board?tab=active')}
                        >
                          <Gavel className="w-4 h-4 mr-1.5" />Sent to climbers — see offers
                        </Button>
                      ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setBidSeed({
                          captureId: r.id,
                          title: r.ai_service ?? r.requested_service ?? 'Tree job',
                          description: [r.ai_notes, r.ai_difficulty ? `Difficulty: ${r.ai_difficulty}` : null, r.ai_risk ? `Risk: ${r.ai_risk}` : null]
                            .filter(Boolean).join('\n\n'),
                          city: r.address_city ?? '',
                          photoPath: r.photo_path,
                        })}
                      >
                        <Gavel className="w-4 h-4 mr-1.5" />Request crew bids
                      </Button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <SendPostcardDialog
        capture={postcardCapture}
        open={!!postcardCapture}
        onOpenChange={(o) => { if (!o) setPostcardCapture(null); }}
      />
      <ScoutEditEstimateDialog
        capture={editCapture}
        open={!!editCapture}
        onOpenChange={(o) => { if (!o) setEditCapture(null); }}
        onSaved={(id) => setRows((curr) => curr?.filter((x) => x.id !== id) ?? null)}
      />
      <RequestCrewBidsDialog
        seed={bidSeed}
        open={!!bidSeed}
        onOpenChange={(o) => { if (!o) setBidSeed(null); }}
      />
    </div>
  );
}
