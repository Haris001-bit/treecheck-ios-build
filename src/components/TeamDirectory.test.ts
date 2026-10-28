import { describe, expect, it } from 'vitest';
import { dialable } from './TeamDirectory';

describe('dialable', () => {
  it('strips formatting so call/text links open the dialer', () => {
    expect(dialable('(405) 555-0134')).toBe('4055550134');
    expect(dialable('+1 405-555-0134')).toBe('+14055550134');
  });
  it('hides call/text when there is no usable number', () => {
    expect(dialable(null)).toBeNull();
    expect(dialable('')).toBeNull();
    expect(dialable('n/a')).toBeNull();
  });
});
