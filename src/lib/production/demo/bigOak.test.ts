// Large-company setup, expo demo: Big Oak Tree Co. is built by the app's own engine, tells the booth story through the
// same report, capacity and profile code the screens use, carries none of the real price sheet's numbers, and the
// committed seed is exactly what the generator writes (UPDATE_DEMO_SQL=1 rewrites it).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIG_OAK, BIG_OAK_SETTINGS, buildBigOak } from './bigOak';
import { renderBigOakSql } from './seedSql';
import { computeReports } from '../reports';
import { capacitySettingsOf, capacityView, backlogWeeks, type CapacityPacket } from '../capacity';
import { recommendProfile } from '../profiles';
import { toReportEstimate, toReportPacket, type ReportEstimateRow } from '@/components/production/jobs/reportRows';
import type { PacketRow } from '@/hooks/useProductionWork';

const SEED = join(process.cwd(), 'docs', 'demo', 'demo_production_setup.sql');
const demo = buildBigOak();
const TODAY = '2026-11-11';

const openPackets: CapacityPacket[] = demo.packets.filter((p) => p.status !== 'done').map((p, i) => ({
  id: `p${i}`, crewTemplate: p.crew.template, estCrewHours: p.estCrewHours, resources: p.resources, status: p.status,
  plannedDate: p.plannedInDays === null ? null : TODAY, scheduledDate: null, schedulingClass: p.schedulingClass,
}));

describe('Big Oak Tree Co. (the expo demo)', () => {
  it('has 14 estimates (9 won, 3 lost, 1 sent, 1 draft), every one priced by the engine', () => {
    const by = (s: string) => demo.estimates.filter((e) => e.status === s).length;
    expect([demo.estimates.length, by('approved'), by('lost'), by('sent'), by('draft')]).toEqual([14, 9, 3, 1, 1]);
    for (const e of demo.estimates) expect(e.workItems.every((i) => i.status === 'ok' && (i.price ?? 0) > 0)).toBe(true);
    expect(demo.packets.filter((p) => p.status === 'done')).toHaveLength(6);
    expect(demo.packets.every((p) => !('price' in p))).toBe(true);
  });

  it('tells the story: removals run about 17% long with rear access, crews earn under the target', () => {
    const rows: ReportEstimateRow[] = demo.estimates.map((e) => ({
      id: e.id, status: e.status, salesperson_id: 'owner', sent_at: e.sentDaysAgo === null ? null : 'x', approved_at: e.approvedDaysAgo === null ? null : 'x',
      totals: e.totals as { total?: number }, backlog_weeks_at_send: e.backlogAtSend, work_items: e.workItems,
    }));
    const crewNames = Object.fromEntries(demo.cards[2].crews.map((c) => [c.key, c.name]));
    const report = computeReports({
      estimates: rows.map((r) => toReportEstimate(r, demo.cards[2], { owner: 'Demo Owner' })),
      packets: demo.packets.map((p) => toReportPacket({
        estimate_id: p.estimateId, package_key: p.packageKey, crew: p.crew, est_hours: p.estHours, est_man_hours: p.estManHours,
        resources: p.resources, scope: p.scope, actuals: p.actuals,
      } as unknown as PacketRow, crewNames)),
      targetRate: demo.cards[2].pricing.manHourRate, crewNames,
    });
    expect(report.insights[0]).toMatch(/^3-person climb crew removal jobs: estimated 4\.6 hours on average, actual 5\.4, underestimated by 17%\. Realized \$\d+ a man-hour against the \$120 target\. Most common factor: restricted rear access\.$/);
    expect(report.revenuePerManHour.overall).toBeLessThan(120);
    expect(report.winRate.overall).toBe(0.75);
  });

  it('about 3 weeks of work is booked, both crews are over capacity for two weeks, and High Demand is suggested', () => {
    const cs = capacitySettingsOf(BIG_OAK_SETTINGS);
    const weeks = backlogWeeks(openPackets, cs);
    expect(weeks).toBeGreaterThanOrEqual(3);
    expect(weeks).toBeLessThan(3.6);
    const view = capacityView(openPackets, cs, TODAY, 14);
    expect(view.crews.map((r) => [r.key, r.over])).toEqual([['crew3', true], ['crew4', true]]);
    const advice = recommendProfile(demo.cards[2], { backlogWeeks: weeks, realizedRate: 105, targetRate: 120 });
    expect(advice.key).toBe('high_demand');
    expect(advice.increase).toBeDefined();
  });

  it("uses none of the real price sheet's numbers", () => {
    for (const def of [demo.cards[1], demo.cards[2]]) {
      expect(def.pricing.manHourRate).not.toBe(125);
      const s = (k: string) => def.services.find((x) => x.key === k)!;
      expect(s('removal').minimum).not.toBe(650);
      const stump = s('stump').strategy;
      expect(stump.kind === 'measurement' && stump.perUnit).not.toBe(15);
      const cable = s('dynamic_cable').strategy;
      expect(cable.kind === 'per_unit' && cable.unitPrice).not.toBe(700);
      const planting = s('planting').strategy;
      expect(planting.kind === 'matrix' && planting.cells['shade|3in']).not.toBe(2400);
    }
  });

  it('the committed seed is what the generator writes, and touches only the Big Oak logins', () => {
    const sql = renderBigOakSql();
    if (process.env.UPDATE_DEMO_SQL === '1' || !existsSync(SEED)) writeFileSync(SEED, sql);
    expect(readFileSync(SEED, 'utf8').replace(/\r\n/g, '\n')).toBe(sql);
    expect(sql).toContain(BIG_OAK.ownerEmail);
    expect(sql).toContain(BIG_OAK.crewEmail);
    for (const line of sql.split('\n').filter((l) => /^\s*(delete|update)\b/i.test(l))) {
      expect(line, line).toMatch(/using demo_ids|from demo_ids|production_rollout|^update public\.profiles p$/);
    }
    expect(sql).not.toMatch(/[–—]/);
  });
});
