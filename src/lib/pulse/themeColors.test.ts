// Guard: Financial Pulse screens take their colours from the app's theme (tokens such as success,
// warning, destructive, primary, muted; see src/components/pulse/tone.ts), never from fixed Tailwind
// palette colours or `dark:` classes. TreeCheck's dark theme (2026-10-01) is the default :root, so
// `dark:` classes never apply and a light palette background would leave white text on a pale panel.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const isUi = (file: string) => /\.tsx?$/.test(file) && !/\.(test|spec)\.tsx?$/.test(file);

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

function pulseUiFiles(): string[] {
  const pagesDir = join(root, "src", "pages");
  const pages = readdirSync(pagesDir).filter((name) => /^Pulse.*\.tsx$/.test(name)).map((name) => join(pagesDir, name));
  const components = walk(join(root, "src", "components", "pulse")).filter(isUi);
  return [...pages, ...components].map((f) => relative(root, f).replace(/\\/g, "/"));
}

const PALETTE = /(?<![\w-])(?:bg|text|border|ring|fill|stroke|divide|outline|from|via|to|shadow|accent|caret|decoration)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})\b/g;
const DARK_CLASS = /(?<![\w-])dark:[a-z[]/g;

describe("Financial Pulse screens use the theme's colours", () => {
  const files = pulseUiFiles();

  it("finds the Pulse screens", () => {
    for (const expected of [
      "src/pages/PulseHome.tsx",
      "src/pages/PulseSetup.tsx",
      "src/pages/PulseTransactions.tsx",
      "src/components/pulse/screen/PulseScreen.tsx",
      "src/components/pulse/setup/PulseSetupWizard.tsx",
      "src/components/pulse/admin/PulseAdminScreen.tsx",
    ]) {
      expect(files).toContain(expected);
    }
  });

  it.each(files)("%s", (file) => {
    const text = readFileSync(join(root, file), "utf8");
    expect(text.match(PALETTE) ?? [], `${file}: use theme colours (see tone.ts), not fixed palette colours`).toEqual([]);
    expect(text.match(DARK_CLASS) ?? [], `${file}: dark: classes never apply in TreeCheck's dark theme`).toEqual([]);
  });

  it("catches what it is meant to catch", () => {
    expect("bg-amber-50 dark:bg-amber-950/40 text-green-700 text-white".match(PALETTE)).toEqual(["bg-amber-50", "bg-amber-950", "text-green-700", "text-white"]);
    expect("x dark:bg-amber-950/40".match(DARK_CLASS)).toEqual(["dark:b"]);
    expect("bg-warning/10 text-success border-destructive/60 bg-primary/5 text-muted-foreground".match(PALETTE)).toBeNull();
  });
});
