import { describe, expect, it } from 'vitest';
import { parseCandidatePreview } from '@/features/rankings-review/ranking-review-model';

describe('ranking review model', () => {
  it('prefers identitySuggestions candidate preview', () => {
    const preview = parseCandidatePreview({
      identitySuggestions: [
        {
          governorId: 'db-1',
          governorGameId: '222067061',
          name: 'Monkey D Luffy',
          source: 'alias',
        },
      ],
      rowCandidates: [
        {
          governorName: 'Fallback Candidate',
          score: 80,
        },
      ],
    });

    expect(preview[0]).toContain('Monkey D Luffy');
    expect(preview[0]).toContain('222067061');
    expect(preview.length).toBe(1);
  });

  it('falls back to legacy rowCandidates preview shape', () => {
    const preview = parseCandidatePreview({
      rowCandidates: [
        {
          governorName: 'Legacy Name',
          score: 91,
        },
      ],
    });

    expect(preview).toEqual(['Legacy Name (91%)']);
  });
});
