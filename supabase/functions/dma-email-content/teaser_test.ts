import { assertEquals } from 'jsr:@std/assert@1';
import { previewTeaser } from './teaser.ts';

Deno.test('a Free preview shows only the first two sentences', () => {
  assertEquals(previewTeaser('We removed a large tree. The yard was cleaned. Stump ground too. Thanks!'), 'We removed a large tree. The yard was cleaned.');
});
Deno.test('a story without sentence ends is cut, never shown in full past 400 characters', () => {
  const long = 'a'.repeat(1000);
  assertEquals(previewTeaser(long).length, 401);
});
