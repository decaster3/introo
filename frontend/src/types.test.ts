import { describe, it, expect } from 'vitest';
import { calculateStrength, timeAgo } from './types';

describe('calculateStrength', () => {
  it('returns strong for recent frequent contacts', () => {
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 3); // 3 days ago
    expect(calculateStrength(recentDate.toISOString(), 5)).toBe('strong');
  });

  it('returns medium for moderately recent contacts', () => {
    const mediumDate = new Date();
    mediumDate.setDate(mediumDate.getDate() - 14); // 14 days ago
    expect(calculateStrength(mediumDate.toISOString(), 2)).toBe('medium');
  });

  it('returns weak for old or infrequent contacts', () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 60); // 60 days ago
    expect(calculateStrength(oldDate.toISOString(), 1)).toBe('weak');
  });

  it('returns weak for recent but only 1 meeting', () => {
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 5); // 5 days ago
    expect(calculateStrength(recentDate.toISOString(), 1)).toBe('weak');
  });
});

describe('timeAgo', () => {
  it('returns "just now" for very recent dates', () => {
    const now = new Date();
    expect(timeAgo(now)).toBe('just now');
  });

  it('returns minutes ago', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(timeAgo(fiveMinutesAgo)).toBe('5m ago');
  });

  it('returns hours ago', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    expect(timeAgo(threeHoursAgo)).toBe('3h ago');
  });

  it('returns days ago', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    expect(timeAgo(twoDaysAgo)).toBe('2d ago');
  });

  it('returns weeks ago for older dates', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    expect(timeAgo(twoWeeksAgo)).toBe('2w ago');
  });
});
