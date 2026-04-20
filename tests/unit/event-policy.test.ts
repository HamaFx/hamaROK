import { describe, expect, it } from 'vitest';
import {
  MANUAL_EVENT_CREATE_TYPES,
  classifyEventType,
  getEventTypeDisplayLabel,
  isManualEventType,
} from '@/lib/events/policy';

describe('event policy', () => {
  it('locks manual create set to kvk/mge/osiris', () => {
    expect(MANUAL_EVENT_CREATE_TYPES).toEqual(['KVK_START', 'MGE', 'OSIRIS']);
    expect(isManualEventType('KVK_START')).toBe(true);
    expect(isManualEventType('MGE')).toBe(true);
    expect(isManualEventType('OSIRIS')).toBe(true);
    expect(isManualEventType('WEEKLY')).toBe(false);
    expect(isManualEventType('CUSTOM')).toBe(false);
    expect(isManualEventType('KVK_END')).toBe(false);
  });

  it('classifies manual/system/legacy types', () => {
    expect(classifyEventType('KVK_START')).toBe('manual');
    expect(classifyEventType('MGE')).toBe('manual');
    expect(classifyEventType('OSIRIS')).toBe('manual');
    expect(classifyEventType('WEEKLY')).toBe('system');
    expect(classifyEventType('KVK_END')).toBe('legacy');
    expect(classifyEventType('CUSTOM')).toBe('legacy');
  });

  it('uses unified display labels with single KvK label', () => {
    expect(getEventTypeDisplayLabel('KVK_START')).toBe('KvK');
    expect(getEventTypeDisplayLabel('KVK_END')).toBe('KvK');
    expect(getEventTypeDisplayLabel('WEEKLY')).toBe('Weekly Check');
    expect(getEventTypeDisplayLabel('CUSTOM')).toBe('Custom');
  });
});

