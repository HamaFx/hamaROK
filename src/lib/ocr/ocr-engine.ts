/**
 * Tesseract.js OCR Engine wrapper
 * Handles worker lifecycle and recognition with optimized settings
 */
import { createWorker, Worker } from 'tesseract.js';
import {
  CROP_REGIONS,
  loadImage,
  cropRegion,
  preprocessForOCR,
  canvasToDataUrl,
} from './image-preprocessor';

export interface OcrFieldResult {
  value: string;
  confidence: number;
  croppedImage: string; // base64 data URL of the cropped region
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
}

let worker: Worker | null = null;

/**
 * Initialize and cache the Tesseract worker
 */
export async function initializeWorker(): Promise<Worker> {
  if (worker) return worker;
  worker = await createWorker('eng');
  return worker;
}

/**
 * Recognize a number from a preprocessed canvas
 */
async function recognizeNumber(canvas: HTMLCanvasElement): Promise<{ text: string; confidence: number }> {
  const w = await initializeWorker();
  await w.setParameters({
    tessedit_char_whitelist: '0123456789,. ',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tessedit_pageseg_mode: '7' as any,
  });
  const { data } = await w.recognize(canvas);
  return {
    text: data.text.trim().replace(/\s/g, '').replace(/\./g, ','),
    confidence: data.confidence,
  };
}

/**
 * Recognize text (governor name) from a preprocessed canvas
 */
async function recognizeText(canvas: HTMLCanvasElement): Promise<{ text: string; confidence: number }> {
  const w = await initializeWorker();
  await w.setParameters({
    tessedit_char_whitelist: '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tessedit_pageseg_mode: '7' as any,
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
  isNumeric: boolean
): Promise<OcrFieldResult> {
  const region = CROP_REGIONS[regionKey];
  const cropped = cropRegion(img, region);
  const croppedImage = canvasToDataUrl(cropped);
  const processed = preprocessForOCR(cropped);

  const result = isNumeric
    ? await recognizeNumber(processed)
    : await recognizeText(processed);

  return {
    value: result.text,
    confidence: result.confidence,
    croppedImage,
  };
}

/**
 * Process an entire screenshot — extract all fields
 */
export async function processScreenshot(
  file: File,
  onProgress?: (field: string, index: number, total: number) => void
): Promise<OcrScreenshotResult> {
  const img = await loadImage(file);
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
  let totalConfidence = 0;

  for (let i = 0; i < fields.length; i++) {
    const { key, numeric } = fields[i];
    onProgress?.(key, i, fields.length);
    results[key] = await processField(img, key, numeric);
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
