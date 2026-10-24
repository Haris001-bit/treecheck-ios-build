// TreeCheck Jobber sync: the draft quote's title, line items and description (plan section 4, D1, D2, D14).
// Pure functions, synthetic job text only: no real customers, notes or prices.
import { describe, expect, it } from "vitest";
import {
  buildQuoteLineItems,
  cleanAiOverview,
  DEFAULT_QUOTE_TEMPLATE,
  OVERVIEW_MAX_CHARS,
  quoteTemplateFrom,
  quoteTitle,
  stripPrices,
  type QuoteLineInput,
  type QuoteLineItem,
  type QuoteTemplate,
  type QuoteTemplateLine,
} from "../../../supabase/functions/_shared/quoteBuilder";

// Figure dash, en dash, em dash, horizontal bar and minus sign: none may reach a customer.
const LONG_DASH = /[\u2012-\u2015\u2212]/;
// Anything that would show the customer a money figure.
const MONEY = /\$|\bUSD\b|\bdollars?\b|\bbucks\b|\bcents?\b/i;

/** A job priced at 1686 with no stump grinding and no haul-away, changed by `over`. */
const job = (over: Partial<QuoteLineInput> = {}): QuoteLineInput => ({
  template: DEFAULT_QUOTE_TEMPLATE,
  salePrice: 1686,
  service: "Tree Removal",
  overview: "Large post oak leaning toward the house.",
  needsStump: false,
  disposalLoads: 0,
  ...over,
});

const names = (items: QuoteLineItem[]) => items.map((i) => i.name);
const total = (items: QuoteLineItem[]) => items.reduce((sum, i) => sum + i.unitPrice, 0);

const title = (
  service: string | null | undefined,
  city: string | null | undefined,
  titlePattern: string = DEFAULT_QUOTE_TEMPLATE.titlePattern,
) => quoteTitle({ template: { ...DEFAULT_QUOTE_TEMPLATE, titlePattern }, service, city });

// A Scout estimate as it reaches TreeCheck: observations, then office-only pricing, then notes.
const SCOUT_NOTES = [
  "OBSERVATIONS:",
  "- Estimated height: 60 ft",
  "- Species: Post oak",
  "- Leaning toward the house, needs rigging.",
  "PRICE BREAKDOWN:",
  "- Base price: $1,200",
  "- Rigging: $300",
  "- Crane access from the alley",
  "- Stump grinding: $186",
  "Total: $1,686",
  "Estimator fee: $65",
  "Large tree price protection applied: No",
  "Difficulty: Hard",
  "Risk: Medium",
  "PRICING NOTES:",
  "The tree is close to the power line, so the crew will rope down every limb.",
].join("\n");

describe("stripPrices", () => {
  it("takes out dollar figures with or without thousands commas, cents or a space after the sign", () => {
    for (const amount of [
      "$1,686",
      "$1686",
      "$1,686.50",
      "$950.5",
      "$0.99",
      "$.99",
      "$ 1,686",
      "$1,250,000.00",
      "+$65",
      "~$1,500",
      "-$0",
      "$2k",
      "$1.5K",
      "1,686$",
    ]) {
      expect(stripPrices(`Oak removal (${amount}) with cleanup.`), amount).toBe("Oak removal with cleanup.");
    }
    expect(stripPrices("Removal, $1,686, includes cleanup.")).toBe("Removal, includes cleanup.");
    expect(stripPrices("The owner budgeted $1,250.50 for the work.")).toBe("The owner budgeted for the work.");
  });

  it("takes out USD amounts and amounts written with a currency word", () => {
    for (const amount of [
      "USD 300",
      "USD300",
      "USD$300",
      "US$300",
      "300 USD",
      "$300 USD",
      "1,250 dollars",
      "1,250.00 dollars",
      "1 dollar",
      "300 bucks",
      "50 cents",
    ]) {
      expect(stripPrices(`Oak removal (${amount}) with cleanup.`), amount).toBe("Oak removal with cleanup.");
    }
    expect(stripPrices("The owner budgeted USD 300 for the work.")).toBe("The owner budgeted for the work.");
    expect(stripPrices("The owner budgeted 1,250 dollars for the work.")).toBe("The owner budgeted for the work.");
  });

  it("takes out a whole range, sum or rate, not just its first figure", () => {
    for (const amount of [
      "$1,200 - $1,500",
      "$1,200\u2013$1,500",
      "$1,200 to 1,500",
      "1,200 to 1,500 dollars",
      "$650 + $65 = $715",
      "$25/hr",
      "$100 an hour",
      "$200 per load",
      "$50 each",
    ]) {
      expect(stripPrices(`Oak removal (${amount}) with cleanup.`), amount).toBe("Oak removal with cleanup.");
    }
  });

  it("drops lines that held only a price breakdown and keeps the lines around them", () => {
    const text = [
      "Large post oak leaning over the garage.",
      "Total: $1,686",
      "- $1,200 removal",
      "* $300 rigging",
      "\u2022 USD 186 stump grinding",
      "Stump grinding: $186",
      "Subtotal 1,632 dollars",
      "Price = 1686",
      "Price = 1686 in total",
      "Total: 1,500 in all",
      "Estimated cost: USD 1,686",
      "Approx. $1,500",
      "$1,686 for removal and cleanup",
      "Two loads of debris to haul away.",
    ].join("\n");
    expect(stripPrices(text)).toBe("Large post oak leaning over the garage.\nTwo loads of debris to haul away.");
  });

  it("leaves text without prices exactly as it was, measurements and counts included", () => {
    const text =
      "Post oak,  about 60 ft tall.\nLean: 30% toward the house.\nTrunk: 18-24 inch, 3 stumps, 2 loads.\nTotal height: 60 ft";
    expect(stripPrices(text)).toBe(text);
  });

  it("returns an empty string for no text, or for text that held only prices", () => {
    expect(stripPrices(null)).toBe("");
    expect(stripPrices(undefined)).toBe("");
    expect(stripPrices("")).toBe("");
    expect(stripPrices("$1,686\nTotal: $1,686\n- USD 300\n1,250 dollars")).toBe("");
  });
});

describe("cleanAiOverview", () => {
  it("keeps the observations as plain sentences and drops the headings and the price breakdown section", () => {
    expect(cleanAiOverview(SCOUT_NOTES)).toBe(
      "Estimated height: 60 ft. Species: Post oak. Leaning toward the house, needs rigging. " +
        "The tree is close to the power line, so the crew will rope down every limb.",
    );
  });

  it("reads Scout notes flattened onto one line the same way", () => {
    const flat =
      "OBSERVATIONS: - Estimated height: 60 ft - Species: Post oak - Lean: toward the house " +
      "PRICE BREAKDOWN: - Base price: $1,200 - Rigging: $300 - Crane: from the alley - Total: $1,686 " +
      "PRICING NOTES: The tree is close to the power line.";
    expect(cleanAiOverview(flat)).toBe(
      "Estimated height: 60 ft. Species: Post oak. Lean: toward the house. The tree is close to the power line.",
    );
  });

  it("drops office-only lines wherever they appear, and keeps observations that only look like them", () => {
    const notes = [
      "Observations:",
      "- Total height: 60 ft",
      "- Difficulty: Hard",
      "- Risk: Medium",
      "- Risk of failure: high",
      "- Margin: 30%",
      "- Base price: 1200",
      "- Cost estimate: about two days of work",
      "- Large tree price protection applied: No",
      "- Estimator fee waived",
      "- Two dead limbs over the drive",
      "Total: $1,686",
      "Grand total 1,686",
      "Subtotal: 1,632",
      "Tax: 0",
      "Deposit: none",
    ].join("\n");
    expect(cleanAiOverview(notes)).toBe("Total height: 60 ft. Risk of failure: high. Two dead limbs over the drive.");
  });

  it("drops a Pricing section up to the blank line, and takes heading labels off the text they introduce", () => {
    const notes = [
      "Pricing:",
      "Crane day billed separately at the office rate.",
      "Cleanup is part of the work.",
      "",
      "Pricing notes: The crew will rope down every limb.",
      "Scout notes:",
      "Notes: The homeowner wants the stump ground.",
      "Summary: Healthy canopy otherwise.",
    ].join("\n");
    expect(cleanAiOverview(notes)).toBe(
      "The crew will rope down every limb. The homeowner wants the stump ground. Healthy canopy otherwise.",
    );
  });

  it("drops every sentence that mentions a price, so no dollar figure survives", () => {
    const notes = [
      "The oak is 60 ft tall.",
      "Removal would run about $1,686 with cleanup.",
      "Rigging adds USD 300 because of the roof.",
      "Last year the owner paid 1,250 dollars for a smaller tree.",
      "The crane costs US$300 a day! Dead limbs hang over the drive.",
      "The neighbor quoted $2k. Price = 1686 after the discount.",
      "Haul away is 300 bucks. Two loads of debris.",
    ].join("\n");
    const out = cleanAiOverview(notes);
    expect(out).toBe("The oak is 60 ft tall. Dead limbs hang over the drive. Two loads of debris.");
    expect(out).not.toMatch(MONEY);
    expect(out).not.toMatch(/1,?686|300|1,250|2k/);
  });

  it("drops Scout's pricing talk written without a dollar sign and keeps the observations, flattened or not", () => {
    // Scout's output contract (OBSERVATIONS, PRICE BREAKDOWN, PRICING NOTES). scout-estimate-callback stores the
    // notes flattened onto one line, and PRICING NOTES explain the pricing drivers, often with bare numbers.
    const notes = [
      "OBSERVATIONS",
      "- Estimated DBH: Approximately 30-36 inches",
      "- Estimated height: Approximately 60-70 feet",
      "- Crown structure: 2 co-dominant leaders",
      "- Proximity to structures: Close to house/shed",
      "- Disposal: 3 loads",
      "PRICE BREAKDOWN",
      "- Base price (DBH bucket): $1,400",
      "- Height: +$200",
      "- Large tree price protection applied: Yes",
      "- Total: $2,500",
      "PRICING NOTES",
      "The tree leans toward the house, so the crew will rope down every limb.",
      "Large tree price protection was applied because the trunk is over 30 inches, lifting the total to 2500.",
      "The minimum charge of 250 does not apply here.",
      "Base rate for this DBH bucket is 1400 before adders.",
      "Expect around 1700 all in.",
    ];
    for (const separator of [" ", "\n"]) {
      const out = cleanAiOverview(notes.join(separator));
      expect(out, JSON.stringify(separator)).toBe(
        "Estimated DBH: Approximately 30-36 inches. Estimated height: Approximately 60-70 feet. " +
          "Crown structure: 2 co-dominant leaders. Proximity to structures: Close to house/shed. Disposal: 3 loads. " +
          "The tree leans toward the house, so the crew will rope down every limb.",
      );
      expect(out).not.toMatch(MONEY);
      expect(out).not.toMatch(/2,?500|1,?400|1,?700|\b250\b|protection|minimum|adders|bucket|\brates?\b|\bbase\b/i);
    }
  });

  it("drops a sentence about the price even with no dollar sign, wherever it appears", () => {
    for (const talk of [
      "Sale price 1686.",
      "Cost to customer: 1,686.",
      "Price range 1,450-1,700.",
      "Estimate 1450 to 1700.",
      "Margin 30%.",
      "Price protection applied.",
      "The pricing drivers are the lean and the house.",
      "Rigging adds 300.",
      "Haul away runs 125 per load.",
      "Two climbers at 85/hr.",
      "The homeowner paid 1,250 last year.",
      "The total comes to 1,686.",
      "The total comes to 1,686 in total.",
      "Estimated 1,500 in all.",
    ]) {
      expect(cleanAiOverview(`Dead limbs hang over the drive. ${talk} Two loads of debris.`), talk).toBe(
        "Dead limbs hang over the drive. Two loads of debris.",
      );
    }
  });

  it("keeps observations that only look like price talk: measurements, counts and leaf margins", () => {
    const notes = [
      "Total height: approximately 60-70 feet.",
      "Estimated DBH: approximately 18-24 inches.",
      "A 30-inch trunk leans 40% toward the house.",
      "Estimated 2 loads of debris and 3 hours of work.",
      "Estimated DBH: 30 in at the base.",
      "Crown structure: 3 co-dominant leaders.",
      "Leaf margins are scorched on the south side.",
    ];
    expect(cleanAiOverview(notes.join("\n"))).toBe(notes.join(" "));
  });

  it("keeps a PRICING NOTES sentence only when it holds no bare number, since that section explains the price", () => {
    const notes = [
      "OBSERVATIONS:",
      "- Crown structure: 3 co-dominant leaders",
      "PRICING NOTES:",
      "Expect around 1700 all in.",
      "The 3 co-dominant leaders need rigging.",
      "Fenced backyard, so everything goes over the fence by hand.",
      "",
      "The 3 co-dominant leaders need rigging.",
    ].join("\n");
    // After the blank line the section is over, so the same sentence is kept there.
    expect(cleanAiOverview(notes)).toBe(
      "Crown structure: 3 co-dominant leaders. Fenced backyard, so everything goes over the fence by hand. " +
        "The 3 co-dominant leaders need rigging.",
    );
    expect(cleanAiOverview("Pricing notes: Expect around 1700 all in. The tree leans over the drive.")).toBe(
      "The tree leans over the drive.",
    );
    // A figure followed by "in total" or "in all" is a price, not inches.
    expect(cleanAiOverview("PRICING NOTES: It comes to 1,686 in total with disposal. About 1,500 in all, crew included. The trunk is 30 in wide.")).toBe(
      "The trunk is 30 in wide.",
    );
  });

  it("takes out a figure that only becomes a price when two lines are joined", () => {
    const out = cleanAiOverview("The owner set aside 1,500\ndollars for the job.\nDead limbs hang over the drive.");
    expect(out).not.toMatch(MONEY);
    expect(out).not.toContain("1,500");
    expect(out).toContain("Dead limbs hang over the drive.");
  });

  it("collapses all whitespace into one plain paragraph", () => {
    const messy = "The  oak\tleans\n\ntoward   the house.\r\nDead limbs  over the drive.   \n\n\n  Two loads of debris  ";
    expect(cleanAiOverview(messy)).toBe("The oak leans toward the house. Dead limbs over the drive. Two loads of debris.");
  });

  it("never shows an em or en dash", () => {
    const out = cleanAiOverview(
      "The oak \u2014 about 60 ft \u2014 leans toward the house. Trunks are 18\u201324 inch wide. North\u2013south fence line \u2013",
    );
    expect(out).toBe("The oak, about 60 ft, leans toward the house. Trunks are 18-24 inch wide. North-south fence line.");
    expect(out).not.toMatch(LONG_DASH);
  });

  it("returns an empty string for no text, or for notes with nothing a customer may read", () => {
    for (const empty of [null, undefined, "", "   ", "\n\n"]) expect(cleanAiOverview(empty)).toBe("");
    expect(cleanAiOverview("PRICE BREAKDOWN:\n- Base price: $1,200\nTotal: $1,686")).toBe("");
    expect(cleanAiOverview("Total: $1,686\nEstimator fee: $65\nDifficulty: Hard")).toBe("");
  });

  describe("the 1,500 character cap", () => {
    it("is 1,500 characters", () => {
      expect(OVERVIEW_MAX_CHARS).toBe(1500);
    });

    it("ends on the last whole sentence that fits", () => {
      const sentences = Array.from(
        { length: 60 },
        (_, i) => `Observation ${i + 1} notes a dead limb over the drive and the fence.`,
      );
      const full = sentences.join(" ");
      // A plain cut at 1,500 must land mid-sentence, or this test would prove nothing.
      expect(full.length).toBeGreaterThan(OVERVIEW_MAX_CHARS);
      expect(full.slice(0, OVERVIEW_MAX_CHARS)).not.toMatch(/[.!?]$/);
      let expected = "";
      for (const sentence of sentences) {
        const next = expected ? `${expected} ${sentence}` : sentence;
        if (next.length > OVERVIEW_MAX_CHARS) break;
        expected = next;
      }
      const out = cleanAiOverview(full);
      expect(out).toBe(expected);
      expect(out.length).toBeLessThanOrEqual(OVERVIEW_MAX_CHARS);
      expect(full.startsWith(`${out} `)).toBe(true);
    });

    it("keeps an overview of exactly 1,500 characters whole and cuts one of 1,501", () => {
      const first = "Dead limbs over the drive.";
      const exact = `${first} ${"y".repeat(OVERVIEW_MAX_CHARS - first.length - 2)}.`;
      expect(exact).toHaveLength(1500);
      expect(cleanAiOverview(exact)).toBe(exact);
      const over = `${first} ${"y".repeat(OVERVIEW_MAX_CHARS - first.length - 1)}.`;
      expect(over).toHaveLength(1501);
      expect(cleanAiOverview(over)).toBe(first);
    });

    it("cuts one sentence longer than the cap after a whole word and closes it with a period", () => {
      const long = `${Array.from({ length: 400 }, (_, i) => `limb${i}`).join(" ")}.`;
      const out = cleanAiOverview(long);
      expect(out.length).toBeLessThanOrEqual(OVERVIEW_MAX_CHARS);
      expect(out.length).toBeGreaterThan(OVERVIEW_MAX_CHARS - 10);
      expect(out).toMatch(/ limb\d+\.$/);
      expect(long.startsWith(`${out.slice(0, -1)} `)).toBe(true);
    });
  });
});

describe("DEFAULT_QUOTE_TEMPLATE", () => {
  it("is the service as the one priced line, then stump grinding and haul away as included scope lines, not taxable", () => {
    expect(DEFAULT_QUOTE_TEMPLATE).toStrictEqual({
      titlePattern: "{service} in {city}",
      lines: [
        { kind: "main", name: "{service}" },
        { kind: "scope", name: "Stump grinding", description: "Included in the price.", showWhen: "stump" },
        { kind: "scope", name: "Haul away wood and debris", description: "Included in the price.", showWhen: "disposal" },
      ],
      taxable: false,
    });
  });

  it("is frozen, so one company's quote cannot change the template for every other company", () => {
    expect(Object.isFrozen(DEFAULT_QUOTE_TEMPLATE)).toBe(true);
    expect(Object.isFrozen(DEFAULT_QUOTE_TEMPLATE.lines)).toBe(true);
    for (const line of DEFAULT_QUOTE_TEMPLATE.lines) expect(Object.isFrozen(line)).toBe(true);
    expect(() => (DEFAULT_QUOTE_TEMPLATE.lines as QuoteTemplateLine[]).push({ kind: "scope", name: "Extra" })).toThrow();
  });
});

describe("quoteTemplateFrom", () => {
  it("uses the default for the empty setting ('{}') or anything that is not an object", () => {
    for (const raw of [{}, null, undefined, [], "x", 42]) {
      expect(quoteTemplateFrom(raw), JSON.stringify(raw)).toEqual(DEFAULT_QUOTE_TEMPLATE);
    }
  });

  it("keeps a stored title pattern, taxable setting and well-formed lines", () => {
    const lines = [
      { kind: "scope", name: "Permit check", description: "Done before work starts.", taxable: false, showWhen: "always" },
      { kind: "main", name: "{service}", description: "As discussed on site." },
    ];
    expect(quoteTemplateFrom({ titlePattern: "{service} for {city}", taxable: true, lines })).toStrictEqual({
      titlePattern: "{service} for {city}",
      lines,
      taxable: true,
    });
  });

  it("ignores JSON nulls in a line's optional fields", () => {
    const raw = { lines: [{ kind: "main", name: "{service}", description: null, taxable: null, showWhen: null }] };
    expect(quoteTemplateFrom(raw).lines).toStrictEqual([{ kind: "main", name: "{service}" }]);
  });

  it("falls back to the default for each malformed part on its own", () => {
    expect(quoteTemplateFrom({ titlePattern: "   ", taxable: "yes", lines: "main" })).toEqual(DEFAULT_QUOTE_TEMPLATE);
    const main = { kind: "main", name: "{service}" };
    for (const lines of [
      [],
      [{ kind: "scope", name: "Cleanup" }],
      [main, { kind: "main", name: "Second price" }],
      [main, { kind: "extra", name: "Cleanup" }],
      [main, { kind: "scope", name: "   " }],
      [main, { kind: "scope", name: "Cleanup", showWhen: "weekly" }],
      [main, { kind: "scope", name: "Cleanup", description: 5 }],
      [main, { kind: "scope", name: "Cleanup", taxable: "no" }],
      [main, "Cleanup"],
    ]) {
      expect(quoteTemplateFrom({ taxable: true, lines }), JSON.stringify(lines)).toEqual({
        ...DEFAULT_QUOTE_TEMPLATE,
        taxable: true,
      });
    }
  });
});

describe("buildQuoteLineItems", () => {
  it("puts the whole sale price on exactly one main line, named after the service", () => {
    const items = buildQuoteLineItems(job({ needsStump: true, disposalLoads: 2 }));
    expect(names(items)).toEqual(["Tree Removal", "Stump grinding", "Haul away wood and debris"]);
    const priced = items.filter((i) => i.unitPrice !== 0);
    expect(priced).toHaveLength(1);
    expect(priced[0]).toMatchObject({ name: "Tree Removal", quantity: 1, unitPrice: 1686, textOnly: false });
    expect(items.filter((i) => !i.textOnly)).toEqual(priced);
  });

  it("makes every scope line text only at 0, marked as included", () => {
    const scope = buildQuoteLineItems(job({ needsStump: true, disposalLoads: 2 })).filter((i) => i.textOnly);
    expect(scope).toStrictEqual([
      { name: "Stump grinding", description: "Included in the price.", quantity: 1, unitPrice: 0, taxable: false, textOnly: true },
      {
        name: "Haul away wood and debris",
        description: "Included in the price.",
        quantity: 1,
        unitPrice: 0,
        taxable: false,
        textOnly: true,
      },
    ]);
  });

  it("adds the stump grinding line only when the job includes it and the service is not stump grinding already", () => {
    expect(names(buildQuoteLineItems(job({ needsStump: true })))).toEqual(["Tree Removal", "Stump grinding"]);
    expect(names(buildQuoteLineItems(job({ needsStump: false })))).toEqual(["Tree Removal"]);
    expect(names(buildQuoteLineItems(job({ needsStump: undefined as unknown as boolean })))).toEqual(["Tree Removal"]);
    expect(names(buildQuoteLineItems(job({ service: "Stump Grinding", needsStump: true })))).toEqual(["Stump Grinding"]);
  });

  it("adds the haul away line only when the crew expects disposal loads", () => {
    for (const loads of [1, 2, 0.5]) {
      expect(names(buildQuoteLineItems(job({ disposalLoads: loads }))), String(loads)).toEqual([
        "Tree Removal",
        "Haul away wood and debris",
      ]);
    }
    for (const loads of [0, null, undefined, -1, NaN]) {
      expect(names(buildQuoteLineItems(job({ disposalLoads: loads }))), String(loads)).toEqual(["Tree Removal"]);
    }
  });

  it("adds up to the sale price exactly, to the cent", () => {
    for (const [salePrice, cents] of [
      [1686, 1686],
      [1686.5, 1686.5],
      [1999.999, 2000],
      [0.01, 0.01],
      [1234.5678, 1234.57],
    ]) {
      const items = buildQuoteLineItems(job({ salePrice, needsStump: true, disposalLoads: 2 }));
      expect(items, String(salePrice)).toHaveLength(3);
      expect(total(items), String(salePrice)).toBe(cents);
      expect(items[0].unitPrice, String(salePrice)).toBe(cents);
    }
  });

  it("rounds half a cent up on the price as written", () => {
    expect(buildQuoteLineItems(job({ salePrice: 1.005 }))[0].unitPrice).toBe(1.01);
    expect(buildQuoteLineItems(job({ salePrice: 2.675 }))[0].unitPrice).toBe(2.68);
    expect(buildQuoteLineItems(job({ salePrice: 0.005 }))[0].unitPrice).toBe(0.01);
  });

  it("throws a clear error rather than price a quote at zero, below zero or with no number", () => {
    for (const salePrice of [0, -5, -0.01, 0.004]) {
      expect(() => buildQuoteLineItems(job({ salePrice })), String(salePrice)).toThrow(
        "The quote needs a sale price above zero.",
      );
    }
    for (const salePrice of [NaN, Infinity, -Infinity, null, undefined]) {
      expect(() => buildQuoteLineItems(job({ salePrice: salePrice as number })), String(salePrice)).toThrow(
        "The quote has no valid sale price.",
      );
    }
  });

  it("puts the cleaned AI overview in the main line's description, and on no other line", () => {
    const overview = [
      "OBSERVATIONS:",
      "- Species: Post oak",
      "- Dead limbs hang over the drive.",
      "PRICE BREAKDOWN:",
      "- Base price: $1,200",
      "Total: $1,686",
    ].join("\n");
    const items = buildQuoteLineItems(job({ overview, needsStump: true, disposalLoads: 2 }));
    expect(items[0].description).toBe("Species: Post oak. Dead limbs hang over the drive.");
    expect(items[0].description).toBe(cleanAiOverview(overview));
    for (const line of items.slice(1)) expect(line.description).toBe("Included in the price.");
    for (const line of items) expect(line.description).not.toMatch(MONEY);
  });

  it("puts a template's own main line description first, then the overview", () => {
    const template: QuoteTemplate = {
      ...DEFAULT_QUOTE_TEMPLATE,
      lines: [{ kind: "main", name: "{service}", description: "Full {service} as discussed on site." }],
    };
    expect(buildQuoteLineItems(job({ template }))[0].description).toBe(
      "Full Tree Removal as discussed on site.\n\nLarge post oak leaning toward the house.",
    );
  });

  it("leaves the main description empty when there is no overview, as on website leads", () => {
    for (const overview of [null, undefined, "", "Total: $1,686"]) {
      expect(buildQuoteLineItems(job({ overview }))[0], String(overview)).toMatchObject({
        name: "Tree Removal",
        description: "",
        unitPrice: 1686,
      });
    }
  });

  it("returns only TreeCheck's line fields: no message, and the price only in unitPrice (D2)", () => {
    for (const line of buildQuoteLineItems(job({ needsStump: true, disposalLoads: 2 }))) {
      expect(Object.keys(line).sort()).toEqual(["description", "name", "quantity", "taxable", "textOnly", "unitPrice"]);
    }
  });

  it("takes taxable from the template unless a line says otherwise", () => {
    const taxable = (template: QuoteTemplate) =>
      buildQuoteLineItems(job({ template, needsStump: true, disposalLoads: 2 })).map((i) => i.taxable);
    const [main, stump, haul] = DEFAULT_QUOTE_TEMPLATE.lines;
    expect(taxable(DEFAULT_QUOTE_TEMPLATE)).toEqual([false, false, false]);
    expect(taxable({ ...DEFAULT_QUOTE_TEMPLATE, taxable: true })).toEqual([true, true, true]);
    expect(taxable({ ...DEFAULT_QUOTE_TEMPLATE, taxable: true, lines: [main, { ...stump, taxable: false }, haul] })).toEqual([
      true,
      false,
      true,
    ]);
    expect(taxable({ ...DEFAULT_QUOTE_TEMPLATE, lines: [{ ...main, taxable: true }, stump, haul] })).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("keeps the template's order and fills {service} in names and descriptions", () => {
    const template: QuoteTemplate = {
      titlePattern: "{service}",
      taxable: false,
      lines: [
        { kind: "scope", name: "Permit check for {service}", description: "Done before {service} starts." },
        { kind: "main", name: "{service}" },
        { kind: "scope", name: "Cleanup", showWhen: "always" },
      ],
    };
    const items = buildQuoteLineItems(job({ template }));
    expect(names(items)).toEqual(["Permit check for Tree Removal", "Tree Removal", "Cleanup"]);
    expect(items[0].description).toBe("Done before Tree Removal starts.");
    expect(items.map((i) => i.unitPrice)).toEqual([0, 1686, 0]);
  });

  it("calls the work Tree work when the job has no service, and never shows a price or a long dash on a line", () => {
    expect(buildQuoteLineItems(job({ service: null }))[0].name).toBe("Tree work");
    expect(buildQuoteLineItems(job({ service: "   " }))[0].name).toBe("Tree work");
    expect(buildQuoteLineItems(job({ service: "Tree Removal $1,686" }))[0].name).toBe("Tree Removal");
    const template: QuoteTemplate = {
      ...DEFAULT_QUOTE_TEMPLATE,
      lines: [{ kind: "main", name: "{service} \u2014 full job", description: "As discussed \u2013 crew of three." }],
    };
    const [main] = buildQuoteLineItems(
      job({ template, service: "Tree Removal \u2014 large oak", overview: "Leaning oak \u2014 near the house." }),
    );
    expect(main.name).toBe("Tree Removal, large oak, full job");
    expect(main.description).toBe("As discussed, crew of three.\n\nLeaning oak, near the house.");
  });

  it("throws when the template does not have exactly one main line", () => {
    const main: QuoteTemplateLine = { kind: "main", name: "{service}" };
    const scope: QuoteTemplateLine = { kind: "scope", name: "Cleanup" };
    for (const lines of [[], [scope], [main, main]]) {
      expect(() => buildQuoteLineItems(job({ template: { ...DEFAULT_QUOTE_TEMPLATE, lines } }))).toThrow(
        "The quote template must have exactly one main line.",
      );
    }
    expect(() => buildQuoteLineItems(job({ template: null as unknown as QuoteTemplate }))).toThrow(
      "The quote template must have exactly one main line.",
    );
  });
});

describe("quoteTitle", () => {
  // Custom patterns: the title with a known city, then with none.
  const PATTERNS: [string, string, string][] = [
    ["{service} - {city}", "Tree Removal - Edmond", "Tree Removal"],
    ["{service}, {city}", "Tree Removal, Edmond", "Tree Removal"],
    ["{service} ({city})", "Tree Removal (Edmond)", "Tree Removal"],
    ["{service} [{city}]", "Tree Removal [Edmond]", "Tree Removal"],
    ["{city}: {service}", "Edmond: Tree Removal", "Tree Removal"],
    ["{city} | {service}", "Edmond | Tree Removal", "Tree Removal"],
    ["| {service} | {city} |", "Tree Removal | Edmond", "Tree Removal"],
    ["{service} near {city}", "Tree Removal near Edmond", "Tree Removal"],
    ["{city} {service}", "Edmond Tree Removal", "Tree Removal"],
    ["{service} / {city} / TreeCheck", "Tree Removal / Edmond / TreeCheck", "Tree Removal / TreeCheck"],
    ["Quote for {service}, {city}", "Quote for Tree Removal, Edmond", "Quote for Tree Removal"],
  ];

  it("names the service and the city", () => {
    expect(title("Tree Removal", "Edmond")).toBe("Tree Removal in Edmond");
    expect(title("Stump Grinding", "Oklahoma City")).toBe("Stump Grinding in Oklahoma City");
  });

  it("is just the service when the city is unknown, with no dangling 'in'", () => {
    for (const city of [null, undefined, "", "   "]) expect(title("Tree Removal", city), String(city)).toBe("Tree Removal");
  });

  it("never has a doubled space, from the job or from the pattern", () => {
    expect(title("  Tree   Removal ", "  Oklahoma   City ")).toBe("Tree Removal in Oklahoma City");
    expect(title("Tree Removal", "Edmond", "{service}  in   {city}")).toBe("Tree Removal in Edmond");
    expect(title("Tree Removal", null, "{service}  in   {city}")).toBe("Tree Removal");
  });

  it("calls the work Tree work when the job has no service", () => {
    expect(title(null, "Edmond")).toBe("Tree work in Edmond");
    expect(title(undefined, null)).toBe("Tree work");
  });

  it("drops a custom pattern's separator or brackets when the city is unknown, and keeps them when it is known", () => {
    for (const [pattern, withCity, withoutCity] of PATTERNS) {
      expect(title("Tree Removal", "Edmond", pattern), pattern).toBe(withCity);
      expect(title("Tree Removal", null, pattern), pattern).toBe(withoutCity);
    }
  });

  it("never leaves a doubled space, an empty bracket, an edge separator or a placeholder, whatever is missing", () => {
    for (const [pattern] of PATTERNS) {
      for (const service of ["Tree Removal", "  Tree   Removal ", null]) {
        for (const city of ["Edmond", " Oklahoma  City ", "", null]) {
          const t = title(service, city, pattern);
          expect(t, `${pattern} / ${service} / ${city}`).not.toMatch(
            / {2}|^[\s,;:|/&+\u00b7-]|[\s,;:|/&+\u00b7-]$|\(\s*\)|\[\s*\]|\{(?:service|city)\}/,
          );
        }
      }
    }
  });

  it("never shows a price or a long dash", () => {
    expect(title("Tree Removal $1,686", "Edmond")).toBe("Tree Removal in Edmond");
    expect(title("Tree Removal \u2014 large oak", "Edmond")).toBe("Tree Removal, large oak in Edmond");
    expect(title("Tree Removal", "Edmond", "{service} \u2014 {city}")).toBe("Tree Removal, Edmond");
    expect(title("Tree Removal", null, "{service} \u2013 {city}")).toBe("Tree Removal");
    expect(title("Tree Removal", "Edmond", "{service} \u2013 {city}")).not.toMatch(LONG_DASH);
  });

  it("uses the default pattern when the template has none", () => {
    for (const titlePattern of ["", "   "]) {
      expect(title("Tree Removal", "Edmond", titlePattern), JSON.stringify(titlePattern)).toBe("Tree Removal in Edmond");
    }
  });
});
