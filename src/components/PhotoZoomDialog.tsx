import { useCallback, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { ArrowLeft, ZoomIn, ZoomOut, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Full-screen photo viewer with pinch (touch), wheel, and double-tap zoom.
 * Opened by tapping a job photo.
 */
export function PhotoZoomDialog({
  src,
  alt,
  open,
  onOpenChange,
}: {
  src: string | null;
  alt: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const photoHistoryEntry = useRef(false);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    if (!open) return;

    window.history.pushState({ ...window.history.state, treecheckPhotoViewer: true }, '');
    photoHistoryEntry.current = true;

    const handleBack = () => {
      photoHistoryEntry.current = false;
      onOpenChangeRef.current(false);
    };

    window.addEventListener('popstate', handleBack);
    return () => window.removeEventListener('popstate', handleBack);
  }, [open]);

  const closeViewer = useCallback(() => {
    if (photoHistoryEntry.current) {
      window.history.back();
      return;
    }
    onOpenChangeRef.current(false);
  }, []);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) closeViewer(); }}>
      <DialogContent className="max-w-[100vw] w-[100vw] h-[100dvh] p-0 border-0 bg-foreground/95 [&>button]:hidden">
        <DialogTitle className="sr-only">{alt}</DialogTitle>
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={closeViewer}
            className="absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-30 h-11 gap-2 px-4 shadow-lg"
            aria-label="Back to jobs"
          >
            <ArrowLeft className="h-5 w-5" />
            Back to jobs
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            onClick={closeViewer}
            className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-30 h-11 w-11 shadow-lg"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>
        {src && (
          <TransformWrapper
            key={src}
            initialScale={1}
            minScale={0.5}
            maxScale={6}
            doubleClick={{ mode: 'reset' }}
            wheel={{ step: 0.15 }}
            pinch={{ step: 5 }}
            centerZoomedOut
          >
            {({ zoomIn, zoomOut, resetTransform }) => (
              <>
                <TransformComponent
                  wrapperClass="!w-full !h-full"
                  contentClass="!w-full !h-full flex items-center justify-center"
                >
                  <img
                    src={src}
                    alt={alt}
                    className="max-w-full max-h-full object-contain select-none"
                    draggable={false}
                  />
                </TransformComponent>
                <div className="absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-20 flex gap-2">
                  <Button size="icon" variant="secondary" className="rounded-full" onClick={() => zoomOut()} aria-label="Zoom out">
                    <ZoomOut className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="secondary" className="rounded-full" onClick={() => resetTransform()} aria-label="Reset zoom">
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="secondary" className="rounded-full" onClick={() => zoomIn()} aria-label="Zoom in">
                    <ZoomIn className="w-4 h-4" />
                  </Button>
                </div>
              </>
            )}
          </TransformWrapper>
        )}
      </DialogContent>
    </Dialog>
  );
}
