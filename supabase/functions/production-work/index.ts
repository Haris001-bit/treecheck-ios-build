// Large-company setup: production packets after a sale. The office assigns a crew leader and a planned day, and moves
// packets along; the crew leader of a packet ticks its tasks, starts and finishes it, and types the actual hours. Every
// change checks the packet hasn't changed since it was read, so two people never overwrite each other. The office can
// read the estimate's Jobber quote and jobs again (refresh) and link a packet to one of those jobs (link_job). With the
// Jobber approval extras on, jobber_actuals reads the linked Jobber job's time sheets to fill in the actual hours.
// Packets carry no price. Never texts anyone. Maintained outside Lovable.
import { z } from "npm:zod@3";
import { productionCaller, productionEligible, productionCors, productionJson, pathInCompany, MEDIA_BUCKET } from "../_shared/productionAccess.ts";
import { linkPacket, productionKillOn, refreshEstimate } from "../_shared/productionJobber.ts";
import { killSwitchOn } from "../_shared/jobberSwitches.ts";
import { extrasSwitchOn, jobberActuals } from "../_shared/productionJobberExtras.ts";

const STATUSES = ["ready", "planned", "scheduled", "in_progress", "done", "cancelled"] as const;
const LEADER_STATUSES = ["in_progress", "done"];
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const stamp = z.string().max(40);
const Actuals = z.object({
  crewTemplate: z.string().max(40).nullable().optional(),
  headcount: z.number().int().min(0).max(30),
  hours: z.number().min(0).max(240),
  manHours: z.number().min(0).max(2000),
  equipment: z.record(z.string().max(40), z.number().min(0).max(240)).default({}),
  expenses: z.number().min(0).max(1_000_000).nullable().optional(),
  factors: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  notes: z.string().max(1000).optional(),
});
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), packetId: z.string().uuid(), crewLeaderId: z.string().uuid().nullable(), plannedDate: day.nullable().optional(), expectedUpdatedAt: stamp }),
  z.object({ action: z.literal("task"), packetId: z.string().uuid(), taskKey: z.string().min(1).max(80), status: z.enum(["open", "done", "skipped"]) }),
  z.object({ action: z.literal("actuals"), packetId: z.string().uuid(), actuals: Actuals, done: z.boolean().optional(), expectedUpdatedAt: stamp }),
  z.object({ action: z.literal("status"), packetId: z.string().uuid(), status: z.enum(STATUSES), expectedUpdatedAt: stamp }),
  z.object({ action: z.literal("media"), packetId: z.string().uuid(), path: z.string().max(300) }),
  z.object({ action: z.literal("leaders") }),
  z.object({ action: z.literal("refresh"), packetId: z.string().uuid() }),
  z.object({ action: z.literal("link_job"), packetId: z.string().uuid(), jobId: z.string().regex(/^[A-Za-z0-9_=+/-]{1,200}$/).nullable() }),
  z.object({ action: z.literal("jobber_actuals"), packetId: z.string().uuid() }),
]);

const STALE = { error: "Someone else just changed this. Refresh and try again." };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: productionCors });
  if (req.method !== "POST") return productionJson({ error: "Method not allowed" }, 405);
  try {
    const caller = await productionCaller(req);
    if (!caller) return productionJson({ error: "Please sign in again." }, 401);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return productionJson({ error: "That request wasn't understood. Refresh and try again." }, 400);
    const body = parsed.data;
    const { admin, ownerId, userId } = caller;
    if (!(await productionEligible(caller))) return productionJson({ error: "Crew work isn't switched on for this company." }, 403);

    // Who can lead crew jobs (the office can't read the team list itself): the owner and employees with field access.
    if (body.action === "leaders") {
      if (!(await caller.can("dispatch"))) return productionJson({ error: "Only the office assigns crews." }, 403);
      const { data: members } = await admin.from("team_member_access").select("user_id, email, permissions")
        .eq("owner_id", ownerId).eq("status", "active").eq("member_kind", "employee");
      const crew = (members ?? []).filter((m) => m.user_id && (m.permissions as Record<string, unknown>)?.assignedJobs === true);
      // Names, so the office picks people rather than email addresses.
      const { data: people } = await admin.from("profiles").select("id, email, full_name").in("id", [ownerId, ...crew.map((m) => m.user_id as string)]);
      const name = (id: string) => ((people ?? []).find((p) => p.id === id)?.full_name as string | null)?.trim() || null;
      const owner = (people ?? []).find((p) => p.id === ownerId);
      const leaders = crew.map((m) => ({ id: m.user_id as string, email: m.email as string, name: name(m.user_id as string) }));
      return productionJson({ ok: true, leaders: [{ id: ownerId, email: (owner?.email as string | null) ?? "Owner", name: name(ownerId), owner: true }, ...leaders] });
    }

    const { data: packet } = await admin.from("production_packets")
      .select("id, estimate_id, crew_leader_id, status, tasks, scope, actuals, jobber_job_id, updated_at").eq("id", body.packetId).eq("contractor_id", ownerId).maybeSingle();
    if (!packet) return productionJson({ error: "That job packet wasn't found." }, 404);
    const dispatch = await caller.can("dispatch");
    const leader = packet.crew_leader_id === userId && (await caller.can("field"));
    const viewer = dispatch || leader || (await caller.can("price"));

    if (body.action === "assign") {
      if (!dispatch) return productionJson({ error: "Only the office assigns crews." }, 403);
      if (body.crewLeaderId && body.crewLeaderId !== ownerId) {
        const { data: m } = await admin.from("team_member_access").select("permissions")
          .eq("owner_id", ownerId).eq("user_id", body.crewLeaderId).eq("status", "active").eq("member_kind", "employee").maybeSingle();
        if (!m || (m.permissions as Record<string, unknown>)?.assignedJobs !== true) return productionJson({ error: "That person can't lead crew jobs. Give them field access first." }, 400);
      }
      const patch: Record<string, unknown> = { crew_leader_id: body.crewLeaderId };
      if (body.plannedDate !== undefined) {
        patch.planned_date = body.plannedDate;
        if (body.plannedDate && packet.status === "ready") patch.status = "planned";
      }
      const { data, error } = await admin.from("production_packets").update(patch).eq("id", packet.id).eq("updated_at", body.expectedUpdatedAt).select("id, updated_at");
      if (error) throw new Error(`assign failed: ${error.message}`);
      if (!data?.length) return productionJson(STALE, 409);
      return productionJson({ ok: true, updatedAt: data[0].updated_at });
    }

    if (body.action === "task") {
      if (!dispatch && !leader) return productionJson({ error: "Only the office or this job's crew leader can tick its tasks." }, 403);
      // Read, change one task, write back only if nothing else changed; one retry covers two people ticking at once.
      for (let attempt = 0; attempt < 2; attempt++) {
        const { data: cur } = attempt === 0 ? { data: packet } : await admin.from("production_packets").select("tasks, updated_at").eq("id", packet.id).maybeSingle();
        const tasks = ((cur?.tasks ?? []) as { key: string; status: string }[]).map((t) => (t.key === body.taskKey
          ? { ...t, status: body.status, doneBy: body.status === "open" ? null : userId, doneAt: body.status === "open" ? null : new Date().toISOString() }
          : t));
        if (!tasks.some((t) => t.key === body.taskKey)) return productionJson({ error: "That task isn't on this job." }, 404);
        const { data } = await admin.from("production_packets").update({ tasks }).eq("id", packet.id).eq("updated_at", cur!.updated_at).select("id, updated_at");
        if (data?.length) return productionJson({ ok: true, updatedAt: data[0].updated_at });
      }
      return productionJson(STALE, 409);
    }

    if (body.action === "actuals") {
      if (!dispatch && !leader) return productionJson({ error: "Only the office or this job's crew leader can enter the actual hours." }, 403);
      // What Jobber's time sheets said stays beside the saved hours, so the two can be compared later.
      const fromJobber = (packet.actuals as { fromJobber?: unknown } | null)?.fromJobber;
      const patch: Record<string, unknown> = { actuals: { ...body.actuals, ...(fromJobber ? { fromJobber } : {}), enteredBy: userId, enteredAt: new Date().toISOString() } };
      if (body.done) { patch.status = "done"; patch.completed_at = new Date().toISOString(); }
      const { data, error } = await admin.from("production_packets").update(patch).eq("id", packet.id).eq("updated_at", body.expectedUpdatedAt).select("id, updated_at");
      if (error) throw new Error(`actuals failed: ${error.message}`);
      if (!data?.length) return productionJson(STALE, 409);
      return productionJson({ ok: true, updatedAt: data[0].updated_at });
    }

    if (body.action === "jobber_actuals") {
      if (!dispatch && !leader) return productionJson({ error: "Only the office or this job's crew leader can enter the actual hours." }, 403);
      if (killSwitchOn() || productionKillOn() || !(await extrasSwitchOn(admin))) {
        return productionJson({ error: "Reading Jobber's time sheets opens once Jobber approves TreeCheck's app." }, 409);
      }
      if (!packet.jobber_job_id) return productionJson({ error: "This job isn't linked to a Jobber job yet." }, 409);
      const r = await jobberActuals(admin, ownerId, packet.jobber_job_id as string);
      if (r.ok === false) return productionJson({ error: r.error }, 409);
      const actuals = r.byPacket[packet.id] ?? null;
      return productionJson({ ok: true, actuals, message: actuals ? null : "Jobber has no finished time or expense on this job yet." });
    }

    if (body.action === "status") {
      if (!dispatch && !(leader && LEADER_STATUSES.includes(body.status))) return productionJson({ error: "You can't move this job to that step." }, 403);
      const patch: Record<string, unknown> = { status: body.status };
      if (body.status === "done") patch.completed_at = new Date().toISOString();
      const { data, error } = await admin.from("production_packets").update(patch).eq("id", packet.id).eq("updated_at", body.expectedUpdatedAt).select("id, updated_at");
      if (error) throw new Error(`status failed: ${error.message}`);
      if (!data?.length) return productionJson(STALE, 409);
      return productionJson({ ok: true, updatedAt: data[0].updated_at });
    }

    if (body.action === "refresh" || body.action === "link_job") {
      if (!dispatch) return productionJson({ error: "Only the office links jobs to Jobber." }, 403);
      if (killSwitchOn() || productionKillOn()) return productionJson({ error: "Jobber is switched off for crew work right now." }, 409);
      if (body.action === "link_job") {
        const r = await linkPacket(admin, ownerId, packet.id, body.jobId);
        return r.ok ? productionJson({ ok: true, outcome: r.outcome }) : productionJson({ error: r.outcome }, 409);
      }
      const r = await refreshEstimate(admin, ownerId, packet.estimate_id as string);
      return productionJson({ ok: true, outcome: r.outcome, jobs: r.jobs });
    }

    if (body.action === "media") {
      if (!viewer) return productionJson({ error: "Not allowed." }, 403);
      const referenced = ((packet.scope ?? []) as { photos?: string[] }[]).some((s) => (s.photos ?? []).includes(body.path));
      if (!referenced || !(await pathInCompany(admin, ownerId, body.path))) return productionJson({ error: "That photo isn't on this job." }, 404);
      const { data: signed } = await admin.storage.from(MEDIA_BUCKET).createSignedUrl(body.path, 3600);
      if (!signed?.signedUrl) return productionJson({ error: "That photo couldn't be opened." }, 404);
      return productionJson({ ok: true, url: signed.signedUrl });
    }
    return productionJson({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("production-work error", String((e as Error)?.message ?? e).slice(0, 300));
    return productionJson({ error: "Something went wrong. Try again." }, 500);
  }
});
