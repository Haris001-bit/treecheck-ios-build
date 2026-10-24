import { describe, expect, it, vi } from 'vitest';
import { notifySubReview } from '../../supabase/functions/review-submit/notify';

const input = { companySide: true, sandbox: false, userId: 'sub', phone: '4055550100', company: 'Test company', jobId: 'job' };
const delivery = () => ({ sms: vi.fn().mockResolvedValue(true), push: vi.fn().mockResolvedValue(undefined) });
describe('review notifications', () => {
  it('notifies the reviewed sub by text and push', async () => {
    const d = delivery(); await notifySubReview(input, d);
    expect(d.sms).toHaveBeenCalledOnce();
    expect(d.push).toHaveBeenCalledWith(['sub'], 'New review', expect.any(String), { route: '/dashboard/crew-bids?review=job', bid_request_id: 'job', source: 'review' });
  });
  it('never contacts real recipients from sandbox reviews', async () => {
    const d = delivery(); await notifySubReview({ ...input, sandbox: true }, d);
    expect(d.sms).not.toHaveBeenCalled(); expect(d.push).not.toHaveBeenCalled();
  });
  it('does not notify subs for crew-authored reviews', async () => {
    const d = delivery(); await notifySubReview({ ...input, companySide: false }, d);
    expect(d.sms).not.toHaveBeenCalled(); expect(d.push).not.toHaveBeenCalled();
  });
  it('still pushes without a valid phone', async () => {
    const d = delivery(); await notifySubReview({ ...input, phone: null }, d);
    expect(d.sms).not.toHaveBeenCalled(); expect(d.push).toHaveBeenCalledOnce();
  });
});