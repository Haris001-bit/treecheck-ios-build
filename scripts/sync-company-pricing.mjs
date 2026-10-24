import { readFileSync, writeFileSync } from 'node:fs';
const catalog = readFileSync('src/lib/pricing/catalog.ts', 'utf8');
const lifecycle = readFileSync('src/lib/pricing/lifecycle.ts', 'utf8').replace("from './catalog'", "from './companyCatalog.ts'");
writeFileSync('supabase/functions/_shared/companyCatalog.ts', catalog);
writeFileSync('supabase/functions/_shared/companyLifecycle.ts', lifecycle);