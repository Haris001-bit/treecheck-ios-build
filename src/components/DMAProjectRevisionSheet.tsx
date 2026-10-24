import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Mic, Square, Loader2, RotateCcw, AlertCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useSignedPhotoUrl } from '@/hooks/useSignedPhotoUrl';
import {
  PublishedProject,
  useProjectRevisions,
  useReviseProject,
  useRepublishProject,
} from '@/hooks/useDMAPublishedProjects';

function Photo({ path }: { path: string }) {
  const { signedUrl } = useSignedPhotoUrl(path);
  return (
    <div className="aspect-[4/3] rounded-lg overflow-hidden border border-border bg-muted">
      {signedUrl && <img src={signedUrl} alt="" className="w-full h-full object-contain" />}
    </div>
  );
}

interface Props {
  project: PublishedProject | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export default function DMAProjectRevisionSheet({ project, open, onOpenChange }: Props) {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [typedNote, setTypedNote] = useState('');
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const revise = useReviseProject();
  const republish = useRepublishProject();
  const { data: revisions } = useProjectRevisions(open ? project?.id ?? null : null);

  useEffect(() => {
    if (!isRecording) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [isRecording]);

  useEffect(() => {
    if (!open) {
      setAudioBlob(null);
      setTypedNote('');
      setSeconds(0);
    }
  }, [open]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        setAudioBlob(new Blob(chunksRef.current, { type: mime }));
        stream.getTracks().forEach((t) => t.stop());
      };
      recorderRef.current = rec;
      setSeconds(0);
      rec.start();
      setIsRecording(true);
    } catch {
      toast.error('Could not access the microphone. Please allow mic access.');
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    setIsRecording(false);
  };

  if (!project) return null;

  const copy = project.copy ?? {};
  const isBusy = revise.isPending || project.status === 'revising';

  const submit = () => {
    revise.mutate(
      { projectId: project.id, audioBlob, typedNote },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6">{project.title}</DialogTitle>
          <DialogDescription>
            {project.location ? `${project.location} · ` : ''}
            Published {new Date(project.published_at).toLocaleDateString()}
            {project.revision_count > 0 && ` · ${project.revision_count} update${project.revision_count > 1 ? 's' : ''}`}
          </DialogDescription>
        </DialogHeader>

        {project.photo_paths?.length > 0 && (
          <div className={`grid gap-2 ${project.photo_paths.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {project.photo_paths.slice(0, 4).map((p) => <Photo key={p} path={p} />)}
          </div>
        )}

        <div className="space-y-3">
          {copy.shortDescription && (
            <p className="text-sm text-foreground leading-relaxed">{copy.shortDescription}</p>
          )}
          {copy.intro && <p className="text-sm text-muted-foreground leading-relaxed">{copy.intro}</p>}
          {(copy.sections ?? []).map((s, i) => (
            <div key={i} className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {s.heading}
              </div>
              {s.paragraphs?.map((p, j) => (
                <p key={j} className="text-sm text-foreground leading-relaxed">{p}</p>
              ))}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {project.public_url && (
            <Button variant="outline" size="sm" asChild>
              <a href={project.public_url} target="_blank" rel="noopener noreferrer">
                View on your site <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
              </a>
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={republish.isPending || project.status === 'revising'}
            onClick={() => republish.mutate(project.id)}
            title="Re-publish this post to the same URL (no duplicate)"
          >
            {republish.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            )}
            Regenerate
          </Button>
        </div>

        {project.status === 'failed' && project.last_error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive flex gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>Last update failed: {project.last_error}</span>
          </div>
        )}

        {/* Voice-memo revision */}
        <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
          <div>
            <div className="text-sm font-semibold text-foreground">Need something fixed?</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Tap the mic and just say it — "we used a bucket truck, not a crane, and drop the part about the fence."
            </p>
          </div>

          {project.status === 'revising' ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Updating your page…
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  size="lg"
                  variant={isRecording ? 'destructive' : 'default'}
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={isBusy}
                  className="rounded-full h-14 w-14 p-0"
                >
                  {isRecording ? <Square className="h-5 w-5" /> : <Mic className="h-6 w-6" />}
                </Button>
                <div className="text-sm text-muted-foreground">
                  {isRecording
                    ? `Recording… ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
                    : audioBlob
                      ? 'Memo ready'
                      : 'Hold nothing — tap to start, tap again to stop'}
                </div>
                {audioBlob && !isRecording && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAudioBlob(null)}>
                    <RotateCcw className="h-3.5 w-3.5 mr-1" /> Redo
                  </Button>
                )}
              </div>

              <Textarea
                value={typedNote}
                onChange={(e) => setTypedNote(e.target.value)}
                placeholder="…or type the change instead (optional)"
                rows={2}
                disabled={isBusy}
              />

              <Button
                type="button"
                className="w-full"
                onClick={submit}
                disabled={isBusy || isRecording || (!audioBlob && !typedNote.trim())}
              >
                {revise.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Fixing it…</>
                ) : (
                  'Submit change'
                )}
              </Button>
            </>
          )}
        </div>

        {(revisions?.length ?? 0) > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Change history
            </div>
            {revisions!.map((r) => (
              <div key={r.id} className="text-xs text-muted-foreground border-l-2 border-border pl-3">
                <div className="flex items-center gap-2">
                  <span>{new Date(r.created_at).toLocaleString()}</span>
                  <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                </div>
                {r.transcript && <p className="mt-0.5 text-foreground">"{r.transcript}"</p>}
                {r.error && <p className="mt-0.5 text-destructive">{r.error}</p>}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
