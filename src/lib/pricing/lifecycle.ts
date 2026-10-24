import { CORE_INCLUDED_FIELD_SEATS, DMA_CAPTURE_CONTRIBUTORS, fitsSeat, type Permissions, type SeatType } from './catalog';

export type MemberKind = 'employee' | 'capture' | 'subcontractor';
export interface Assignment { seat: SeatType | null; kind: MemberKind; permissions: Permissions; active: boolean }
export interface Capacity { scout: number; manager: number; field: number }

export function validateAssignment(a: Assignment) {
  if (a.kind === 'subcontractor') {
    if (a.seat || Object.entries(a.permissions).some(([key, value]) => key !== 'assignedJobs' && value)) throw new Error('Subcontractor guests only access their assigned work.');
  } else if (a.kind === 'capture') {
    if (a.seat || Object.entries(a.permissions).some(([key, value]) => key !== 'dmaSubmit' && value)) throw new Error('Capture contributors only submit photos and voice memos.');
  } else if (!a.seat || !fitsSeat(a.seat, a.permissions)) throw new Error('Select a seat that supports these permissions.');
}

export function availableCapacity(capacity: Capacity, members: Assignment[], complimentary = false) {
  const result = { ...capacity };
  for (const a of members.filter(m => m.active && m.kind === 'employee')) if (a.seat) result[a.seat]--;
  return complimentary ? { scout: Infinity, manager: Infinity, field: Infinity } : result;
}

export function paidQuantities(capacity: Capacity, ownerScout: boolean) {
  return { scout: capacity.scout + Number(ownerScout), manager: capacity.manager, field: Math.max(0, capacity.field - CORE_INCLUDED_FIELD_SEATS) };
}

export function captureSlotsRemaining(members: Assignment[]) {
  return DMA_CAPTURE_CONTRIBUTORS - members.filter(m => m.active && m.kind === 'capture').length;
}

export function remainingTrialEnd(original: string | null, now: number) {
  if (!original) return null;
  const end = Math.floor(Date.parse(original) / 1000);
  return end > Math.floor(now / 1000) + 48 * 3600 ? end : null;
}

// Stripe Checkout needs trial_end at least 48 hours out (payments milestone, 2026-10-21). A trial with less time left
// moves to 49 hours from now, at most two extra free days, instead of being refused or charged early. An ended trial
// gets no trial at all, so the first payment is taken at checkout.
export function checkoutTrialEnd(original: string | null, now: number) {
  if (!original) return null;
  const end = Math.floor(Date.parse(original) / 1000);
  const nowSeconds = Math.floor(now / 1000);
  if (!(end > nowSeconds)) return null;
  return Math.max(end, nowSeconds + 49 * 3600);
}
