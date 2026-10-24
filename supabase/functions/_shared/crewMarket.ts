// A subcontractor's local membership price (onboarding milestone). One source for crew-market-quote (what signup
// shows), create-crew-checkout (what Stripe charges) and stripe-webhook (which prices unlock the membership), so
// the price on screen is always the price charged. Subcontractors never pay (owner decision, Oct 2026): the price
// is always free. The old $10/$25/$35 and $20 price ids stay recognised only so existing subscriptions are still
// identified. Maintained outside Lovable.

import { BILLING_EXEMPT_OWNER_IDS } from "./scoutAccess.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export const CREW_RADIUS_MILES = 30;

/** Stripe price per local monthly price. The old $20 price stays recognised for anyone already on it. */
export const CREW_PRICE_IDS: Record<number, string> = {
  10: "price_1UJbFSLSrCwArzdgihLinYvm",
  25: "price_1UJl6vLSrCwArzdg1noXHJIV",
  35: "price_1UJltrLSrCwArzdggUwc5Y5N",
};
export const LEGACY_CREW_PRICE_ID = "price_1UJHl0LSrCwArzdgubBcgWyp"; // $20/mo, before local pricing

/** True when a subscription's prices or metadata make it a subcontractor membership. */
export function isCrewSubscription(priceIds: string[], metadataProduct?: string | null): boolean {
  if (metadataProduct === "crew_membership") return true;
  const crew = new Set([...Object.values(CREW_PRICE_IDS), LEGACY_CREW_PRICE_ID]);
  return priceIds.some((id) => crew.has(id));
}

/** Subcontractors never pay (owner decision, Oct 2026): membership is always free. */
export function crewMonthlyPrice(_companyCount: number): number {
  return 0;
}

export function distanceMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = 3958.8, rad = Math.PI / 180;
  const x = (bLat - aLat) * rad, y = (bLng - aLng) * rad;
  const q = Math.sin(x / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(y / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(q));
}

export interface AreaRow {
  id?: string;
  contractor_id: string;
  city?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  profiles?: { is_active?: boolean | null; is_sandbox?: boolean | null; account_type?: string | null }
    | { is_active?: boolean | null; is_sandbox?: boolean | null; account_type?: string | null }[]
    | null;
}

/** Live, non-sandbox tree companies with a service area within 30 miles, or in the same city when it has no point. */
export function companiesNear(areas: AreaRow[], lat: number, lng: number, city: string): Set<string> {
  const found = new Set<string>();
  const wantedCity = city.split(",")[0].trim().toLowerCase();
  for (const row of areas) {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    if (!profile?.is_active || profile?.is_sandbox || profile?.account_type !== "company") continue;
    const aLat = Number(row.latitude), aLng = Number(row.longitude);
    const hasPoint = row.latitude != null && row.longitude != null && Number.isFinite(aLat) && Number.isFinite(aLng);
    if (hasPoint && distanceMiles(lat, lng, aLat, aLng) <= CREW_RADIUS_MILES) found.add(row.contractor_id);
    else if (wantedCity && String(row.city || "").toLowerCase() === wantedCity) found.add(row.contractor_id);
  }
  return found;
}

/** Every service area, in a fixed order so the same sub always gets the same price. Throws on a failed read: an
 * empty list would mean "no companies", which is free. */
export async function loadServiceAreas(admin: Admin): Promise<AreaRow[]> {
  const { data, error } = await admin
    .from("service_areas")
    .select("id, contractor_id, city, region, latitude, longitude, profiles!inner(is_active, is_sandbox, account_type)")
    .order("contractor_id")
    .order("id");
  if (error) throw new Error(`service areas unavailable: ${error.message}`);
  return (data ?? []) as AreaRow[];
}

export interface MyCrewMarket {
  company_count: number;
  monthly_price: number;
  location_label: string | null;
  /** True when the sub joined the open network (has a network profile), not only a company's crew. */
  network: boolean;
}

/**
 * The signed-in sub's local price, worked out on the server so nobody can pick their own. Location comes from the
 * sub's network profile, else from the service area of a company they belong to (so that company counts itself).
 * With no location at all, each company they belong to counts once.
 */
export async function myCrewMarket(admin: Admin, userId: string): Promise<MyCrewMarket> {
  const { data: crewProfile } = await admin
    .from("crew_profiles")
    .select("latitude, longitude, location_label, home_city, network_visible")
    .eq("user_id", userId)
    .maybeSingle();
  const network = !!crewProfile;

  let lat = Number(crewProfile?.latitude), lng = Number(crewProfile?.longitude);
  let label: string | null = crewProfile?.location_label || crewProfile?.home_city || null;
  let hasPoint = crewProfile?.latitude != null && crewProfile?.longitude != null && Number.isFinite(lat) && Number.isFinite(lng);

  const { data: memberships, error: membershipsError } = await admin
    .from("crew_members")
    .select("owner_contractor_id, status")
    .eq("user_id", userId)
    .in("status", ["active", "pending"]);
  if (membershipsError) throw new Error(`crew memberships unavailable: ${membershipsError.message}`);
  const rows = (memberships ?? []) as { owner_contractor_id: string; status: string }[];
  const companyIds = Array.from(new Set(rows.map((m) => m.owner_contractor_id).filter(Boolean))).sort();
  // Working for an exempt company (Timber) is free, here as in the app.
  if (rows.some((m) => m.status === "active" && BILLING_EXEMPT_OWNER_IDS.includes(m.owner_contractor_id))) {
    return { company_count: 0, monthly_price: 0, location_label: crewProfile?.location_label || crewProfile?.home_city || null, network };
  }

  const areas = await loadServiceAreas(admin);
  if (!hasPoint && companyIds.length) {
    const theirs = areas.find((a) => companyIds.includes(a.contractor_id)
      && a.latitude != null && a.longitude != null
      && Number.isFinite(Number(a.latitude)) && Number.isFinite(Number(a.longitude)));
    if (theirs) {
      lat = Number(theirs.latitude); lng = Number(theirs.longitude); hasPoint = true;
      label = label || theirs.city || null;
    }
  }

  const count = hasPoint || label
    ? companiesNear(areas, hasPoint ? lat : NaN, hasPoint ? lng : NaN, label || "").size
    : companyIds.length;
  return { company_count: count, monthly_price: crewMonthlyPrice(count), location_label: label, network };
}
