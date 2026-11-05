import { useState } from 'react';
import { Settings2 } from 'lucide-react';
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
  // A clone of the website-connected Marketing screen (Mark, 2026-10-29): same job form, posts below, brand voice setup button.
  return <div className="space-y-6">
    <DMAEmailPosts canGenerate={status.can_generate} freePreview={status.free_preview === true} />
    <Button variant="outline" onClick={() => setEditing(true)}><Settings2 className="h-4 w-4 mr-2" />Brand voice & marketing setup</Button>
  </div>;
}