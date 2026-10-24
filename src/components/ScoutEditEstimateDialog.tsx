import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { saveEditedCapture, type ScoutCapture } from '@/lib/estimatorService';
import { ScoutWorksheetPanel } from '@/components/ScoutWorksheetPanel';
import { useScoutRates } from '@/hooks/useScoutRates';
import { calculateWorksheet, worksheetFromRow, worksheetToRow, EMPTY_WORKSHEET, type WorksheetInputs } from '@/lib/scoutWorksheet';

const SERVICES = ['Tree Removal', 'Stump Grinding', 'Pruning/Trimming'];

interface Props {
  capture: (ScoutCapture & { signed_photo?: string | null }) | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (id: string) => void;
}

export function ScoutEditEstimateDialog({ capture, open, onOpenChange, onSaved }: Props) {
  const { rates } = useScoutRates();
  const [service, setService] = useState('Tree Removal');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [notes, setNotes] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [worksheet, setWorksheet] = useState<WorksheetInputs>({ ...EMPTY_WORKSHEET });
  const [saving, setSaving] = useState(false);
  const wk = useMemo(() => calculateWorksheet(worksheet, rates), [worksheet, rates]);

  useEffect(() => {
    if (!capture) return;
    const svc = capture.final_service || capture.ai_service || capture.requested_service || 'Tree Removal';
    setService(SERVICES.includes(svc) ? svc : 'Tree Removal');
    setMin(String(capture.final_price_min ?? capture.ai_price_min ?? ''));
    setMax(String(capture.final_price_max ?? capture.ai_price_max ?? ''));
    setNotes(capture.final_notes ?? capture.ai_notes ?? '');
    setName(capture.customer_name ?? '');
    setPhone(capture.customer_phone ?? '');
    setEmail(capture.customer_email ?? '');
    setStreet(capture.address_street ?? '');
    setCity(capture.address_city ?? '');
    setState(capture.address_state ?? '');
    setZip(capture.address_zip ?? '');
    setWorksheet(worksheetFromRow(capture as any));
  }, [capture]);

  const save = async () => {
    if (!capture) return;
    const pMin = Number(min);
    const pMax = Number(max || min);
    if (!pMin || pMin <= 0) {
      toast.error('Enter a valid minimum price');
      return;
    }
    if (pMax < pMin) {
      toast.error('Max price must be at least the min price');
      return;
    }
    setSaving(true);
    try {
      await saveEditedCapture(capture.id, {
        service,
        price_min: pMin,
        price_max: pMax,
        notes: notes.trim(),
        customer_name: name.trim(),
        customer_phone: phone.trim(),
        customer_email: email.trim(),
        address_street: street.trim(),
        address_city: city.trim(),
        address_state: state.trim(),
        address_zip: zip.trim(),
        worksheet: worksheetToRow(worksheet, wk),
        price_source: wk.hasInput && Math.round(wk.total) === Math.round(pMin) && Math.round(pMax) === Math.round(pMin) ? 'worksheet' : 'ai',
      });
      toast.success('Estimate updated — added to Your Leads');
      onSaved?.(capture.id);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || 'Could not save estimate');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit estimate</DialogTitle>
          <DialogDescription>
            Adjust the price, service and client details. Saving approves the job and sends it to Your Leads.
          </DialogDescription>
        </DialogHeader>

        {capture?.signed_photo ? (
          <img
            src={capture.signed_photo}
            alt="Scout capture of the tree"
            className="w-full max-h-64 object-contain bg-muted rounded-md"
          />
        ) : (
          <div className="w-full h-32 bg-muted rounded-md flex items-center justify-center text-xs text-muted-foreground">
            No photo on this capture
          </div>
        )}

        {(capture?.notes_summary || capture?.notes_raw) && (
          <div className="text-sm text-muted-foreground rounded-md bg-muted/50 p-2">
            <span className="font-medium text-foreground">Rep notes: </span>
            {capture?.notes_summary || capture?.notes_raw}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <Label>Service</Label>
            <Select value={service} onValueChange={setService}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SERVICES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Price min ($)</Label>
              <Input className="mt-1" value={min} onChange={(e) => setMin(e.target.value)} inputMode="numeric" />
            </div>
            <div>
              <Label>Price max ($)</Label>
              <Input className="mt-1" value={max} onChange={(e) => setMax(e.target.value)} inputMode="numeric" />
            </div>
          </div>

          <ScoutWorksheetPanel value={worksheet} onChange={setWorksheet} rates={rates} defaultOpen={wk.hasInput} />

          {wk.hasInput && (
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => { setMin(String(Math.round(wk.total))); setMax(String(Math.round(wk.total))); }}
            >
              Use worksheet total (${Math.round(wk.total).toLocaleString()})
            </Button>
          )}

          <div>
            <Label>Estimate notes</Label>
            <Textarea className="mt-1" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          </div>



          <div className="space-y-2">
            <Label>Client details <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
            <Input placeholder="Client name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Client phone" value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" maxLength={40} />
              <Input placeholder="Client email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" maxLength={200} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Address</Label>
            <Input placeholder="Street" value={street} onChange={(e) => setStreet(e.target.value)} maxLength={200} />
            <div className="grid grid-cols-3 gap-2">
              <Input placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} maxLength={100} />
              <Input placeholder="State" value={state} onChange={(e) => setState(e.target.value)} maxLength={20} />
              <Input placeholder="ZIP" value={zip} onChange={(e) => setZip(e.target.value)} maxLength={10} inputMode="numeric" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Saving…</> : <><Save className="w-4 h-4 mr-1.5" />Save & approve</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
