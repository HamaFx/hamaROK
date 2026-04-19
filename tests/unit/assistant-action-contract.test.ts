import { describe, expect, it } from 'vitest';
import {
  assistantActionSchema,
  assistantReadActionSchema,
  assistantToolActionSchema,
  assistantPlanOutputSchema,
} from '@/lib/assistant/types';

describe('assistant action contract', () => {
  it('accepts supported action shapes', () => {
    const register = assistantActionSchema.parse({
      type: 'register_player',
      governorId: '12345678',
      name: 'Player One',
      alliance: '[GODt] GOD of Thunder',
    });

    const record = assistantActionSchema.parse({
      type: 'record_profile_stats',
      governorId: '12345678',
      power: '123456789',
      killPoints: '987654321',
      t4Kills: '1000',
      t5Kills: '500',
      deads: '250',
    });

    expect(register.type).toBe('register_player');
    expect(record.type).toBe('record_profile_stats');
  });

  it('rejects update_player without identifier or patch', () => {
    expect(() =>
      assistantActionSchema.parse({
        type: 'update_player',
      })
    ).toThrow();

    expect(() =>
      assistantActionSchema.parse({
        type: 'update_player',
        governorId: '12345678',
      })
    ).toThrow();
  });

  it('rejects stats writes when governor identifier is missing', () => {
    expect(() =>
      assistantActionSchema.parse({
        type: 'record_profile_stats',
        power: '10',
        killPoints: '20',
        deads: '30',
      })
    ).toThrow();
  });

  it('parses structured plan output envelope', () => {
    const parsed = assistantPlanOutputSchema.parse({
      assistantResponse: 'I found one update.',
      summary: 'Update one player.',
      actions: [
        {
          type: 'update_player',
          governorId: '12345678',
          name: 'Player Prime',
        },
      ],
    });

    expect(parsed.actions).toHaveLength(1);
    expect(parsed.summary).toContain('Update');
  });

  it('accepts typed read actions and mixed tool actions', () => {
    const read = assistantReadActionSchema.parse({
      type: 'read_scan_job_tasks',
      scanJobId: 'scan_123',
      status: 'QUEUED,PROCESSING',
      limit: 20,
    });

    const mixed = assistantToolActionSchema.parse({
      type: 'read_governors',
      search: 'alpha',
      limit: 10,
    });

    expect(read.type).toBe('read_scan_job_tasks');
    expect(mixed.type).toBe('read_governors');
  });

  it('rejects read action requiring identifiers when missing', () => {
    expect(() =>
      assistantReadActionSchema.parse({
        type: 'read_event_detail',
      })
    ).toThrow();
  });
});
