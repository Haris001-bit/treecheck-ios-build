import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';

export interface PublishedProjectCopy {
  slug?: string;
  title?: string;
  shortDescription?: string;
  intro?: string;
  sections?: { heading: string; paragraphs: string[] }[];
  ctaHeadline?: string;
  ctaSub?: string;
}

export interface PublishedProject {
  id: string;
  contractor_id: string;
  slug: string;
  title: string;
  location: string | null;
  service_category: string | null;
  public_url: string | null;
  photo_paths: string[];
  copy: PublishedProjectCopy;
  status: 'published' | 'revising' | 'failed';
  revision_count: number;
  last_error: string | null;
  published_at: string;
  updated_at: string;
}

export interface ProjectRevision {
  id: string;
  project_id: string;
  transcript: string | null;
  status: string;
  error: string | null;
  created_at: string;
}

export function useDMAPublishedProjects() {
  const { user, effectiveContractorId } = useAuth();
  const cid = effectiveContractorId ?? user?.id;

  return useQuery({
    queryKey: ['dma-published-projects', cid],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dma_published_projects' as any)
        .select('*')
        .order('published_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PublishedProject[];
    },
    enabled: !!cid,
    // Poll while any post is mid-revision so the corrected copy appears on its own.
    refetchInterval: (query) => {
      const rows = query.state.data as PublishedProject[] | undefined;
      return rows?.some((r) => r.status === 'revising') ? 5000 : false;
    },
  });
}

export function useProjectRevisions(projectId: string | null) {
  return useQuery({
    queryKey: ['dma-project-revisions', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dma_project_revisions' as any)
        .select('id, project_id, transcript, status, error, created_at')
        .eq('project_id', projectId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ProjectRevision[];
    },
    enabled: !!projectId,
  });
}

/**
 * Sends a casual voice memo ("we used a bucket truck, not a crane") and has the
 * DMA rewrite + re-publish the live page at the same URL.
 */
export function useReviseProject() {
  const queryClient = useQueryClient();
  const { user, effectiveContractorId } = useAuth();
  const cid = effectiveContractorId ?? user?.id;

  return useMutation({
    mutationFn: async ({
      projectId,
      audioBlob,
      typedNote,
    }: {
      projectId: string;
      audioBlob?: Blob | null;
      typedNote?: string;
    }) => {
      let voice_memo_path: string | undefined;

      if (audioBlob) {
        const ext = audioBlob.type.includes('mp4') ? 'mp4' : 'webm';
        voice_memo_path = `dma/memos/${cid}/${projectId}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('lead-photos')
          .upload(voice_memo_path, audioBlob, {
            contentType: audioBlob.type || 'audio/webm',
            upsert: true,
          });
        if (upErr) throw new Error(`Could not upload the memo: ${upErr.message}`);
      }

      if (!voice_memo_path && !typedNote?.trim()) {
        throw new Error('Record a memo (or type the change) first.');
      }

      const { data, error } = await supabase.functions.invoke('dma-publish-project', {
        body: {
          project_id: projectId,
          voice_memo_path,
          transcript: typedNote?.trim() || undefined,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { success: boolean; url: string; title: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dma-published-projects'] });
      queryClient.invalidateQueries({ queryKey: ['dma-project-revisions'] });
      toast.success('Updated — your live page now reflects the change.');
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ['dma-published-projects'] });
      toast.error(error.message || 'Could not apply the change');
    },
  });
}

/**
 * Re-pushes the existing copy to the contractor's site at the same slug.
 * No AI rewrite, no new post — the live page is overwritten in place.
 */
export function useRepublishProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (projectId: string) => {
      const { data, error } = await supabase.functions.invoke('dma-publish-project', {
        body: { project_id: projectId, republish: true },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { success: boolean; url: string; title: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dma-published-projects'] });
      toast.success('Re-published — same URL, no duplicate post.');
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ['dma-published-projects'] });
      toast.error(error.message || 'Could not re-publish');
    },
  });
}
