import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRODUCTION_SHARED_FILES, toDeno } from '../../../scripts/sync-production-engine.mjs';

const root = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8').replace(/\r\n/g, '\n');

describe('the edge functions price exactly as the screens do', () => {
  it('every shared copy matches its source (run node scripts/sync-production-engine.mjs)', () => {
    for (const f of PRODUCTION_SHARED_FILES as string[]) {
      expect(read(`supabase/functions/_shared/production/${f}`), f).toBe(toDeno(read(`src/lib/production/${f}`)));
    }
  });
  it('nothing extra sits in the shared folder', () => {
    expect(readdirSync(resolve(root, 'supabase/functions/_shared/production')).sort()).toEqual([...(PRODUCTION_SHARED_FILES as string[])].sort());
  });
  it('the shared copy never names Deno, so vitest can import what the functions use', () => {
    for (const f of PRODUCTION_SHARED_FILES as string[]) expect(read(`src/lib/production/${f}`)).not.toMatch(/\bDeno\./);
  });
});
