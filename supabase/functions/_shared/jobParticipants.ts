// Who actually worked a job: the owner company and every hired sub.
// deno-lint-ignore-file no-explicit-any
export async function hiredCrew(admin: any, request: any): Promise<{ crew_member_id: string; user_id: string | null; full_name: string | null; trade: string | null }[]> {
  const bidIds = [request.awarded_bid_id, request.awarded_ground_bid_id, request.awarded_stump_bid_id].filter(Boolean);
  const memberIds = new Set<string>();
  if (bidIds.length) {
    const { data: bids } = await admin.from("bids").select("crew_member_id").in("id", bidIds);
    for (const b of bids ?? []) memberIds.add(b.crew_member_id);
  }
  const { data: dispatches } = await admin
    .from("job_dispatches").select("hired_crew_member_ids").eq("bid_request_id", request.id);
  for (const d of dispatches ?? []) for (const id of d.hired_crew_member_ids ?? []) memberIds.add(id);
  if (!memberIds.size) return [];
  const { data: members } = await admin
    .from("crew_members").select("id, user_id, full_name, trade").in("id", [...memberIds]);
  return (members ?? []).map((m: any) => ({ crew_member_id: m.id, user_id: m.user_id, full_name: m.full_name, trade: m.trade }));
}
