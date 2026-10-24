import { useState, useEffect } from 'react';
import { useProfile, useUpdateProfile } from '@/hooks/useProfile';
import { useDMAIntegration, useUpsertDMAIntegration } from '@/hooks/useDMA';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Loader2, User, Building, Phone, Mail, Star, Trash2, CreditCard } from 'lucide-react';
import { canUseStorePlans, isAppStoreSafeMode, isNativeStoreBilling, storeName } from '@/lib/platform';
import { useCompanyBilling } from '@/hooks/useCompanyBilling';
import { openCompanyPortal } from '@/lib/billing/companyCheckout';

export default function Profile() {
  const { user, isTeamMember } = useAuth();
  const { data: profile, isLoading } = useProfile();
  const companyBilling = useCompanyBilling();
  const updateMutation = useUpdateProfile();
  const { data: dmaIntegration } = useDMAIntegration();
  const upsertIntegration = useUpsertDMAIntegration();

  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  const [reviewLink, setReviewLink] = useState('');
  const [savingReviewLink, setSavingReviewLink] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteDetails, setDeleteDetails] = useState('');
  const [openingBilling, setOpeningBilling] = useState(false);

  const openBilling = async () => {
    setOpeningBilling(true);
    try {
      // Company plans (payments milestone) keep their card in company billing; older accounts use the original portal.
      const companyRow = companyBilling.data?.billing as { pricing_version?: string; stripe_customer_id?: string | null } | undefined;
      if (companyRow?.pricing_version === '2026-10' && companyRow.stripe_customer_id) {
        await openCompanyPortal('profile');
        return;
      }
      const { data, error } = await supabase.functions.invoke('create-billing-portal');
      if (error || data?.error || !data?.url) throw new Error(error?.message || data?.error || 'Billing is unavailable');
      window.location.href = data.url;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Billing is unavailable');
      setOpeningBilling(false);
    }
  };

  useEffect(() => {
    setReviewLink(dmaIntegration?.google_review_link || '');
  }, [dmaIntegration?.google_review_link]);

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke('delete-account', {
        body: { reason: deleteReason, details: deleteDetails },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success('Account deleted');
      await signOut().catch(() => {});
      navigate('/login', { replace: true });
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete account');
    } finally {
      setDeleting(false);
    }
  };

  const saveReviewLink = async () => {
    setSavingReviewLink(true);
    try {
      await upsertIntegration.mutateAsync({ google_review_link: reviewLink.trim() || null });
      toast.success(isAppStoreSafeMode() ? 'Review link saved' : 'Google review link saved');
    } catch (e: any) {
      toast.error(e.message || 'Failed to save');
    } finally {
      setSavingReviewLink(false);
    }
  };

  const startEditing = () => {
    setFullName(profile?.full_name || '');
    setCompanyName(profile?.company_name || '');
    setPhone(profile?.phone || '');
    setIsEditing(true);
  };

  const handleSave = () => {
    updateMutation.mutate(
      {
        full_name: fullName || null,
        company_name: companyName || null,
        phone: phone || null,
      },
      {
        onSuccess: () => setIsEditing(false),
      }
    );
  };

  if (isLoading) {
    return (
      <div className="p-8 max-w-2xl">
        <Skeleton className="h-10 w-48 mb-8" />
        <Card>
          <CardContent className="p-6 space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold text-foreground">Profile</h1>
        <p className="text-muted-foreground mt-1">
          Manage your account information
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Account Details</CardTitle>
            <CardDescription>Your personal and business information</CardDescription>
          </div>
          {!isEditing && (
            <Button variant="outline" onClick={startEditing}>
              Edit Profile
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          {isEditing ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your full name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="companyName">Company Name</Label>
                <Input
                  id="companyName"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Your company name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Your phone number"
                />
              </div>
              <div className="flex gap-3">
                <Button
                  onClick={handleSave}
                  disabled={updateMutation.isPending}
                  className="gradient-primary"
                >
                  {updateMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Changes'
                  )}
                </Button>
                <Button variant="outline" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <Mail className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Email</p>
                  <p className="font-medium">{user?.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <User className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Full Name</p>
                  <p className="font-medium">{profile?.full_name || 'Not set'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <Building className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Company Name</p>
                  <p className="font-medium">{profile?.company_name || 'Not set'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <Phone className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Phone Number</p>
                  <p className="font-medium">{profile?.phone || 'Not set'}</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stripe's billing portal: never in the phone apps, where purchases go through Apple or Google (3.1.1). */}
      {!isNativeStoreBilling() && (
        <Card className="mt-6">
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><CreditCard className="h-5 w-5 text-primary" />Billing</CardTitle><CardDescription>View invoices, update your card, or cancel your subscription.</CardDescription></CardHeader>
          <CardContent><Button variant="outline" onClick={openBilling} disabled={openingBilling}>{openingBilling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Manage billing</Button></CardContent>
        </Card>
      )}
      {/* The phone plan screen (payments milestone): the owner's plan, bought in the App Store or Google Play. */}
      {canUseStorePlans() && !isTeamMember && (
        <Card className="mt-6">
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><CreditCard className="h-5 w-5 text-primary" />Plan</CardTitle><CardDescription>Choose or manage your TreeCheck plan, through {storeName()}.</CardDescription></CardHeader>
          <CardContent><Button variant="outline" onClick={() => navigate('/plan')}>Your plan</Button></CardContent>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Star className="h-5 w-5 text-primary" />
            {isAppStoreSafeMode() ? 'Customer Review Link' : 'Google Review Link'}
          </CardTitle>
          <CardDescription>
            Used by Closeout and the Digital Marketing Agent to request reviews from your customers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="google-review-link">Review URL</Label>
          <Input
            id="google-review-link"
            type="url"
            value={reviewLink}
            onChange={(e) => setReviewLink(e.target.value)}
            placeholder={isAppStoreSafeMode() ? 'https://your-review-link.com' : 'https://g.page/r/...'}
          />
          <p className="text-xs text-muted-foreground">
            {isAppStoreSafeMode()
              ? 'Paste your public review page link here.'
              : 'Find it in your Google Business Profile → "Ask for reviews" → Share.'}
          </p>
          <Button
            onClick={saveReviewLink}
            disabled={
              savingReviewLink ||
              reviewLink === (dmaIntegration?.google_review_link || '')
            }
            className="gradient-primary"
          >
            {savingReviewLink && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save review link
          </Button>
        </CardContent>
      </Card>

      <Card className="mt-6 border-destructive/40">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Delete Account
          </CardTitle>
          <CardDescription>
            Permanently delete your TreeCheck account and all associated data.
            This action cannot be undone. Any remaining credits will be forfeited.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog onOpenChange={(o) => !o && setConfirmText('')}>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                Delete My Account
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes your profile, service areas, and
                  account access. Purchased lead history is retained for
                  compliance but anonymized. Type <strong>DELETE</strong> to
                  confirm.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="delete-reason">Why are you leaving?</Label>
                  <select
                    id="delete-reason"
                    value={deleteReason}
                    onChange={(e) => setDeleteReason(e.target.value)}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Select a reason…</option>
                    <option value="too_expensive">Too expensive</option>
                    <option value="not_enough_leads">Not enough leads in my area</option>
                    <option value="lead_quality">Lead quality issues</option>
                    <option value="switching_service">Switching to another service</option>
                    <option value="no_longer_in_business">No longer in business</option>
                    <option value="temporary_break">Just taking a break</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="delete-details">Tell us more (optional)</Label>
                  <textarea
                    id="delete-details"
                    value={deleteDetails}
                    onChange={(e) => setDeleteDetails(e.target.value)}
                    placeholder="Anything we could've done better?"
                    rows={3}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="delete-confirm">Type DELETE to confirm</Label>
                  <Input
                    id="delete-confirm"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="DELETE"
                  />
                </div>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={confirmText !== 'DELETE' || !deleteReason || deleting}
                  onClick={(e) => {
                    e.preventDefault();
                    handleDeleteAccount();
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deleting ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Deleting…</>
                  ) : (
                    'Permanently Delete'
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
