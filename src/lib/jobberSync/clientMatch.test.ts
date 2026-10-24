// TreeCheck Jobber sync: finding the customer's existing Jobber client before a quote makes a new one
// (plan section 4, and section 7 "Wrong or duplicate client"). Pure functions, no network. Every
// name, address, phone number and email here is made up: phone numbers use the 555-01xx range kept
// for fiction, emails use example.com.
import { describe, expect, it } from "vitest";
import type { Address } from "../../../supabase/functions/_shared/jobberAddress";
import {
  normalizeEmail,
  normalizePhone,
  pickClient,
  splitName,
  type ClientCandidate,
  type ClientWant,
} from "../../../supabase/functions/_shared/jobberClientMatch";

const HOME: Address = { street1: "123 Main St", city: "Edmond", province: "OK", postalCode: "73034", country: "US" };
const EMAIL = "jo.smith@example.com";
const PHONE = "4055550101";

// A Jobber client named Jo Smith, with no email, phone or address unless given.
const client = (id: string, parts: Partial<ClientCandidate> = {}): ClientCandidate => ({
  id,
  firstName: "Jo",
  lastName: "Smith",
  isArchived: false,
  emails: [],
  phones: [],
  addresses: [],
  ...parts,
});

// The customer as TreeCheck holds them, each value written differently from the Jobber clients.
const WANT: ClientWant = {
  email: "  Jo.Smith@Example.COM ",
  phone: "+1 (405) 555-0101",
  lastName: "Smith",
  address: { ...HOME, street1: "123 Main Street", postalCode: "73034-1234" },
};

// pickClient's answer as the client id, the reason and the ambiguity flag.
const pick = (candidates: ClientCandidate[], want: ClientWant | null = WANT) => {
  const { client: found, reason, ambiguous } = pickClient(candidates, want);
  return { id: found?.id ?? null, reason, ambiguous };
};
const NONE = { id: null, reason: "none", ambiguous: false };

describe("normalizePhone", () => {
  it("reads a US number written with +1, dots, dashes, spaces or parentheses as its 10 digits", () => {
    const written = [
      "+1 (405) 555-0123",
      "405.555.0123",
      "405-555-0123",
      "405 555 0123",
      "(405) 555-0123",
      "1-405-555-0123",
      "14055550123",
      "4055550123",
      " +1 405 555 0123 ",
    ];
    for (const raw of written) expect(normalizePhone(raw), raw).toBe("4055550123");
  });

  it("drops an extension", () => {
    for (const raw of ["405-555-0123 ext. 12", "405-555-0123 x12", "(405) 555-0123 #12", "+1 405 555 0123 extension 7"]) {
      expect(normalizePhone(raw), raw).toBe("4055550123");
    }
  });

  it("gives null for a short, long or foreign number, a bad area code, one digit ten times, blank or not text", () => {
    const bad = [
      "555-0123",
      "405-555-012",
      "405-555-01234",
      "24055550123",
      "+44 20 7946 0958",
      "040-555-0123",
      "105-555-0123",
      "999-999-9999",
      "222-222-2222",
      "",
      "   ",
      "n/a",
    ];
    for (const raw of bad) expect(normalizePhone(raw), raw).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone(4055550123 as unknown as string)).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases, and drops a mailto: prefix", () => {
    expect(normalizeEmail("  Jo.Smith@Example.COM ")).toBe("jo.smith@example.com");
    expect(normalizeEmail("MAILTO:Jo@Example.com")).toBe("jo@example.com");
  });

  it("reads an address in brackets, after a name, or with stray punctuation after it as the bare address", () => {
    for (const raw of [
      "<jo@example.com>",
      "Jo Smith <Jo@Example.com>",
      "<mailto:jo@example.com>",
      "jo@example.com.",
      "jo@example.com;",
      "jo@example.com,",
      " jo@example.com. ",
      "Jo Smith <jo@example.com>.",
      "<jo@example.com;>",
    ]) {
      expect(normalizeEmail(raw), raw).toBe("jo@example.com");
    }
  });

  it("matches an email written with brackets or a trailing period to the same Jobber client", () => {
    const client = { id: "C1", lastName: "Smith", emails: ["JO@example.com"], phones: [], addresses: [] };
    for (const email of ["<jo@example.com>", "jo@example.com.", "Jo Smith <jo@example.com>"]) {
      expect(pickClient([client], { email }), email).toEqual({ client, reason: "email", ambiguous: false });
    }
  });

  it("gives null for blank, a stand-in, or anything that is not one address", () => {
    const bad = [
      "",
      "   ",
      "n/a",
      "not an email",
      "jo@example",
      "jo smith@example.com",
      "jo@@example.com",
      "@example.com",
      "jo@.com",
      "jo@example.com, al@example.com",
      "jo@example.com; al@example.com",
      "Jo <jo@example.com>, Al <al@example.com>",
      "<jo@example.com",
      "jo@example.c",
      "jo@example.123",
    ];
    for (const raw of bad) expect(normalizeEmail(raw), raw).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});

describe("splitName", () => {
  it("gives the last word as the last name and keeps middle names with the first", () => {
    expect(splitName("John Smith")).toEqual({ first: "John", last: "Smith" });
    expect(splitName("John Michael Smith")).toEqual({ first: "John Michael", last: "Smith" });
    expect(splitName("Mary Ann Lee Jones")).toEqual({ first: "Mary Ann Lee", last: "Jones" });
    expect(splitName("  John   Smith  ")).toEqual({ first: "John", last: "Smith" });
    expect(splitName("Mary-Jane Smith-Jones")).toEqual({ first: "Mary-Jane", last: "Smith-Jones" });
  });

  it("gives a single word as the first name with an empty last name, never a lone dash", () => {
    expect(splitName("Cher")).toEqual({ first: "Cher", last: "" });
    // The old code sent "-" as the last name of a one-word name, so a name can come back as "Cher -".
    expect(splitName("Cher -")).toEqual({ first: "Cher", last: "" });
    expect(splitName("John \u2013 Smith")).toEqual({ first: "John", last: "Smith" });
    expect(splitName("John \u2014 Smith")).toEqual({ first: "John", last: "Smith" });
  });

  it("reads \"Smith, John\" as the last name first", () => {
    expect(splitName("Smith, John")).toEqual({ first: "John", last: "Smith" });
    expect(splitName("Smith, John A.")).toEqual({ first: "John A.", last: "Smith" });
    expect(splitName("de la Cruz, Maria")).toEqual({ first: "Maria", last: "de la Cruz" });
    expect(splitName("Smith Jr., John")).toEqual({ first: "John", last: "Smith Jr." });
  });

  it("drops honorifics, and after one a single word is the last name", () => {
    expect(splitName("Mr. John Smith")).toEqual({ first: "John", last: "Smith" });
    expect(splitName("Mrs Jane Doe")).toEqual({ first: "Jane", last: "Doe" });
    expect(splitName("Mr. and Mrs. John Smith")).toEqual({ first: "John", last: "Smith" });
    expect(splitName("Mr & Mrs John Smith")).toEqual({ first: "John", last: "Smith" });
    expect(splitName("Smith, Mr. John")).toEqual({ first: "John", last: "Smith" });
    expect(splitName("Dr. Smith")).toEqual({ first: "", last: "Smith" });
  });

  it("keeps particles before the last name and suffixes after it", () => {
    expect(splitName("Maria de la Cruz")).toEqual({ first: "Maria", last: "de la Cruz" });
    expect(splitName("Ludwig van Beethoven")).toEqual({ first: "Ludwig", last: "van Beethoven" });
    expect(splitName("John Smith Jr.")).toEqual({ first: "John", last: "Smith Jr." });
    expect(splitName("John Smith, Jr.")).toEqual({ first: "John", last: "Smith Jr." });
    expect(splitName("John Smith III")).toEqual({ first: "John", last: "Smith III" });
  });

  it("gives empty parts for a blank name", () => {
    for (const blank of ["", "   ", " , ", "-", null, undefined]) {
      expect(splitName(blank), String(blank)).toEqual({ first: "", last: "" });
    }
  });
});

describe("pickClient (plan section 7, wrong or duplicate client)", () => {
  it("email_phone: email and phone on one client, ahead of a client listed first that matches by email alone", () => {
    const byEmail = client("a", { emails: [EMAIL] });
    const both = client("b", { emails: ["JO.SMITH@example.com"], phones: ["405.555.0101"] });
    expect(pick([byEmail, both])).toEqual({ id: "b", reason: "email_phone", ambiguous: false });
    expect(pickClient([byEmail, both], WANT).client).toBe(both);
  });

  it("email: the same email is enough, whatever the name and phone", () => {
    const other = client("a", { lastName: "Jones", emails: [EMAIL], phones: ["405-555-0199"] });
    expect(pick([other])).toEqual({ id: "a", reason: "email", ambiguous: false });
  });

  it("phone_name: a phone match needs the same last name", () => {
    expect(pick([client("a", { lastName: "SMITH", phones: ["405 555 0101"] })])).toEqual({ id: "a", reason: "phone_name", ambiguous: false });
    expect(pick([client("a", { lastName: "Jones", phones: [PHONE] })])).toEqual(NONE);
    expect(pick([client("a", { phones: [PHONE] })], { phone: WANT.phone })).toEqual(NONE);
  });

  it("compares last names by their last word, without case, accents, punctuation or a suffix", () => {
    const phone = "405-555-0101";
    expect(pick([client("a", { lastName: "OBrien", phones: [PHONE] })], { phone, lastName: "O'Brien Jr." }).reason).toBe("phone_name");
    expect(pick([client("a", { lastName: "Cruz", phones: [PHONE] })], { phone, lastName: "de la Cruz" }).reason).toBe("phone_name");
    expect(pick([client("a", { lastName: "Nunez", phones: [PHONE] })], { phone, lastName: "N\u00fa\u00f1ez" }).reason).toBe("phone_name");
  });

  it("never matches a last name with no letters, such as the old code's placeholder dash", () => {
    expect(pick([client("a", { lastName: "-", phones: [PHONE] })], { phone: PHONE, lastName: "-" })).toEqual(NONE);
  });

  it("name_address: the same last name at the same place, however the address is written", () => {
    const elsewhere = { ...HOME, street1: "999 Other Rd" };
    expect(pick([client("a", { addresses: [elsewhere, HOME] })])).toEqual({ id: "a", reason: "name_address", ambiguous: false });
    expect(pick([client("a", { addresses: [{ ...HOME, street1: "125 Main St" }] })])).toEqual(NONE);
    expect(pick([client("a", { lastName: "Jones", addresses: [HOME] })])).toEqual(NONE);
  });

  it("never matches on a name alone", () => {
    expect(pick([client("a")])).toEqual(NONE);
    expect(pick([client("a", { addresses: [HOME] })], { lastName: "Smith" })).toEqual(NONE);
  });

  it("skips archived clients, even the best match", () => {
    const archived = client("old", { isArchived: true, emails: [EMAIL], phones: [PHONE] });
    expect(pick([archived, client("b", { phones: [PHONE] })])).toEqual({ id: "b", reason: "phone_name", ambiguous: false });
    expect(pick([archived])).toEqual(NONE);
  });

  it("flags more than one match at the best tier and returns the first in the order given", () => {
    const a = client("a", { emails: [EMAIL] });
    const b = client("b", { emails: [EMAIL.toUpperCase()] });
    expect(pick([a, b])).toEqual({ id: "a", reason: "email", ambiguous: true });
    expect(pick([b, a])).toEqual({ id: "b", reason: "email", ambiguous: true });
    const c = client("c", { addresses: [HOME] });
    const d = client("d", { addresses: [HOME] });
    expect(pick([d, c])).toEqual({ id: "d", reason: "name_address", ambiguous: true });
  });

  it("counts a client listed twice once, at its best tier", () => {
    const once = client("a", { emails: [EMAIL] });
    expect(pick([once, once])).toEqual({ id: "a", reason: "email", ambiguous: false });
    const again = client("a", { emails: [EMAIL], phones: [PHONE] });
    expect(pick([once, client("b", { emails: [EMAIL] }), again])).toEqual({ id: "a", reason: "email_phone", ambiguous: false });
  });

  it("none: no candidates, no customer details, or nothing that matches", () => {
    const everything = client("a", { emails: [EMAIL], phones: [PHONE], addresses: [HOME] });
    expect(pick([])).toEqual(NONE);
    expect(pickClient(null, WANT)).toEqual({ client: null, reason: "none", ambiguous: false });
    expect(pickClient(undefined, WANT)).toEqual({ client: null, reason: "none", ambiguous: false });
    expect(pick([everything], null)).toEqual(NONE);
    expect(pick([everything], {})).toEqual(NONE);
    expect(pick([client("a", { emails: ["n/a"], phones: ["555-0101"] })], { email: "n/a", phone: "555-0101", lastName: "Smith" })).toEqual(NONE);
    expect(pick([client("a", { lastName: "Jones", emails: ["al@example.com"], phones: ["405-555-0199"] })])).toEqual(NONE);
  });
});
