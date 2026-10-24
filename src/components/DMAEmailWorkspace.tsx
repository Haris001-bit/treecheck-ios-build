import { useState } from 'react';
import { Mail, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDMASetup } from '@/hooks/useDMASetup';
import DMASetupForm from './DMASetupForm';
import DMAEmailPosts from './DMAEmailPosts';

export default function DMAEmailWorkspace() {
  const query = useDMASetup();
  const [editing, setEditing] = useState(false);
  if (query.isLoading) return <p className="text-muted-foreground">Loading marketing setup…</p>;
  if (query.error) return <div className="space-y-3"><p role="alert" className="text-destructive">{query.error.message}</p><Button variant="outline" onClick={() => query.refetch()}>Try again</Button></div>;
  if (!query.data) return null;
  const status = query.data;
  if (editing) return <DMASetupForm status={status} onDone={() => { setEditing(false); query.refetch(); }} />;
  // Setup comes first for full DMA; posts made earlier (e.g. Free previews unlocked by the trial) stay readable below.
  if (!status.setup?.completed_at && !status.free_preview) return <div className="space-y-8">
    <DMASetupForm status={status} onDone={() => { setEditing(false); query.refetch(); }} />
    <DMAEmailPosts canGenerate={false} listOnly />
  </div>;
  // Free plan previews can start right away; brand voice setup is optional and makes the posts sound like them.
  if (!status.setup?.completed_at) return <div className="space-y-6">
    <section className="space-y-2 border-b border-border pb-5">
      <p className="text-sm text-muted-foreground">Try it now: add job photos and a voice memo or a few notes. Set up your brand voice any time to make posts sound like you.</p>
      <Button variant="outline" onClick={() => setEditing(true)}><Settings2 className="h-4 w-4 mr-2" />Set up your brand voice</Button>
    </section>
    <DMAEmailPosts canGenerate={false} freePreview />
  </div>;
  return <div className="space-y-6">
    <section className="space-y-3 border-b border-border pb-5">
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Your marketing setup</h2><p className="text-sm text-muted-foreground break-words mt-2 flex items-start gap-2"><Mail className="h-4 w-4 shrink-0 mt-0.5" />{status.setup.delivery_email}</p></div>
        <Button variant="outline" size="icon" aria-label="Edit marketing setup" title="Edit marketing setup" onClick={() => setEditing(true)}><Settings2 className="h-4 w-4" /></Button>
      </div>
      <p className="text-sm text-muted-foreground">{status.setup.company_name} · {status.setup.service_area}</p>
      {status.trial_ends_at && <p className="text-sm text-primary">Unlimited posts during your current 14-day trial, ending {new Date(status.trial_ends_at).toLocaleDateString()}.</p>}
    </section>
    <DMAEmailPosts canGenerate={status.can_generate} freePreview={status.free_preview === true} />
  </div>;
}