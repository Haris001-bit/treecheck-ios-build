import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import treecheckLogo from '@/assets/treecheck-logo-dark.png';
import { canUseAppleIAP, isAppStoreSafeMode, isStrictSafeMode } from '@/lib/platform';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as { from?: string })?.from || '/dashboard';
  const trialStarted = new URLSearchParams(location.search).get('trial') === 'started';
  const iap = canUseAppleIAP();
  const strict = isStrictSafeMode();

  useEffect(() => {
    if (!authLoading && user) {
      navigate(from, { replace: true });
    }
  }, [authLoading, user, navigate, from]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await signIn(email, password);

    if (error) {
      toast.error(error.message || 'Failed to sign in');
      setLoading(false);
    } else {
      navigate(from, { replace: true });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <div className="absolute inset-0 gradient-primary opacity-5" />

      <Card className="w-full max-w-md relative mx-2">
        <CardHeader className="space-y-3 text-center px-4 sm:px-6">
          <div className="mx-auto">
            <img
              src={treecheckLogo}
              alt="TreeCheck Logo"
              className="h-14 sm:h-16 w-auto object-contain"
            />
          </div>
          <div>
            <CardDescription className="text-sm">
              {trialStarted
                ? 'Your 14-day free trial has started. Sign in with the email and password you just chose.'
                : 'Sign in to access your contractor dashboard'}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
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
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full gradient-primary" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>
          <div className="mt-4 text-center">
            <Link to="/forgot-password" className="text-sm text-primary underline">
              Forgot your password?
            </Link>
          </div>
          <div className="mt-6 text-center text-sm text-muted-foreground space-y-2">
            {strict ? (
              <p className="text-xs">
                TreeCheck is a companion app for approved contractor accounts. Please contact your administrator for access.
              </p>
            ) : iap || isAppStoreSafeMode() ? (
              <>
                <p>
                  New here?{' '}
                  <Link to="/register" className="text-primary font-medium underline">
                    Create an account
                  </Link>
                </p>
                <p>
                  Or{' '}
                  <Link to="/start-trial" className="text-primary font-medium underline">
                    start a 14-day free trial
                  </Link>{' '}
                  via the App Store
                </p>
                <p className="text-xs">
                  Subcontractor? Ask the company you work with to send you an invite.
                </p>
              </>
            ) : (
              <>
                <p>
                  New tree company?{' '}
                  <a href="/start-trial" className="text-primary font-medium underline">
                    Start a 14-day free trial
                  </a>
                </p>
                <p>
                  Climber or ground worker?{' '}
                  <Link to="/crew-join" className="text-primary font-medium underline">
                    Join the crew network
                  </Link>
                </p>
                <p className="text-xs">Office teammate? Ask your company owner to send you an invite.</p>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
