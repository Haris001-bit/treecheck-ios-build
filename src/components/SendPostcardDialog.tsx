import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';
import type { ScoutCapture } from '@/lib/estimatorService';
import { canUsePaymentFunction, isAppStoreSafeMode } from '@/lib/platform';

interface Props {
  capture: ScoutCapture | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ReturnAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  company?: string;
}

export function SendPostcardDialog({ capture, open, onOpenChange }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [returnAddress, setReturnAddress] = useState<ReturnAddress>({
    street: '', city: '', state: '', zip: '', company: '',
  });
  const [hasSavedAddress, setHasSavedAddress] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('return_address, company_name')
        .eq('id', user.id)
        .maybeSingle();
      const ra = (data?.return_address as unknown) as ReturnAddress | null;
      if (ra) {
        setReturnAddress({ ...ra, company: ra.company || data?.company_name || '' });
        setHasSavedAddress(true);
      } else {
        setReturnAddress({
          street: '', city: '', state: '', zip: '',
          company: data?.company_name || '',
        });
        setHasSavedAddress(false);
      }
      setLoading(false);
    })();
  }, [open, user?.id]);

  const send = async () => {
    if (!capture) return;
    if (!canUsePaymentFunction('postgrid-send-postcard')) {
      toast.info('Postcards are not available in the mobile app.');
      return;
    }
    if (!returnAddress.street || !returnAddress.city || !returnAddress.state || !returnAddress.zip) {
      toast.error('Please complete the return address');
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('postgrid-send-postcard', {
        body: {
          scout_capture_id: capture.id,
          return_address: returnAddress,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Postcard queued! Status: ' + (data?.postcard?.status || 'queued'));
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message || 'Could not send postcard');
    } finally {
      setSending(false);
    }
  };

  if (!capture) return null;

  const recipient = [capture.address_street, capture.address_city, capture.address_state, capture.address_zip]
    .filter(Boolean).join(', ');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" /> Send postcard
          </DialogTitle>
          <DialogDescription>
            Mails a postcard to the property with the tree photo, notes, and a QR code for the homeowner.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Recipient</div>
            <div className="text-foreground">{recipient || 'No address on capture'}</div>
          </div>

          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">
              Return address {hasSavedAddress && <span className="text-[10px] normal-case font-normal">(saved)</span>}
            </div>
            {loading ? (
              <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin" /></div>
            ) : (
              <div className="space-y-2">
                <div>
                  <Label htmlFor="ra-company" className="text-xs">Company (optional)</Label>
                  <Input id="ra-company" value={returnAddress.company || ''}
                    onChange={(e) => setReturnAddress({ ...returnAddress, company: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="ra-street" className="text-xs">Street</Label>
                  <Input id="ra-street" value={returnAddress.street}
                    onChange={(e) => setReturnAddress({ ...returnAddress, street: e.target.value })} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <Label htmlFor="ra-city" className="text-xs">City</Label>
                    <Input id="ra-city" value={returnAddress.city}
                      onChange={(e) => setReturnAddress({ ...returnAddress, city: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="ra-state" className="text-xs">State</Label>
                    <Input id="ra-state" value={returnAddress.state} maxLength={2}
                      onChange={(e) => setReturnAddress({ ...returnAddress, state: e.target.value.toUpperCase() })} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="ra-zip" className="text-xs">ZIP</Label>
                  <Input id="ra-zip" value={returnAddress.zip}
                    onChange={(e) => setReturnAddress({ ...returnAddress, zip: e.target.value })} />
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
          <Button onClick={send} disabled={sending || loading}>
            {sending ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Sending…</> : 'Send postcard (test)'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
