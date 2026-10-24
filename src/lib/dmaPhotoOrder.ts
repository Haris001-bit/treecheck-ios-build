/** Move the file itself, not just its thumbnail, into the selected position. */
export function movePhotoInOrder<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const moved = next.splice(from, 1);
  next.splice(to, 0, ...moved);
  return next;
}

/** Freeze the displayed order for this submission, regardless of upload timing. */
export async function uploadPhotosInOrder<T>(items: readonly T[], upload: (item: T, index: number) => Promise<string>): Promise<string[]> {
  const snapshot = [...items];
  const paths: string[] = [];
  for (const [index, item] of snapshot.entries()) paths.push(await upload(item, index));
  return paths;
}