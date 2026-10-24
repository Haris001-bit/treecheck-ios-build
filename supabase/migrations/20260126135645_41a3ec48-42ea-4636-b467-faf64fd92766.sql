-- Create storage bucket for lead photos
INSERT INTO storage.buckets (id, name, public) VALUES ('lead-photos', 'lead-photos', true);

-- Storage policies for lead photos
CREATE POLICY "Lead photos are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'lead-photos');

CREATE POLICY "Admins can upload lead photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'lead-photos' AND public.is_admin());

CREATE POLICY "Admins can delete lead photos"
ON storage.objects FOR DELETE
USING (bucket_id = 'lead-photos' AND public.is_admin());