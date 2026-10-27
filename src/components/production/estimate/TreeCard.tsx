import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Camera, Loader2, Mic, Sparkles, Square, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { photoToDataUrl } from '@/components/production/setup/sheetFiles';
import { useVoiceRecorder } from './useVoiceRecorder';

export interface TreeDraft {
  key: string; label: string; location?: string; photos: string[]; voice: string | null; transcript?: string; notes?: string; uncertain?: string[];
}
export interface TreeFacts { label: string; services: string[]; facts: Record<string, { value: string | number | boolean | null; confidence: number }>; observations: string }
export interface AnalyzeResult { photoPaths: string[]; voicePath: string | null; transcript: string; trees: TreeFacts[] }

export function TreeCard({ tree, onChange, onRemove, analyze, saved, children }: {
  tree: TreeDraft; onChange: (t: TreeDraft) => void; onRemove: () => void;
  analyze: (input: { treeKey: string; photos: string[]; voice?: string; notes?: string }) => Promise<AnalyzeResult>;
  /** The photos already saved with the estimate. */
  saved?: ReactNode;
  children?: ReactNode;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const voice = useVoiceRecorder();
  const previews = useMemo(() => (typeof URL.createObjectURL === 'function' ? files.map((f) => URL.createObjectURL(f)) : []), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const run = async () => {
    setBusy(true);
    try {
      const photos = await Promise.all(files.slice(0, 4).map((f) => photoToDataUrl(f, 1600, 0.82)));
      const r = await analyze({ treeKey: tree.key, photos, voice: voice.dataUrl ?? undefined, notes: tree.notes?.trim() || undefined });
      onChange({
        ...tree, photos: [...tree.photos, ...r.photoPaths].slice(0, 10), voice: r.voicePath ?? tree.voice,
        transcript: r.transcript || tree.transcript, label: tree.label || r.trees[0]?.label || tree.label,
      });
      setFiles([]);
      voice.clear();
      toast.success(r.trees.length ? 'Filled in. Check anything outlined.' : 'Saved. Nothing to fill in from these.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not read these');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-3 space-y-3">
      <div className="flex gap-2">
        <Input value={tree.label} maxLength={60} placeholder="Tree 1, front yard oak..." aria-label="Tree name" onChange={(e) => onChange({ ...tree, label: e.target.value })} />
        <Button size="icon" variant="ghost" aria-label="Remove tree" onClick={onRemove}><Trash2 className="w-4 h-4" /></Button>
      </div>
      <Input value={tree.location ?? ''} maxLength={200} placeholder="Where on the property (rear yard, by the drive)" aria-label="Where on the property" onChange={(e) => onChange({ ...tree, location: e.target.value })} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1 text-sm cursor-pointer rounded-md border px-3 py-2 hover:bg-muted">
          <Camera className="w-4 h-4" /> Photos
          <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 4))} />
        </label>
        {voice.recording
          ? <Button type="button" size="sm" variant="destructive" onClick={voice.stop}><Square className="w-4 h-4 mr-1" />Stop</Button>
          : <Button type="button" size="sm" variant="outline" onClick={voice.start}><Mic className="w-4 h-4 mr-1" />{voice.dataUrl ? 'Record again' : 'Voice memo'}</Button>}
        {voice.dataUrl && !voice.recording && <span className="text-xs text-muted-foreground">Memo recorded</span>}
        <span className="text-xs text-muted-foreground">{tree.photos.length ? `${tree.photos.length} saved photo${tree.photos.length === 1 ? '' : 's'}` : ''}</span>
      </div>
      {voice.error && <p className="text-xs text-destructive">{voice.error}</p>}
      {saved}
      {previews.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">{previews.map((src, i) => <img key={i} src={src} alt={`New photo ${i + 1}`} className="h-20 w-20 rounded object-cover" />)}</div>
      )}
      <Textarea rows={2} maxLength={2000} placeholder="Notes, for example: large elm, three-man crew half a day, lift and mini, customer wants the stump ground" value={tree.notes ?? ''}
        onChange={(e) => onChange({ ...tree, notes: e.target.value })} aria-label="Notes" />
      {tree.transcript && <p className="text-xs text-muted-foreground">Memo: "{tree.transcript}"</p>}
      <Button type="button" size="sm" onClick={run} disabled={busy || (!files.length && !voice.dataUrl && !tree.notes?.trim())}>
        {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}Fill in with AI
      </Button>
      <p className="text-xs text-muted-foreground">The AI fills in the answers from your photos and words. The price comes from your company's rates, and you check every answer.</p>
      {children}
    </Card>
  );
}
