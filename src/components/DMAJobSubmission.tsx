import { useState, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Camera, X, Loader2, Plus, CheckCircle2, Mic, MicOff, ExternalLink, Images, Star, ChevronLeft, ChevronRight, GripVertical, Send, Mail, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { useSpeechRecognition } from '@/hooks/useAudioRecorder';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { movePhotoInOrder, uploadPhotosInOrder } from '@/lib/dmaPhotoOrder';
import { useDMAIntegration } from '@/hooks/useDMA';
import { AddressAutocomplete } from '@/components/AddressAutocomplete';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Link } from 'react-router-dom';

export interface DMAResult {
  url: string;
  previewUrl: string;
  title: string;
  serviceCategory: string;
  shortDescription: string;
}

interface DMAJobSubmissionProps {
  onSubmit?: (data: JobSubmissionData) => void;
  /** Optional override for the post-submit screen. If provided, replaces the built-in success card. */
  renderSuccess?: (args: { result: DMAResult; previews: string[]; reset: () => void }) => React.ReactNode;
}

export interface JobSubmissionData {
  photos: File[];
  notes: string;
}

/**
 * Downscale to max 1600px on the long edge and re-encode as JPEG so uploads
 * (and the downstream publish payload) stay small. Falls back to the original
 * file if the browser can't decode it.
 */
async function compressImage(file: File, maxEdge = 1600, quality = 0.78): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality),
    );
    if (!blob) return file;
    if (blob.size >= file.size && scale === 1) return file;
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}


export default function DMAJobSubmission({ onSubmit, renderSuccess }: DMAJobSubmissionProps) {
  const { user } = useAuth();
  const [photos, setPhotos] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [photoLabels, setPhotoLabels] = useState<Array<'before' | 'after' | null>>([]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sendingPostcards, setSendingPostcards] = useState(false);
  const [postcardsOptIn, setPostcardsOptIn] = useState(false);
  const [postcardStep, setPostcardStep] = useState<'closed' | 'sample' | 'pick' | 'confirm' | 'done'>('closed');
  const [submitted, setSubmitted] = useState(false);
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [zip, setZip] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [result, setResult] = useState<DMAResult | null>(null);
  const [missingLinkAlert, setMissingLinkAlert] = useState(false);
  const { data: integration } = useDMAIntegration();
  const reviewLink = integration?.google_review_link;
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef<string[]>([]);
  useEffect(() => () => previewUrlsRef.current.forEach(url => URL.revokeObjectURL(url)), []);
  const { transcript, isListening, startListening, stopListening, resetTranscript, setTranscript } = useSpeechRecognition();
  const notesBaseRef = useRef('');

  useEffect(() => {
    if (isListening) {
      const combined = notesBaseRef.current
        ? `${notesBaseRef.current.replace(/\s+$/, '')} ${transcript}`.trim()
        : transcript;
      setNotes(combined);
    }
  }, [transcript, isListening]);

  const toggleMic = () => {
    if (isListening) {
      stopListening();
    } else {
      notesBaseRef.current = notes;
      resetTranscript();
      setTranscript('');
      startListening();
    }
  };

  const handlePhotos = (files: FileList | null) => {
    if (!files) return;
    const newFiles = Array.from(files).slice(0, 4 - photos.length);
    if (newFiles.length === 0) {
      toast.error('Maximum 4 photos per job.');
      return;
    }
    const updatedPhotos = [...photos, ...newFiles];
    setPhotos(updatedPhotos);
    setPhotoLabels((prev) => [...prev, ...newFiles.map(() => null as 'before' | 'after' | null)]);

    // Create previews synchronously: FileReader completion order can differ from file order.
    const urls = newFiles.map(file => URL.createObjectURL(file));
    previewUrlsRef.current.push(...urls);
    setPreviews(prev => [...prev, ...urls]);
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => prev.filter((_, i) => i !== index));
    setPhotoLabels((prev) => prev.filter((_, i) => i !== index));
  };

  const setLabel = (index: number, label: 'before' | 'after') => {
    setPhotoLabels((prev) => {
      const next = [...prev];
      // Toggle off if same label clicked again
      if (next[index] === label) {
        next[index] = null;
        return next;
      }
      // Ensure only one photo holds each label
      for (let i = 0; i < next.length; i++) {
        if (i !== index && next[i] === label) next[i] = null;
      }
      next[index] = label;
      return next;
    });
  };

  const movePhoto = (from: number, to: number) => {
    if (submitting) return;
    if (to < 0 || to >= photos.length || from === to) return;
    setPhotos((prev) => movePhotoInOrder(prev, from, to));
    setPreviews((prev) => movePhotoInOrder(prev, from, to));
    setPhotoLabels((prev) => movePhotoInOrder(prev, from, to));
  };

  const dragIndexRef = useRef<number | null>(null);
  const handleDragStart = (i: number) => (e: React.DragEvent) => {
    dragIndexRef.current = i;
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const handleDrop = (i: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    if (from === null) return;
    movePhoto(from, i);
  };

  const handleSubmit = async () => {
    if (photos.length === 0) {
      toast.error('Add at least one photo.');
      return;
    }
    if (!notes.trim()) {
      toast.error('Add a quick note about the job.');
      return;
    }
    if (!user) {
      toast.error('You need to be signed in.');
      return;
    }

    setSubmitting(true);
    try {
      // 1. Downscale + compress, then upload to lead-photos/dma/<userId>/<jobId>/<filename>
      const jobId = crypto.randomUUID();
      const photoPaths = await uploadPhotosInOrder(photos, async (photo, i) => {
        const file = await compressImage(photo);
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const safeExt = ['png', 'jpg', 'jpeg', 'webp'].includes(ext) ? ext : 'jpg';
        const path = `dma/${user.id}/${jobId}/photo-${i + 1}.${safeExt}`;
        const { error: upErr } = await supabase.storage
          .from('lead-photos')
          .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: true });
        if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
        return path;
      });


      // 2. Trigger publish — this calls AI + commits to GitHub
      toast.message('Writing your project page…', {
        description: 'This usually takes 20–40 seconds.',
      });
      const { data, error } = await supabase.functions.invoke('dma-publish-project', {
        body: { notes: notes.trim(), photo_paths: photoPaths },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      onSubmit?.({ photos, notes });
      setResult({
        url: data.url,
        previewUrl: data.previewUrl,
        title: data.title,
        serviceCategory: data.serviceCategory,
        shortDescription: data.shortDescription || '',
      });
      setSubmitted(true);
      toast.success('Published! Netlify is rebuilding your site (usually live in 1–2 min).');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong. Try again.';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setPhotos([]);
    setPreviews([]);
    setPhotoLabels([]);
    setNotes('');
    setStreet('');
    setCity('');
    setStateCode('');
    setZip('');
    setSubmitted(false);
    setResult(null);
  };

  const beforeIndex = photoLabels.findIndex((l) => l === 'before');
  const afterIndex = photoLabels.findIndex((l) => l === 'after');
  const hasBeforeAfter = beforeIndex !== -1 && afterIndex !== -1;
  const addressComplete = !!(street.trim() && city.trim() && stateCode.trim() && zip.trim());
  const sampleBefore = beforeIndex >= 0 ? previews[beforeIndex] : previews[0];
  const sampleAfter = afterIndex >= 0 ? previews[afterIndex] : previews[1] || previews[0];

  const openPostcardFlow = () => {
    if (photos.length < 2) {
      setPostcardStep('sample');
      return;
    }
    setPostcardStep('pick');
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) { toast.error('Geolocation not supported on this device'); return; }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { data, error } = await supabase.functions.invoke('geo-reverse', {
            body: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          });
          if (error) throw new Error(error.message);
          if (data?.error) throw new Error(data.error);
          if (data?.street) setStreet(data.street);
          if (data?.city) setCity(data.city);
          if (data?.state) setStateCode(data.state);
          if (data?.zip) setZip(data.zip);
          toast.success('Address pre-filled from GPS');
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Could not look up address');
        } finally { setGpsLoading(false); }
      },
      (err) => {
        setGpsLoading(false);
        toast.error(err.code === err.PERMISSION_DENIED ? 'Location permission denied' : 'Could not get your location');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const handleSendPostcards = async () => {
    if (!hasBeforeAfter) {
      toast.error('Tag a "Before" and an "After" photo first.');
      return;
    }
    if (!addressComplete) {
      toast.error('Add the job address so we know which neighborhood to mail.');
      return;
    }
    setSendingPostcards(true);
    try {
      // TODO: wire up to PostGrid API connector.
      // Will send the before+after pair plus job notes to neighbors of this job's address.
      await new Promise((r) => setTimeout(r, 800));
      toast.success('Postcards queued for this neighborhood (preview — PostGrid hookup pending).');
    } finally {
      setSendingPostcards(false);
    }
  };

  const handleRequestReview = () => {
    if (!reviewLink) {
      setMissingLinkAlert(true);
      return;
    }
    window.open(reviewLink, '_blank', 'noopener,noreferrer');
  };

  if (submitted && result && renderSuccess) {
    return <>{renderSuccess({ result, previews, reset: handleReset })}</>;
  }

  if (submitted) {
    return (
      <>
        <Card>
          <CardContent className="p-6 text-center space-y-5">
            <CheckCircle2 className="h-12 w-12 text-primary mx-auto" />
            <div>
              <h3 className="text-lg font-bold text-foreground">Done. Pushed to your site.</h3>
              {result && (
                <p className="text-sm text-muted-foreground mt-1">
                  <span className="font-medium">{result.title}</span> — linked under {result.serviceCategory.replace(/-/g, ' ')}.
                  Netlify usually finishes building in 1–2 minutes.
                </p>
              )}
            </div>

            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
              <p className="text-sm font-medium text-foreground">
                Now ask this customer for a Google review.
              </p>
              <p className="text-xs text-muted-foreground">
                The fresh job is on their mind — this is the best moment to ask.
              </p>
              <Button onClick={handleRequestReview} variant="cta" size="lg" className="w-full">
                <Star className="mr-2 h-4 w-4" />
                Request Google Review
              </Button>
            </div>

            {result && (
              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <Button variant="outline" size="sm" asChild>
                  <a href={result.url} target="_blank" rel="noopener noreferrer">
                    View on timberedmond.com <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                  </a>
                </Button>
                <Button variant="ghost" size="sm" asChild>
                  <a href={result.previewUrl} target="_blank" rel="noopener noreferrer">
                    Preview build <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                  </a>
                </Button>
              </div>
            )}
            <Button variant="ghost" onClick={handleReset} className="mt-2">
              Post another job
            </Button>
          </CardContent>
        </Card>

        <AlertDialog open={missingLinkAlert} onOpenChange={setMissingLinkAlert}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Add your Google review link first</AlertDialogTitle>
              <AlertDialogDescription>
                You haven't set up your Google review link yet. Add it in Google Reviews, then you can send review requests in one tap.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Later</AlertDialogCancel>
              <AlertDialogAction asChild>
                <Link to="/dashboard/google-reviews">Go to Google Reviews</Link>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  return (
    <>
    <Card>
      <CardContent className="p-6 space-y-5">
        <div>
          <h3 className="text-lg font-bold text-foreground">Just finished a job?</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Upload a couple of photos, type a quick note. That's it — we do the rest.
          </p>
        </div>

        {/* Photo upload */}
        <div>
          <Label className="text-sm font-medium mb-2 block">Photos</Label>
          <p className="text-xs text-muted-foreground mb-2">
            Drag and drop photos into the proper order before submitting. The first photo is the cover; photos are sent in the order shown. You can also use the arrows.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {previews.map((src, i) => (
              <div key={i} className="space-y-1.5">
                <div
                  draggable={!submitting}
                  onDragStart={handleDragStart(i)}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop(i)}
                  className="relative aspect-square rounded-lg overflow-hidden border border-border bg-muted cursor-move group"
                >
                  <img src={src} alt={`Job photo ${i + 1}`} className="w-full h-full object-contain pointer-events-none" />
                  {i === 0 && (
                    <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-primary text-primary-foreground">
                      Cover
                    </span>
                  )}
                  {photoLabels[i] && (
                    <span className={`absolute bottom-9 left-1.5 px-1.5 py-0.5 text-[10px] font-semibold rounded text-white ${photoLabels[i] === 'before' ? 'bg-amber-600' : 'bg-emerald-600'}`}>
                      {photoLabels[i] === 'before' ? 'Postcard: Before' : 'Postcard: After'}
                    </span>
                  )}
                  <span className="absolute top-1.5 right-9 p-1 rounded-full bg-background/80 opacity-60 group-hover:opacity-100 transition-opacity">
                    <GripVertical className="h-3.5 w-3.5" />
                  </span>
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    className="absolute top-1.5 right-1.5 p-1 rounded-full bg-background/80 hover:bg-background transition-colors"
                    aria-label="Remove photo"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  {previews.length > 1 && (
                    <div className="absolute bottom-1.5 left-1.5 right-1.5 flex justify-between gap-1">
                      <button
                        type="button"
                        onClick={() => movePhoto(i, i - 1)}
                        disabled={i === 0}
                        className="p-1 rounded-full bg-background/80 hover:bg-background disabled:opacity-30 transition-colors"
                        aria-label="Move left"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => movePhoto(i, i + 1)}
                        disabled={i === previews.length - 1}
                        className="p-1 rounded-full bg-background/80 hover:bg-background disabled:opacity-30 transition-colors"
                        aria-label="Move right"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {photos.length < 4 && (
              <div className="aspect-square rounded-lg border-2 border-dashed border-muted-foreground/30 p-2 flex flex-col gap-2 justify-center">
                <button
                  type="button"
                  onClick={() => libraryInputRef.current?.click()}
                  className="flex-1 rounded-md border border-border hover:border-primary/50 flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer bg-background"
                >
                  {photos.length === 0 ? (
                    <>
                      <Images className="h-5 w-5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground text-center leading-tight">Photo library</span>
                    </>
                  ) : (
                    <Plus className="h-5 w-5 text-muted-foreground" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex-1 rounded-md border border-border hover:border-primary/50 flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer bg-background"
                >
                  <Camera className="h-5 w-5 text-muted-foreground" />
                  {photos.length === 0 && <span className="text-xs text-muted-foreground text-center leading-tight">Take photo</span>}
                </button>
              </div>
            )}
          </div>
          <input
            ref={libraryInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,heic,heif"
            multiple
            className="hidden"
            onChange={(e) => {
              handlePhotos(e.target.files);
              // Reset so picking the same file again still fires onChange
              if (e.target) e.target.value = '';
            }}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              handlePhotos(e.target.files);
              // Reset so taking another photo still fires onChange
              if (e.target) e.target.value = '';
            }}
          />
        </div>

        {/* Notes */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label htmlFor="job-notes" className="text-sm font-medium">What'd you do?</Label>
            <Button
              type="button"
              variant={isListening ? 'destructive' : 'outline'}
              size="sm"
              onClick={toggleMic}
              className="h-8 gap-1.5"
            >
              {isListening ? (
                <>
                  <MicOff className="h-3.5 w-3.5" />
                  Stop
                </>
              ) : (
                <>
                  <Mic className="h-3.5 w-3.5" />
                  Speak
                </>
              )}
            </Button>
          </div>
          <Textarea
            id="job-notes"
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              notesBaseRef.current = e.target.value;
            }}
            placeholder="Edmond, OK — vine removal off a pergola. Customer found us on Google."
            rows={3}
            className="resize-none"
          />
          <p className="text-xs text-muted-foreground mt-1.5">
            {isListening ? (
              <span className="text-destructive font-medium">● Listening… tap Stop when done.</span>
            ) : (
              "City, job type, any detail worth mentioning. Tap Speak to dictate."
            )}
          </p>
        </div>

        {/* Address */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" />
              <Label className="text-sm font-medium">Job address</Label>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={handleUseCurrentLocation} disabled={gpsLoading}>
              {gpsLoading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <MapPin className="w-3.5 h-3.5 mr-1" />}
              Use current location
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mb-2">Where the job happened — start typing to autocomplete, or tap "Use current location" if you're still on site. Used to target postcards to the surrounding neighborhood.</p>
          <div className="space-y-2">
            <AddressAutocomplete
              value={street}
              onChange={setStreet}
              onSelect={(p) => { setStreet(p.street); setCity(p.city); setStateCode(p.state); setZip(p.zip); }}
              placeholder="Street address"
            />
            <div className="grid grid-cols-3 gap-2">
              <Input placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" className="col-span-2" />
              <select value={stateCode} onChange={(e) => setStateCode(e.target.value)} className="h-10 rounded-md border border-input bg-background px-2 text-sm" aria-label="State">
                <option value="">State</option>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <Input placeholder="ZIP" value={zip} onChange={(e) => setZip(e.target.value)} autoComplete="postal-code" inputMode="numeric" maxLength={10} className="max-w-[140px]" />
          </div>
        </div>

        {/* Submit */}
        <Button
          onClick={handleSubmit}
          disabled={submitting || photos.length === 0 || !notes.trim()}
          className="w-full"
          variant="cta"
          size="lg"
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Submitting…
            </>
          ) : (
            'Post this job'
          )}
        </Button>

        {/* Send postcards to neighborhood (opt-in checkbox) */}
        <div className="pt-3 border-t border-border">
          <label
            onClick={(event) => {
              const target = event.target as HTMLElement;
              if (target.closest('[role="checkbox"]')) return;
              openPostcardFlow();
            }}
            className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${postcardsOptIn ? 'border-primary/60 bg-primary/5' : 'border-border hover:bg-muted/40'} cursor-pointer`}
          >
            <Checkbox
              checked={postcardsOptIn}
              onCheckedChange={(v) => {
                const checked = v === true;
                if (checked) {
                  openPostcardFlow();
                } else {
                  setPostcardsOptIn(false);
                  setPhotoLabels((prev) => prev.map(() => null));
                }
              }}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-foreground">Send postcards to this neighborhood</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {photos.length < 2
                  ? 'Tap to see a sample campaign preview.'
                  : postcardsOptIn
                    ? 'Postcards queued — will mail after you post this job.'
                    : 'Mail a before/after postcard to homes within a half-mile.'}
              </p>
            </div>
          </label>
        </div>
      </CardContent>
    </Card>

    {/* Postcard dialog: step 1 = pick before/after, step 2 = confirm reach + cost */}
    <Dialog
      open={postcardStep === 'sample' || postcardStep === 'pick' || postcardStep === 'confirm'}
      onOpenChange={(open) => { if (!open) setPostcardStep('closed'); }}
    >
      <DialogContent className="max-w-lg">
        {postcardStep === 'sample' && (
          <>
            <DialogHeader>
              <DialogTitle>Sample neighborhood postcard campaign</DialogTitle>
              <DialogDescription>
                This is the preview you would see before any postcards are mailed or charged.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-1">
              <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div className="aspect-[4/3] overflow-hidden rounded-md bg-muted">
                    {sampleBefore ? (
                      <img src={sampleBefore} alt="Sample before postcard photo" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-muted text-xs font-medium text-muted-foreground">BEFORE PHOTO</div>
                    )}
                  </div>
                  <div className="aspect-[4/3] overflow-hidden rounded-md bg-muted">
                    {sampleAfter ? (
                      <img src={sampleAfter} alt="Sample after postcard photo" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-muted text-xs font-medium text-muted-foreground">AFTER PHOTO</div>
                    )}
                  </div>
                </div>
                <div className="mt-3 space-y-1">
                  <p className="text-sm font-semibold text-foreground">Recently completed tree work in your neighborhood</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    We helped a nearby homeowner with professional tree service and are scheduling neighbors this week.
                  </p>
                  <div className="mt-2 rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
                    QR code + call-to-action would send neighbors to your estimate request page.
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">Example homes reached</span>
                  <span className="text-2xl font-bold text-foreground">247</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">Example radius</span>
                  <span className="text-sm font-medium text-foreground">0.5 miles</span>
                </div>
                <div className="flex items-baseline justify-between border-t border-border pt-2 mt-2">
                  <span className="text-sm text-muted-foreground">Example total</span>
                  <span className="text-2xl font-bold text-primary">$172.90</span>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setPostcardStep('closed')}>Close</Button>
              <Button variant="cta" onClick={() => photos.length >= 2 ? setPostcardStep('pick') : toast.message('Add two job photos to build a real postcard preview.')}>
                Build one from this job
              </Button>
            </DialogFooter>
          </>
        )}

        {postcardStep === 'pick' && (
          <>
            <DialogHeader>
              <DialogTitle>Pick the Before & After</DialogTitle>
              <DialogDescription>
                Tap one photo for <span className="font-medium text-amber-700">Before</span>, then one for <span className="font-medium text-emerald-700">After</span>. These will be printed on the postcard.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 py-2">
              {previews.map((src, i) => (
                <div key={i} className="space-y-1">
                  <div className="relative aspect-square rounded-md overflow-hidden border border-border bg-muted">
                    <img src={src} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                    {photoLabels[i] && (
                      <span className={`absolute top-1 left-1 px-1.5 py-0.5 text-[10px] font-semibold rounded text-white ${photoLabels[i] === 'before' ? 'bg-amber-600' : 'bg-emerald-600'}`}>
                        {photoLabels[i] === 'before' ? 'Before' : 'After'}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => setLabel(i, 'before')}
                      className={`text-[10px] py-1 rounded border transition-colors ${photoLabels[i] === 'before' ? 'bg-amber-600 text-white border-amber-600' : 'border-border text-muted-foreground hover:border-amber-600/50'}`}
                    >
                      Before
                    </button>
                    <button
                      type="button"
                      onClick={() => setLabel(i, 'after')}
                      className={`text-[10px] py-1 rounded border transition-colors ${photoLabels[i] === 'after' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-border text-muted-foreground hover:border-emerald-600/50'}`}
                    >
                      After
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPostcardStep('closed')}>Cancel</Button>
              <Button
                variant="cta"
                disabled={!hasBeforeAfter}
                onClick={() => setPostcardStep('confirm')}
              >
                Continue
              </Button>
            </DialogFooter>
          </>
        )}

        {postcardStep === 'confirm' && (
          <>
            <DialogHeader>
              <DialogTitle>Send postcards to this neighborhood?</DialogTitle>
              <DialogDescription>
                We'll mail your before/after postcard to homes within a half-mile of the job address.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">Homes in radius</span>
                <span className="text-2xl font-bold text-foreground">247</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">Radius</span>
                <span className="text-sm font-medium text-foreground">0.5 miles</span>
              </div>
              <div className="flex items-baseline justify-between border-t border-border pt-2 mt-2">
                <span className="text-sm text-muted-foreground">Estimated cost</span>
                <span className="text-2xl font-bold text-primary">$172.90</span>
              </div>
              <p className="text-[11px] text-muted-foreground pt-1">
                Final count + cost will be confirmed by PostGrid before any charge.
              </p>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPostcardStep('pick')}>Back</Button>
              <Button
                variant="cta"
                disabled={sendingPostcards}
                onClick={async () => {
                  setSendingPostcards(true);
                  await new Promise((r) => setTimeout(r, 700));
                  setSendingPostcards(false);
                  setPostcardsOptIn(true);
                  setPostcardStep('closed');
                  toast.success('Postcards queued — 247 homes, $172.90 (preview — PostGrid hookup pending).');
                }}
              >
                {sendingPostcards ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Queuing…</>
                ) : (
                  <>Send postcards</>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
