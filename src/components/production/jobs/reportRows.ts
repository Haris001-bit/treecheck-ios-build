import type { RateCardDefinition } from '@/lib/production/rules';
import type { PricedItem } from '@/lib/production/estimate';
import type { ReportEstimate, ReportPacket } from '@/lib/production/reports';
import type { CapacityPacket } from '@/lib/production/capacity';
import type { PacketRow } from '@/hooks/useProductionWork';

/** The estimate columns the reports read (price layer). */
export interface ReportEstimateRow {
  id: string; status: string; salesperson_id: string | null; sent_at: string | null; approved_at: string | null;
  totals: { total?: number } | null; backlog_weeks_at_send: number | string | null; work_items: PricedItem[] | null;
}

export function toReportEstimate(row: ReportEstimateRow, def: RateCardDefinition | null, names: Record<string, string>): ReportEstimate {
  const category = new Map((def?.services ?? []).map((s) => [s.key, s.category as string]));
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    id: row.id, status: row.status, salespersonId: row.salesperson_id,
    salespersonName: row.salesperson_id ? names[row.salesperson_id] ?? null : null,
    sentAt: row.sent_at, approvedAt: row.approved_at, total: Number(row.totals?.total) || 0,
    backlogWeeksAtSend: row.backlog_weeks_at_send === null ? null : Number(row.backlog_weeks_at_send),
    items: (row.work_items ?? []).filter((i) => i.status === 'ok' && i.price !== null).map((i) => ({
      serviceKey: i.serviceKey, serviceName: i.serviceName, category: category.get(i.serviceKey) ?? 'other',
      engineAmount: i.engineAmount ?? i.price ?? 0, price: i.price ?? 0, override: i.override,
      crewTemplate: i.production?.crewTemplate ?? null, headcount: i.production?.headcount ?? 0,
      estHours: i.production?.hours ?? 0, estManHours: i.production?.manHours ?? 0,
      equipmentHours: Object.fromEntries((i.production?.equipment ?? []).map((e) => [e.key, e.hours])),
      access: typeof i.answers?.access === 'string' ? i.answers.access : null, dbh: num(i.answers?.dbh),
    })),
  };
}

export function toReportPacket(p: PacketRow, crewNames: Record<string, string>): ReportPacket {
  const template = p.crew?.template ?? null;
  return {
    estimateId: p.estimate_id, packageKey: p.package_key, crewTemplate: template, crewName: template ? crewNames[template] ?? null : null,
    estHours: Number(p.est_hours) || 0, estManHours: Number(p.est_man_hours) || 0,
    estEquipment: Object.fromEntries((p.resources ?? []).map((r) => [r.key, r.hours])),
    services: [...new Set(p.scope.map((s) => s.service))], actuals: p.actuals ?? null,
  };
}

export function toCapacityPacket(p: PacketRow): CapacityPacket {
  return {
    id: p.id, crewTemplate: p.crew?.template ?? null, estCrewHours: Number(p.est_crew_hours ?? p.est_hours) || 0,
    resources: p.resources ?? [], status: p.status, plannedDate: p.planned_date, scheduledDate: p.scheduled_date,
    promisedWindow: p.promised_window ?? null, schedulingClass: p.scheduling_class,
  };
}
