import { useState } from 'react';
import { PlayCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { assetUrl } from '@/lib/platform';
import jobsVideo from '@/assets/treecheck-jobs-explainer.mp4.asset.json';
import scoutVideo from '@/assets/treecheck-scout-explainer-portrait.mp4.asset.json';
import dmaVideo from '@/assets/treecheck-dma-explainer-portrait.mp4.asset.json';

/** Explainer video files per page. Add a CDN url (from a .asset.json pointer) to turn the link on. */
export const EXPLAINER_VIDEOS: Record<'jobs' | 'scout' | 'dma', { url: string | null; title: string; label: string }> = {
  jobs: { url: jobsVideo.url, title: 'How Jobs works', label: 'Watch the explainer video' },
  scout: { url: scoutVideo.url, title: 'How Scout works', label: 'Watch the explainer video' },
  dma: { url: dmaVideo.url, title: 'How the Digital Marketing Agent works', label: 'Watch the explainer video' },
};

export function ExplainerVideo({ video, label, className = '' }: {
  video: keyof typeof EXPLAINER_VIDEOS; label?: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { url, title, label: defaultLabel } = EXPLAINER_VIDEOS[video];
  if (!url) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 text-sm font-medium text-sky-600 hover:text-sky-500 hover:underline dark:text-sky-400 dark:hover:text-sky-300 ${className}`}>
        <PlayCircle className="w-4 h-4" />{label ?? defaultLabel}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        {/* The box shrinks to the video, so a tall phone-shaped clip isn't stranded in a wide frame. */}
        <DialogContent className="w-auto max-w-[96vw] p-1.5 sm:p-3">
          <DialogTitle className="sr-only">{title}</DialogTitle>
          {open && (
            // The phone apps load the file from the website (assetUrl), like the giveaway photo.
            <video src={assetUrl({ url })} controls autoPlay playsInline
              className="block h-[86vh] max-h-[86dvh] w-auto max-w-[92vw] rounded-md bg-muted" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
