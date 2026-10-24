import { describe, expect, it } from 'vitest';
import { requestTab, dispatchTab } from './crewJobTabs';

const today = '2026-10-20';
describe('requestTab', () => {
  it('open job with no bid is Open', () => expect(requestTab({ status: 'open' }, null, today)).toBe('open'));
  it('lost bid is Archived', () => expect(requestTab({ status: 'open' }, { id: 'b', status: 'lost' }, today)).toBe('archived'));
  it('closed job I never bid on is Archived', () => expect(requestTab({ status: 'awarded' }, null, today)).toBe('archived'));
  it('all offered dates passed is Archived', () => expect(requestTab({ status: 'open', offered_dates: ['2026-10-01'] }, null, today)).toBe('archived'));
  it('won and complete is Past work', () => expect(requestTab({ status: 'awarded', awarded_bid_id: 'b', workflow_status: 'job_complete' }, { id: 'b', status: 'won' }, today)).toBe('past'));
  it('won and not complete is My jobs', () => expect(requestTab({ status: 'awarded', awarded_bid_id: 'b' }, { id: 'b', status: 'won' }, today)).toBe('mine'));
});
describe('dispatchTab', () => {
  it('hired, date passed is Past work', () => expect(dispatchTab({ status: 'filled', awarded_date: '2026-10-10' }, { status: 'confirmed' }, today)).toBe('past'));
  it('filled by others is Archived', () => expect(dispatchTab({ status: 'filled' }, null, today)).toBe('archived'));
  it('open with future day is Open', () => expect(dispatchTab({ status: 'open', offered_dates: ['2026-10-25'] }, null, today)).toBe('open'));
});
