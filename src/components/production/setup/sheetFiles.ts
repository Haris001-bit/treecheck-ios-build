/** Files for the price sheet import: photos shrunk to a readable size, PDFs passed as they are. Browser only. */
export const MAX_PDF_BYTES = 8 * 1024 * 1024;

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
}

/** A photo as a JPEG data URL, longest side at most `maxSide` pixels (sheets stay readable, uploads stay small). */
export async function photoToDataUrl(file: File, maxSide = 2000, quality = 0.85): Promise<string> {
  const src = await fileToDataUrl(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('That photo could not be opened'));
    i.src = src;
  });
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return src;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}
