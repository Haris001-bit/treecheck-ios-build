-- Make the lead-photos storage bucket private
UPDATE storage.buckets 
SET public = false 
WHERE id = 'lead-photos';

-- Drop the public access policy
DROP POLICY IF EXISTS "Lead photos are publicly accessible" ON storage.objects;

-- Create policy for authenticated users to view lead photos
CREATE POLICY "Authenticated users can view lead photos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'lead-photos');

-- Keep admin write/delete policies (they should already exist)
-- Ensure admins can upload/update/delete
DROP POLICY IF EXISTS "Admins can upload lead photos" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update lead photos" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete lead photos" ON storage.objects;

CREATE POLICY "Admins can upload lead photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'lead-photos' AND public.is_admin());

CREATE POLICY "Admins can update lead photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'lead-photos' AND public.is_admin());

CREATE POLICY "Admins can delete lead photos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'lead-photos' AND public.is_admin());