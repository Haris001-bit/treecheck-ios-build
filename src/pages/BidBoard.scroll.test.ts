import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/BidBoard.tsx', 'utf8');

describe('Jobs scroll stability', () => {
  it('does not reorder jobs when opening clears an activity badge', () => {
    const ordering = source.slice(source.indexOf('const shown ='), source.indexOf('const hasAiPrice'));
    expect(ordering).not.toContain('activityFlags[');
    expect(ordering).toContain('b.created_at.localeCompare(a.created_at)');
    expect(ordering).toContain('a.id.localeCompare(b.id)');
  });

  it('reserves the same photo height while loading and after loading', () => {
    const photo = source.slice(source.indexOf('const src = photos[r.id]'), source.indexOf('<TreePhotoGallery'));
    expect(photo.match(/h-64/g)).toHaveLength(2);
    expect(photo).toContain('object-contain');
  });

  it('does not animate automatic job navigation against manual scrolling', () => {
    expect(source).not.toContain("behavior: 'smooth'");
    expect(source).toContain("behavior: 'instant'");
    expect(source).toContain('sticky top-16 lg:top-0');
  });
});