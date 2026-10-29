// The RipSaw giveaway in the phone apps (release 1.4): the banner and the Official Rules work inside the apps, phone app
// signups are entered once their store trial starts, and test purchases never reach the draw.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({ native: false, platform: 'web' as 'web' | 'ios' | 'android' }));
const browserOpen = vi.hoisted(() => vi.fn(async (_opts: { url: string; presentationStyle?: string }) => {}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => state.native, getPlatform: () => state.platform },
}));
vi.mock('@capacitor/browser', () => ({ Browser: { open: browserOpen } }));

import { GiveawayBanner } from './GiveawayBanner';
import GiveawayRules from '@/pages/GiveawayRules';
import { assetUrl, getWebBaseUrl } from '@/lib/platform';
import {
  GIVEAWAY_RULES_VERSION,
  TRIAL_STARTED_BILLING_STATUSES,
  recordGiveawayEntry,
} from '../../../supabase/functions/_shared/giveaway';
import { storePlanDecision } from '../../../supabase/functions/_shared/storePlans';

const on = (p: 'web' | 'ios' | 'android') => { state.native = p !== 'web'; state.platform = p; };
const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');
const rulesUrl = () => `${getWebBaseUrl()}/giveaway/rules?in_app=1`;

// Rendered with React's own renderer, like the other page tests.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const mount = (ui: ReactNode) => act(() => root.render(ui));
const leaf = (text: string) => Array.from(host.querySelectorAll('*')).find((el) => el.children.length === 0 && el.textContent === text) as HTMLElement | undefined;
const links = () => Array.from(host.querySelectorAll('a')).map((a) => a.getAttribute('href'));

beforeEach(() => {
  on('web');
  browserOpen.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the giveaway banner', () => {
  it('loads the prize photo from the website inside the apps, where the bundled page has no Lovable files', () => {
    expect(assetUrl({ url: '/__l5e/assets-v1/a/ripsaw.jpg' })).toBe('/__l5e/assets-v1/a/ripsaw.jpg');
    on('ios');
    expect(assetUrl({ url: '/__l5e/assets-v1/a/ripsaw.jpg' })).toBe(`${getWebBaseUrl()}/__l5e/assets-v1/a/ripsaw.jpg`);
    expect(assetUrl({ url: 'https://cdn.example.com/x.jpg' })).toBe('https://cdn.example.com/x.jpg');
  });

  it('on iPhone: opens the published rules in the in-app browser and says Apple is not a sponsor', () => {
    on('ios');
    mount(<MemoryRouter><GiveawayBanner onCta={() => {}} /></MemoryRouter>);
    expect(host.querySelector('img')?.getAttribute('src')?.startsWith(`${getWebBaseUrl()}/__l5e/`)).toBe(true);
    expect(leaf('Apple is not a sponsor of this giveaway and is not involved in it.')).toBeDefined();
    const rules = leaf('See Official Rules');
    expect(rules?.tagName).toBe('BUTTON');
    act(() => rules?.click());
    expect(browserOpen).toHaveBeenCalledWith({ url: rulesUrl(), presentationStyle: 'popover' });
  });

  it('on Android: the same, with Google', () => {
    on('android');
    mount(<MemoryRouter><GiveawayBanner onCta={() => {}} /></MemoryRouter>);
    expect(leaf('Google is not a sponsor of this giveaway and is not involved in it.')).toBeDefined();
    act(() => leaf('See Official Rules')?.click());
    expect(browserOpen).toHaveBeenCalledWith({ url: rulesUrl(), presentationStyle: 'popover' });
  });

  it('on the website: unchanged, a normal link to the rules page and no store line', () => {
    mount(<MemoryRouter><GiveawayBanner onCta={() => {}} /></MemoryRouter>);
    const rules = leaf('See Official Rules');
    expect(rules?.tagName).toBe('A');
    expect(rules?.getAttribute('href')).toBe('/giveaway/rules');
    expect(host.textContent).not.toContain('is not a sponsor');
    expect(host.querySelector('img')?.getAttribute('src')?.startsWith('/__l5e/')).toBe(true);
    expect(browserOpen).not.toHaveBeenCalled();
  });

  it('shows on every platform while entries are open, and every rules link goes through GiveawayRulesLink', () => {
    const page = read('src', 'pages', 'StartTrial.tsx');
    expect(page).toMatch(/const showGiveaway = giveawayOpen\(\);/);
    for (const file of [page, read('src', 'components', 'giveaway', 'GiveawayBanner.tsx'), read('src', 'pages', 'Giveaway.tsx')]) {
      expect(file).not.toMatch(/to="\/giveaway\/rules"/);
    }
  });
});

describe('the Official Rules', () => {
  it('name the apps as a way to enter and say Apple and Google are not part of it', () => {
    mount(<MemoryRouter initialEntries={['/giveaway/rules']}><GiveawayRules /></MemoryRouter>);
    expect(host.textContent).toContain('in the TreeCheck app for iPhone or Android');
    expect(host.textContent).toContain('Apple and Google are not sponsors of this giveaway and are not involved in it in any way.');
    expect(links()).toContain('/start-trial');
  });

  it('are complete: no "To confirm" left, and the sponsor is the App Store seller (Apple 5.3.1)', () => {
    mount(<MemoryRouter initialEntries={['/giveaway/rules']}><GiveawayRules /></MemoryRouter>);
    expect(host.textContent).not.toContain('To confirm');
    expect(host.textContent).not.toContain('Draft');
    expect(host.querySelector('mark')).toBeNull();
    expect(host.textContent).toContain('TRADES MARKETING AI LLC');
    expect(host.textContent).toContain("canceling before it ends doesn't cancel the entry");
  });

  it('opened from the apps, link nowhere into the website signup or prices (Apple 3.1.1)', () => {
    mount(<MemoryRouter initialEntries={['/giveaway/rules?in_app=1']}><GiveawayRules /></MemoryRouter>);
    expect(links()).toEqual(['mailto:support@treecheck.app']);
    expect(host.textContent).toContain('in the TreeCheck app for iPhone or Android');
  });
});

describe('phone app signups enter the giveaway', () => {
  const fakeAdmin = (error: { code: string; message: string } | null = null) => {
    const rows: Array<{ table: string; row: Record<string, unknown> }> = [];
    const admin = { from: (table: string) => ({ insert: async (row: Record<string, unknown>) => { rows.push({ table, row }); return { error }; } }) };
    return { admin, rows };
  };
  const headers: Record<string, string> = { 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'TreeCheck iOS' };
  const req = { headers: { get: (k: string) => headers[k] ?? null } } as unknown as Request;
  const entry = {
    userId: 'u1', fullName: 'Pat Oak', email: ' Pat@Example.com ', phone: '', companyName: 'Oak Co', region: 'OK',
    source: 'app-signup' as const, status: 'awaiting_trial' as const,
  };

  it('saves the entry as a phone app signup waiting for its store trial, under the current rules', async () => {
    const { admin, rows } = fakeAdmin();
    await expect(recordGiveawayEntry(admin, req, entry)).resolves.toBe('entered');
    expect(rows).toEqual([{ table: 'giveaway_entries', row: expect.objectContaining({
      source: 'app-signup', status: 'awaiting_trial', email: 'pat@example.com', phone: null, region: 'OK', country: 'US',
      rules_version: GIVEAWAY_RULES_VERSION, ip: '203.0.113.7', user_agent: 'TreeCheck iOS',
    }) }]);
    expect(GIVEAWAY_RULES_VERSION).toBe('2026-10-29b');
  });

  it('one entry per email: a second signup with the same email is a duplicate, and nothing ever throws', async () => {
    await expect(recordGiveawayEntry(fakeAdmin({ code: '23505', message: 'dup' }).admin, req, entry)).resolves.toBe('duplicate');
    await expect(recordGiveawayEntry({ from: () => { throw new Error('down'); } }, req, entry)).resolves.toBe('error');
  });

  it('create-ios-register records it while entries are open, once the account exists', () => {
    const src = read('supabase', 'functions', 'create-ios-register', 'index.ts');
    const at = src.indexOf('recordGiveawayEntry(supabaseAdmin');
    expect(at).toBeGreaterThan(src.indexOf('auth.admin.createUser'));
    expect(src.lastIndexOf('if (giveawayOpen())', at)).toBeGreaterThan(src.indexOf('auth.admin.createUser'));
    expect(src.slice(at, at + 300)).toMatch(/source: "app-signup", status: "awaiting_trial"/);
  });

  it('the store trial is what counts: a trial purchase writes a status the draw accepts', () => {
    const d = storePlanDecision(
      { type: 'INITIAL_PURCHASE', period_type: 'TRIAL', product_id: 'treecheck_core_scout_monthly', store: 'APP_STORE', environment: 'PRODUCTION', expiration_at_ms: Date.now() + 14 * 86_400_000 },
      null,
      { sandboxAllowed: false, blocker: null, now: Date.now() },
    );
    if (d.kind !== 'write') throw new Error(`expected a write, got ${d.kind}`);
    expect(TRIAL_STARTED_BILLING_STATUSES).toContain(d.update.status);
    expect(d.update.environment).toBe('live');
  });

  it('the draw counts live billing only, so App Review and sandbox test purchases never win', () => {
    const src = read('supabase', 'functions', 'giveaway-draw', 'index.ts');
    expect(src).toMatch(/\.from\('company_billing'\)\.select\('owner_id'\)\s*\.in\('owner_id', ids\)\.eq\('environment', 'live'\)/);
  });

  it("TreeCheck's own test and demo companies never count or win, even with live billing", () => {
    const src = read('supabase', 'functions', 'giveaway-draw', 'index.ts');
    expect(src).toContain(".from('profiles').select('id').in('id', ids.slice(i, i + 200)).eq('is_sandbox', true)");
    const handler = src.slice(src.indexOf('Deno.serve('));
    // Once before marking entries as counted, once before the winner is picked.
    expect(handler.match(/await testCompanies\(db, /g)?.length).toBe(2);
    expect(handler.indexOf('await testCompanies(db, startedOwners)')).toBeLessThan(handler.indexOf(".update({ status: 'entered' })"));
    expect(handler.indexOf('const pool = entered.filter(')).toBeLessThan(handler.indexOf('secureIndex(pool.length)'));
  });

  it('a store trial that started counts even after it expires, like a canceled Stripe trial', () => {
    const src = read('supabase', 'functions', 'giveaway-draw', 'index.ts');
    expect(src).toContain('stripe_subscription_id.not.is.null,provider.in.(app_store,play_store),status.in.');
    const expired = storePlanDecision(
      { type: 'EXPIRATION', product_id: 'treecheck_core_monthly', store: 'PLAY_STORE', environment: 'PRODUCTION', expiration_at_ms: Date.now() },
      { pricing_version: '2026-10', provider: 'play_store', environment: 'live', status: 'trialing' },
      { sandboxAllowed: false, blocker: null, now: Date.now() },
    );
    if (expired.kind !== 'write') throw new Error(`expected a write, got ${expired.kind}`);
    expect(expired.update.status).toBe('canceled');
    expect(expired.update).not.toHaveProperty('provider');
  });
});
