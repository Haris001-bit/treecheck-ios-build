import { useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Mic, MicOff, Upload, Loader2, Megaphone, Globe, Award, Sparkles, CheckCircle2, Send, Camera
} from 'lucide-react';
import {
  useMarketingSubscription,
  useMarketingProfile,
  useUpdateMarketingProfile,
  useCreateMarketingCheckout,
  useGenerateMarketingBio,
  useSendMarketingWebhook,
} from '@/hooks/useMarketing';
import { useSpeechRecognition } from '@/hooks/useAudioRecorder';
import { useProfile } from '@/hooks/useProfile';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';
import { AppStoreSafeWall } from '@/components/AppStoreSafeWall';
import { canUseAppleIAP, isStrictSafeMode } from '@/lib/platform';
import { useIapSubscribeMarketing, useIapRestore } from '@/hooks/useRevenueCat';

export default function Marketing() {
  if (isStrictSafeMode()) return <AppStoreSafeWall />;
  const iap = canUseAppleIAP();
  const { user } = useAuth();
  const { data: subscription, isLoading: subLoading, error: subscriptionError, refetch: refreshSubscription } = useMarketingSubscription();
  const { data: profile } = useProfile();
  const { data: marketingProfile, isLoading: mpLoading } = useMarketingProfile();
  const updateProfile = useUpdateMarketingProfile();
  const checkoutMutation = useCreateMarketingCheckout();
  const iapSubscribe = useIapSubscribeMarketing();
  const iapRestore = useIapRestore();
  const generateBio = useGenerateMarketingBio();
  const sendWebhook = useSendMarketingWebhook();

  const {
    transcript,
    setTranscript,
    isListening,
    startListening,
    stopListening,
    resetTranscript,
  } = useSpeechRecognition();

  const [bio, setBio] = useState(marketingProfile?.bio || '');
  const [websiteUrl, setWebsiteUrl] = useState(marketingProfile?.website_url || '');
  const [isaCertified, setIsaCertified] = useState(marketingProfile?.isa_certified || false);
  const [isaCredentials, setIsaCredentials] = useState(marketingProfile?.isa_credentials || '');
  const [uploading, setUploading] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync from loaded data
  const [initialized, setInitialized] = useState(false);
  if (marketingProfile && !initialized) {
    setBio(marketingProfile.bio || '');
    setWebsiteUrl(marketingProfile.website_url || '');
    setIsaCertified(marketingProfile.isa_certified || false);
    setIsaCredentials(marketingProfile.isa_credentials || '');
    setInitialized(true);
  }

  const isSubscribed = subscription?.subscribed === true;

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Photo must be under 5MB');
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${user.id}/profile.${ext}`;

      const { error } = await supabase.storage
        .from('marketing-photos')
        .upload(path, file, { upsert: true });

      if (error) throw error;

      await updateProfile.mutateAsync({ photo_url: path } as any);
      setPhotoPreview(URL.createObjectURL(file));
      toast.success('Photo uploaded!');
    } catch (err: any) {
      toast.error(err.message || 'Failed to upload photo');
    } finally {
      setUploading(false);
    }
  };

  const handleGenerateBio = async () => {
    if (!transcript.trim()) {
      toast.error('Please record yourself first');
      return;
    }
    const result = await generateBio.mutateAsync({
      transcript: transcript.trim(),
      company_name: profile?.company_name || '',
    });
    if (result.bio) {
      setBio(result.bio);
      toast.success('Bio generated! Review and edit if needed.');
    }
  };

  const handleSave = async () => {
    await updateProfile.mutateAsync({
      bio,
      website_url: websiteUrl || null,
      isa_certified: isaCertified,
      isa_credentials: isaCertified ? isaCredentials : null,
    } as any);
  };

  const handlePublish = async () => {
    await handleSave();
    await sendWebhook.mutateAsync();
  };

  if (subLoading || mpLoading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (subscriptionError || subscription?.billing_available === false) {
    return <div className="p-4 sm:p-8 max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-display font-bold">Marketing Package</h1>
      <p role="alert" className="text-muted-foreground">{subscriptionError?.message || subscription?.message}</p>
      <Button variant="outline" onClick={() => refreshSubscription()}>Check again</Button>
    </div>;
  }

  // Not subscribed — show purchase CTA
  if (!isSubscribed) {
    return (
      <div className="p-4 sm:p-8 max-w-2xl mx-auto">
        <Card className="border-primary ring-2 ring-primary">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-3">
              <div className="p-3 rounded-full bg-primary/10">
                <Megaphone className="h-8 w-8 text-primary" />
              </div>
            </div>
            <CardTitle className="text-2xl font-display">Marketing Package</CardTitle>
            <p className="text-muted-foreground mt-2">
              Get featured on our thank-you page as a preferred partner in your area
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-3">
              {[
                'Your photo & bio shown to homeowners after they submit a lead',
                'ISA credentials highlighted to build trust',
                'Direct link to your website for instant traffic',
                'Targeted by service area — only shown to relevant homeowners',
              ].map((f) => (
                <div key={f} className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                  <span className="text-sm">{f}</span>
                </div>
              ))}
            </div>

            <div className="text-center pt-2">
              <p className="text-3xl font-bold">$99<span className="text-lg font-normal text-muted-foreground">/mo</span></p>
            </div>

            <Button
              onClick={() => (iap ? iapSubscribe.mutate() : checkoutMutation.mutate())}
              disabled={iap ? iapSubscribe.isPending : checkoutMutation.isPending}
              className="w-full gradient-primary"
              size="lg"
            >
              {(iap ? iapSubscribe.isPending : checkoutMutation.isPending) ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Megaphone className="mr-2 h-4 w-4" />
              )}
              {iap ? 'Subscribe with Apple — $99/mo' : 'Subscribe — $99/mo'}
            </Button>
            {iap && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                disabled={iapRestore.isPending}
                onClick={() => iapRestore.mutate()}
              >
                Restore Purchases
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Subscribed — show profile editor
  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Marketing Profile</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Set up your featured listing on the thank-you page
          </p>
        </div>
        <Badge className="gradient-primary text-primary-foreground">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Active
        </Badge>
      </div>

      {/* Photo Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Your Photo
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="h-24 w-24 rounded-lg border-2 border-dashed border-border flex items-center justify-center overflow-hidden bg-muted">
              {photoPreview || marketingProfile?.photo_url ? (
                <img
                  src={photoPreview || ''}
                  alt="Marketing photo"
                  className="h-full w-full object-cover"
                />
              ) : (
                <Upload className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoUpload}
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Upload Photo
              </Button>
              <p className="text-xs text-muted-foreground">Max 5MB. This will appear on the thank-you page.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Voice Bio */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Your Bio
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Press the microphone and tell us about your company — we'll turn it into polished marketing copy.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Recording controls */}
          <div className="flex items-center gap-3">
            <Button
              variant={isListening ? 'destructive' : 'default'}
              size="lg"
              onClick={isListening ? stopListening : startListening}
              className={isListening ? 'animate-pulse' : ''}
            >
              {isListening ? (
                <>
                  <MicOff className="mr-2 h-5 w-5" />
                  Stop Recording
                </>
              ) : (
                <>
                  <Mic className="mr-2 h-5 w-5" />
                  Start Recording
                </>
              )}
            </Button>
            {transcript && (
              <Button variant="outline" size="sm" onClick={resetTranscript}>
                Clear
              </Button>
            )}
          </div>

          {/* Live transcript */}
          {transcript && (
            <div className="p-3 rounded-lg border border-border bg-muted/50">
              <Label className="text-xs text-muted-foreground mb-1 block">What you said:</Label>
              <p className="text-sm italic">"{transcript}"</p>
            </div>
          )}

          {/* Generate button */}
          {transcript && !isListening && (
            <Button
              onClick={handleGenerateBio}
              disabled={generateBio.isPending}
              className="gradient-primary"
            >
              {generateBio.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              Generate Bio from Recording
            </Button>
          )}

          {/* Editable bio */}
          <div>
            <Label htmlFor="bio">Marketing Bio</Label>
            <Textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Your AI-generated bio will appear here. You can also write or edit it manually."
              rows={4}
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              This is what homeowners see. Feel free to edit after generating.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Credentials & Website */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Award className="h-5 w-5" />
            Credentials & Website
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>ISA Certified Arborist</Label>
              <p className="text-xs text-muted-foreground">Show the ISA badge on your listing</p>
            </div>
            <Switch checked={isaCertified} onCheckedChange={setIsaCertified} />
          </div>

          {isaCertified && (
            <div>
              <Label htmlFor="isa-creds">ISA Certification Number</Label>
              <Input
                id="isa-creds"
                value={isaCredentials}
                onChange={(e) => setIsaCredentials(e.target.value)}
                placeholder="e.g. MA-1234A"
                className="mt-1"
              />
            </div>
          )}

          <div>
            <Label htmlFor="website">
              <Globe className="inline h-4 w-4 mr-1" />
              Website URL
            </Label>
            <Input
              id="website"
              type="url"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://yourcompany.com"
              className="mt-1"
            />
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Button
          onClick={handleSave}
          disabled={updateProfile.isPending}
          variant="outline"
          className="flex-1"
        >
          {updateProfile.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save Draft
        </Button>
        <Button
          onClick={handlePublish}
          disabled={updateProfile.isPending || sendWebhook.isPending || !bio}
          className="flex-1 gradient-primary"
        >
          {sendWebhook.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          Save & Publish to Website
        </Button>
      </div>
    </div>
  );
}
