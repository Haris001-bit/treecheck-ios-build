import { openOutside } from '@/lib/openOutside';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Copy, Download, Loader2, Mail, Save, X } from 'lucide-react';
import DMAJobSubmission from '@/components/DMAJobSubmission';
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

export const FIRST_IMPRESSION_REMINDER = 'This post can be published to your website automatically and instantly with a TreeCheck First Impression website, built by Trades Marketing AI.';
/**
 * On every copy-and-paste post (Mark, 2026-10-29): the same content can publish itself from a First Impression website.
 * The link shows in the phone apps too (Haris, 2026-11-06), opening in the in-app browser.
 */
export function FirstImpressionNote() {
  return <p className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm text-foreground">
    {FIRST_IMPRESSION_REMINDER}
    {' '}<a className="font-semibold text-primary underline" href="https://tradesmarketing.ai/dma-web" target="_blank" rel="noopener noreferrer"
      onClick={(e) => { e.preventDefault(); void openOutside('https://tradesmarketing.ai/dma-web'); }}>See how it works / Schedule a demo</a>
  </p>;
}

interface Post { id: string; title: string; article: string; google_caption: string; facebook_caption: string; instagram_caption: string; status: string; created_at: string; free_preview_locked?: boolean; photo_paths?: string[] }
/** The job photos go with the post (Mark, 2026-10-29): show them in order so the owner can download and add them to the page. */
function PostPhotos({ paths }: { paths: string[] }) {
  const { data: urls } = useQuery({ queryKey: ['dma-post-photos', ...paths], enabled: paths.length > 0, staleTime: 50 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from('lead-photos').createSignedUrls(paths, 3600);
      if (error) throw error;
      return (data ?? []).map(d => d.signedUrl).filter(Boolean) as string[];
    } });
  if (!paths.length) return null;
  const download = async (url: string, i: number) => {
    try {
      const blob = await (await fetch(url)).blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `job-photo-${i + 1}.jpg`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch { window.open(url, '_blank'); }
  };
  return <div className="space-y-2">
    <Label>Job photos ({paths.length})</Label>
    <p className="text-xs text-muted-foreground">Add these to your website page in this order. Photo 1 is the cover. Their descriptions (alt text) are at the end of the Website content.</p>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {paths.map((path, i) => <div key={path} className="space-y-1">
        <div className="aspect-square rounded-md border border-border bg-muted overflow-hidden">
          {urls?.[i] && <a href={urls[i]} target="_blank" rel="noopener noreferrer"><img src={urls[i]} alt={`Job photo ${i + 1}`} className="h-full w-full object-contain" /></a>}
        </div>
        <Button size="sm" variant="outline" className="w-full" disabled={!urls?.[i]} onClick={() => urls?.[i] && download(urls[i], i)}><Download className="h-3.5 w-3.5 mr-1" />Photo {i + 1}</Button>
      </div>)}
    </div>
  </div>;
}

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
  const { effectiveContractorId } = useAuth();
  // Free plan previews use the same form; the server returns only the start of each post.
  const canGenerate = fullAccess || freePreview;
  const [limitMessage, setLimitMessage] = useState('');
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Post | null>(null);
  const query = useQuery({ queryKey: ['dma-email-posts', effectiveContractorId], enabled: !!effectiveContractorId,
    queryFn: async () => {
      if (!effectiveContractorId) return [];
      const { data, error } = await supabase.from('dma_email_posts').select('id,title,article,google_caption,facebook_caption,instagram_caption,status,created_at,free_preview_locked,photo_paths').eq('contractor_id', effectiveContractorId).order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return data as Post[];
    } });
  // Photos are uploaded by the shared job screen (DMAJobSubmission), in the order shown.
  const generate = async ({ notes, neighborhood, photoPaths }: { notes: string; neighborhood: string; photoPaths: string[] }) => {
    setError(''); setLimitMessage('');
    try {
      const data = await action({ action: 'generate', notes, photo_paths: photoPaths, ...(neighborhood ? { neighborhood } : {}) });
      setSelected(data.post);
      qc.invalidateQueries({ queryKey: ['dma-email-posts'] });
      toast.success(data.post?.free_preview_locked ? 'Your preview is ready.' : 'Your draft is ready.', { description: FIRST_IMPRESSION_REMINDER });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not generate your post.';
      if (freePreview && /this month/.test(message)) { setLimitMessage(message); throw new Error('Free DMA previews used for this month.'); }
      throw e;
    } finally { if (freePreview) qc.invalidateQueries({ queryKey: ['free-plan'] }); }
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
    {!listOnly && <div className="space-y-4">
      <FirstImpressionNote />
      {freePreview && <FreeUsageNote kind="dma" />}
      {limitMessage && <FreePlanUpsell title="Free DMA previews used" body={limitMessage} />}
      {canGenerate
        ? <DMAJobSubmission submitPost={generate} />
        : <p className="text-sm text-muted-foreground">An active company trial or DMA access is required to create posts.</p>}
    </div>}
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
      <FirstImpressionNote />
      <div className="space-y-2"><Label htmlFor="dma-post-title">Title</Label><Input id="dma-post-title" maxLength={200} value={selected.title} onChange={e => setSelected({ ...selected, title: e.target.value })} /></div>
      <PostPhotos paths={selected.photo_paths ?? []} />
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