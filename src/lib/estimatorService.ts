import { functionFailure } from '@/lib/functionFailure';
/**
 * Scout™ service layer.
 *
 * Submits a tree capture to the `scout-submit` edge function which:
 *   1) uploads photo + voice memo to private storage
 *   2) summarizes notes via Lovable AI
 *   3) inserts a `scout_captures` row
 *   4) fires the n8n webhook with signed URLs and a callback URL
 *
 * n8n later POSTs the AI estimate to `scout-estimate-callback`, which sets
 * status='awaiting_review' on the row. The frontend listens via realtime.
 */

import { supabase } from '@/integrations/supabase/client';

export interface EstimateAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface SubmitScoutRequest {
  /** Up to 3 photos of the SAME tree */
  photoDataUrls: string[];
  /** Pruning only: groups photos by tree. */
  trees?: { label: string; note: string | null; photo_indexes: number[] }[] | null;
  audioBlob?: Blob | null;
  notes: string;
  service?: string;
  circumferenceInches?: number;
  diameterInches?: number;
  address: EstimateAddress;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  /** Optional estimator worksheet (wk_* columns) — see src/lib/scoutWorksheet.ts */
  worksheet?: Record<string, unknown> | null;
}

export interface ScoutCapture {
  id: string;
  contractor_id: string;
  owner_id: string;
  status: 'pending' | 'awaiting_review' | 'approved' | 'edited';
  photo_path: string | null;
  photo_paths?: string[] | null;
  voice_memo_path: string | null;
  notes_raw: string | null;
  notes_summary: string | null;
  requested_service: string | null;
  circumference_inches: number | null;
  diameter_inches: number | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  ai_service: string | null;
  ai_price_min: number | null;
  ai_price_max: number | null;
  ai_difficulty: string | null;
  ai_risk: string | null;
  ai_notes: string | null;
  final_service: string | null;
  final_price_min: number | null;
  final_price_max: number | null;
  final_notes: string | null;
  approved_at: string | null;
  created_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  promoted_lead_id: string | null;
  /** Free plan preview: the estimate stays on the server until a trial or paid plan. */
  free_preview_locked?: boolean;
  // Estimator worksheet (optional)
  wk_climber_payout?: number | null;
  wk_climber_required?: boolean | null;
  wk_rigging_level?: string | null;
  wk_ground_crew?: number | null;
  wk_hours?: number | null;
  wk_loads?: number | null;
  wk_crane_required?: boolean | null;
  wk_crane_hours?: number | null;
  wk_chipper?: boolean | null;
  wk_mini_skid?: boolean | null;
  wk_stump?: boolean | null;
  wk_stump_diameter_inches?: number | null;
  wk_extras_amount?: number | null;
  wk_extras_note?: string | null;
  wk_total?: number | null;
  price_source?: string | null;
}


async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function submitScoutCapture(req: SubmitScoutRequest): Promise<{ captureId: string }> {
  const voiceMemoBase64 = req.audioBlob ? await blobToDataUrl(req.audioBlob) : null;

  const { data, error } = await supabase.functions.invoke('scout-submit', {
    body: {
      photoBase64: req.photoDataUrls[0],
      photosBase64: req.photoDataUrls.slice(0, req.trees && req.trees.length > 1 ? 24 : 3),
      trees: req.trees ?? null,
      voiceMemoBase64,
      notesRaw: req.notes,
      service: req.service ?? null,
      circumferenceInches: req.circumferenceInches ?? null,
      diameterInches: req.diameterInches ?? null,
      address: req.address,
      customerName: req.customerName ?? null,
      customerPhone: req.customerPhone ?? null,
      customerEmail: req.customerEmail ?? null,
      worksheet: req.worksheet ?? null,
    },
  });

  const failure = await functionFailure(error, data);
  if (failure) throw new Error(failure.message);
  if (!data?.capture_id) throw new Error('No capture_id returned');

  return { captureId: data.capture_id as string };
}

async function promoteToLead(captureId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('promote-scout-to-lead', {
    body: { capture_id: captureId },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
}

export async function approveCapture(
  capture: ScoutCapture,
  opts?: { priceSource?: 'ai' | 'worksheet'; worksheetTotal?: number | null },
): Promise<void> {
  const useWorksheet = opts?.priceSource === 'worksheet' && opts?.worksheetTotal != null;
  const { error } = await supabase
    .from('scout_captures')
    .update({
      status: 'approved',
      final_service: capture.ai_service,
      final_price_min: useWorksheet ? opts!.worksheetTotal! : capture.ai_price_min,
      final_price_max: useWorksheet ? opts!.worksheetTotal! : capture.ai_price_max,
      final_notes: capture.ai_notes,
      price_source: useWorksheet ? 'worksheet' : 'ai',
      approved_at: new Date().toISOString(),
    })
    .eq('id', capture.id);
  if (error) throw new Error(error.message);
  await promoteToLead(capture.id);
}

export async function saveEditedCapture(
  id: string,
  edits: {
    service: string;
    price_min: number;
    price_max: number;
    notes: string;
    customer_name?: string | null;
    customer_phone?: string | null;
    customer_email?: string | null;
    address_street?: string | null;
    address_city?: string | null;
    address_state?: string | null;
    address_zip?: string | null;
    price_source?: 'ai' | 'worksheet' | null;
    /** wk_* worksheet columns produced by worksheetToRow() */
    worksheet?: Record<string, unknown> | null;
  },
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: 'edited',
    final_service: edits.service,
    final_price_min: edits.price_min,
    final_price_max: edits.price_max,
    final_notes: edits.notes,
    approved_at: new Date().toISOString(),
    ...(edits.worksheet ?? {}),
  };
  if (edits.price_source) patch.price_source = edits.price_source;
  for (const k of [
    'customer_name', 'customer_phone', 'customer_email',
    'address_street', 'address_city', 'address_state', 'address_zip',
  ] as const) {
    if (edits[k] !== undefined) patch[k] = (edits[k] || null);
  }
  const { error } = await supabase
    .from('scout_captures')
    .update(patch)
    .eq('id', id);
  if (error) throw new Error(error.message);
  await promoteToLead(id);
}

