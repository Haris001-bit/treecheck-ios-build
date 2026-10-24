// Scout learning (the weekly feedback loop) on the Scout screen: the owner's switch, the latest report, undo, the
// current adjustments and earlier weeks. ScoutLearningView is pure (tests render it); ScoutLearningCard wires the hook.
import { useState } from "react";
import { ChevronDown, GraduationCap, Loader2, Undo2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useScoutLearning } from "@/hooks/useScoutLearning";
import {
  crewText, dateLabel, factorSentence, gapText, INTRO, latestRun, overallGap, PENDING, projectedGap, runTitle, statusLine,
  TEAM_OFF, UNDO_CONFIRM, usd, type LearningReport, type LearnJob, type SurfaceReport,
} from "./scoutLearningText";

type Surface = "scout" | "website";
/** Signed photo links by job (capture id), from scout-learning-photos. */
export type JobPhotos = Record<string, string>;

/** One job of a report; tap it for its photo, Scout's own notes and the crew's numbers. */
function JobRow({ job, photo, onOpen }: { job: LearnJob; photo?: string; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const crew = crewText(job.crew);
  const hasDetails = !!(job.notes || crew || job.has_photo);
  return (
    <li className="py-2 border-b last:border-b-0">
      <button type="button" className="w-full text-left" disabled={!hasDetails}
        onClick={() => { setOpen((o) => !o); if (!open) onOpen?.(); }}>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-medium truncate">{job.service}{job.city ? `, ${job.city}` : ""}</span>
          <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
            {dateLabel(job.picked_on)}
            {hasDetails && <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>Scout {job.estimate_low !== job.estimate_high ? `${usd(job.estimate_low)} to ${usd(job.estimate_high)}` : usd(job.estimate)}</span>
          <span>Picked {usd(job.picked)}</span>
          <span className="font-medium text-foreground">{gapText(job.gap_pct)}</span>
          {job.auto && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">auto-picked</Badge>}
          {job.size_given === false && <Badge variant="outline" className="text-[10px] px-1.5 py-0">no size given</Badge>}
        </div>
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-xs">
          {photo && <img src={photo} alt="The tree" className="w-full max-h-48 object-cover rounded-md border" loading="lazy" />}
          {crew && <p><span className="font-medium">Crew's offer:</span> {crew}</p>}
          {job.notes && (
            <div>
              <div className="font-medium">Scout's notes{job.may_include_edit ? " (may include your edit)" : ""}</div>
              <p className="whitespace-pre-line text-muted-foreground">{job.notes}</p>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function SurfaceSection({ title, surface, data, isOwner, onUndo, photos, onPhotos }: {
  title: string | null; surface: Surface; data: SurfaceReport; isOwner: boolean; onUndo: (s: Surface) => void;
  photos?: JobPhotos; onPhotos?: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const { latest, working } = latestRun(data.runs);
  if (!latest) return working ? <p className="text-sm text-muted-foreground border-t pt-3">{PENDING}</p> : null;
  const earlier = data.runs.filter((r) => r.id !== latest.id && r.status !== "running");
  const guidance = data.active?.guidance ?? null;
  const canUndo = isOwner && data.can_undo && latest.active && latest.status === "rewritten";

  return (
    <div className="space-y-3 border-t pt-3">
      {title && <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>}
      <div>
        <div className="font-medium">{runTitle(latest, true)}</div>
        <p className="text-sm text-muted-foreground">{statusLine(latest)}</p>
        {working && <p className="text-xs text-muted-foreground mt-1">A newer report is being worked out.</p>}
      </div>

      {latest.jobs.length > 0 && (
        <ul className="rounded-md border px-3">
          {latest.jobs.map((j) => <JobRow key={j.ref} job={j} photo={photos?.[j.ref]} onOpen={j.has_photo ? onPhotos : undefined} />)}
        </ul>
      )}
      {overallGap(latest.jobs) !== null && (
        <p className="text-sm">{gapText(overallGap(latest.jobs))} overall on these jobs.</p>
      )}
      {latest.status === "rewritten" && !latest.undone_at && projectedGap(latest.jobs) !== null && (
        <p className="text-sm">
          Checked on the same jobs: with the new adjustments, {gapText(projectedGap(latest.jobs)).replace(/^Scout was/, "Scout would have been")
            .replace(/^Scout matched/, "Scout would have matched")} overall.
        </p>
      )}
      {latest.summary && <p className="text-sm">{latest.summary}</p>}
      {latest.changes.length > 0 && !latest.undone_at && (
        <div>
          <div className="text-sm font-medium">What changed</div>
          <ul className="list-disc pl-5 text-sm space-y-0.5">{latest.changes.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}

      {canUndo && (
        <>
          <Button variant="outline" size="sm" onClick={() => setConfirm(true)}>
            <Undo2 className="w-4 h-4 mr-1.5" /> Undo this change
          </Button>
          <AlertDialog open={confirm} onOpenChange={setConfirm}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Undo this change?</AlertDialogTitle>
                <AlertDialogDescription>{UNDO_CONFIRM}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction onClick={() => onUndo(surface)}>Undo</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}

      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1 text-sm font-medium">
          Current adjustments <ChevronDown className="w-4 h-4" />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2 text-sm space-y-1">
          {guidance && (guidance.factors.length > 0 || guidance.rules.length > 0) ? (
            <>
              {guidance.factors.map((f) => <p key={`${f.service}-${f.size}`}>{factorSentence(f)}</p>)}
              {guidance.rules.map((r) => <p key={r} className="text-muted-foreground">{r}</p>)}
            </>
          ) : (
            <p className="text-muted-foreground">No adjustments yet. Scout prices the standard way.</p>
          )}
        </CollapsibleContent>
      </Collapsible>

      {earlier.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1 text-sm font-medium">
            Earlier weeks <ChevronDown className="w-4 h-4" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2 space-y-2">
            {earlier.map((r) => (
              <div key={r.id} className="text-sm">
                <div className="font-medium">{runTitle(r, false)}</div>
                <div className="text-muted-foreground">
                  {statusLine(r)}
                  {overallGap(r.jobs) !== null ? ` ${gapText(overallGap(r.jobs))} overall.` : ""}
                </div>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

export function ScoutLearningView({ report, saving, onToggle, onUndo, photos, onPhotos }: {
  report: LearningReport; saving: boolean; onToggle: (on: boolean) => void; onUndo: (s: Surface) => void;
  photos?: JobPhotos; onPhotos?: () => void;
}) {
  if (!report.visible) return null;
  const isOwner = report.is_owner === true;
  const enabled = report.enabled === true;
  const website = report.website && report.website.runs.length > 0 ? report.website : null;
  return (
    <Card className="p-4 mt-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-primary" /> Scout learning
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{enabled ? "On. Scout learns from your picked prices every week." : INTRO}</p>
        </div>
        {isOwner && (
          <Switch checked={enabled} disabled={saving} onCheckedChange={onToggle} aria-label="Scout learning" />
        )}
      </div>
      {!enabled && !isOwner && <p className="text-xs text-muted-foreground">{TEAM_OFF}</p>}
      {enabled && report.pending_first_run && (
        <p className="text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {PENDING}</p>
      )}
      {enabled && report.scout && (
        <SurfaceSection title={website ? "Scout in the app" : null} surface="scout" data={report.scout} isOwner={isOwner} onUndo={onUndo}
          photos={photos} onPhotos={onPhotos} />
      )}
      {enabled && website && (
        <SurfaceSection title="Your website's price form" surface="website" data={website} isOwner={isOwner} onUndo={onUndo} />
      )}
    </Card>
  );
}

/** The card for the Scout screen. Hidden while loading, for the Free plan and for anyone the report doesn't show. */
export function ScoutLearningCard() {
  const { report, toggle, undo, saving, photos, loadPhotos } = useScoutLearning();
  if (report.isLoading) return null;
  if (report.isError) {
    return (
      <Card className="p-4 mt-4 text-sm flex items-center justify-between gap-3">
        <span className="text-muted-foreground">Couldn't load Scout learning.</span>
        <Button variant="outline" size="sm" onClick={() => report.refetch()}>Try again</Button>
      </Card>
    );
  }
  if (!report.data) return null;
  return <ScoutLearningView report={report.data} saving={saving} onToggle={toggle} onUndo={undo} photos={photos} onPhotos={loadPhotos} />;
}

/** The same switch on Settings > Pricing rates (owners only). */
export function ScoutLearningSwitchRow() {
  const { report, toggle, saving } = useScoutLearning();
  const data = report.data;
  if (!data?.visible || data.is_owner !== true) return null;
  return (
    <Card className="p-4 mb-4 flex items-start justify-between gap-3">
      <div>
        <div className="font-semibold flex items-center gap-2"><GraduationCap className="w-4 h-4 text-primary" /> Scout learning</div>
        <p className="text-sm text-muted-foreground mt-0.5">{INTRO} The weekly report is on the Scout screen.</p>
      </div>
      <Switch checked={data.enabled === true} disabled={saving} onCheckedChange={toggle} aria-label="Scout learning" />
    </Card>
  );
}
