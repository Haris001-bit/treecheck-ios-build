import { useState } from 'react';
import { z } from 'zod';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  source?: string;
  title?: string;
  message?: string;
}

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: z.string().trim().email('Invalid email').max(255),
});

type Step = 'ask' | 'form';

export function WaitlistModal({
  open,
  onOpenChange,
  source = 'instant_tree_estimator',
  title = 'Coming Soon',
  message = 'Get on the waiting list?',
}: Props) {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>('ask');
  const [name, setName] = useState('');
  const [email, setEmail] = useState(user?.email ?? '');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setStep('ask');
    setName('');
    setEmail(user?.email ?? '');
    setSubmitting(false);
  };

  const close = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const submit = async () => {
    const parsed = schema.safeParse({ name, email });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from('estimator_waitlist' as any).insert({
      name: parsed.data.name,
      email: parsed.data.email,
      user_id: user?.id ?? null,
      source,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("You're on the list! We'll be in touch.");
    close(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {step === 'ask'
              ? message
              : 'Drop your name and email and we\'ll let you know the moment it goes live.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'form' && (
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="wl-name">Name</Label>
              <Input id="wl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" maxLength={100} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wl-email">Email</Label>
              <Input id="wl-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" maxLength={255} />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {step === 'ask' ? (
            <>
              <Button variant="outline" onClick={() => close(false)}>No</Button>
              <Button onClick={() => setStep('form')}>Yes</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => close(false)} disabled={submitting}>Cancel</Button>
              <Button onClick={submit} disabled={submitting}>
                {submitting ? 'Joining…' : 'Join waitlist'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
