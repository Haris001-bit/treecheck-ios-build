import DMAJobSubmission from '@/components/DMAJobSubmission';

/**
 * Read-only preview of <DMAJobSubmission /> for non-beta users.
 * Renders the real UI with interaction disabled (no demo video for now —
 * re-add the video dialog here once the new one is ready).
 */
export default function DMADemoPreview() {
  return (
    <div className="relative pointer-events-none select-none" aria-hidden="true">
      <DMAJobSubmission />
    </div>
  );
}
