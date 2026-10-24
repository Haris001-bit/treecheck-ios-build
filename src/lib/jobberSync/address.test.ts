// TreeCheck Jobber sync: one-line US addresses, address comparison, and the customer details and
// address a Jobber quote is built from (plan section 4, "Customer details and address precedence").
// Pure functions, no network. Every name, address, phone number and email here is made up: phone
// numbers use the 555-01xx range kept for fiction, emails use example.com.
import { describe, expect, it } from "vitest";
import {
  addressKey,
  customerDetails,
  jobCardAddress,
  NO_STREET_REASON,
  parseUsAddress,
  samePlace,
  type Address,
  type CaptureFields,
} from "../../../supabase/functions/_shared/jobberAddress";

// An Edmond, OK 73034 address with the given street line and any other parts changed.
const at = (street1: string, parts: Partial<Address> = {}): Address => ({
  street1,
  city: "Edmond",
  province: "OK",
  postalCode: "73034",
  country: "US",
  ...parts,
});

// A Scout capture's own address fields, and the one line bid-request-create first wrote from them.
const CAPTURE: CaptureFields = {
  address_street: "123 Main St",
  address_city: "Edmond",
  address_state: "OK",
  address_zip: "73034",
};
const CAPTURE_LINE = "123 Main St, Edmond, OK, 73034";

describe("parseUsAddress", () => {
  it("reads a line with commas and the same line without them", () => {
    expect(parseUsAddress("123 Main St, Edmond, OK 73034")).toEqual(at("123 Main St"));
    expect(parseUsAddress("123 Main St Edmond OK 73034")).toEqual(at("123 Main St"));
    const okc = at("1820 NW 24th St", { city: "Oklahoma City", postalCode: "73106" });
    expect(parseUsAddress("1820 NW 24th St, Oklahoma City, OK 73106")).toEqual(okc);
    expect(parseUsAddress("1820 NW 24th St Oklahoma City OK 73106")).toEqual(okc);
  });

  it("ends a street without commas at its type word or a run of them, a numbered road, or a direction after the type", () => {
    const noZip = { postalCode: "" };
    expect(parseUsAddress("123 Park Place Dr Edmond OK")).toEqual(at("123 Park Place Dr", noZip));
    // A type word needs a name before it.
    expect(parseUsAddress("123 St Charles Ave Edmond OK")).toEqual(at("123 St Charles Ave", noZip));
    expect(parseUsAddress("123 Court St Edmond OK")).toEqual(at("123 Court St", noZip));
    expect(parseUsAddress("123 Main St NW Edmond OK")).toEqual(at("123 Main St NW", noZip));
    // A full direction word after the type belongs to the city.
    expect(parseUsAddress("12 Pine St North Little Rock AR")).toEqual(
      at("12 Pine St", { city: "North Little Rock", province: "AR", postalCode: "" }),
    );
    expect(parseUsAddress("12345 County Road 3050 Edmond OK")).toEqual(at("12345 County Road 3050", noZip));
    expect(parseUsAddress("500 Highway 66 Arcadia OK")).toEqual(at("500 Highway 66", { city: "Arcadia", postalCode: "" }));
  });

  it("leaves a line with no type word all street, unless a city hint ends it", () => {
    expect(parseUsAddress("123 Broadway Edmond")).toEqual(at("123 Broadway Edmond", { city: "", province: "", postalCode: "" }));
    expect(parseUsAddress("123 Broadway Edmond", { city: "Edmond" })).toEqual(at("123 Broadway", { province: "", postalCode: "" }));
    expect(parseUsAddress("123 Broadway Del City OK", { city: "Del City" })).toEqual(
      at("123 Broadway", { city: "Del City", postalCode: "" }),
    );
  });

  it("reads the state as a two-letter code or a full name, in any case", () => {
    expect(parseUsAddress("123 Main St, Edmond, Oklahoma 73034")).toEqual(at("123 Main St"));
    expect(parseUsAddress("123 Main St, Edmond, ok 73034")).toEqual(at("123 Main St"));
    expect(parseUsAddress("123 Main St, Edmond, Okla.")).toEqual(at("123 Main St", { postalCode: "" }));
    const raleigh = at("45 Elm Ave", { city: "Raleigh", province: "NC", postalCode: "27601" });
    expect(parseUsAddress("45 Elm Ave, Raleigh, North Carolina 27601")).toEqual(raleigh);
    expect(parseUsAddress("45 Elm Ave Raleigh north carolina 27601")).toEqual(raleigh);
  });

  it("reads a code that is also a street word (Ct, Ne, La, Wy) as the state only when a city comes before it", () => {
    const bare = { city: "", province: "", postalCode: "" };
    expect(parseUsAddress("456 Oak Ct")).toEqual(at("456 Oak Ct", bare));
    expect(parseUsAddress("88 Pine St NE")).toEqual(at("88 Pine St NE", bare));
    const hartford = at("456 Oak Ct", { city: "Hartford", province: "CT", postalCode: "06103" });
    expect(parseUsAddress("456 Oak Ct Hartford CT 06103")).toEqual(hartford);
    expect(parseUsAddress("456 Oak Ct, Hartford, CT 06103")).toEqual(hartford);
  });

  it("title-cases a part typed all in lowercase, and keeps the case of a part with any capital", () => {
    expect(parseUsAddress("1820 nw 24th st, oklahoma city, ok 73106")).toEqual(
      at("1820 NW 24th St", { city: "Oklahoma City", postalCode: "73106" }),
    );
    // Each part on its own: the street keeps its own capitals, the city typed in lowercase is title-cased.
    expect(parseUsAddress("100 de la Rosa St, edmond, OK")).toEqual(at("100 de la Rosa St", { postalCode: "" }));
  });

  it("keeps a ZIP+4 as 73034-1234, however it was written", () => {
    for (const zip of ["73034-1234", "730341234", "73034 - 1234"]) {
      expect(parseUsAddress(`123 Main St, Edmond, OK ${zip}`)).toEqual(at("123 Main St", { postalCode: "73034-1234" }));
    }
  });

  it("puts an apartment, unit, suite or # in street2, with or without commas", () => {
    const apt = at("123 Main St", { street2: "Apt 4" });
    expect(parseUsAddress("123 Main St Apt 4, Edmond, OK 73034")).toEqual(apt);
    expect(parseUsAddress("123 Main St, Apt 4, Edmond, OK 73034")).toEqual(apt);
    expect(parseUsAddress("123 Main St Apt 4 Edmond OK 73034")).toEqual(apt);
    expect(parseUsAddress("123 Main St, Suite 200, Edmond, OK 73034")).toEqual(at("123 Main St", { street2: "Suite 200" }));
    expect(parseUsAddress("123 Main St #4, Edmond, OK 73034")).toEqual(at("123 Main St", { street2: "#4" }));
    expect(parseUsAddress("123 Main St Unit B Edmond OK 73034")).toEqual(at("123 Main St", { street2: "Unit B" }));
  });

  it("accepts extra spaces, line breaks (read as commas) and a trailing USA", () => {
    const want = at("123 Main St");
    expect(parseUsAddress("  123   Main  St ,  Edmond ,OK   73034  ")).toEqual(want);
    expect(parseUsAddress("123 Main St\nEdmond, OK 73034")).toEqual(want);
    expect(parseUsAddress("123 Main St\r\nEdmond\r\nOK 73034")).toEqual(want);
    // A street with no type word ends only where its line does.
    expect(parseUsAddress("123 Broadway\nEdmond, OK 73034")).toEqual(at("123 Broadway"));
    expect(parseUsAddress("123 Main St, Edmond, OK 73034, USA")).toEqual(want);
    expect(parseUsAddress("123 Main St Edmond OK 73034 U.S.A.")).toEqual(want);
    expect(parseUsAddress("123 Main St, Edmond, OK 73034 United States")).toEqual(want);
  });

  describe("hints fill only what the line leaves out", () => {
    it("fills the city, state and ZIP from the hints", () => {
      expect(parseUsAddress("123 Main St", { city: "Edmond", province: "OK", postalCode: "73034" })).toEqual(at("123 Main St"));
      expect(parseUsAddress("123 main st", { city: "oklahoma city" })).toEqual(
        at("123 Main St", { city: "Oklahoma City", province: "", postalCode: "" }),
      );
    });

    it("never overrides what the line says", () => {
      const hints = { city: "Edmond", province: "OK", postalCode: "73034", defaultProvince: "OK" };
      expect(parseUsAddress("123 Main St, Austin, TX 78701", hints)).toEqual(
        at("123 Main St", { city: "Austin", province: "TX", postalCode: "78701" }),
      );
    });

    it("uses the province hint before the company's default province, and the default only when nothing else gives a state", () => {
      const edmond = at("123 Main St", { postalCode: "" });
      expect(parseUsAddress("123 Main St, Edmond", { province: "Oklahoma", defaultProvince: "TX" })).toEqual(edmond);
      expect(parseUsAddress("123 Main St, Edmond", { defaultProvince: "OK" })).toEqual(edmond);
      expect(parseUsAddress("123 Main St, Edmond, OK", { defaultProvince: "TX" })).toEqual(edmond);
    });

    it("skips the ZIP hint when the line names a city other than the city hint", () => {
      expect(parseUsAddress("123 Main St, Norman", { city: "Edmond", postalCode: "73034" })).toEqual(
        at("123 Main St", { city: "Norman", province: "", postalCode: "" }),
      );
      expect(parseUsAddress("123 Main St, edmond", { city: "Edmond", postalCode: "73034" })).toEqual(at("123 Main St", { province: "" }));
    });

    it("ignores blank and stand-in hints and a ZIP hint that is not a ZIP", () => {
      const hints = { city: "Unknown", province: "n/a", postalCode: "7303", defaultProvince: " " };
      expect(parseUsAddress("123 Main St", hints)).toEqual(at("123 Main St", { city: "", province: "", postalCode: "" }));
    });
  });

  it("gives null with no street: no house number, only a city or ZIP, a PO box, a unit alone, blank or a stand-in", () => {
    const hints = { city: "Edmond", province: "OK", postalCode: "73034", defaultProvince: "OK" };
    const lines = [
      "Main Street, Edmond, OK",
      "Edmond, OK 73034",
      "73034",
      "PO Box 123, Edmond, OK 73034",
      "P.O. Box 123, Edmond, OK",
      "Apt 4, Edmond, OK",
      "",
      "   ",
      "Homeowner",
      "Unknown",
      null,
      undefined,
    ];
    for (const line of lines) expect(parseUsAddress(line, hints), String(line)).toBeNull();
  });
});

describe("addressKey", () => {
  it("gives the same key however the address was written", () => {
    const key = addressKey(at("123 N Main St", { street2: "Apt 4" }));
    expect(key).not.toBe("");
    const written = [
      at("123 North Main Street", { street2: "Apartment 4", city: "EDMOND", province: "Oklahoma", postalCode: "73034-1234" }),
      at("123 N. Main St. #4", { city: "edmond", province: "ok" }),
      at("123 north main st unit 4"),
    ];
    for (const address of written) expect(addressKey(address), address.street1).toBe(key);
  });

  it("abbreviates street types, directions before or after the name, and place words such as Fort", () => {
    expect(addressKey(at("1820 Northwest 24th Street"))).toBe(addressKey(at("1820 NW 24th St")));
    expect(addressKey(at("123 Main Street Northwest"))).toBe(addressKey(at("123 Main St NW")));
    expect(addressKey(at("12 Oak Avenue", { city: "Fort Worth", province: "Texas", postalCode: "76102" }))).toBe(
      addressKey(at("12 Oak Ave", { city: "Ft. Worth", province: "TX", postalCode: "76102" })),
    );
  });

  it("tells different addresses apart", () => {
    const keys = [
      at("123 Main St"),
      at("124 Main St"),
      at("123 Main Ave"),
      at("123 S Main St"),
      at("123 Main St NE"),
      at("123 Main St", { street2: "Apt 5" }),
      at("123 Main St", { city: "Norman" }),
      at("123 Main St", { postalCode: "73013" }),
    ].map(addressKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("cuts the ZIP to five digits, and a missing ZIP gives a different key", () => {
    expect(addressKey(at("123 Main St", { postalCode: "73034-1234" }))).toBe(addressKey(at("123 Main St")));
    expect(addressKey(at("123 Main St", { postalCode: "" }))).not.toBe(addressKey(at("123 Main St")));
  });

  it("is empty for no address", () => {
    expect(addressKey(null)).toBe("");
    expect(addressKey(undefined)).toBe("");
  });
});

describe("samePlace", () => {
  it("matches the same house and street however written, by the five-digit ZIP", () => {
    expect(samePlace(at("123 North Main Street", { postalCode: "73034-1234" }), at("123 N Main St"))).toBe(true);
    expect(samePlace(at("1820 Northwest 24th Street"), at("1820 N.W. 24th St."))).toBe(true);
    expect(samePlace(at("123 Main Street Northwest"), at("123 Main St NW"))).toBe(true);
  });

  it("decides by ZIP when both have one, whatever the cities say", () => {
    expect(samePlace(at("123 Main St"), at("123 Main St", { postalCode: "73013" }))).toBe(false);
    expect(samePlace(at("123 Main St", { city: "Oklahoma City" }), at("123 Main St"))).toBe(true);
  });

  it("compares the cities when either ZIP is missing", () => {
    expect(samePlace(at("123 Main St", { postalCode: "" }), at("123 Main St", { city: "edmond" }))).toBe(true);
    expect(samePlace(at("123 Main St", { postalCode: "" }), at("123 Main St", { city: "Norman" }))).toBe(false);
    expect(samePlace(at("123 Main St", { city: "", postalCode: "" }), at("123 Main St", { city: "" }))).toBe(false);
  });

  it("lets a street type or a unit that only one side has match, but not two different ones", () => {
    expect(samePlace(at("123 Main"), at("123 Main St"))).toBe(true);
    expect(samePlace(at("123 Main St"), at("123 Main Ave"))).toBe(false);
    expect(samePlace(at("123 Main St Apt 4"), at("123 Main St"))).toBe(true);
    expect(samePlace(at("123 Main St Apt 4"), at("123 Main St", { street2: "Unit 4" }))).toBe(true);
    expect(samePlace(at("123 Main St Apt 4"), at("123 Main St", { street2: "Apt 5" }))).toBe(false);
  });

  it("never matches another house number or direction, or a street with no house number", () => {
    expect(samePlace(at("123 Main St"), at("124 Main St"))).toBe(false);
    expect(samePlace(at("123 N Main St"), at("123 S Main St"))).toBe(false);
    expect(samePlace(at("123 Main St NW"), at("123 Main St NE"))).toBe(false);
    expect(samePlace(at("Main St"), at("Main St"))).toBe(false);
  });

  it("is false when either address is missing", () => {
    expect(samePlace(at("123 Main St"), null)).toBe(false);
    expect(samePlace(undefined, at("123 Main St"))).toBe(false);
  });
});

describe("jobCardAddress: the job card, then the capture, then the lead (plan section 4)", () => {
  it("1. a job-card line that is the capture's combined fields gives the capture's own fields", () => {
    expect(jobCardAddress({ request: { customer_address: CAPTURE_LINE, city: "Edmond" }, capture: CAPTURE })).toEqual({
      address: at("123 Main St"),
      source: "capture",
    });
  });

  it("1. so does a job-card line that normalises to them however it is written", () => {
    for (const customer_address of ["123 Main Street, Edmond, Oklahoma 73034-1234", "123 main st edmond ok 73034, USA"]) {
      expect(jobCardAddress({ request: { customer_address, city: "Edmond" }, capture: CAPTURE }), customer_address).toEqual({
        address: at("123 Main St"),
        source: "capture",
      });
    }
  });

  it("2. otherwise the job-card line wins, parsed with request.city and the capture's state and ZIP", () => {
    expect(
      jobCardAddress({ request: { customer_address: "456 Oak Ave", city: "Edmond" }, capture: CAPTURE, defaultProvince: "TX" }),
    ).toEqual({ address: at("456 Oak Ave"), source: "job_card" });
  });

  it("2. what the job-card line says beats every hint", () => {
    expect(
      jobCardAddress({
        request: { customer_address: "456 Oak Ave, Austin, TX 78701", city: "Edmond" },
        capture: CAPTURE,
        defaultProvince: "OK",
      }),
    ).toEqual({ address: at("456 Oak Ave", { city: "Austin", province: "TX", postalCode: "78701" }), source: "job_card" });
  });

  it("2. uses the company's default province when neither the line nor the capture has a state", () => {
    expect(jobCardAddress({ request: { customer_address: "456 Oak Ave, Edmond" }, defaultProvince: "OK" })).toEqual({
      address: at("456 Oak Ave", { postalCode: "" }),
      source: "job_card",
    });
    expect(
      jobCardAddress({
        request: { customer_address: "456 Oak Ave", city: "Edmond" },
        capture: { ...CAPTURE, address_state: null },
        defaultProvince: "OK",
      }),
    ).toEqual({ address: at("456 Oak Ave"), source: "job_card" });
  });

  it("2. never gives the capture's ZIP to a job card in another city", () => {
    // request.city names another city.
    expect(jobCardAddress({ request: { customer_address: "456 Oak Ave", city: "Norman" }, capture: CAPTURE })).toEqual({
      address: at("456 Oak Ave", { city: "Norman", postalCode: "" }),
      source: "job_card",
    });
    // The line names another city and the job card has no city column.
    expect(jobCardAddress({ request: { customer_address: "456 Oak Ave, Norman" }, capture: CAPTURE })).toEqual({
      address: at("456 Oak Ave", { city: "Norman", postalCode: "" }),
      source: "job_card",
    });
    // The line names the capture's city, whatever request.city says.
    expect(jobCardAddress({ request: { customer_address: "456 Oak Ave, Edmond", city: "Norman" }, capture: CAPTURE })).toEqual({
      address: at("456 Oak Ave"),
      source: "job_card",
    });
  });

  it("3. with no job-card line, or one without a street, the capture's own fields come before the lead", () => {
    const lead = { customer_address: "789 Elm Dr, Edmond, OK 73034" };
    for (const customer_address of [null, "", "   ", "Unknown", "Edmond, OK"]) {
      expect(jobCardAddress({ request: { customer_address, city: "Norman" }, capture: CAPTURE, lead }), String(customer_address)).toEqual({
        address: at("123 Main St"),
        source: "capture",
      });
    }
  });

  it("3. reads the capture's fields: a unit in the street, a state name, a whole line in the street field, a bad ZIP", () => {
    expect(jobCardAddress({ capture: { ...CAPTURE, address_street: "123 Main St Apt 4", address_state: "Oklahoma" } })).toEqual({
      address: at("123 Main St", { street2: "Apt 4" }),
      source: "capture",
    });
    expect(jobCardAddress({ capture: { address_street: "123 Main St, Edmond, OK 73034" } })).toEqual({
      address: at("123 Main St"),
      source: "capture",
    });
    expect(jobCardAddress({ capture: { ...CAPTURE, address_zip: "7303" } })).toEqual({
      address: at("123 Main St", { postalCode: "" }),
      source: "capture",
    });
  });

  it("3. then the lead's line, with the lead's city, else the job card's city, and the default province", () => {
    expect(
      jobCardAddress({
        request: { customer_address: "", city: "Norman" },
        capture: { address_street: "", address_city: "Edmond" },
        lead: { customer_address: "789 Elm Dr", city: "Edmond" },
        defaultProvince: "OK",
      }),
    ).toEqual({ address: at("789 Elm Dr", { postalCode: "" }), source: "lead" });
    expect(jobCardAddress({ request: { city: "Norman" }, lead: { customer_address: "789 Elm Dr" }, defaultProvince: "OK" })).toEqual({
      address: at("789 Elm Dr", { city: "Norman", postalCode: "" }),
      source: "lead",
    });
  });

  it("gives null with no street anywhere, and the quote then fails with the plan's reason", () => {
    expect(
      jobCardAddress({
        request: { customer_address: "Edmond, OK", city: "Edmond" },
        capture: { address_street: "Main St", address_city: "Edmond", address_state: "OK" },
        lead: { customer_address: "PO Box 12, Edmond, OK 73034" },
        defaultProvince: "OK",
      }),
    ).toBeNull();
    expect(jobCardAddress({})).toBeNull();
    expect(jobCardAddress({ request: null, capture: null, lead: null })).toBeNull();
    expect(NO_STREET_REASON).toBe("No street address on the job: add it with Edit job details.");
    expect(NO_STREET_REASON).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("customerDetails (plan section 4)", () => {
  const request = { customer_name: "Jo Card", customer_phone: "405-555-0101" };
  const capture = { customer_name: "Cap Ture", customer_phone: "405-555-0102", customer_email: "capture@example.com" };
  const lead = { customer_name: "Lee Lead", customer_phone: "405-555-0103", customer_email: "lead@example.com" };

  it("takes the name and phone from the job card first, then the capture, then the lead", () => {
    expect(customerDetails({ request, capture, lead })).toEqual({
      name: "Jo Card",
      phone: "405-555-0101",
      email: "capture@example.com",
      source: { name: "job_card", phone: "job_card", email: "capture" },
    });
    expect(customerDetails({ request: {}, capture, lead })).toMatchObject({
      name: "Cap Ture",
      phone: "405-555-0102",
      source: { name: "capture", phone: "capture" },
    });
    expect(customerDetails({ lead })).toMatchObject({ name: "Lee Lead", phone: "405-555-0103", source: { name: "lead", phone: "lead" } });
  });

  it("takes the email from the capture, then the lead, and never from the job card (decision D4)", () => {
    const cardWithEmail = { ...request, customer_email: "card@example.com" };
    expect(customerDetails({ request: cardWithEmail, capture, lead })).toMatchObject({ email: "capture@example.com", source: { email: "capture" } });
    expect(customerDetails({ request: cardWithEmail, lead })).toMatchObject({ email: "lead@example.com", source: { email: "lead" } });
    expect(customerDetails({ request: cardWithEmail })).toMatchObject({ email: null, source: { email: null } });
  });

  it("skips blanks and stand-ins, a phone with no digits and an email with no @", () => {
    expect(
      customerDetails({
        request: { customer_name: "Homeowner", customer_phone: "n/a" },
        capture: { customer_name: "  ", customer_phone: "call the office", customer_email: "none" },
        lead,
      }),
    ).toEqual({
      name: "Lee Lead",
      phone: "405-555-0103",
      email: "lead@example.com",
      source: { name: "lead", phone: "lead", email: "lead" },
    });
    expect(customerDetails({ capture: { customer_email: "not given" }, lead })).toMatchObject({
      email: "lead@example.com",
      source: { email: "lead" },
    });
  });

  it("tidies spaces, and gives null with a null source when nothing has a value", () => {
    expect(customerDetails({ request: { customer_name: "  Jo   Card ", customer_phone: " (405) 555-0101 " } })).toEqual({
      name: "Jo Card",
      phone: "(405) 555-0101",
      email: null,
      source: { name: "job_card", phone: "job_card", email: null },
    });
    const nothing = { name: null, phone: null, email: null, source: { name: null, phone: null, email: null } };
    expect(customerDetails({})).toEqual(nothing);
    expect(customerDetails({ request: null, capture: null, lead: null })).toEqual(nothing);
  });
});
