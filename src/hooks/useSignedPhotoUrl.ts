import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Cache for signed URLs to avoid redundant requests
const signedUrlCache = new Map<string, { url: string; expiry: number }>();
const CACHE_DURATION = 50 * 60 * 1000; // 50 minutes (less than the 1 hour signed URL expiry)

export function useSignedPhotoUrl(photoUrl: string | null | undefined) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!photoUrl) {
      setSignedUrl(null);
      return;
    }

    // Check if it's an external URL (not from our storage)
    const isSupabaseStorageUrl = photoUrl.includes('/storage/v1/object/') || 
                                  photoUrl.startsWith('lead-photos/') ||
                                  !photoUrl.startsWith('http');

    // For external URLs, use directly
    if (!isSupabaseStorageUrl && photoUrl.startsWith('http')) {
      setSignedUrl(photoUrl);
      return;
    }

    // Check cache first
    const cached = signedUrlCache.get(photoUrl);
    if (cached && cached.expiry > Date.now()) {
      setSignedUrl(cached.url);
      return;
    }

    const fetchSignedUrl = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          // If not authenticated, try using the original URL
          setSignedUrl(photoUrl);
          return;
        }

        const response = await supabase.functions.invoke('get-signed-photo-url', {
          body: { photo_url: photoUrl },
        });

        if (response.error) {
          throw new Error(response.error.message || 'Failed to get signed URL');
        }

        const { signed_url } = response.data;
        
        // Cache the result
        signedUrlCache.set(photoUrl, {
          url: signed_url,
          expiry: Date.now() + CACHE_DURATION,
        });

        setSignedUrl(signed_url);
      } catch (err) {
        console.error('Error fetching signed URL:', err);
        setError(err instanceof Error ? err : new Error('Unknown error'));
        // Fallback to original URL on error
        setSignedUrl(photoUrl);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSignedUrl();
  }, [photoUrl]);

  return { signedUrl, isLoading, error };
}

// Utility to clear cache if needed (e.g., on logout)
export function clearSignedUrlCache() {
  signedUrlCache.clear();
}
