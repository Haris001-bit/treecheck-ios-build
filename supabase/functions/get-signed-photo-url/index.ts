import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only accept POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Get authorization header
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing authorization header" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Parse request body
  let body: { photo_url: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { photo_url } = body;

  if (!photo_url) {
    return new Response(JSON.stringify({ error: "Missing photo_url" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Platform already verified JWT (verify_jwt=true by default).
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Check if the photo_url is from our storage bucket
  // Format: https://{project}.supabase.co/storage/v1/object/public/lead-photos/{path}
  // or just the storage path like: lead-photos/filename.jpg
  
  let storagePath: string;
  
  if (photo_url.includes('/storage/v1/object/')) {
    // Extract the path from the full URL
    const match = photo_url.match(/\/storage\/v1\/object\/(?:public|sign)\/lead-photos\/(.+)/);
    if (match) {
      storagePath = match[1];
    } else {
      // Not a lead-photos URL, return original URL (external images)
      return new Response(JSON.stringify({ signed_url: photo_url }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } else if (photo_url.startsWith('lead-photos/')) {
    storagePath = photo_url.replace('lead-photos/', '');
  } else if (!photo_url.startsWith('http')) {
    // Assume it's just the filename
    storagePath = photo_url;
  } else {
    // External URL, return as-is
    return new Response(JSON.stringify({ signed_url: photo_url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Create signed URL using service role client
  const supabaseService = createClient(supabaseUrl, supabaseServiceKey);
  
  const { data: signedData, error: signError } = await supabaseService.storage
    .from("lead-photos")
    .createSignedUrl(storagePath, 3600); // 1 hour expiry

  if (signError) {
    console.error("Error creating signed URL:", signError);
    // If signed URL fails, try returning original URL (might be external)
    return new Response(JSON.stringify({ signed_url: photo_url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ signed_url: signedData.signedUrl }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
