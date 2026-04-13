import { describe, expect, it } from 'vitest';
import {
  applyCalibrationToRegions,
  getTemplateRuntimeProfiles,
  selectBestRuntimeProfile,
} from '@/lib/ocr/profiles';

describe('ocr profile selection', () => {
  it('selects exact template profile for matching 16:9 resolution', () => {
    const profiles = getTemplateRuntimeProfiles();
    const selected = selectBestRuntimeProfile({
      width: 1920,
      height: 1080,
      profiles,
    });
    expect(selected.profile.profileKey).toBe('default-16-9');
    expect(['exact', 'nearest']).toContain(selected.matchType);
  });

  it('applies calibration offsets and scales to regions', () => {
    const profiles = getTemplateRuntimeProfiles();
    const base = profiles[0];
    const calibrated = applyCalibrationToRegions(base.regions, {
      xOffset: 0.01,
      yOffset: -0.01,
      xScale: 1.05,
      yScale: 0.95,
    });
    expect(calibrated.governorId.width).toBeGreaterThan(base.regions.governorId.width);
    expect(calibrated.governorId.height).toBeLessThan(base.regions.governorId.height);
  });
});
