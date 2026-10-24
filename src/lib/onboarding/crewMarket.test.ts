// Onboarding milestone: a subcontractor's local membership price. One helper (_shared/crewMarket.ts) feeds what
// signup shows, what checkout charges and which Stripe prices unlock the membership. Pure functions plus
// myCrewMarket against an in-memory stand-in for the database.
import { describe, expect, it } from "vitest";
import {
  CREW_PRICE_IDS,
  LEGACY_CREW_PRICE_ID,
  companiesNear,
  crewMonthlyPrice,
  isCrewSubscription,
  myCrewMarket,
  type AreaRow,
} from "../../../supabase/functions/_shared/crewMarket";

const OKC = { lat: 35.4676, lng: -97.5164 };
const EDMOND = { lat: 35.6528, lng: -97.4781 }; // about 13 miles from OKC
const TULSA = { lat: 36.154, lng: -95.9928 }; // about 100 miles from OKC

const live = { is_active: true, is_sandbox: false, account_type: "company" };
const area = (id: string, at: { lat: number; lng: number } | null, extra: Partial<AreaRow> = {}, profile = live): AreaRow => ({
  contractor_id: id,
  city: null,
  latitude: at?.lat ?? null,
  longitude: at?.lng ?? null,
  profiles: profile,
  ...extra,
});

/** Just enough of supabase-js's query builder for myCrewMarket: select, eq, in, maybeSingle, await. */
function fakeAdmin(tables: Record<string, object[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])] as Record<string, unknown>[];
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return q; },
        in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return q; },
        order: () => q,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return q;
    },
  };
}

describe("crewMonthlyPrice", () => {
  it("is always free — subs never pay", () => {
    expect([0, 1, 2, 5, 6, 40].map(crewMonthlyPrice)).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it("never maps to a Stripe price", () => {
    for (const n of [1, 2, 6]) expect(CREW_PRICE_IDS[crewMonthlyPrice(n)]).toBeUndefined();
  });
});

describe("companiesNear", () => {
  it("counts live tree companies within 30 miles, once each", () => {
    const areas = [area("a", EDMOND), area("a", OKC), area("b", OKC), area("far", TULSA)];
    expect([...companiesNear(areas, OKC.lat, OKC.lng, "Oklahoma City, OK")].sort()).toEqual(["a", "b"]);
  });
  it("leaves out sandbox, inactive and non-company accounts", () => {
    const areas = [
      area("demo", OKC, {}, { ...live, is_sandbox: true }),
      area("off", OKC, {}, { ...live, is_active: false }),
      area("sub", OKC, {}, { ...live, account_type: "subcontractor" }),
    ];
    expect(companiesNear(areas, OKC.lat, OKC.lng, "Oklahoma City").size).toBe(0);
  });
  it("falls back to the city name for an area with no map point", () => {
    const areas = [area("c", null, { city: "Edmond" })];
    expect(companiesNear(areas, OKC.lat, OKC.lng, "Edmond, OK").size).toBe(1);
    expect(companiesNear(areas, NaN, NaN, "Edmond, OK").size).toBe(1);
    expect(companiesNear(areas, OKC.lat, OKC.lng, "Norman, OK").size).toBe(0);
  });
});

describe("isCrewSubscription", () => {
  it("recognises every local price and the old $20 price", () => {
    for (const id of [...Object.values(CREW_PRICE_IDS), LEGACY_CREW_PRICE_ID]) expect(isCrewSubscription([id])).toBe(true);
  });
  it("recognises the checkout's own metadata", () => {
    expect(isCrewSubscription(["price_unknown"], "crew_membership")).toBe(true);
  });
  it("leaves other subscriptions alone", () => {
    expect(isCrewSubscription(["price_1TcYOALSrCwArzdgFXnQwYOd"], null)).toBe(false);
  });
});

describe("myCrewMarket", () => {
  const areas = [area("timber", EDMOND), area("other", OKC), area("tulsa", TULSA)];

  it("prices a network sub from the place they signed up with", async () => {
    const admin = fakeAdmin({
      crew_profiles: [{ user_id: "u1", latitude: OKC.lat, longitude: OKC.lng, location_label: "Oklahoma City, OK" }],
      crew_members: [],
      service_areas: areas,
    });
    expect(await myCrewMarket(admin, "u1")).toEqual({ company_count: 2, monthly_price: 0, location_label: "Oklahoma City, OK", network: true });
  });

  it("prices a sub who joined by a company's link from that company's area", async () => {
    const admin = fakeAdmin({
      crew_profiles: [],
      crew_members: [{ user_id: "u2", owner_contractor_id: "tulsa", status: "active" }],
      service_areas: areas,
    });
    const market = await myCrewMarket(admin, "u2");
    expect(market).toMatchObject({ company_count: 1, monthly_price: 0, network: false });
  });

  it("is free where no company participates", async () => {
    const admin = fakeAdmin({
      crew_profiles: [{ user_id: "u3", latitude: 40.7, longitude: -74.0, location_label: "New York, NY" }],
      crew_members: [],
      service_areas: areas,
    });
    expect(await myCrewMarket(admin, "u3")).toMatchObject({ company_count: 0, monthly_price: 0, network: true });
  });

  it("counts the companies they belong to when there is no location at all", async () => {
    const admin = fakeAdmin({
      crew_profiles: [],
      crew_members: [{ user_id: "u4", owner_contractor_id: "nowhere", status: "pending" }],
      service_areas: areas,
    });
    expect(await myCrewMarket(admin, "u4")).toMatchObject({ company_count: 1, monthly_price: 0 });
  });
});

describe("myCrewMarket, the edges", () => {
  it("is free for an active member of Timber (billing exempt), wherever they are", async () => {
    const admin = fakeAdmin({
      crew_profiles: [],
      crew_members: [{ user_id: "u5", owner_contractor_id: "705cecc2-5926-48c1-a728-b3ebd6b920a2", status: "active" }],
      service_areas: [area("other", OKC)],
    });
    expect(await myCrewMarket(admin, "u5")).toMatchObject({ monthly_price: 0 });
  });

  it("fails rather than calling it free when service areas can't be read", async () => {
    const broken = {
      from(table: string) {
        const q = {
          select: () => q, eq: () => q, in: () => q, order: () => q,
          maybeSingle: async () => ({ data: null, error: null }),
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve(table === "service_areas" ? { data: null, error: { message: "timeout" } } : { data: [], error: null }).then(resolve),
        };
        return q;
      },
    };
    await expect(myCrewMarket(broken, "u6")).rejects.toThrow(/service areas unavailable/);
  });
});
