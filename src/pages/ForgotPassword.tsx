import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Loader2, MailCheck } from 'lucide-react';
import { toast } from 'sonner';
import treecheckLogo from '@/assets/treecheck-white-login.png';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // TreeCheck sends the reset email itself; the built-in sender is only a fallback if that fails.
    const { data, error: fnError } = await supabase.functions.invoke('send-password-reset', { body: { email: email.trim() } });
    if (fnError || !data?.ok) {
      if (data?.error) { setLoading(false); toast.error(data.error); return; }
      // Always the real app address: the phone app and preview addresses can't be opened from an email.
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: 'https://app.treecheck.ai/reset-password',
      });
      if (error) {
        setLoading(false);
        toast.error(error.message || 'Could not send the reset email');
        return;
      }
    }
    setLoading(false);
    setSent(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <div className="absolute inset-0 gradient-primary opacity-5" />
      <Card className="w-full max-w-md relative mx-2">
        <CardHeader className="space-y-3 text-center px-4 sm:px-6">
          <div className="mx-auto">
            <img src={treecheckLogo} alt="TreeCheck" className="h-14 sm:h-16 w-auto object-contain" />
          </div>
          <CardDescription className="text-sm">
            {sent ? 'Check your email' : 'Reset your password'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-4 text-center">
              <MailCheck className="mx-auto h-10 w-10 text-primary" />
              <p className="text-sm text-muted-foreground">
                We sent a reset link to <span className="font-medium text-foreground">{email}</span>. It opens in
                your web browser. Choose a new password there, then come back to the TreeCheck app and sign in with it.
              </p>
              <p className="text-xs text-muted-foreground">
                No email after a few minutes? Check your spam folder or try again.
              </p>
              <Button variant="outline" className="w-full" onClick={() => setSent(false)}>
                Use a different email
              </Button>
              <Link to="/login" className="block text-sm text-primary underline">
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full gradient-primary" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    'Send reset link'
                  )}
                </Button>
              </form>
              <div className="mt-6 text-center text-sm">
                <Link to="/login" className="text-primary underline">
                  Back to sign in
                </Link>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
