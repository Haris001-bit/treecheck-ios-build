import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ImageOff, Loader2 } from 'lucide-react';
import { PhotoZoomDialog } from '@/components/PhotoZoomDialog';

/** One saved photo: signed on demand (the bucket is private), shown small, opened in the zoomable viewer. */
function Thumb({ scope, path, sign, onOpen }: { scope: string; path: string; sign: (path: string) => Promise<string>; onOpen: (url: string) => void }) {
  const q = useQuery({ queryKey: ['production-media', scope, path], queryFn: () => sign(path), staleTime: 50 * 60_000, retry: false });
  if (q.isLoading) return <div className="h-16 w-16 shrink-0 rounded bg-muted flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  if (!q.data) return <div className="h-16 w-16 shrink-0 rounded bg-muted flex items-center justify-center" title="This photo couldn't be opened"><ImageOff className="w-4 h-4 text-muted-foreground" /></div>;
  return (
    <button type="button" className="h-16 w-16 shrink-0 rounded overflow-hidden" onClick={() => onOpen(q.data!)} aria-label="Open photo">
      <img src={q.data} alt="" className="h-full w-full object-cover" />
    </button>
  );
}

export function PhotoStrip({ scope, paths, sign }: { scope: string; paths: string[]; sign: (path: string) => Promise<string> }) {
  const [open, setOpen] = useState<string | null>(null);
  const photos = paths.filter((p) => /\/photo-[^/]+$/.test(p));
  if (!photos.length) return null;
  return (
    <>
      <div className="flex gap-2 overflow-x-auto">{photos.map((p) => <Thumb key={p} scope={scope} path={p} sign={sign} onOpen={setOpen} />)}</div>
      <PhotoZoomDialog src={open} alt="Job photo" open={!!open} onOpenChange={(o) => !o && setOpen(null)} />
    </>
  );
}
