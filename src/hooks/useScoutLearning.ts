import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useSaveCompanySettings } from "@/hooks/useCompanySettings";
import type { LearningReport } from "@/components/scout/scoutLearningText";

/**
 * Scout learning (the weekly feedback loop): the report for the signed-in user's own company (scout_learning_report
 * decides who may see it), the owner's on/off switch, and undo. Errors become toasts and never throw.
 */
export function useScoutLearning() {
  const { user, effectiveContractorId } = useAuth();
  const queryKey = ["scout-learning", effectiveContractorId ?? user?.id ?? null];
  const qc = useQueryClient();
  const save = useSaveCompanySettings();

  const report = useQuery({
    queryKey,
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)("scout_learning_report");
      if (error) throw error;
      return (data ?? { visible: false }) as LearningReport;
    },
    // While the first run is being worked out, check back every minute.
    refetchInterval: (query) => ((query.state.data as LearningReport | undefined)?.pending_first_run ? 60_000 : false),
  });

  const toggle = async (on: boolean) => {
    try {
      await save.mutateAsync({ scout_learning_enabled: on });
      await qc.invalidateQueries({ queryKey });
      toast.success(on
        ? "Scout learning is on. Its first report is ready in a few minutes."
        : "Scout learning is off. Scout is back to its standard pricing.");
    } catch {
      toast.error("Couldn't save that. Try again.");
    }
  };

  const undo = async (surface: "scout" | "website") => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)("scout_learning_undo", { p_surface: surface });
    if (error || !(data as { ok?: boolean } | null)?.ok) {
      toast.error((data as { reason?: string } | null)?.reason === "nothing_to_undo"
        ? "There's nothing to undo right now."
        : "Couldn't undo that. Try again.");
      return;
    }
    await qc.invalidateQueries({ queryKey });
    toast.success("Done. Scout is back to the adjustments it used before.");
  };

  // The report's photos are signed by scout-learning-photos (a rep's photo is in their own folder, which the owner's
  // browser can't read), once, the first time someone opens a job.
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [photosAsked, setPhotosAsked] = useState(false);
  const loadPhotos = useCallback(async () => {
    if (photosAsked) return;
    setPhotosAsked(true);
    const refs = [...new Set((report.data?.scout?.runs ?? []).flatMap((r) => r.jobs ?? [])
      .filter((j) => j.has_photo).map((j) => j.ref))].slice(0, 40);
    if (!refs.length) return;
    const { data, error } = await supabase.functions.invoke("scout-learning-photos", { body: { refs } });
    if (!error && data && typeof data.photos === "object") setPhotos(data.photos as Record<string, string>);
  }, [photosAsked, report.data]);

  return { report, toggle, undo, saving: save.isPending, photos, loadPhotos };
}
