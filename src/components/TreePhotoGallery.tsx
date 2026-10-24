import { useEffect, useState } from 'react';
import { fetchBidPhotoSet, getCachedBidPhotoSet, type BidPhotoSet, type BidTree } from '@/hooks/useCrew';

/**
 * Photo strip grouped by tree for multi-tree pruning jobs.
 * Renders nothing for single-tree jobs.
 */
export function TreePhotoGallery({
  requestId,
  trees,
  onZoom,
}: {
  requestId: string;
  trees: BidTree[] | null | undefined;
  onZoom: (src: string, alt: string) => void;
}) {
  const [set, setSet] = useState<BidPhotoSet | undefined>(() => getCachedBidPhotoSet(requestId));
  const hasTrees = Array.isArray(trees) && trees.length > 1;

  useEffect(() => {
    if (!hasTrees || (set && set.urls.length > 0)) return;
    let alive = true;
    fetchBidPhotoSet(requestId).then((s) => { if (alive) setSet(s); });
    return () => { alive = false; };
  }, [requestId, hasTrees, set]);

  if (!hasTrees) return null;
  const urls = set?.urls ?? [];

  return (
    <div className="space-y-3 p-3 border-t">
      <div className="text-sm font-black">{trees!.length} trees on this job</div>
      {trees!.map((t, ti) => (
        <div key={ti} className="space-y-1">
          <div className="text-xs font-medium">
            {t.label || `Tree ${ti + 1}`}
            {t.note ? <span className="font-normal text-muted-foreground"> — {t.note}</span> : null}
          </div>
          <div className="flex gap-2 overflow-x-auto">
            {t.photo_indexes.map((pi) => {
              const src = urls[pi];
              return src ? (
                <button
                  key={pi}
                  type="button"
                  onClick={() => onZoom(src, `${t.label || `Tree ${ti + 1}`} photo`)}
                  className="shrink-0 cursor-zoom-in"
                  aria-label={`Zoom ${t.label || `Tree ${ti + 1}`} photo`}
                >
                  <img src={src} alt={`${t.label} photo`} className="h-20 w-20 rounded-md border object-contain bg-muted" />
                </button>
              ) : (
                <div key={pi} className="h-20 w-20 shrink-0 rounded-md border bg-muted" />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
