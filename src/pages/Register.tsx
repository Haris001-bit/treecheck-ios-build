import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import treecheckLogo from '@/assets/treecheck-logo-dark.png';
import { canUseStorePlans, isStrictSafeMode, storeName } from '@/lib/platform';
import { AppStoreSafeWall } from '@/components/AppStoreSafeWall';
import { Navigate } from 'react-router-dom';

/**
 * Free registration in the phone apps (no Stripe). Web users should use /start-trial.
 */
export default function Register() {
  if (isStrictSafeMode()) {
    return (
      <AppStoreSafeWall
        title="Sign-up unavailable"
        body="Existing accounts can sign in from the login screen."
      />
    );
  }
  if (!canUseStorePlans()) {
    return <Navigate to="/start-trial" replace />;
  }

  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    company_name: '',
    full_name: '',
    email: '',
    phone: '',
    city: '',
    password: '',
  });

  const onChange = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-ios-register', {
        body: { ...form, start_demo_iap: false },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      const { error: signInError } = await signIn(form.email, form.password);
      if (signInError) {
        toast.success('Account created. Please sign in.');
        navigate('/login');
        return;
      }
      toast.success('Welcome to TreeCheck');
      navigate('/dashboard');
    } catch (err: any) {
      toast.error(err.message || 'Registration failed');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-6">
          <img src={treecheckLogo} alt="TreeCheck" className="h-14 w-auto mx-auto mb-3" />
          <h1 className="text-2xl font-bold">Create your account</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Free to register. Purchases go through {storeName()}.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Register</CardTitle>
            <CardDescription>No payment required to create an account</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <Label>Company name</Label>
                <Input required value={form.company_name} onChange={onChange('company_name')} />
              </div>
              <div>
                <Label>Your name</Label>
                <Input required value={form.full_name} onChange={onChange('full_name')} />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" required value={form.email} onChange={onChange('email')} />
              </div>
              <div>
                <Label>Phone (optional)</Label>
                <Input value={form.phone} onChange={onChange('phone')} />
              </div>
              <div>
                <Label>City (optional)</Label>
                <Input value={form.city} onChange={onChange('city')} />
              </div>
              <div>
                <Label>Password</Label>
                <Input type="password" required minLength={8} value={form.password} onChange={onChange('password')} />
              </div>
              <Button type="submit" className="w-full gradient-primary" disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create account
              </Button>
            </form>
            <p className="text-center text-sm text-muted-foreground mt-4">
              Want the trial?{' '}
              <Link to="/start-trial" className="text-primary underline">
                Start 14-day trial
              </Link>
            </p>
            <p className="text-center text-sm text-muted-foreground mt-2">
              Already have an account?{' '}
              <Link to="/login" className="text-primary underline">
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
