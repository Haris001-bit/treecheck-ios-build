import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Check, Crown, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import treecheckLogo from '@/assets/treecheck-white-login.png';
import { SubscriptionTier } from '@/lib/subscriptions';
import { cn } from '@/lib/utils';
import { GetTheApp } from '@/components/GetTheApp';


export default function AcceptInvite() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const teamToken = searchParams.get('team_token');

  const [fullName, setFullName] = useState(searchParams.get('name') || '');
  const [companyName, setCompanyName] = useState(searchParams.get('company') || '');
  const [phone, setPhone] = useState(searchParams.get('phone') || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedTier, setSelectedTier] = useState<SubscriptionTier>('free');
  const [registrationComplete, setRegistrationComplete] = useState(false);
  const navigate = useNavigate();
  // Team invites for an email that already has a TreeCheck login are accepted while signed in
  // as that login; the invite link alone can never change an existing account.
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [teamNotice, setTeamNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!teamToken) return;
    supabase.auth.getSession().then(({ data }) => {
      setSignedInEmail(data.session?.user?.email ?? null);
    });
  }, [teamToken]);

  const goToSignIn = () => {
    navigate('/login', { state: { from: `/accept-invite?team_token=${encodeURIComponent(teamToken ?? '')}` } });
  };

  const signOutForInvite = async () => {
    await supabase.auth.signOut();
    setSignedInEmail(null);
    setTeamNotice(null);
  };

  const handleJoinSignedIn = async () => {
    if (!teamToken) { toast.error('Invalid invitation link'); return; }
    setLoading(true);
    try {
      const response = await supabase.functions.invoke('accept-team-invite', {
        body: { team_token: teamToken },
      });
      if (response.error) throw new Error(response.error.message || 'Failed to accept invitation');
      if (response.data?.code === 'existing_account_sign_in') {
        setTeamNotice(`This invitation is for a different email than ${signedInEmail}. Sign out, then sign in with the invited email.`);
        return;
      }
      if (response.data?.code === 'password_required') {
        setTeamNotice('This invitation is for a new account. Sign out, then open the link again to set up the new account.');
        return;
      }
      if (response.data?.error) throw new Error(response.data.error);
      toast.success("You're on the team!");
      setRegistrationComplete(true);
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'Failed to accept invitation');
    } finally {
      setLoading(false);
    }
  };

  const handleTeamSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) { toast.error('Passwords do not match'); return; }
    if (password.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    if (!teamToken) { toast.error('Invalid invitation link'); return; }
    setLoading(true);
    try {
      const response = await supabase.functions.invoke('accept-team-invite', {
        body: { team_token: teamToken, password, fullName, phone },
      });
      if (response.error) throw new Error(response.error.message || 'Failed to accept invitation');
      if (response.data?.code === 'existing_account_sign_in') {
        setNeedsSignIn(true);
        return;
      }
      if (response.data?.error) throw new Error(response.data.error);
      if (response.data?.session) {
        await supabase.auth.setSession({
          access_token: response.data.session.access_token,
          refresh_token: response.data.session.refresh_token,
        });
      }
      toast.success("You're on the team!");
      setRegistrationComplete(true);
    } catch (error: any) {
      toast.error(error.message || 'Failed to accept invitation');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    if (!token) {
      toast.error('Invalid invitation link');
      return;
    }

    setLoading(true);
    try {
      const response = await supabase.functions.invoke('accept-invite', {
        body: { token, password, fullName, companyName, phone, tier: selectedTier },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to accept invitation');
      }

      if (response.data?.error) {
        throw new Error(response.data.error);
      }

      if (response.data?.checkout_url) {
        toast.success('Account created! Redirecting to payment...');
        window.location.href = response.data.checkout_url;
      } else {
        setRegistrationComplete(true);
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  // Team invite for someone who already has a login: accept while signed in
  if (teamToken && !registrationComplete && (signedInEmail || needsSignIn)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
        <div className="absolute inset-0 gradient-primary opacity-5" />
        <Card className="w-full max-w-md relative mx-2">
          <CardHeader className="space-y-3 text-center px-4 sm:px-6">
            <div className="mx-auto">
              <img src={treecheckLogo} alt="TreeCheck Logo" className="h-14 sm:h-16 w-auto object-contain" />
            </div>
            <div>
              <CardTitle className="text-2xl font-display">Join Your Team</CardTitle>
              <CardDescription className="text-sm">
                {signedInEmail
                  ? `You're signed in as ${signedInEmail}. Accept the invitation to join your company on TREECHECK.`
                  : 'You already have a TREECHECK login with this email. Sign in with it, and you will come straight back here to accept.'}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {teamNotice && <p className="text-sm text-destructive text-center">{teamNotice}</p>}
            {signedInEmail ? (
              <>
                <Button className="w-full" variant="cta" disabled={loading} onClick={handleJoinSignedIn}>
                  {loading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Joining team...</>) : 'Join Team'}
                </Button>
                <Button className="w-full" variant="ghost" disabled={loading} onClick={signOutForInvite}>
                  Not you? Sign out
                </Button>
              </>
            ) : (
              <Button className="w-full" variant="cta" onClick={goToSignIn}>
                Sign in to accept
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Team invite flow (brand new email invite from a contractor owner)
  if (teamToken && !registrationComplete) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
        <div className="absolute inset-0 gradient-primary opacity-5" />
        <Card className="w-full max-w-md relative mx-2">
          <CardHeader className="space-y-3 text-center px-4 sm:px-6">
            <div className="mx-auto">
              <img src={treecheckLogo} alt="TreeCheck Logo" className="h-14 sm:h-16 w-auto object-contain" />
            </div>
            <div>
              <CardTitle className="text-2xl font-display">Join Your Team</CardTitle>
              <CardDescription className="text-sm">
                You've been invited to join your company on TREECHECK. Set up your account to get started.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleTeamSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name</Label>
                <Input id="fullName" placeholder="John Smith" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number (optional)</Label>
                <Input id="phone" type="tel" placeholder="(555) 123-4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input id="confirmPassword" type="password" placeholder="••••••••" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
              </div>
              <Button type="submit" className="w-full" variant="cta" disabled={loading}>
                {loading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Joining team...</>) : 'Join Team'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!token && !teamToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-destructive">Invalid Invitation</CardTitle>
            <CardDescription>
              This invitation link is invalid or has expired. Please contact your administrator for a new invitation.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Registration complete — show install instructions
  if (registrationComplete) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
        <div className="absolute inset-0 gradient-primary opacity-5" />
        <Card className="w-full max-w-md relative mx-2">
          <CardHeader className="space-y-3 text-center px-4 sm:px-6">
            <div className="mx-auto">
              <img src={treecheckLogo} alt="TreeCheck Logo" className="h-14 sm:h-16 w-auto object-contain" />
            </div>
            <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-primary" />
            </div>
            <div>
              <CardTitle className="text-2xl font-display">You're In! 🎉</CardTitle>
              <CardDescription className="text-sm mt-2">
                Your TREECHECK account is ready. Install the app on your phone to start receiving leads.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 px-4 sm:px-6">
            <GetTheApp />
            <div className="border-t pt-4 text-center">
              <p className="text-xs text-muted-foreground">
                You can also log in anytime at{' '}
                <a href="/login" className="text-primary font-medium hover:underline">
                  app.treecheck.ai/login
                </a>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <div className="absolute inset-0 gradient-primary opacity-5" />

      <Card className="w-full max-w-md relative mx-2">
        <CardHeader className="space-y-3 text-center px-4 sm:px-6">
          <div className="mx-auto">
            <img src={treecheckLogo} alt="TreeCheck Logo" className="h-14 sm:h-16 w-auto object-contain" />
          </div>
          <div>
            <CardTitle className="text-2xl font-display">Welcome to TREECHECK Pro</CardTitle>
            <CardDescription className="text-sm">Complete your contractor registration</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Plan Selection */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">Choose Your Plan</Label>
            <div className="grid gap-3">
              {/* Free Plan */}
              <button
                type="button"
                onClick={() => setSelectedTier('free')}
                className={cn(
                  "relative flex items-start gap-4 rounded-lg border-2 p-4 text-left transition-all",
                  selectedTier === 'free'
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:border-muted-foreground/30"
                )}
              >
                <div className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 mt-0.5",
                  selectedTier === 'free'
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/30"
                )}>
                  {selectedTier === 'free' && <Check className="h-3 w-3" />}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Free</span>
                    <span className="text-sm text-muted-foreground">$0/mo</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    <span className="font-medium text-foreground">5% fee</span> on lead unlocks
                  </p>
                </div>
              </button>

              {/* Premium Plan */}
              <button
                type="button"
                onClick={() => setSelectedTier('premium')}
                className={cn(
                  "relative flex items-start gap-4 rounded-lg border-2 p-4 text-left transition-all",
                  selectedTier === 'premium'
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:border-muted-foreground/30"
                )}
              >
                <div className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 mt-0.5",
                  selectedTier === 'premium'
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/30"
                )}>
                  {selectedTier === 'premium' && <Check className="h-3 w-3" />}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold flex items-center gap-1.5">
                      <Crown className="h-4 w-4 text-amber-500" />
                      Premium
                    </span>
                    <span className="text-sm font-semibold text-primary">$500/mo</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    <span className="font-medium text-foreground">60-min early access</span> rotation + $500 credits + 2.5% rate when out of rotation
                  </p>
                </div>
                <div className="absolute -top-2 right-3 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-medium text-white">
                  Best Value
                </div>
              </button>
            </div>
          </div>

          <div className="border-t pt-4" />

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input id="fullName" placeholder="John Smith" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="companyName">Company Name</Label>
              <Input id="companyName" placeholder="Smith Tree Services" value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number (optional)</Label>
              <Input id="phone" type="tel" placeholder="(555) 123-4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input id="confirmPassword" type="password" placeholder="••••••••" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" variant="cta" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating Account...
                </>
              ) : (
                selectedTier === 'premium' ? 'Continue to Payment' : 'Complete Registration'
              )}
            </Button>
            {selectedTier === 'premium' && (
              <p className="text-xs text-center text-muted-foreground">
                You'll be redirected to Stripe to set up your subscription
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
