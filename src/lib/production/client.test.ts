import { describe, it, expect, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { readStatus, STATUS_OFF, newDraftDefinition } from './client';
import { priceSheetCard } from './testing/priceSheetFixture';
import { readResponsesStream, callResponses } from '../../../supabase/functions/_shared/aiResponses';

describe('production status in the browser', () => {
  it('anything unexpected means everything is off', () => {
    expect(readStatus(null)).toEqual(STATUS_OFF);
    expect(readStatus('yes')).toEqual(STATUS_OFF);
    expect(readStatus({ eligible: 'true', can: { setup: 1 } }).eligible).toBe(false);
  });
  it('reads a real answer', () => {
    const s = readStatus({ rollout: true, eligible: true, started: false, published: false, owner: 'o1', is_owner: true, operating_model: 'hybrid', jobber_extras: false, can: { price: true, setup: true, dispatch: false, field: false, costs: true } });
    expect(s).toMatchObject({ eligible: true, is_owner: true, owner: 'o1', can: { setup: true, costs: true, dispatch: false } });
  });
});

describe('a new draft', () => {
  it('copies the live card, without the frozen selling rates', () => {
    const live = priceSheetCard();
    live.pricing.derivedRates = { roles: { climber: 60 }, equipment: {} };
    const d = newDraftDefinition(live);
    expect(d.services.map((s) => s.key)).toEqual(live.services.map((s) => s.key));
    expect(d.pricing.derivedRates).toBeUndefined();
  });
  it('starts from the starter card when nothing is published', () => {
    expect(newDraftDefinition(null).services).toHaveLength(14);
    expect(newDraftDefinition({ nonsense: true }).services).toHaveLength(14);
  });
});

const streamOf = (chunks: string[]) => new ReadableStream<Uint8Array>({
  start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch)); c.close(); },
});

describe('the AI gateway answer', () => {
  it('joins the streamed text, across chunk boundaries', async () => {
    const r = await readResponsesStream(streamOf([
      'data: {"type":"response.output_text.delta","delta":"{\\"a\\":"}\n',
      'data: {"type":"response.output_text.del', 'ta","delta":"1}"}\n',
      'data: [DONE]\n',
    ]));
    expect(r).toEqual({ text: '{"a":1}', failed: false });
  });
  it('turns gateway refusals into messages a person can act on', async () => {
    const reply = (status: number, body = '') => vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;
    const base = { apiKey: 'k', model: 'm', name: 'n', schema: {}, content: [], unreadable: 'Could not read it.' };
    // Out of AI credits: customers see a neutral message, never "Lovable" (Lovable's wording, 2026-10-27).
    expect(await callResponses(base, reply(402))).toMatchObject({ kind: 'error', status: 402, message: 'This feature is temporarily unavailable. Please try again later.' });
    expect(await callResponses(base, reply(429))).toMatchObject({ kind: 'error', status: 429 });
    expect(await callResponses(base, reply(400))).toEqual({ kind: 'error', status: 400, message: 'Could not read it.' });
    expect(await callResponses(base, reply(500))).toMatchObject({ kind: 'error', status: 502 });
    const ok = vi.fn(async () => new Response(streamOf(['data: {"type":"response.output_text.delta","delta":"{\\"x\\":true}"}\n']), { status: 200 })) as unknown as typeof fetch;
    expect(await callResponses(base, ok)).toEqual({ kind: 'ok', value: { x: true } });
    const junk = vi.fn(async () => new Response(streamOf(['data: {"type":"response.output_text.delta","delta":"not json"}\n']), { status: 200 })) as unknown as typeof fetch;
    expect(await callResponses(base, junk)).toEqual({ kind: 'error', status: 502, message: 'Could not read it.' });
  });
});
