export async function notifySubReview(input: {
  companySide: boolean;
  sandbox: boolean;
  userId: string;
  phone: string | null;
  company: string;
  jobId: string;
}, delivery: {
  sms: (phone: string, body: string) => Promise<unknown>;
  push: (ids: string[], title: string, body: string, data: Record<string, string>) => Promise<unknown>;
}) {
  if (!input.companySide || input.sandbox) return;
  const route = `/dashboard/crew-bids?review=${input.jobId}`;
  const body = `${input.company} left you a review. Reviews stay private until both sides rate or 14 days pass. Open TreeCheck to see it and rate the company.`;
  const deliveries = [delivery.push([input.userId], 'New review', body, { route, bid_request_id: input.jobId, source: 'review' })];
  if (input.phone && input.phone.replace(/\D/g, '').length >= 10) {
    deliveries.push(delivery.sms(input.phone, `TreeCheck: ${body} https://app.treecheck.ai${route}`));
  }
  const results = await Promise.allSettled(deliveries);
  for (const result of results) if (result.status === 'rejected') console.warn('review notification failed');
}