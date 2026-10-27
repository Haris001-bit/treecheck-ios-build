import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import treecheckLogo from '@/assets/treecheck-white-login.png';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // The recovery link puts a session in place (hash or code exchange).
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      setReady(!!data.session);
    };
    check();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error('Use at least 8 characters');
      return;
    }
    if (password !== confirm) {
      toast.error('The passwords do not match');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(error.message || 'Could not update your password');
      return;
    }
    toast.success('Password updated');
    setDone(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <div className="absolute inset-0 gradient-primary opacity-5" />
      <Card className="w-full max-w-md relative mx-2">
        <CardHeader className="space-y-3 text-center px-4 sm:px-6">
          <div className="mx-auto">
            <img src={treecheckLogo} alt="TreeCheck" className="h-14 sm:h-16 w-auto object-contain" />
          </div>
          <CardDescription className="text-sm">Choose a new password</CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="space-y-4 text-center text-sm">
              <p className="font-medium text-foreground">Password saved.</p>
              <p className="text-muted-foreground">
                Open the TreeCheck app on your phone and sign in with your email and new password.
              </p>
              <Button variant="outline" className="w-full" onClick={() => navigate('/dashboard', { replace: true })}>
                Or continue in this browser
              </Button>
            </div>
          ) : !ready ? (
            <div className="space-y-4 text-center text-sm text-muted-foreground">
              <p>
                This page works only when opened from the reset link in your email. Open that link again on this
                device.
              </p>
              <Link to="/forgot-password" className="block text-primary underline">
                Send a new reset link
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input
                  id="confirm"
                  type="password"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full gradient-primary" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save new password'
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
