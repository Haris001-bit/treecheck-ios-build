import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, ChevronRight, FileText } from 'lucide-react';
import { PublishedProject, useDMAPublishedProjects } from '@/hooks/useDMAPublishedProjects';
import DMAProjectRevisionSheet from './DMAProjectRevisionSheet';

export default function DMAPublishedPosts() {
  const { data: projects, isLoading } = useDMAPublishedProjects();
  const [selected, setSelected] = useState<PublishedProject | null>(null);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!projects || projects.length === 0) return null;

  // Keep the sheet bound to fresh data so a completed revision updates in place.
  const active = selected ? projects.find((p) => p.id === selected.id) ?? selected : null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Published posts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {projects.map((p) => (
            <div
              key={p.id}
              className="w-full flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted/60 transition-colors"
            >
              <button
                type="button"
                onClick={() => setSelected(p)}
                className="min-w-0 flex-1 flex items-center gap-3 text-left"
              >
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground truncate">{p.title}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {p.location ? `${p.location} · ` : ''}
                    {new Date(p.published_at).toLocaleDateString()}
                  </div>
                </div>
              </button>
              {p.status === 'revising' && (
                <Badge variant="outline" className="text-[10px] shrink-0">
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Updating
                </Badge>
              )}
              {p.status === 'failed' && (
                <Badge variant="destructive" className="text-[10px] shrink-0">Needs attention</Badge>
              )}
              <button type="button" onClick={() => setSelected(p)} aria-label="Open post">
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            </div>
          ))}
        </CardContent>
      </Card>

      <DMAProjectRevisionSheet
        project={active}
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
      />
    </>
  );
}
