// Event demo (milestone 2): the demo company's website posts while they are live, for TimberEdmond.com's
// live-post page (/projects/live/:slug) and the top of its Featured Projects page. Public and read-only
// (verify_jwt = false in supabase/config.toml). It returns only the demo company's posts, only their own text and
// photos (as short-lived signed links), and a post drops out LIVE_POST_MINUTES after it was published, so it
// disappears from the site by itself. Demo posts are never committed to the site's repository.
// Maintained outside Lovable.
import { createClient } from "npm:@supabase/supabase-js@2";
import { DEMO_OWNER_ID, liveSince, publicPost } from "../_shared/demoCompany.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers });

const PHOTO_LINK_SECONDS = 15 * 60;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "GET") return json({ error: "Use GET." }, 405);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const slug = new URL(req.url).searchParams.get("slug");
    let query = admin
      .from("dma_published_projects")
      .select("slug, copy, photo_paths, published_at")
      .eq("contractor_id", DEMO_OWNER_ID)
      // A failed fix leaves the stored post as it was, so it stays up like Timber's real pages do.
      .in("status", ["published", "revising", "failed"])
      .gte("published_at", liveSince(Date.now()))
      .order("published_at", { ascending: false })
      .limit(5);
    if (slug) query = query.eq("slug", slug.slice(0, 80));
    const { data, error } = await query;
    if (error) {
      console.error("dma-live-posts read failed", error.message);
      return json({ posts: [] }, 500);
    }

    const posts = [];
    for (const row of (data ?? []) as { slug: string; copy: unknown; photo_paths: unknown; published_at: string }[]) {
      const paths = (Array.isArray(row.photo_paths) ? row.photo_paths : [])
        .filter((p): p is string => typeof p === "string")
        .slice(0, 4);
      let urls: string[] = [];
      if (paths.length) {
        const { data: signed } = await admin.storage.from("lead-photos").createSignedUrls(paths, PHOTO_LINK_SECONDS);
        urls = (signed ?? []).map((s) => s.signedUrl).filter((u): u is string => typeof u === "string" && u.length > 0);
      }
      posts.push(publicPost(row.slug, row.copy, urls, row.published_at));
    }
    return json({ posts });
  } catch (e) {
    console.error("dma-live-posts", e instanceof Error ? e.message : e);
    return json({ posts: [] }, 500);
  }
});
