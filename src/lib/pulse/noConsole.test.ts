// Guard: Financial Pulse UI code never logs to the browser console (the debug console may be live
// in production, and logs could carry bank data).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const isTest = (file: string) => /\.(test|spec)\.tsx?$/.test(file);
const isSource = (file: string) => /\.tsx?$/.test(file) && !isTest(file);

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function pulseFiles(): string[] {
  const pagesDir = join(root, "src", "pages");
  const pages = readdirSync(pagesDir)
    .filter((name) => /^Pulse.*\.tsx$/.test(name) && !isTest(name))
    .map((name) => join(pagesDir, name));
  const libDir = join(root, "src", "lib", "pulse");
  const lib = readdirSync(libDir)
    .filter((name) => isSource(name))
    .map((name) => join(libDir, name));
  const components = walk(join(root, "src", "components", "pulse")).filter(isSource);
  const hooks = walk(join(root, "src", "hooks", "pulse")).filter(isSource);
  return [...pages, ...components, ...hooks, ...lib].map((f) => relative(root, f).replace(/\\/g, "/"));
}

describe("Financial Pulse UI has no console calls", () => {
  const files = pulseFiles();

  it("finds the Pulse UI files", () => {
    for (const expected of [
      "src/pages/PulseSetup.tsx",
      "src/pages/PulseTransactions.tsx",
      "src/pages/PulseOAuthReturn.tsx",
      "src/components/pulse/PulseGate.tsx",
      "src/components/pulse/PlaidLinkButton.tsx",
      "src/hooks/pulse/usePulseAccess.ts",
      "src/lib/pulse/api.ts",
      "src/lib/pulse/flags.ts",
    ]) {
      expect(files).toContain(expected);
    }
  });

  it.each(files)("%s", (file) => {
    const text = readFileSync(join(root, file), "utf8");
    expect(text.includes("console."), `${file} must not use the console`).toBe(false);
  });
});
