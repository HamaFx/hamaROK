import type { CropRegion } from './image-preprocessor';
import { OCR_TEMPLATES } from './templates';
import { OCR_FIELD_KEYS } from './field-config';

export interface OcrCalibration {
  xOffset: number;
  yOffset: number;
  xScale: number;
  yScale: number;
}

export interface OcrRuntimeProfile {
  id: string;
  profileKey: string;
  name: string;
  archetype?: 'governor-profile' | 'rankboard' | null;
  version: number;
  sourceTemplateId?: string | null;
  minWidth?: number | null;
  maxWidth?: number | null;
  minAspectRatio?: number | null;
  maxAspectRatio?: number | null;
  calibration: OcrCalibration;
  regions: Record<string, CropRegion>;
  isDefault?: boolean;
}

export interface ProfileSelectionScore {
  profileId: string;
  profileKey: string;
  penalty: number;
  reasons: string[];
}

export interface ProfileSelectionResult {
  profile: OcrRuntimeProfile;
  matchType: 'manual' | 'exact' | 'nearest' | 'fallback';
  scores: ProfileSelectionScore[];
}

export const DEFAULT_CALIBRATION: OcrCalibration = {
  xOffset: 0,
  yOffset: 0,
  xScale: 1,
  yScale: 1,
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

export function applyCalibrationToRegions(
  regions: Record<string, CropRegion>,
  calibration: OcrCalibration
): Record<string, CropRegion> {
  const out: Record<string, CropRegion> = {};
  for (const key of Object.keys(regions)) {
    const region = regions[key];
    const width = clamp(region.width * calibration.xScale, 0.01, 1);
    const height = clamp(region.height * calibration.yScale, 0.01, 1);
    const x = clamp(region.x + calibration.xOffset, 0, 1 - width);
    const y = clamp(region.y + calibration.yOffset, 0, 1 - height);
    out[key] = { x, y, width, height };
  }
  return out;
}

export function getTemplateRuntimeProfiles(): OcrRuntimeProfile[] {
  return OCR_TEMPLATES.map((template) => ({
    id: `template:${template.id}`,
    profileKey: template.id,
    name: template.label,
    archetype: template.archetype || null,
    version: 1,
    sourceTemplateId: template.id,
    minWidth: template.minWidth,
    maxWidth: template.maxWidth,
    minAspectRatio: template.minAspectRatio,
    maxAspectRatio: template.maxAspectRatio,
    calibration: DEFAULT_CALIBRATION,
    regions: template.regions,
    isDefault: template.id === OCR_TEMPLATES[0]?.id,
  }));
}

function regionRecordFromUnknown(
  value: unknown
): Record<string, CropRegion> | null {
  if (!value || typeof value !== 'object') return null;
  const src = value as Record<string, unknown>;
  const out: Record<string, CropRegion> = {};
  for (const key of OCR_FIELD_KEYS) {
    const raw = src[key];
    if (!raw || typeof raw !== 'object') return null;
    const reg = raw as Record<string, unknown>;
    const x = Number(reg.x);
    const y = Number(reg.y);
    const width = Number(reg.width);
    const height = Number(reg.height);
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    ) {
      return null;
    }
    out[key] = { x, y, width, height };
  }
  return out;
}

export function parseCalibrationFromUnknown(value: unknown): OcrCalibration {
  if (!value || typeof value !== 'object') return DEFAULT_CALIBRATION;
  const obj = value as Record<string, unknown>;
  const xOffset = Number(obj.xOffset);
  const yOffset = Number(obj.yOffset);
  const xScale = Number(obj.xScale);
  const yScale = Number(obj.yScale);
  return {
    xOffset: Number.isFinite(xOffset) ? xOffset : DEFAULT_CALIBRATION.xOffset,
    yOffset: Number.isFinite(yOffset) ? yOffset : DEFAULT_CALIBRATION.yOffset,
    xScale: Number.isFinite(xScale) ? xScale : DEFAULT_CALIBRATION.xScale,
    yScale: Number.isFinite(yScale) ? yScale : DEFAULT_CALIBRATION.yScale,
  };
}

export function normalizeRuntimeProfile(input: {
  id: string;
  profileKey: string;
  name: string;
  archetype?: 'governor-profile' | 'rankboard' | null;
  version: number;
  sourceTemplateId?: string | null;
  minWidth?: number | null;
  maxWidth?: number | null;
  minAspectRatio?: number | null;
  maxAspectRatio?: number | null;
  calibration: unknown;
  regions: unknown;
  isDefault?: boolean;
}): OcrRuntimeProfile | null {
  const regions = regionRecordFromUnknown(input.regions);
  if (!regions) return null;
  const calibration = parseCalibrationFromUnknown(input.calibration);
  return {
    id: input.id,
    profileKey: input.profileKey,
    name: input.name,
    archetype: input.archetype ?? null,
    version: input.version,
    sourceTemplateId: input.sourceTemplateId ?? null,
    minWidth: input.minWidth ?? null,
    maxWidth: input.maxWidth ?? null,
    minAspectRatio: input.minAspectRatio ?? null,
    maxAspectRatio: input.maxAspectRatio ?? null,
    calibration,
    regions: applyCalibrationToRegions(regions, calibration),
    isDefault: Boolean(input.isDefault),
  };
}

function scoreProfileForResolution(
  width: number,
  height: number,
  profile: OcrRuntimeProfile
): ProfileSelectionScore {
  const ratio = width / Math.max(1, height);
  const reasons: string[] = [];
  let penalty = 0;

  if (profile.minWidth != null && width < profile.minWidth) {
    const p = (profile.minWidth - width) / Math.max(1, profile.minWidth);
    penalty += p + 0.2;
    reasons.push('below-min-width');
  }
  if (profile.maxWidth != null && width > profile.maxWidth) {
    const p = (width - profile.maxWidth) / Math.max(1, profile.maxWidth);
    penalty += p + 0.2;
    reasons.push('above-max-width');
  }

  if (profile.minAspectRatio != null && ratio < profile.minAspectRatio) {
    penalty += (profile.minAspectRatio - ratio) + 0.2;
    reasons.push('below-min-aspect');
  }
  if (profile.maxAspectRatio != null && ratio > profile.maxAspectRatio) {
    penalty += (ratio - profile.maxAspectRatio) + 0.2;
    reasons.push('above-max-aspect');
  }

  const centerWidth =
    profile.minWidth != null && profile.maxWidth != null
      ? (profile.minWidth + profile.maxWidth) / 2
      : width;
  const widthDistance = Math.abs(width - centerWidth) / Math.max(1, centerWidth);
  penalty += widthDistance * 0.05;

  if (reasons.length === 0) reasons.push('within-range');

  return {
    profileId: profile.id,
    profileKey: profile.profileKey,
    penalty,
    reasons,
  };
}

export function selectBestRuntimeProfile(args: {
  width: number;
  height: number;
  profiles?: OcrRuntimeProfile[];
  preferredProfileId?: string | null;
  preferredArchetype?: 'governor-profile' | 'rankboard' | null;
}): ProfileSelectionResult {
  const profilePool = args.profiles && args.profiles.length > 0
    ? args.profiles
    : getTemplateRuntimeProfiles();

  if (args.preferredProfileId) {
    const selected =
      profilePool.find((p) => p.id === args.preferredProfileId) ||
      profilePool.find((p) => p.profileKey === args.preferredProfileId);
    if (selected) {
      return {
        profile: selected,
        matchType: 'manual',
        scores: [
          scoreProfileForResolution(args.width, args.height, selected),
        ],
      };
    }
  }

  const scores = profilePool.map((profile) =>
    scoreProfileForResolution(args.width, args.height, profile)
  );
  if (args.preferredArchetype) {
    for (const score of scores) {
      const profile = profilePool.find((item) => item.id === score.profileId);
      if (!profile?.archetype) continue;
      if (profile.archetype === args.preferredArchetype) {
        score.penalty -= 0.08;
        score.reasons.push('archetype-match');
      } else {
        score.penalty += 0.25;
        score.reasons.push('archetype-mismatch');
      }
    }
  }
  scores.sort((a, b) => a.penalty - b.penalty);
  const best = scores[0];
  const selected = profilePool.find((p) => p.id === best.profileId) || profilePool[0];
  const matchType = best.penalty <= 0.06 ? 'exact' : 'nearest';

  return {
    profile: selected,
    matchType: selected ? matchType : 'fallback',
    scores,
  };
}
