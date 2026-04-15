import { describe, expect, it } from 'vitest';
import { validateGovernorData } from '@/lib/ocr/validators';

describe('ocr validators', () => {
  it('treats missing optional combat fields as non-blocking', () => {
    const results = validateGovernorData({
      governorId: '222289750',
      name: 'GdTrine',
      power: '4757121',
      killPoints: '501259',
      t4Kills: '',
      t5Kills: '',
      deads: '',
      confidences: {
        governorId: 90,
        name: 90,
        power: 90,
        killPoints: 90,
        t4Kills: 0,
        t5Kills: 0,
        deads: 0,
      },
    });

    const t4 = results.find((item) => item.field === 't4Kills');
    const t5 = results.find((item) => item.field === 't5Kills');
    const deads = results.find((item) => item.field === 'deads');

    expect(t4?.severity).toBe('ok');
    expect(t5?.severity).toBe('ok');
    expect(deads?.severity).toBe('ok');
  });
});
