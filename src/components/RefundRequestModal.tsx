import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, AlertTriangle, Phone } from 'lucide-react';
import { REFUND_REASONS, RefundReasonCode, useRequestRefund } from '@/hooks/useRefundRequest';

interface RefundRequestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchaseId: string;
  customerName: string;
  purchaseAmount: number;
}

export function RefundRequestModal({ open, onOpenChange, purchaseId, customerName, purchaseAmount }: RefundRequestModalProps) {
  const [reasonCode, setReasonCode] = useState<RefundReasonCode | null>(null);
  const [notes, setNotes] = useState('');
  const requestRefund = useRequestRefund();

  const handleSubmit = () => {
    if (!reasonCode) return;
    requestRefund.mutate(
      { purchase_id: purchaseId, reason_code: reasonCode, reason_notes: notes.trim() || undefined },
      {
        onSuccess: () => {
          onOpenChange(false);
          setReasonCode(null);
          setNotes('');
        },
      }
    );
  };

  const requiresNotes = reasonCode === 'other';
  const canSubmit = !!reasonCode && (!requiresNotes || notes.trim().length >= 10);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Request a Refund</DialogTitle>
          <DialogDescription>
            For lead: <span className="font-medium text-foreground">{customerName}</span> (${purchaseAmount.toFixed(2)})
          </DialogDescription>
        </DialogHeader>

        {/* Policy disclosure */}
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-2 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="text-amber-900">
              <p className="font-semibold mb-1">Refund Policy</p>
              <ul className="list-disc list-inside space-y-1 text-amber-800">
                <li>Refund requests must be submitted within <strong>7 days</strong> of purchase.</li>
                <li>Approved refunds are credited back to your TreeCheck wallet (not your card).</li>
                <li>One refund request per lead.</li>
                <li>Reviews typically complete within 1–2 business days.</li>
              </ul>
            </div>
          </div>
          <div className="flex items-start gap-2 pt-2 border-t border-amber-300">
            <Phone className="h-4 w-4 text-amber-700 mt-0.5 flex-shrink-0" />
            <p className="text-amber-900">
              <strong>We verify every refund request</strong> by calling the customer to confirm your experience matches what was reported. False or misleading claims may result in account suspension.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <Label>Reason for refund</Label>
          <RadioGroup value={reasonCode || ''} onValueChange={(v) => setReasonCode(v as RefundReasonCode)}>
            {REFUND_REASONS.map((r) => (
              <div key={r.value} className="flex items-start space-x-2 rounded-md border border-border p-3 hover:bg-muted/50 cursor-pointer" onClick={() => setReasonCode(r.value)}>
                <RadioGroupItem value={r.value} id={r.value} className="mt-0.5" />
                <div className="flex-1">
                  <Label htmlFor={r.value} className="cursor-pointer font-normal leading-snug">{r.label}</Label>
                  {r.hint && <p className="text-xs text-muted-foreground mt-1 leading-snug">{r.hint}</p>}
                </div>
              </div>
            ))}
          </RadioGroup>
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">
            Additional details {requiresNotes && <span className="text-destructive">*</span>}
          </Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 1000))}
            placeholder={requiresNotes ? 'Please describe what happened (required, min 10 chars)...' : 'Optional — any context that helps us verify (when you called, what they said, etc.)'}
            rows={4}
            maxLength={1000}
          />
          <p className="text-xs text-muted-foreground">{notes.length}/1000</p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={requestRefund.isPending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || requestRefund.isPending} className="gradient-primary">
            {requestRefund.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting</> : 'Submit Refund Request'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
