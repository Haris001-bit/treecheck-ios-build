// What a Free-plan DMA preview shows of the job story: the first two sentences. The rest waits server-side.
export function previewTeaser(article: string, sentences = 2): string {
  const text = article.replace(/\s+/g, ' ').trim();
  const parts = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
  const teaser = parts.slice(0, sentences).join('').trim();
  return teaser.length > 400 ? `${teaser.slice(0, 400).trim()}…` : teaser;
}
