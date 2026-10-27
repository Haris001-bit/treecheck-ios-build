// The edge functions import zod as npm:zod@3 (Deno). Tests that load a supabase/functions/_shared module run it with the
// app's own zod (vitest.config.ts maps the name), and this tells the type checker the same thing.
declare module 'npm:zod@3' {
  export * from 'zod';
}
