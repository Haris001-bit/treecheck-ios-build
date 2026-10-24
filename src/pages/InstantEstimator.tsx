import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Image as ImageIcon, Mic, MicOff, Sparkles, RotateCcw, Loader2, AlertTriangle, CheckCircle2, Ruler, HelpCircle, Play, Pause, Trash2, MapPin, Pencil, Save, X, ChevronLeft } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth';
import { WaitlistModal } from '@/components/WaitlistModal';
import { submitScoutCapture, approveCapture, saveEditedCapture, type ScoutCapture } from '@/lib/estimatorService';
import { useFreePlan } from '@/hooks/useFreePlan';
import { FreeUsageNote } from '@/components/free/FreeUsageNote';
import { FreePlanUpsell } from '@/components/free/FreePlanUpsell';
import { LockedScoutEstimate } from '@/components/free/LockedScoutEstimate';
import { AddressAutocomplete } from '@/components/AddressAutocomplete';
import { RecentCaptures } from '@/components/RecentCaptures';
import { ScoutLearningCard } from '@/components/scout/ScoutLearningCard';
import { ScoutWorksheetPanel } from '@/components/ScoutWorksheetPanel';
import { useScoutRates } from '@/hooks/useScoutRates';
import { EMPTY_WORKSHEET, calculateWorksheet, worksheetToRow, worksheetFromRow, worksheetSummary, type WorksheetInputs } from '@/lib/scoutWorksheet';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import measureTreeImg from '@/assets/measure-tree-circumference.png';
import { RequestCrewBidsDialog, type RequestCrewBidsSeed } from '@/components/RequestCrewBidsDialog';
import { cn } from '@/lib/utils';
import { useServiceAreas } from '@/hooks/useServiceAreas';
import { saveScoutDraft, loadScoutDraft, clearScoutDraft, toStateCode } from '@/lib/scoutDraft';

type Phase = 'input' | 'submitting' | 'awaiting' | 'review' | 'done';

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
const SERVICE_TYPES = ['Tree Removal', 'Stump Grinding', 'Pruning/Trimming'] as const;

const money = (value: number | null | undefined) => value == null ? '—' : `$${Number(value).toLocaleString()}`;
const rangeMoney = (min?: number | null, max?: number | null) => {
  if (min == null && max == null) return '—';
  if (min != null && max != null && min !== max) return `${money(min)} - ${money(max)}`;
  return money(max ?? min);
};
const fullAddress = (c: ScoutCapture) => [
  c.address_street,
  [c.address_city, c.address_state].filter(Boolean).join(', '),
  c.address_zip,
].filter(Boolean).join(' ');

function DetailBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</div>
      <div className="text-sm text-foreground whitespace-pre-wrap break-words">{children || '—'}</div>
    </div>
  );
}

function CaptureDetails({ capture, photoUrls }: { capture: ScoutCapture; photoUrls: string[] }) {
  return (
    <div className="space-y-4 text-left">
      {photoUrls.length > 0 && (
        <div className={photoUrls.length > 1 ? "grid grid-cols-2 gap-2" : ""}>
          {photoUrls.map((u, i) => (
            <img key={i} src={u} alt={`Saved Scout capture ${i + 1}`} className="w-full rounded-lg border object-contain max-h-80 bg-muted" />
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <DetailBlock label="Status"><Badge variant="outline">{capture.status.replace('_', ' ')}</Badge></DetailBlock>
        <DetailBlock label="Submitted">{capture.created_at ? format(new Date(capture.created_at), 'PPp') : '—'}</DetailBlock>
      </div>
      <DetailBlock label="Address">{fullAddress(capture)}</DetailBlock>
      <div className="grid grid-cols-2 gap-4">
        <DetailBlock label="Selected service">{capture.requested_service ?? capture.final_service ?? capture.ai_service}</DetailBlock>
        <DetailBlock label="Diameter / Circumference">
          {capture.diameter_inches != null ? `${Number(capture.diameter_inches).toFixed(1)} in DBH` : '—'}
          {capture.circumference_inches != null ? ` / ${Number(capture.circumference_inches).toFixed(1)} in around` : ''}
        </DetailBlock>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <DetailBlock label="Raw notes">{capture.notes_raw}</DetailBlock>
        <DetailBlock label="Cleaned notes">{capture.notes_summary}</DetailBlock>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-md border bg-muted/30 p-3">
        <DetailBlock label="AI service">{capture.ai_service}</DetailBlock>
        <DetailBlock label="AI price">{rangeMoney(capture.ai_price_min, capture.ai_price_max)}</DetailBlock>
        <DetailBlock label="Difficulty">{capture.ai_difficulty}</DetailBlock>
        <DetailBlock label="Risk">{capture.ai_risk}</DetailBlock>
        <div className="sm:col-span-2"><DetailBlock label="AI notes">{capture.ai_notes}</DetailBlock></div>
      </div>
      {(capture.final_service || capture.final_price_min != null || capture.final_price_max != null || capture.final_notes) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-md border border-primary/20 bg-primary/5 p-3">
          <DetailBlock label="Final service">{capture.final_service}</DetailBlock>
          <DetailBlock label="Final price">{rangeMoney(capture.final_price_min, capture.final_price_max)}</DetailBlock>
          <div className="sm:col-span-2"><DetailBlock label="Final notes">{capture.final_notes}</DetailBlock></div>
        </div>
      )}
    </div>
  );
}

export default function InstantEstimator() {
  const { user, isAdmin, loading, roleLoading } = useAuth();
  const { rates: scoutRates } = useScoutRates();
  const navigate = useNavigate();
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [seeHowOpen, setSeeHowOpen] = useState(false);

  const [photos, setPhotos] = useState<string[]>([]);
  // Pruning only: which tree each photo belongs to, plus a note per tree.
  const [photoTree, setPhotoTree] = useState<number[]>([]);
  const [treeNotes, setTreeNotes] = useState<string[]>(['']);
  const [activeTree, setActiveTree] = useState(0);
  const [service, setService] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [circumference, setCircumference] = useState('');
  const [phase, setPhase] = useState<Phase>('input');
  const [capture, setCapture] = useState<ScoutCapture | null>(null);
  // Free plan (Oklahoma owners): AI previews only, the estimate stays hidden; no worksheet.
  const freePlan = useFreePlan();
  const onFree = freePlan.data?.plan === 'free';
  const [freeLimit, setFreeLimit] = useState<string | null>(null);
  const isOwnerOfCapture = !!(capture && user && (capture.owner_id === user.id || isAdmin));
  const isRepView = !!(capture && user && capture.contractor_id === user.id && capture.owner_id !== user.id && !isAdmin);
  const [capturePhotoUrls, setCapturePhotoUrls] = useState<string[]>([]);

  // Edit-mode state
  const [editing, setEditing] = useState(false);
  const [editService, setEditService] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Address
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);

  // Optional homeowner contact (used to promote approved captures into Your Leads)
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [worksheet, setWorksheet] = useState<WorksheetInputs>({ ...EMPTY_WORKSHEET });
  // How the owner prices jobs: AI suggestion or their own worksheet.
  const [pricingMode, setPricingModeState] = useState<'ai' | 'manual'>(() => {
    const q = new URLSearchParams(window.location.search).get('mode');
    if (q === 'ai' || q === 'manual') { localStorage.setItem('scout_pricing_mode', q); return q; }
    return localStorage.getItem('scout_pricing_mode') === 'manual' ? 'manual' : 'ai';
  });
  const setPricingMode = (m: 'ai' | 'manual') => { localStorage.setItem('scout_pricing_mode', m); setPricingModeState(m); };
  const [needSubs, setNeedSubs] = useState(false);
  const [subsSeed, setSubsSeed] = useState<RequestCrewBidsSeed | null>(null);

  // Default state: last one used, else the state of the company's service area.
  const { data: serviceAreas } = useServiceAreas();
  const defaultState = useMemo(() => {
    const last = toStateCode(localStorage.getItem('scout_last_state'));
    if (last) return last;
    for (const a of serviceAreas ?? []) { const c = toStateCode(a.region); if (c) return c; }
    return '';
  }, [serviceAreas]);
  useEffect(() => { if (defaultState && !state) setState(defaultState); }, [defaultState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the in-progress capture on the device so switching apps doesn't wipe it.
  const draftLoadedRef = useRef(false);
  useEffect(() => {
    loadScoutDraft<any>().then((d) => {
      if (d) {
        if (Array.isArray(d.photos)) setPhotos(d.photos);
        if (d.service) setService(d.service);
        if (d.notes) setNotes(d.notes);
        if (d.circumference) setCircumference(d.circumference);
        if (d.street) setStreet(d.street);
        if (d.city) setCity(d.city);
        if (d.state) setState(d.state);
        if (d.zip) setZip(d.zip);
        if (d.customerName) setCustomerName(d.customerName);
        if (d.customerPhone) setCustomerPhone(d.customerPhone);
        if (d.customerEmail) setCustomerEmail(d.customerEmail);
        if (d.worksheet) setWorksheet({ ...EMPTY_WORKSHEET, ...d.worksheet });
      }
      draftLoadedRef.current = true;
    });
  }, []);
  useEffect(() => {
    if (!draftLoadedRef.current) return;
    const hasContent = photos.length || notes || street || customerName || customerPhone || service;
    if (!hasContent) return;
    const t = window.setTimeout(() => {
      saveScoutDraft({ photos, service, notes, circumference, street, city, state, zip, customerName, customerPhone, customerEmail, worksheet });
    }, 300);
    return () => window.clearTimeout(t);
  }, [photos, service, notes, circumference, street, city, state, zip, customerName, customerPhone, customerEmail, worksheet]);

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
          if (data?.state) setState(data.state);
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

  // Live speech recognition → notes (with MediaRecorder audio fallback)
  const [recording, setRecording] = useState(false);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const sawTranscriptRef = useRef(false);





  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  // Scout is now open to all contractors — no waitlist gate.


  useEffect(() => {
    let cancelled = false;
    setCapturePhotoUrls([]);
    const paths = (capture?.photo_paths && capture.photo_paths.length > 0)
      ? capture.photo_paths
      : (capture?.photo_path ? [capture.photo_path] : []);
    if (paths.length === 0) return;

    Promise.all(paths.map((p) => supabase.storage.from('scout-media').createSignedUrl(p, 3600))).then((results) => {
      if (!cancelled) setCapturePhotoUrls(results.map((r) => r.data?.signedUrl).filter(Boolean) as string[]);
    });

    return () => { cancelled = true; };
  }, [capture?.photo_path, capture?.photo_paths]);

  // Realtime subscription to the active capture row
  useEffect(() => {
    if (!capture?.id) return;
    const channel = supabase
      .channel(`scout-capture-${capture.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'scout_captures', filter: `id=eq.${capture.id}` },
        (payload) => {
          const next = payload.new as ScoutCapture;
          setCapture(next);
          if (next.status === 'awaiting_review' && phase !== 'review' && phase !== 'done') {
            setEditService(next.ai_service ?? '');
            setEditPrice(String(next.ai_price_max ?? next.ai_price_min ?? ''));
            setEditNotes(next.ai_notes ?? '');
            toast.success('Scout estimate ready', {
              description: 'Tap to review before sending to the homeowner.',
              duration: 15000,
              action: { label: 'Review', onClick: () => setPhase('review') },
            });
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [capture?.id, phase]);


  const MAX_PHOTOS = 3;
  const MAX_TREES = 8;
  const isPruning = service === 'Pruning/Trimming';
  const treeOf = (i: number) => photoTree[i] ?? 0;
  const photosInTree = (t: number) => photos.reduce((n, _, i) => n + (treeOf(i) === t ? 1 : 0), 0);

  // Shrink pruning photos so a many-tree job uploads quickly.
  const downscale = (dataUrl: string): Promise<string> => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d');
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error('Photo must be under 10MB'); return; }
    const tree = isPruning ? activeTree : 0;
    const inTree = isPruning ? photosInTree(tree) : photos.length;
    if (inTree >= MAX_PHOTOS) { toast.error(`Up to ${MAX_PHOTOS} photos per tree`); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const raw = reader.result as string;
      const url = isPruning ? await downscale(raw) : raw;
      setPhotos((prev) => [...prev, url]);
      setPhotoTree((prev) => { const next = photos.map((_, i) => prev[i] ?? 0); next.push(tree); return next; });
    };
    reader.readAsDataURL(file);
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    setPhotoTree((prev) => photos.map((_, i) => prev[i] ?? 0).filter((_, i) => i !== index));
  };

  const addTree = () => {
    if (treeNotes.length >= MAX_TREES) return toast.error(`Up to ${MAX_TREES} trees per job`);
    setTreeNotes((n) => [...n, '']);
    setActiveTree(treeNotes.length);
  };

  const removeTree = (t: number) => {
    const keep = photos.map((_, i) => treeOf(i) !== t);
    setPhotos((prev) => prev.filter((_, i) => keep[i]));
    setPhotoTree(photos.map((_, i) => treeOf(i)).filter((_, i) => keep[i]).map((x) => (x > t ? x - 1 : x)));
    setTreeNotes((n) => n.filter((_, i) => i !== t));
    setActiveTree(0);
  };

  const resetTrees = () => { setPhotoTree([]); setTreeNotes(['']); setActiveTree(0); };

  // Leaving Pruning: fall back to one tree, max 3 photos.
  useEffect(() => {
    if (isPruning || (treeNotes.length <= 1 && photos.length <= MAX_PHOTOS)) return;
    const firstTree = photos.filter((_, i) => treeOf(i) === 0).slice(0, MAX_PHOTOS);
    setPhotos(firstTree);
    resetTrees();
    toast.message('Only one tree per job for this service', { description: 'Kept the first tree\'s photos.' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPruning]);

  const stopMediaRecorder = () => {
    try { mediaRecorderRef.current?.state === 'recording' && mediaRecorderRef.current.stop(); } catch { /* noop */ }
    try { mediaStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    mediaRecorderRef.current = null;
    mediaStreamRef.current = null;
  };

  const toggleVoice = async () => {
    if (recording) {
      const r = recognitionRef.current;
      if (r) (r as any)._userWantsListening = false;
      try { r?.stop(); } catch { /* noop */ }
      stopMediaRecorder();
      setRecording(false);
      if (!sawTranscriptRef.current) {
        toast.message('Voice memo saved', { description: "We'll transcribe it when you submit." });
      }
      return;
    }

    // Get mic access (required for both MediaRecorder and iOS SR)
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error('Microphone access denied. Enable it in your browser settings and try again.');
      return;
    }

    // Start MediaRecorder so we always capture audio, even if SpeechRecognition fails
    sawTranscriptRef.current = false;
    audioChunksRef.current = [];
    setAudioBlob(null);
    try {
      const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', ''];
      let mr: MediaRecorder | null = null;
      for (const mime of mimeCandidates) {
        try {
          mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
          break;
        } catch { /* try next */ }
      }
      if (mr) {
        mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
        mr.onstop = () => {
          const type = mr!.mimeType || 'audio/webm';
          if (audioChunksRef.current.length > 0) {
            setAudioBlob(new Blob(audioChunksRef.current, { type }));
          }
        };
        mr.start();
        mediaRecorderRef.current = mr;
        mediaStreamRef.current = stream;
      } else {
        stream.getTracks().forEach((t) => t.stop());
      }
    } catch (e) {
      console.error('MediaRecorder failed', e);
      stream.getTracks().forEach((t) => t.stop());
    }

    setRecording(true);

    // Best-effort live transcription via Web Speech API (works in Safari, often not in iOS WebView)
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return; // audio still captured via MediaRecorder

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = !isIOS;

    const baseline = notes ? notes + ' ' : '';
    let finalText = '';
    rec.onresult = (e: any) => {
      sawTranscriptRef.current = true;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += chunk;
        else interim += chunk;
      }
      setNotes(baseline + finalText + interim);
    };
    rec.onerror = (event: any) => {
      // Swallow errors silently — we still have the MediaRecorder audio as backup
      if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
        console.warn('SpeechRecognition blocked, relying on audio capture');
      }
    };
    rec.onend = () => {
      if (isIOS && recognitionRef.current === rec && (rec as any)._userWantsListening) {
        try { rec.start(); return; } catch { /* fall through */ }
      }
    };

    (rec as any)._userWantsListening = true;
    recognitionRef.current = rec;
    try {
      rec.start();
    } catch (e) {
      console.error('Failed to start recognition (audio still recording):', e);
    }
  };


  const circumferenceNum = parseFloat(circumference);
  const diameter = useMemo(() => {
    if (!circumference || isNaN(circumferenceNum) || circumferenceNum <= 0) return null;
    return circumferenceNum / Math.PI;
  }, [circumference, circumferenceNum]);

  const worksheetResult = useMemo(() => calculateWorksheet(worksheet, scoutRates), [worksheet, scoutRates]);
  const captureWorksheet = useMemo(() => worksheetFromRow(capture), [capture]);
  const captureWorksheetResult = useMemo(() => calculateWorksheet(captureWorksheet, scoutRates), [captureWorksheet, scoutRates]);

  const addressComplete = !!(street.trim() && city.trim() && state.trim() && zip.trim());
  const canSubmit = photos.length > 0 && addressComplete && !!service;

  const submit = async () => {
    if (photos.length === 0) return toast.error('Please add a photo first');
    if (isPruning && treeNotes.length > 1) {
      const empty = treeNotes.findIndex((_, t) => photosInTree(t) === 0);
      if (empty >= 0) return toast.error(`Add a photo for Tree ${empty + 1}, or remove it`);
    }
    // Order photos tree by tree so each tree's indexes are contiguous.
    const pruningPayload = (() => {
      if (!isPruning || treeNotes.length <= 1) return { photos, trees: null };
      const ordered: string[] = [];
      const trees = treeNotes.map((note, t) => {
        const idx: number[] = [];
        photos.forEach((p, i) => { if (treeOf(i) === t) { idx.push(ordered.length); ordered.push(p); } });
        return { label: `Tree ${t + 1}`, note: note.trim() || null, photo_indexes: idx };
      });
      return { photos: ordered, trees };
    })();
    if (!service) return toast.error('Please select a service type');
    if (!addressComplete) return toast.error('Please fill in the full address');

    setPhase('submitting');
    try {
      const { captureId } = await submitScoutCapture({
        photoDataUrls: pruningPayload.photos,
        trees: pruningPayload.trees,
        audioBlob,
        notes,
        service,
        circumferenceInches: diameter !== null ? circumferenceNum : undefined,
        diameterInches: diameter !== null ? Number(diameter.toFixed(2)) : undefined,
        address: { street: street.trim(), city: city.trim(), state: state.trim(), zip: zip.trim() },
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        customerEmail: customerEmail.trim() || undefined,
        worksheet: worksheetResult.hasInput ? worksheetToRow(worksheet, worksheetResult) : null,
      });
      const { data } = await supabase.from('scout_captures').select('*').eq('id', captureId).single();
      if (data) setCapture(data as ScoutCapture);
      else setCapture({ id: captureId } as ScoutCapture);
      if (needSubs) {
        setSubsSeed({
          captureId,
          title: `${service}${city.trim() ? ` — ${city.trim()}` : ''}`,
          description: notes.trim(),
          city: city.trim(),
          climber: (worksheet.climberPayout ?? 0) > 0 || service !== 'Stump Grinding',
          groundCount: worksheet.groundCrew,
          hours: worksheet.hours,
          loads: worksheet.loads,
          stump: worksheet.stump || service === 'Stump Grinding',
          crane: worksheet.craneRequired,
          chipper: !!worksheet.chipper,
        });
        setNeedSubs(false);
      }

      // Reset the form and return to input — we'll notify when the estimate comes back
      clearScoutDraft();
      if (state.trim()) localStorage.setItem('scout_last_state', state.trim());
      setPhotos([]); resetTrees(); setService(''); setNotes(''); setCircumference('');
      setStreet(''); setCity(''); setState(state.trim() || defaultState); setZip('');
      setCustomerName(''); setCustomerPhone(''); setCustomerEmail('');
      setWorksheet({ ...EMPTY_WORKSHEET });
      clearMemo();
      setPhase('input');
      toast.success('Sent to Scout', {
        description: "We'll notify you when the AI estimate is ready. Keep working — no need to wait here.",
        duration: 6000,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to submit';
      if (onFree && /this month/.test(message)) setFreeLimit(message);
      else toast.error(message);
      setPhase('input');
    } finally {
      if (onFree) void freePlan.refetch();
    }
  };

  const clearMemo = () => { setAudioBlob(null); audioChunksRef.current = []; sawTranscriptRef.current = false; };



  const startOver = () => {
    clearScoutDraft();
    setPhotos([]); resetTrees(); setService(''); setNotes(''); setCircumference('');
    setStreet(''); setCity(''); setState(defaultState); setZip('');
    setCustomerName(''); setCustomerPhone(''); setCustomerEmail('');
    setWorksheet({ ...EMPTY_WORKSHEET });
    clearMemo();
    setCapture(null);
    setEditing(false);
    setPhase('input');
  };

  const openCapture = (c: ScoutCapture) => {
    setCapture(c);
    setEditing(false);
    if (c.status === 'approved' || c.status === 'edited') setPhase('done');
    else if (c.status === 'awaiting_review') setPhase('review');
    else setPhase('awaiting');
  };

  const handleApprove = async (priceSource: 'ai' | 'worksheet' = 'ai') => {
    if (!capture) return;
    const useWk = priceSource === 'worksheet' && captureWorksheetResult.hasInput;
    setSaving(true);
    try {
      await approveCapture(capture, {
        priceSource: useWk ? 'worksheet' : 'ai',
        worksheetTotal: useWk ? captureWorksheetResult.total : null,
      });
      setCapture({
        ...capture,
        status: 'approved',
        final_service: capture.ai_service,
        final_price_min: useWk ? captureWorksheetResult.total : capture.ai_price_min,
        final_price_max: useWk ? captureWorksheetResult.total : capture.ai_price_max,
        final_notes: capture.ai_notes,
        approved_at: new Date().toISOString(),
      });
      toast.success('Estimate approved');
      setPhase('done');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to approve');
    } finally { setSaving(false); }
  };

  const handleSaveEdits = async () => {
    if (!capture) return;
    const price = Number(editPrice);
    if (!editService.trim() || isNaN(price)) {
      toast.error('Please fill service and price');
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('scout-request-edit', {
        body: {
          capture_id: capture.id,
          service: editService.trim(),
          price,
          notes: editNotes,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success('Edits sent to Scout', {
        description: "We'll notify you when the updated estimate is ready.",
        duration: 6000,
      });
      setEditing(false);
      setPhase('awaiting');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally { setSaving(false); }
  };


  if (loading || roleLoading) {
    return (
      <div className="container mx-auto p-4 lg:p-8 max-w-2xl py-20 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }




  return (
    <div className="container mx-auto p-4 lg:p-8 max-w-2xl">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-6 h-6 text-primary" />
          <h1 className="text-3xl font-bold">Scout™</h1>
        </div>
        <p className="text-muted-foreground">Capture a tree in the field — review the AI estimate before it goes to the homeowner</p>
      </div>

      {phase === 'input' && capture && capture.status && capture.status !== 'approved' && capture.status !== 'edited' && (
        <Card className="p-4 mb-4 flex items-center gap-3 border-primary/30 bg-primary/5">
          {capture.status === 'awaiting_review' ? (
            <>
              <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
              <div className="flex-1">
                <div className="text-sm font-semibold">Scout estimate ready</div>
                <div className="text-xs text-muted-foreground">Review before sending to the homeowner.</div>
              </div>
              <Button size="sm" onClick={() => setPhase('review')}>Review</Button>
            </>
          ) : (
            <>
              <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
              <div className="flex-1">
                <div className="text-sm font-semibold">Scout is analyzing your last capture</div>
                <div className="text-xs text-muted-foreground">We'll notify you when it's ready — usually 30–60 sec.</div>
              </div>
            </>
          )}
        </Card>
      )}

      {phase === 'input' && onFree && <FreeUsageNote kind="scout" className="mb-4" />}
      {phase === 'input' && freeLimit && <div className="mb-4"><FreePlanUpsell title="Free Scout previews used" body={freeLimit} /></div>}
      {phase === 'input' && (
        <Card className="p-6 space-y-6">

          {/* How to price (the worksheet is part of full Scout, not the Free preview) */}
          {!onFree && <div>
            <label className="text-sm font-bold block mb-2">How do you want to price this job?</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setPricingMode('ai')}
                className={cn('rounded-lg border-2 p-3 text-left', pricingMode === 'ai' ? 'border-primary bg-primary/5' : 'border-input')}>
                <div className="font-black text-sm">Let AI estimate it</div>
                <div className="text-xs">AI suggests the price. You can adjust it.</div>
              </button>
              <button type="button" onClick={() => setPricingMode('manual')}
                className={cn('rounded-lg border-2 p-3 text-left', pricingMode === 'manual' ? 'border-primary bg-primary/5' : 'border-input')}>
                <div className="font-black text-sm">I'll price it myself</div>
                <div className="text-xs">Use the worksheet below. AI still gives a second opinion.</div>
              </button>
            </div>
          </div>}

          {/* Photo */}
          <div>
            <label className="text-sm font-medium block mb-2">Tree photos <span className="font-normal text-muted-foreground">(up to {MAX_PHOTOS})</span></label>
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} className="hidden" />
            <input ref={libraryInputRef} type="file" accept="image/*" onChange={handlePhoto} className="hidden" />
            {isPruning ? (
              <div className="space-y-3">
                {treeNotes.map((note, t) => {
                  const idxs = photos.map((_, i) => i).filter((i) => treeOf(i) === t);
                  return (
                    <div key={t} className={cn('rounded-lg border-2 p-3 space-y-2', activeTree === t ? 'border-primary' : 'border-input')}>
                      <div className="flex items-center justify-between">
                        <div className="font-black text-sm">Tree {t + 1}</div>
                        {treeNotes.length > 1 && (
                          <button type="button" onClick={() => removeTree(t)} className="text-xs text-destructive underline">Remove tree</button>
                        )}
                      </div>
                      {idxs.length > 0 && (
                        <div className="grid grid-cols-3 gap-2">
                          {idxs.map((i) => (
                            <div key={i} className="relative">
                              <img src={photos[i]} alt={`Tree ${t + 1} photo`} className="w-full aspect-square rounded-lg border object-cover bg-muted" />
                              <button type="button" onClick={() => removePhoto(i)} aria-label={`Remove photo`}
                                className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 shadow">
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      {idxs.length < MAX_PHOTOS && (
                        <div className="grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => { setActiveTree(t); setTimeout(() => cameraInputRef.current?.click(), 0); }} className="border-2 border-dashed rounded-lg py-3 flex items-center justify-center gap-2 hover:bg-muted/40 transition">
                            <Camera className="w-5 h-5 text-muted-foreground" /><span className="font-medium text-sm">Take photo</span>
                          </button>
                          <button type="button" onClick={() => { setActiveTree(t); setTimeout(() => libraryInputRef.current?.click(), 0); }} className="border-2 border-dashed rounded-lg py-3 flex items-center justify-center gap-2 hover:bg-muted/40 transition">
                            <ImageIcon className="w-5 h-5 text-muted-foreground" /><span className="font-medium text-sm">Library</span>
                          </button>
                        </div>
                      )}
                      <input
                        value={note}
                        onChange={(e) => setTreeNotes((n) => n.map((x, i) => (i === t ? e.target.value.slice(0, 200) : x)))}
                        placeholder="Note (optional), e.g. back corner oak, lift canopy"
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        aria-label={`Tree ${t + 1} note`}
                      />
                    </div>
                  );
                })}
                {treeNotes.length < MAX_TREES && (
                  <button type="button" onClick={addTree} className="w-full rounded-lg border-2 border-dashed py-3 font-medium text-sm hover:bg-muted/40">
                    + Add another tree
                  </button>
                )}
                <p className="text-xs text-muted-foreground">Pruning jobs can include several trees at one property. Up to {MAX_PHOTOS} photos per tree, {MAX_TREES} trees. Climbers bid on the whole job.</p>
              </div>
            ) : (<>
            {photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-2">
                {photos.map((p, i) => (
                  <div key={i} className="relative">
                    <img src={p} alt={`Tree photo ${i + 1}`} className="w-full aspect-square rounded-lg border object-cover bg-muted" />
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      aria-label={`Remove photo ${i + 1}`}
                      className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 shadow"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {photos.length < MAX_PHOTOS && (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => cameraInputRef.current?.click()} className="border-2 border-dashed rounded-lg py-6 flex flex-col items-center gap-2 hover:bg-muted/40 transition">
                  <Camera className="w-7 h-7 text-muted-foreground" />
                  <span className="font-medium text-sm">{photos.length === 0 ? 'Take photo' : 'Add another'}</span>
                </button>
                <button type="button" onClick={() => libraryInputRef.current?.click()} className="border-2 border-dashed rounded-lg py-6 flex flex-col items-center gap-2 hover:bg-muted/40 transition">
                  <ImageIcon className="w-7 h-7 text-muted-foreground" />
                  <span className="font-medium text-sm">Choose from library</span>
                </button>
              </div>
            )}
            </>)}
            {!isPruning && (<>
              <p className="text-xs text-muted-foreground mt-2">JPG/PNG, up to 10MB each. Add up to {MAX_PHOTOS} photos <strong>of the same tree</strong>.</p>
              <p className="text-xs font-medium text-amber-700 dark:text-amber-500 mt-1">Photographing a different tree? Please start a new submission for it. Pruning several trees? Pick Pruning/Trimming below to add more trees.</p>
            </>)}
          </div>

          {/* Service type */}
          <div>
            <label className="text-sm font-medium block mb-2">Service type</label>
            <select
              value={service}
              onChange={(e) => setService(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              aria-label="Service type"
            >
              <option value="">Select service…</option>
              {SERVICE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <p className="text-xs text-muted-foreground mt-1">Pick the job type the homeowner is asking about.</p>
          </div>

          {/* Address */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-primary" />
                <label className="text-sm font-medium">Property address</label>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={handleUseCurrentLocation} disabled={gpsLoading}>
                {gpsLoading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <MapPin className="w-3.5 h-3.5 mr-1" />}
                Use current location
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mb-2">The home where the tree is — start typing to autocomplete, or tap "Use current location" if you're at the property.</p>
            <div className="space-y-2">
              <AddressAutocomplete
                value={street}
                onChange={setStreet}
                onSelect={(p) => { setStreet(p.street); setCity(p.city); setState(p.state); setZip(p.zip); }}
                placeholder="Street address"
              />
              <div className="grid grid-cols-3 gap-2">
                <Input placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" className="col-span-2" />
                <select value={state} onChange={(e) => setState(e.target.value)} className="h-10 rounded-md border border-input bg-background px-2 text-sm" aria-label="State">
                  <option value="">State</option>
                  {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <Input placeholder="ZIP" value={zip} onChange={(e) => setZip(e.target.value)} autoComplete="postal-code" inputMode="numeric" maxLength={10} className="max-w-[140px]" />
            </div>
          </div>

          {/* Homeowner contact (optional) */}
          <div>
            <label className="text-sm font-medium block mb-1">Homeowner contact <span className="text-muted-foreground font-normal">(optional)</span></label>
            <p className="text-xs text-muted-foreground mb-2">If you have it, fill it in. When you approve this estimate it'll drop straight into <strong>Your Leads</strong> with these details.</p>
            <div className="space-y-2">
              <Input placeholder="Homeowner name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={120} autoComplete="name" />
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} type="tel" inputMode="tel" maxLength={40} autoComplete="tel" />
                <Input placeholder="Email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} type="email" inputMode="email" maxLength={200} autoComplete="email" />
              </div>
            </div>
          </div>

          {/* Diameter */}
          <div>
            <div className="flex items-center justify-between mb-2 gap-2">
              <div className="flex items-center gap-2">
                <Ruler className="w-4 h-4 text-primary" />
                <label className="text-sm font-medium">Trunk diameter calculator</label>
                <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              </div>
              <button type="button" onClick={() => setSeeHowOpen(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                <HelpCircle className="w-3.5 h-3.5" /> See how
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Optional — skip it and the AI will estimate size from the photo. For a tighter estimate, measure the <strong>circumference at chest height</strong> (about 4.5 ft off the ground) by wrapping a measuring tape around the trunk, then enter that number in inches.
            </p>
            <div className="flex items-center gap-2">
              <Input type="number" inputMode="decimal" min="0" step="0.1" placeholder="e.g. 62" value={circumference} onChange={(e) => setCircumference(e.target.value)} className="max-w-[160px]" />
              <span className="text-sm text-muted-foreground">inches around</span>
            </div>
            {diameter !== null && (
              <div className="mt-3 p-3 rounded-md bg-primary/10 border border-primary/20">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Diameter (DBH)</div>
                <div className="text-2xl font-bold text-primary">
                  {diameter.toFixed(1)}<span className="text-base font-medium ml-1">inches</span>
                </div>
              </div>
            )}
          </div>

          {/* Notes + voice */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Notes</label>
              <Button type="button" size="sm" variant={recording ? 'destructive' : 'outline'} onClick={toggleVoice}>
                {recording ? <MicOff className="w-4 h-4 mr-1" /> : <Mic className="w-4 h-4 mr-1" />}
                {recording ? 'Stop' : 'Voice'}
              </Button>
            </div>
            <Textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add notes about the tree, access, hazards, size, customer concerns, etc." maxLength={2000} />
            <p className="text-xs text-muted-foreground mt-1">We'll clean these notes into a short paragraph before sending.</p>
            {recording && (
              <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" /> Listening…
              </p>
            )}
          </div>

          {/* Estimator worksheet (optional) */}
          {!onFree && <ScoutWorksheetPanel key={pricingMode} value={worksheet} onChange={setWorksheet} rates={scoutRates} defaultOpen={pricingMode === 'manual'} />}

          {/* Need subs? */}
          <div>
            <label className="text-sm font-bold block mb-2">Do you need subs for this job?</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setNeedSubs(false)}
                className={cn('rounded-lg border-2 p-3 text-sm font-bold', !needSubs ? 'border-primary bg-primary/5' : 'border-input')}>
                No, my crew has it
              </button>
              <button type="button" onClick={() => setNeedSubs(true)}
                className={cn('rounded-lg border-2 p-3 text-sm font-bold', needSubs ? 'border-primary bg-primary/5' : 'border-input')}>
                Yes, I need help
              </button>
            </div>
            {needSubs && (
              <p className="text-xs mt-2">After you send this, we'll ask who you need, how many, for how long, and what to pay. We fill it in from your worksheet.</p>
            )}
          </div>

          <Button onClick={submit} className="w-full" size="lg" disabled={!canSubmit}>
            <Sparkles className="w-4 h-4 mr-2" /> Send to Scout
          </Button>
        </Card>
      )}

      {phase === 'input' && <RecentCaptures onOpen={openCapture} refreshKey={capture?.id ? 1 : 0} />}
      {phase === 'input' && <ScoutLearningCard />}

      {(phase === 'submitting' || phase === 'awaiting') && (
        <>
          {phase === 'awaiting' && (
            <Button variant="ghost" size="sm" onClick={startOver} className="mb-3 -ml-2">
              <ChevronLeft className="w-4 h-4 mr-1" /> Back to Scout
            </Button>
          )}
          <Card className="p-12 flex flex-col items-center text-center space-y-4">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <h2 className="text-xl font-semibold">
              {phase === 'submitting' ? 'Uploading…' : 'Analyzing tree…'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {phase === 'submitting'
                ? 'Sending photo, memo, and notes.'
                : 'Waiting for the AI estimate. This usually takes 30–60 seconds.'}
            </p>
            {capture?.notes_summary && phase === 'awaiting' && (
              <div className="w-full text-left mt-4 p-3 rounded-md bg-muted/40 border">
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Cleaned notes</div>
                <p className="text-sm">{capture.notes_summary}</p>
              </div>
            )}
            {capture && (
              <div className="w-full pt-4 border-t">
                <CaptureDetails capture={capture} photoUrls={capturePhotoUrls} />
              </div>
            )}
          </Card>
        </>
      )}

      {phase === 'review' && capture && (
        <>
          <Button variant="ghost" size="sm" onClick={startOver} className="mb-3 -ml-2">
            <ChevronLeft className="w-4 h-4 mr-1" /> Back to Scout
          </Button>
        </>
      )}
      {phase === 'review' && capture && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-2 text-primary">
            <CheckCircle2 className="w-5 h-5" />
            <span className="text-sm font-semibold">
              {((capture as any).requested_service === 'Pruning/Trimming' || (capture as any).ai_service === 'Pruning/Trimming')
                ? (isRepView
                  ? 'Pruning job saved — waiting for the business owner to schedule an on-site visit'
                  : 'Pruning job saved — schedule an on-site visit to price it')
                : isRepView
                  ? 'AI Estimate Ready — waiting for the business owner to review'
                  : 'AI Estimate Ready — review before sending to homeowner'}
            </span>
          </div>
            <CaptureDetails capture={capture} photoUrls={capturePhotoUrls} />

          {isRepView && (
            <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
              This estimate has been sent to your business owner for approval. You'll see the final approved price here once they sign off.
            </div>
          )}


          {capture.free_preview_locked ? (
            <LockedScoutEstimate service={capture.ai_service ?? capture.requested_service} />
          ) : isRepView ? null : !editing ? (
            <>
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Service</div>
                <div className="text-lg font-semibold">{capture.ai_service}</div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Estimate</div>
                  {capture.ai_price_max == null && capture.ai_price_min == null ? (
                    <div className="text-sm text-muted-foreground">AI estimates are available for removals and stump grinding. Pruning requires an on-site visit.</div>
                  ) : (
                    <div className="text-2xl font-bold text-primary">
                      ${Number(capture.ai_price_max ?? capture.ai_price_min ?? 0).toLocaleString()}
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  {capture.ai_difficulty && (
                    <div><span className="text-xs text-muted-foreground">Difficulty: </span><Badge variant="outline">{capture.ai_difficulty}</Badge></div>
                  )}
                  {capture.ai_risk && (
                    <div><span className="text-xs text-muted-foreground">Risk: </span>
                      <Badge variant={capture.ai_risk === 'High' ? 'destructive' : 'outline'} className="gap-1">
                        {capture.ai_risk === 'High' && <AlertTriangle className="w-3 h-3" />}{capture.ai_risk}
                      </Badge>
                    </div>
                  )}
                </div>
              </div>

              {capture.final_notes && capture.final_notes !== capture.ai_notes && (
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Final notes (sent to homeowner)</div>
                  <p className="text-sm bg-muted/40 p-3 rounded-md">{capture.final_notes}</p>
                </div>
              )}

              {/* Estimator worksheet cross-check */}
              <div className="pt-2">
                <ScoutWorksheetPanel
                  value={captureWorksheet}
                  onChange={(next) => setCapture({ ...capture, ...worksheetToRow(next, calculateWorksheet(next, scoutRates)) } as ScoutCapture)}
                  rates={scoutRates}
                  defaultOpen={captureWorksheetResult.hasInput}
                />
              </div>

              {captureWorksheetResult.hasInput && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">AI estimate</div>
                    <div className="text-xl font-bold">{rangeMoney(capture.ai_price_min, capture.ai_price_max)}</div>
                  </div>
                  <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Your worksheet</div>
                    <div className="text-xl font-bold text-primary">{money(captureWorksheetResult.total)}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{worksheetSummary(captureWorksheet)}</div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 pt-2">
                <Button variant="outline" onClick={() => {
                  setEditService(capture.final_service ?? capture.ai_service ?? '');
                  setEditPrice(String(capture.final_price_max ?? capture.final_price_min ?? capture.ai_price_max ?? capture.ai_price_min ?? ''));
                  setEditNotes(capture.final_notes ?? capture.ai_notes ?? '');
                  setEditing(true);
                }} disabled={saving}>
                  <Pencil className="w-4 h-4 mr-1" /> Request edit
                </Button>
                <Button onClick={() => handleApprove('ai')} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
                  {captureWorksheetResult.hasInput ? 'Use AI price' : 'Approve'}
                </Button>
                {captureWorksheetResult.hasInput && (
                  <Button className="col-span-2" variant="secondary" onClick={() => handleApprove('worksheet')} disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
                    Use worksheet price ({money(captureWorksheetResult.total)})
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-xs text-muted-foreground uppercase tracking-wide">Service</label>
                <select
                  value={editService}
                  onChange={(e) => setEditService(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Select service…</option>
                  {SERVICE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground uppercase tracking-wide">Price $</label>
                <Input type="number" inputMode="numeric" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground uppercase tracking-wide">Notes</label>
                <Textarea rows={4} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2 pt-2">
                <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                  <X className="w-4 h-4 mr-1" /> Cancel
                </Button>
                <Button onClick={handleSaveEdits} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                  Save edits
                </Button>
              </div>
            </>
          )}
        </Card>
      )}

      {phase === 'done' && capture && (
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={startOver} className="-ml-2">
            <ChevronLeft className="w-4 h-4 mr-1" /> Back to Scout
          </Button>
          <Card className="p-6 space-y-3 text-center">
            <CheckCircle2 className="w-10 h-10 text-primary mx-auto" />
            <h2 className="text-xl font-bold">
              {capture.status === 'approved' ? 'Estimate approved' : 'Edits saved'}
            </h2>
            <p className="text-sm text-muted-foreground">
              Final estimate: <strong>${Number(capture.final_price_max ?? capture.final_price_min ?? 0).toLocaleString()}</strong> · {capture.final_service}
            </p>
            <div className="text-xs text-muted-foreground">
              {capture.approved_at && format(new Date(capture.approved_at), 'PPp')}
            </div>
            <div className="pt-4 border-t">
              <CaptureDetails capture={capture} photoUrls={capturePhotoUrls} />
            </div>
          </Card>
          {!isRepView && (
            <Button className="w-full" onClick={() => setSubsSeed({
              captureId: capture.id,
              title: `${capture.final_service ?? capture.requested_service ?? 'Tree job'}${capture.address_city ? ` — ${capture.address_city}` : ''}`,
              description: capture.notes_summary ?? '',
              city: capture.address_city ?? '',
              climber: capture.wk_climber_required ?? true,
              groundCount: capture.wk_ground_crew ?? null,
              hours: capture.wk_hours ?? null,
              loads: capture.wk_loads ?? null,
              stump: !!capture.wk_stump,
              crane: !!capture.wk_crane_required,
              chipper: !!(capture as any).wk_chipper,
            })}>
              I need subs for this job
            </Button>
          )}
          <Button variant="outline" onClick={startOver} className="w-full">
            <RotateCcw className="w-4 h-4 mr-2" /> New capture
          </Button>
        </div>
      )}


      <RequestCrewBidsDialog seed={subsSeed} open={!!subsSeed} onOpenChange={(o) => !o && setSubsSeed(null)} />

      <Dialog open={seeHowOpen} onOpenChange={setSeeHowOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>How to measure trunk circumference</DialogTitle></DialogHeader>
          <img src={measureTreeImg} alt="Measuring tape wrapped around a tree trunk at chest height" className="w-full rounded-lg border object-contain bg-muted" />
          <ol className="text-sm space-y-2 list-decimal pl-5 text-foreground">
            <li>Pull a measuring tape around the tree trunk.</li>
            <li>Keep it level at <strong>chest height</strong> (about 4.5 ft off the ground).</li>
            <li>Note the measurement in <strong>inches</strong>.</li>
            <li>Enter that number into the field — we'll calculate the diameter for you.</li>
          </ol>
          <Button onClick={() => setSeeHowOpen(false)} className="w-full">Got it</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
