import { describe, expect, it } from 'vitest';
import {
  MOBILE_MORE_NAV,
  MOBILE_PRIMARY_NAV,
  PRIMARY_NAV_ITEMS,
  TOOL_NAV_ITEMS,
  getActiveNav,
  isActivePath,
} from '@/features/shared/navigation';

describe('frontend shell navigation', () => {
  it('matches active paths including nested routes', () => {
    expect(isActivePath('/', '/')).toBe(true);
    expect(isActivePath('/rankings', '/rankings')).toBe(true);
    expect(isActivePath('/rankings/review', '/rankings')).toBe(true);
    expect(isActivePath('/events/abc', '/events')).toBe(true);
    expect(isActivePath('/events', '/rankings')).toBe(false);
  });

  it('resolves active nav and falls back to home for unknown paths', () => {
    expect(getActiveNav('/governors').href).toBe('/governors');
    expect(getActiveNav('/rankings/review/row-1').href).toBe('/rankings');
    expect(getActiveNav('/does-not-exist').href).toBe('/');
  });

  it('keeps compare out of mobile primary nav and first in more nav', () => {
    expect(PRIMARY_NAV_ITEMS.some((item) => item.href === '/compare')).toBe(true);
    expect(MOBILE_PRIMARY_NAV.some((item) => item.href === '/compare')).toBe(false);
    expect(MOBILE_MORE_NAV[0]?.href).toBe('/compare');
  });

  it('keeps tools grouped as secondary nav', () => {
    expect(TOOL_NAV_ITEMS.length).toBeGreaterThan(0);
    expect(TOOL_NAV_ITEMS.every((item) => item.group === 'tools')).toBe(true);
  });
});
