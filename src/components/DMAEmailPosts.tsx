import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Camera, ChevronLeft, ChevronRight, Copy, GripVertical, Loader2, Mail, Mic, Save, Square, X } from 'lucide-react';
import { useSpeechRecognition } from '@/hooks/useAudioRecorder';
import { FreeUsageNote } from '@/components/free/FreeUsageNote';
import { FreePlanUpsell } from '@/components/free/FreePlanUpsell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';
import { movePhotoInOrder, uploadPhotosInOrder } from '@/lib/dmaPhotoOrder';

interface Post { id: string; title: string; article: string; google_caption: string; facebook_caption: string; instagram_caption: string; status: string; created_at: string; free_preview_locked?: boolean }
async function action(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('dma-email-content', { body });
  if (error instanceof FunctionsHttpError) {
    const detail = await error.context.json().catch(() => null);
    throw new Error(detail?.error || 'Could not prepare this post.');
  }
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}
export default function DMAEmailPosts({ canGenerate: fullAccess, freePreview = false, listOnly = false }: { canGenerate: boolean; freePreview?: boolean; listOnly?: boolean }) {
  const { user, effectiveContractorId } = useAuth();
  // Free plan previews use the same form; the server returns only the start of each post.
  const canGenerate = fullAccess || freePreview;
  const [limitMessage, setLimitMessage] = useState('');
  const speech = useSpeechRecognition();
  const toggleMemo = () => {
    if (speech.isListening) {
      speech.stopListening();
      const said = speech.transcript.trim();
      if (said) setNotes(current => (current.trim() ? `${current.trim()} ${said}` : said).slice(0, 5000));
      speech.resetTranscript();
    } else {
      speech.resetTranscript();
      void speech.startListening();
    }
  };
  const qc = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const dragIndex = useRef<number | null>(null);
  useEffect(() => {
    const urls = files.map(file => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, [files]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Post | null>(null);
  const query = useQuery({ queryKey: ['dma-email-posts', effectiveContractorId], enabled: !!effectiveContractorId,
    queryFn: async () => {
      if (!effectiveContractorId) return [];
      const { data, error } = await supabase.from('dma_email_posts').select('id,title,article,google_caption,facebook_caption,instagram_caption,status,created_at,free_preview_locked').eq('contractor_id', effectiveContractorId).order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return data as Post[];
    } });
  const generate = async () => {
    setError('');
    if (!user || !notes.trim() || files.length === 0 || notes.length > 5000) { setError('Add at least one job photo and a short note.'); return; }
    setBusy(true);
    try {
      const jobId = crypto.randomUUID();
      const paths = await uploadPhotosInOrder(files, async (file, i) => {
        if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('Use JPG, PNG or WebP photos under 10 MB.');
        const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
        const path = `dma/${user.id}/${jobId}/photo-${i + 1}.${ext}`;
        const { error } = await supabase.storage.from('lead-photos').upload(path, file, { contentType: file.type });
        if (error) throw error;
        return path;
      });
      const data = await action({ action: 'generate', notes: notes.trim(), photo_paths: paths });
      setSelected(data.post);
      qc.invalidateQueries({ queryKey: ['dma-email-posts'] });
      toast.success(data.post?.free_preview_locked ? 'Your preview is ready.' : 'Your draft is ready.');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not generate your post.';
      if (freePreview && /this month/.test(message)) setLimitMessage(message); else setError(message);
    }
    finally { setBusy(false); if (freePreview) qc.invalidateQueries({ queryKey: ['free-plan'] }); }
  };
  const save = async () => {
    if (!selected) return;
    setSaving(true); setError('');
    try {
      const { title, article, google_caption, facebook_caption, instagram_caption } = selected;
      await action({ action: 'save', id: selected.id, content: { title, article, google_caption, facebook_caption, instagram_caption } });
      qc.invalidateQueries({ queryKey: ['dma-email-posts'] }); toast.success('Content saved.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save content.'); }
    finally { setSaving(false); }
  };
  const sections = [['article','Website'],['google_caption','Google'],['facebook_caption','Facebook'],['instagram_caption','Instagram']] as const;
  if (listOnly && !query.data?.length) return null;
  return <div className="space-y-7">
    {!listOnly && <section className="space-y-4">
      <h2 className="text-lg font-semibold flex items-center gap-2"><Camera className="h-5 w-5 text-primary" />Create a job post</h2>
      {freePreview && <FreeUsageNote kind="dma" />}
      {limitMessage && <FreePlanUpsell title="Free DMA previews used" body={limitMessage} />}
      <div className="space-y-2"><Label htmlFor="dma-email-photos">Job photos</Label><Input id="dma-email-photos" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy || !canGenerate}
        onChange={e => { const chosen = Array.from(e.target.files || []); if (chosen.length > 4) { setError('Choose up to four photos.'); return; } setFiles(chosen); }} />
        <p className="text-xs text-muted-foreground">Drag and drop photos into the proper order before submitting. The first photo is the cover; photos are sent in the order shown. You can also use the arrows.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {files.map((file, index) => <div key={`${file.name}-${index}`} className="min-w-0 space-y-1" draggable={!busy && canGenerate}
            onDragStart={event => { dragIndex.current = index; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)); }}
            onDragEnd={() => { dragIndex.current = null; }}
            onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
            onDrop={event => { event.preventDefault(); const from = dragIndex.current; dragIndex.current = null; if (!busy && canGenerate && from !== null) setFiles(current => movePhotoInOrder(current, from, index)); }}>
            <div className="relative aspect-square rounded-md border border-border bg-muted overflow-hidden cursor-move">
              <img src={previews[index]} alt={`Job photo ${index + 1}: ${file.name}`} className="w-full h-full object-contain pointer-events-none" />
              <span className="absolute top-1 left-1 text-xs px-1.5 py-0.5 rounded bg-background/90 text-foreground">{index === 0 ? '1 · Cover' : index + 1}</span>
              <GripVertical className="absolute top-2 right-2 h-4 w-4 text-foreground" />
              <div className="absolute bottom-1 left-1 right-1 flex justify-between">
                <Button size="icon" variant="outline" className="h-7 w-7" disabled={busy || !canGenerate || index === 0} aria-label={`Move photo ${index + 1} earlier`} title="Move earlier" onClick={() => setFiles(current => movePhotoInOrder(current, index, index - 1))}><ChevronLeft className="h-4 w-4" /></Button>
                <Button size="icon" variant="outline" className="h-7 w-7" disabled={busy || !canGenerate || index === files.length - 1} aria-label={`Move photo ${index + 1} later`} title="Move later" onClick={() => setFiles(current => movePhotoInOrder(current, index, index + 1))}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground truncate" title={file.name}>{file.name}</p>
          </div>)}
        </div>
      </div>
      <div className="space-y-2"><Label htmlFor="dma-email-notes">What did you do on this job?</Label><Textarea id="dma-email-notes" rows={4} maxLength={5000} value={speech.isListening ? `${notes}${notes && speech.transcript ? ' ' : ''}${speech.transcript}` : notes} onChange={e => setNotes(e.target.value)} disabled={busy || !canGenerate || speech.isListening} />
        <Button type="button" variant="outline" size="sm" disabled={busy || !canGenerate} onClick={toggleMemo}>{speech.isListening ? <><Square className="h-4 w-4 mr-2" />Stop voice memo</> : <><Mic className="h-4 w-4 mr-2" />Record a voice memo</>}</Button>
        <p className="text-xs text-muted-foreground">Talk about the job; your words are typed into the notes.</p></div>
      <Button disabled={busy || !canGenerate || files.length === 0 || !notes.trim()} onClick={generate}>{busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{busy ? 'Writing your content…' : 'Generate content'}</Button>
      {!canGenerate && <p className="text-sm text-muted-foreground">An active company trial or DMA access is required to create posts.</p>}
    </section>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {selected?.free_preview_locked && <section className="space-y-4 border-t border-border pt-5">
      <div className="flex justify-between items-start gap-3"><h2 className="text-lg font-semibold">Your post preview</h2><Button size="icon" variant="ghost" aria-label="Close preview" onClick={() => setSelected(null)}><X className="h-4 w-4" /></Button></div>
      <h3 className="text-xl font-bold break-words">{selected.title}</h3>
      <p className="text-sm whitespace-pre-wrap">{selected.article}</p>
      <div aria-hidden="true" className="space-y-2 blur-sm select-none text-sm text-muted-foreground">
        <p>The rest of your job story continues here with the work you did, how the crew protected the yard and how the job wrapped up for the homeowner.</p>
        <p>Google, Facebook and Instagram captions are written for each platform and ready to copy.</p>
      </div>
      <FreePlanUpsell title="DMA wrote your full post" body="Start your 14-day free trial to get the full post: the whole job story plus Google, Facebook and Instagram captions." />
    </section>}
    {selected && !selected.free_preview_locked && <section className="space-y-4 border-t border-border pt-5">
      <div className="flex justify-between items-start gap-3"><h2 className="text-lg font-semibold">Review your content</h2><Button size="icon" variant="ghost" aria-label="Close content editor" onClick={() => setSelected(null)}><X className="h-4 w-4" /></Button></div>
      <div className="space-y-2"><Label htmlFor="dma-post-title">Title</Label><Input id="dma-post-title" maxLength={200} value={selected.title} onChange={e => setSelected({ ...selected, title: e.target.value })} /></div>
      <Tabs defaultValue="article"><TabsList className="w-full grid grid-cols-4">{sections.map(([key, title]) => <TabsTrigger key={key} value={key} className="px-1 text-xs sm:text-sm">{title}</TabsTrigger>)}</TabsList>
        {sections.map(([key, title]) => <TabsContent key={key} value={key} className="space-y-3"><Label htmlFor={`dma-post-${key}`}>{title} content</Label><Textarea id={`dma-post-${key}`} rows={10} maxLength={key === 'article' ? 20000 : 5000} value={selected[key]} onChange={e => setSelected({ ...selected, [key]: e.target.value })} /><Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(selected[key]); toast.success('Copied.'); } catch { toast.error('Could not copy. Select the content to copy it.'); } }}><Copy className="h-4 w-4 mr-2" />Copy {title} content</Button></TabsContent>)}
      </Tabs>
      <div className="flex flex-wrap gap-2"><Button disabled={saving || !canGenerate} onClick={save}>{saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}Save changes</Button><Button variant="outline" disabled title="Awaiting sender-domain setup"><Mail className="h-4 w-4 mr-2" />Email this post</Button></div>
      <p className="text-sm text-muted-foreground">Email delivery is awaiting sender setup. Your draft is saved and ready to copy.</p>
    </section>}
    <section className="space-y-3 border-t border-border pt-5"><h2 className="text-lg font-semibold">Saved content</h2>
      {query.isLoading && <p className="text-muted-foreground text-sm">Loading saved content…</p>}
      {query.error && <p role="alert" className="text-destructive text-sm">Could not load saved content.</p>}
      {query.data?.length === 0 && <p className="text-sm text-muted-foreground">No posts yet.</p>}
      {query.data?.map(post => <div key={post.id} className="flex justify-between items-center gap-3 border-b border-border py-3"><div className="min-w-0"><p className="font-medium break-words">{post.title}</p><p className="text-xs text-muted-foreground mt-1">{new Date(post.created_at).toLocaleDateString()} · {post.free_preview_locked ? 'preview' : post.status}</p></div><Button variant="outline" size="sm" onClick={() => setSelected({ ...post })}>Open</Button></div>)}
    </section>
  </div>;
}