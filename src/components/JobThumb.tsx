import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { fetchBidPhotoSet, getCachedBidPhotoSet } from '@/hooks/useCrew';
import { cn } from '@/lib/utils';

/** Small square job photo that loads only once it scrolls into view. */
export function JobThumb({
  requestId,
  hasPhoto,
  known,
  onLoaded,
  treeCount,
  className,
}: {
  requestId: string;
  hasPhoto: boolean;
  known: string | null | undefined;
  onLoaded: (id: string, url: string | null) => void;
  treeCount?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  // Small resized version for the square; the full photo stays for the zoom view.
  const [thumb, setThumb] = useState<string | null>(() => getCachedBidPhotoSet(requestId)?.thumb ?? null);

  useEffect(() => {
    if (!hasPhoto || known !== undefined || !ref.current) return;
    const el = ref.current;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasPhoto, known]);

  useEffect(() => {
    if (!visible || known !== undefined) return;
    let alive = true;
    fetchBidPhotoSet(requestId).then((set) => {
      if (!alive) return;
      if (set.thumb) setThumb(set.thumb);
      onLoaded(requestId, set.cover);
    });
    return () => { alive = false; };
  }, [visible, known, requestId, onLoaded]);

  const shown = thumb ?? known ?? null;

  return (
    <div ref={ref} className={cn('relative shrink-0 w-16 h-16 rounded-md border bg-muted overflow-hidden flex items-center justify-center', className)}>
      {shown ? (
        <img src={shown} alt="" loading="lazy" className="w-full h-full object-cover" />
      ) : (
        <ImageIcon className="w-5 h-5 text-muted-foreground opacity-60" />
      )}
      {treeCount && treeCount > 1 ? (
        <span className="absolute bottom-0 inset-x-0 bg-foreground/70 text-background text-[9px] font-bold text-center leading-4">
          {treeCount} trees
        </span>
      ) : null}
    </div>
  );
}
