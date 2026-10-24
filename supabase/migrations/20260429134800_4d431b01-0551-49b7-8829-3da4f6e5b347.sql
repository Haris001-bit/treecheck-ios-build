-- Allow authenticated contractors to upload their own DMA job photos
-- Path convention: dma/<auth.uid()>/<jobId>/<filename>
CREATE POLICY "Contractors can upload own DMA photos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'lead-photos'
  AND (storage.foldername(name))[1] = 'dma'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "Contractors can update own DMA photos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'lead-photos'
  AND (storage.foldername(name))[1] = 'dma'
  AND (storage.foldername(name))[2] = auth.uid()::text
);