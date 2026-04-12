import type { CropRegion } from './image-preprocessor';
import { CROP_REGIONS } from './image-preprocessor';

export interface OcrTemplateProfile {
  id: string;
  label: string;
  minWidth: number;
  maxWidth: number;
  minAspectRatio: number;
  maxAspectRatio: number;
  regions: Record<string, CropRegion>;
}

export const OCR_TEMPLATES: OcrTemplateProfile[] = [
  {
    id: 'default-16-9',
    label: 'Default 16:9',
    minWidth: 1000,
    maxWidth: 3000,
    minAspectRatio: 1.6,
    maxAspectRatio: 1.9,
    regions: CROP_REGIONS,
  },
  {
    id: 'mobile-20-9',
    label: 'Tall Mobile 20:9',
    minWidth: 900,
    maxWidth: 1600,
    minAspectRatio: 2.0,
    maxAspectRatio: 2.4,
    regions: {
      ...CROP_REGIONS,
      governorId: { x: 0.24, y: 0.075, width: 0.52, height: 0.036 },
      governorName: { x: 0.18, y: 0.115, width: 0.62, height: 0.045 },
      power: { x: 0.24, y: 0.205, width: 0.52, height: 0.05 },
      killPoints: { x: 0.46, y: 0.405, width: 0.5, height: 0.04 },
      t4Kills: { x: 0.46, y: 0.525, width: 0.5, height: 0.04 },
      t5Kills: { x: 0.46, y: 0.565, width: 0.5, height: 0.04 },
      deads: { x: 0.46, y: 0.705, width: 0.5, height: 0.04 },
    },
  },
];

export function detectOcrTemplate(
  width: number,
  height: number
): OcrTemplateProfile {
  const ratio = width / Math.max(1, height);
  return (
    OCR_TEMPLATES.find(
      (template) =>
        width >= template.minWidth &&
        width <= template.maxWidth &&
        ratio >= template.minAspectRatio &&
        ratio <= template.maxAspectRatio
    ) || OCR_TEMPLATES[0]
  );
}
