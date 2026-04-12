/**
 * Tesseract.js OCR Engine wrapper
 * Handles worker lifecycle and recognition with optimized settings
 */
import { createWorker, Worker } from 'tesseract.js';
import {
  loadImage,
  cropRegion,
  preprocessForOCR,
  canvasToDataUrl,
} from './image-preprocessor';
import { detectOcrTemplate } from './templates';

interface OcrPassTrace {
  threshold: number;
  scale: number;
  contrast: number;
  psm: '6' | '7';
  confidence: number;
  text: string;
}

export interface OcrFieldResult {
  value: string;
  confidence: number;
  croppedImage: string; // base64 data URL of the cropped region
  trace?: {
    templateId: string;
    selectedPass: number;
    passes: OcrPassTrace[];
    fallbackUsed: boolean;
  };
}

export interface OcrScreenshotResult {
  governorId: OcrFieldResult;
  governorName: OcrFieldResult;
  power: OcrFieldResult;
  killPoints: OcrFieldResult;
  t4Kills: OcrFieldResult;
  t5Kills: OcrFieldResult;
  deads: OcrFieldResult;
  averageConfidence: number;
  templateId: string;
  normalizationTrace: Record<string, OcrPassTrace[]>;
}

export interface OcrFallbackResult {
  value: string;
  confidence: number;
}

export type OcrFallbackHandler = (args: {
  fieldKey: string;
  croppedImage: string;
  currentValue: string;
  currentConfidence: number;
}) => Promise<OcrFallbackResult | null>;

let worker: Worker | null = null;

/**
 * Initialize and cache the Tesseract worker
 */
export async function initializeWorker(): Promise<Worker> {
  if (worker) return worker;
  worker = await createWorker('eng');
  return worker;
}

async function recognizeNumberWithPsm(
  canvas: HTMLCanvasElement
): Promise<{ text: string; confidence: number }> {
  const w = await initializeWorker();
  await w.setParameters({
    tessedit_char_whitelist: '0123456789,. ',
  });
  const { data } = await w.recognize(canvas);
  return {
    text: data.text.trim().replace(/\s/g, '').replace(/\./g, ','),
    confidence: data.confidence,
  };
}

async function recognizeTextWithPsm(
  canvas: HTMLCanvasElement
): Promise<{ text: string; confidence: number }> {
  const w = await initializeWorker();
  await w.setParameters({
    tessedit_char_whitelist: '',
  });
  const { data } = await w.recognize(canvas);
  return {
    text: data.text.trim(),
    confidence: data.confidence,
  };
}

/**
 * Process a single field from a screenshot
 */
async function processField(
  img: HTMLImageElement,
  regionKey: string,
  isNumeric: boolean,
  regions: Record<string, { x: number; y: number; width: number; height: number }>,
  templateId: string,
  fallback?: OcrFallbackHandler
): Promise<OcrFieldResult> {
  const region = regions[regionKey];
  const cropped = cropRegion(img, region);
  const croppedImage = canvasToDataUrl(cropped);

  const passes: Array<{
    threshold: number;
    scale: number;
    contrast: number;
    psm: '6' | '7';
  }> = isNumeric
    ? [
        { threshold: 105, scale: 2, contrast: 1.15, psm: '7' },
        { threshold: 120, scale: 2.2, contrast: 1.35, psm: '7' },
        { threshold: 140, scale: 2.4, contrast: 1.5, psm: '6' },
      ]
    : [
        { threshold: 110, scale: 2, contrast: 1.1, psm: '7' },
        { threshold: 135, scale: 2.2, contrast: 1.3, psm: '6' },
      ];

  const passResults: OcrPassTrace[] = [];
  let bestValue = '';
  let bestConfidence = -1;
  let selectedPass = 0;

  for (let i = 0; i < passes.length; i++) {
    const pass = passes[i];
    const processed = preprocessForOCR(cropped, {
      invert: true,
      threshold: pass.threshold,
      scale: pass.scale,
      contrast: pass.contrast,
    });

    const result = isNumeric
      ? await recognizeNumberWithPsm(processed)
      : await recognizeTextWithPsm(processed);

    passResults.push({
      ...pass,
      text: result.text,
      confidence: result.confidence,
    });

    if (result.confidence > bestConfidence) {
      bestConfidence = result.confidence;
      bestValue = result.text;
      selectedPass = i;
    }
  }

  let finalValue = bestValue;
  let finalConfidence = bestConfidence;
  let fallbackUsed = false;

  if (fallback && bestConfidence < 70) {
    const fallbackResult = await fallback({
      fieldKey: regionKey,
      croppedImage,
      currentValue: bestValue,
      currentConfidence: bestConfidence,
    });
    if (fallbackResult && fallbackResult.confidence > finalConfidence) {
      finalValue = fallbackResult.value;
      finalConfidence = fallbackResult.confidence;
      fallbackUsed = true;
    }
  }

  return {
    value: finalValue,
    confidence: finalConfidence,
    croppedImage,
    trace: {
      templateId,
      selectedPass,
      passes: passResults,
      fallbackUsed,
    },
  };
}

/**
 * Process an entire screenshot — extract all fields
 */
export async function processScreenshot(
  file: File,
  onProgress?: (field: string, index: number, total: number) => void,
  fallback?: OcrFallbackHandler
): Promise<OcrScreenshotResult> {
  const img = await loadImage(file);
  const template = detectOcrTemplate(img.naturalWidth, img.naturalHeight);
  const fields = [
    { key: 'governorId', numeric: true },
    { key: 'governorName', numeric: false },
    { key: 'power', numeric: true },
    { key: 'killPoints', numeric: true },
    { key: 't4Kills', numeric: true },
    { key: 't5Kills', numeric: true },
    { key: 'deads', numeric: true },
  ];

  const results: Record<string, OcrFieldResult> = {};
  const normalizationTrace: Record<string, OcrPassTrace[]> = {};
  let totalConfidence = 0;

  for (let i = 0; i < fields.length; i++) {
    const { key, numeric } = fields[i];
    onProgress?.(key, i, fields.length);
    results[key] = await processField(
      img,
      key,
      numeric,
      template.regions,
      template.id,
      fallback
    );
    normalizationTrace[key] = results[key].trace?.passes ?? [];
    totalConfidence += results[key].confidence;
  }

  // Clean up blob URL
  URL.revokeObjectURL(img.src);

  return {
    governorId: results.governorId,
    governorName: results.governorName,
    power: results.power,
    killPoints: results.killPoints,
    t4Kills: results.t4Kills,
    t5Kills: results.t5Kills,
    deads: results.deads,
    averageConfidence: totalConfidence / fields.length,
    templateId: template.id,
    normalizationTrace,
  };
}

/**
 * Terminate the worker when done
 */
export async function terminateWorker(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}
