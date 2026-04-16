import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ReviewItemCard } from '@/features/review/review-item-card';
import type { OcrRuntimeProfile } from '@/lib/ocr/profiles';
import type { QueueItem, ReviewDraft } from '@/features/review/review-model';

const mockDraft: ReviewDraft = {
  governorId: '222067061',
  governorName: 'Hamabot',
  power: '123456789',
  killPoints: '45000000',
  t4Kills: '1300000',
  t5Kills: '950000',
  deads: '120000',
};

const mockItem: QueueItem = {
  id: 'rq_mock_01',
  scanJobId: 'scan_job_01',
  eventId: 'event_01',
  provider: 'local',
  status: 'RAW',
  confidence: 78,
  severity: { level: 'MEDIUM', reasons: ['low-confidence'] },
  values: {
    governorId: { value: '222067061', confidence: 89 },
    governorName: { value: 'Hamabot', confidence: 91 },
    power: { value: '123456789', confidence: 70 },
    killPoints: { value: '45000000', confidence: 72 },
    t4Kills: { value: '1300000', confidence: 81 },
    t5Kills: { value: '950000', confidence: 77 },
    deads: { value: '120000', confidence: 80 },
  },
  validation: [
    { field: 'power', severity: 'warning', warning: 'Verify from source' },
  ],
  artifact: {
    id: 'artifact_1',
    url: '/mock-screenshot.png',
    type: 'image/png',
  },
  createdAt: new Date('2026-03-12T10:00:00.000Z').toISOString(),
};

const mockProfiles: OcrRuntimeProfile[] = [
  {
    id: 'profile_1',
    profileKey: 'default-16-9',
    name: 'Default 16:9',
    version: 1,
    calibration: { xOffset: 0, yOffset: 0, xScale: 1, yScale: 1 },
    regions: {},
    archetype: 'governor-profile',
  },
];

describe('Review mobile drilldown card', () => {
  it('renders drawer trigger and review actions', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReviewItemCard, {
        item: mockItem,
        draft: mockDraft,
        actionBusy: null,
        profiles: mockProfiles,
        rerunProfileId: '',
        onRerunProfileChange: vi.fn(),
        onUpdateDraft: vi.fn(),
        onRerun: vi.fn(),
        onSaveGolden: vi.fn(),
        onSubmit: vi.fn(),
      })
    );

    expect(html).toContain('Edit Fields');
    expect(html).toContain('Mark Reviewed');
    expect(html).toContain('Approve');
    expect(html).toContain('Reject');
    expect(html).toContain('Open Screenshot');
  });
});
