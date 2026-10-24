import { describe, expect, it } from 'vitest';
import { movePhotoInOrder, uploadPhotosInOrder } from './dmaPhotoOrder';

describe('DMA chosen photo order', () => {
  it('moves the actual file and preserves the other positions', () => {
    const files = ['before.jpg', 'during.jpg', 'after.jpg'];
    expect(movePhotoInOrder(files, 2, 0)).toEqual(['after.jpg', 'before.jpg', 'during.jpg']);
    expect(files).toEqual(['before.jpg', 'during.jpg', 'after.jpg']);
  });
  it('keeps thumbnails and before/after labels in the same positions', () => {
    expect(movePhotoInOrder(['before-preview', 'after-preview'], 1, 0)).toEqual(['after-preview', 'before-preview']);
    expect(movePhotoInOrder(['before', 'after'], 1, 0)).toEqual(['after', 'before']);
  });
  it('uploads and returns paths in the selected order despite different upload durations', async () => {
    const files = movePhotoInOrder(['before.jpg', 'during.jpg', 'after.jpg'], 2, 0);
    const calls: string[] = [];
    const paths = await uploadPhotosInOrder(files, async (file, index) => {
      await new Promise(resolve => setTimeout(resolve, index === 0 ? 15 : 1));
      calls.push(file);
      return `photo-${index + 1}/${file}`;
    });
    expect(calls).toEqual(['after.jpg', 'before.jpg', 'during.jpg']);
    expect(paths).toEqual(['photo-1/after.jpg', 'photo-2/before.jpg', 'photo-3/during.jpg']);
  });
  it('freezes order when submission begins', async () => {
    const files = ['cover.jpg', 'second.jpg'];
    const paths = await uploadPhotosInOrder(files, async (file) => {
      files.reverse();
      return file;
    });
    expect(paths).toEqual(['cover.jpg', 'second.jpg']);
  });
});