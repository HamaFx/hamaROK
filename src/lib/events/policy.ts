import type { EventType } from '@prisma/client';

export type EventClassification = 'manual' | 'system' | 'legacy';

export const MANUAL_EVENT_CREATE_TYPES = ['KVK_START', 'MGE', 'OSIRIS'] as const;
export const SYSTEM_EVENT_TYPES = ['WEEKLY'] as const;
export const LEGACY_EVENT_TYPES = ['KVK_END', 'CUSTOM'] as const;

export type ManualEventType = (typeof MANUAL_EVENT_CREATE_TYPES)[number];

const MANUAL_EVENT_TYPE_SET = new Set<string>(MANUAL_EVENT_CREATE_TYPES);
const SYSTEM_EVENT_TYPE_SET = new Set<string>(SYSTEM_EVENT_TYPES);
const LEGACY_EVENT_TYPE_SET = new Set<string>(LEGACY_EVENT_TYPES);

export const EVENT_TYPE_DISPLAY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  KVK_START: 'KvK',
  KVK_END: 'KvK',
  MGE: 'MGE',
  OSIRIS: 'Ark of Osiris',
  WEEKLY: 'Weekly Check',
  CUSTOM: 'Custom',
});

export const MANUAL_EVENT_CREATE_OPTIONS: ReadonlyArray<{ value: ManualEventType; label: string }> =
  Object.freeze([
    { value: 'KVK_START', label: EVENT_TYPE_DISPLAY_LABELS.KVK_START },
    { value: 'MGE', label: EVENT_TYPE_DISPLAY_LABELS.MGE },
    { value: 'OSIRIS', label: EVENT_TYPE_DISPLAY_LABELS.OSIRIS },
  ]);

export function isManualEventType(value: unknown): value is ManualEventType {
  return MANUAL_EVENT_TYPE_SET.has(String(value || '').trim());
}

export function classifyEventType(value: EventType | string): EventClassification {
  const normalized = String(value || '').trim();
  if (SYSTEM_EVENT_TYPE_SET.has(normalized)) return 'system';
  if (LEGACY_EVENT_TYPE_SET.has(normalized)) return 'legacy';
  return 'manual';
}

export function getEventTypeDisplayLabel(value: EventType | string): string {
  const normalized = String(value || '').trim();
  return EVENT_TYPE_DISPLAY_LABELS[normalized] || normalized || 'Unknown';
}

