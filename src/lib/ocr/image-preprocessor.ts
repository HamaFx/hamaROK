/**
 * OCR Image Preprocessor
 * Crops specific regions and prepares them for Tesseract with optional OpenCV.js passes.
 */

import { loadOpenCv } from './opencv-loader';

export interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreprocessOptions {
  variantId?: string;
  invert?: boolean;
  threshold?: number;
  scale?: number;
  contrast?: number;
  useOpenCv?: boolean;
  deskew?: boolean;
  clahe?: boolean;
  adaptiveThreshold?: boolean;
  adaptiveBlockSize?: number;
  adaptiveC?: number;
  denoiseKernel?: number;
  morphology?: 'none' | 'open' | 'close';
}

export interface PreprocessTraceStep {
  step: string;
  detail: string;
  metrics?: Record<string, number | string | boolean>;
}

export interface PreprocessTrace {
  variantId: string;
  usedOpenCv: boolean;
  deskewAngle: number;
  steps: PreprocessTraceStep[];
}

export interface PreprocessResult {
  canvas: HTMLCanvasElement;
  trace: PreprocessTrace;
}

// Percentage-based defaults for the "Governor More Info" view.
export const CROP_REGIONS: Record<string, CropRegion> = {
  governorId: { x: 0.28, y: 0.07, width: 0.44, height: 0.04 },
  governorName: { x: 0.22, y: 0.11, width: 0.56, height: 0.05 },
  power: { x: 0.28, y: 0.21, width: 0.44, height: 0.05 },
  killPoints: { x: 0.48, y: 0.41, width: 0.48, height: 0.04 },
  t4Kills: { x: 0.48, y: 0.53, width: 0.48, height: 0.04 },
  t5Kills: { x: 0.48, y: 0.57, width: 0.48, height: 0.04 },
  deads: { x: 0.48, y: 0.71, width: 0.48, height: 0.04 },
};

export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export function cropRegion(img: HTMLImageElement, region: CropRegion): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const sx = Math.round(img.naturalWidth * region.x);
  const sy = Math.round(img.naturalHeight * region.y);
  const sw = Math.round(img.naturalWidth * region.width);
  const sh = Math.round(img.naturalHeight * region.height);

  canvas.width = sw;
  canvas.height = sh;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not create 2D context while cropping OCR region.');
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  return canvas;
}

function ensureOdd(value: number, fallback: number): number {
  const rounded = Math.max(1, Math.floor(value || fallback));
  return rounded % 2 === 1 ? rounded : rounded + 1;
}

function scaleCanvas(input: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(input.width * scale));
  out.height = Math.max(1, Math.round(input.height * scale));
  const outCtx = out.getContext('2d');
  if (!outCtx) {
    throw new Error('Could not create 2D context while scaling OCR image.');
  }
  outCtx.imageSmoothingEnabled = false;
  outCtx.drawImage(input, 0, 0, out.width, out.height);
  return out;
}

function preprocessCanvasOnly(
  sourceCanvas: HTMLCanvasElement,
  options: Required<
    Pick<PreprocessOptions, 'invert' | 'threshold' | 'scale' | 'contrast' | 'variantId'>
  >
): PreprocessResult {
  const canvas = document.createElement('canvas');
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not create 2D context while preprocessing OCR image.');
  }
  ctx.drawImage(sourceCanvas, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const contrasted = Math.max(0, Math.min(255, (gray - 128) * options.contrast + 128));
    const normalized = options.invert ? 255 - contrasted : contrasted;
    const value = normalized > options.threshold ? 255 : 0;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  ctx.putImageData(imageData, 0, 0);

  return {
    canvas: scaleCanvas(canvas, options.scale),
    trace: {
      variantId: options.variantId,
      usedOpenCv: false,
      deskewAngle: 0,
      steps: [
        {
          step: 'canvas-grayscale-threshold',
          detail: 'Canvas fallback pipeline (grayscale + contrast + fixed threshold).',
          metrics: {
            threshold: options.threshold,
            contrast: options.contrast,
            scale: options.scale,
            invert: options.invert,
          },
        },
      ],
    },
  };
}

async function preprocessWithOpenCv(
  sourceCanvas: HTMLCanvasElement,
  options: Required<
    Pick<
      PreprocessOptions,
      | 'variantId'
      | 'invert'
      | 'threshold'
      | 'scale'
      | 'contrast'
      | 'deskew'
      | 'clahe'
      | 'adaptiveThreshold'
      | 'adaptiveBlockSize'
      | 'adaptiveC'
      | 'denoiseKernel'
      | 'morphology'
    >
  >
): Promise<PreprocessResult> {
  const cv = await loadOpenCv();
  if (!cv) {
    return preprocessCanvasOnly(sourceCanvas, options);
  }

  const trace: PreprocessTrace = {
    variantId: options.variantId,
    usedOpenCv: true,
    deskewAngle: 0,
    steps: [],
  };

  const src = cv.imread(sourceCanvas) as {
    cols: number;
    rows: number;
    delete: () => void;
  };
  const gray = new cv.Mat();
  const enhanced = new cv.Mat();
  const denoised = new cv.Mat();
  const binary = new cv.Mat();
  const morph = new cv.Mat();
  const points = new cv.Mat();
  const rotated = new cv.Mat();

  let working = src;
  let deskewAngle = 0;

  try {
    cv.cvtColor(working, gray, cv.COLOR_RGBA2GRAY, 0);
    trace.steps.push({ step: 'grayscale', detail: 'Converted RGBA to grayscale.' });

    if (options.clahe) {
      const clahe = new cv.CLAHE(2.5, new cv.Size(8, 8));
      clahe.apply(gray, enhanced);
      clahe.delete();
      trace.steps.push({
        step: 'clahe',
        detail: 'Applied CLAHE contrast normalization.',
        metrics: { clipLimit: 2.5, tileGrid: 8 },
      });
    } else {
      (gray as unknown as { copyTo: (dst: unknown) => void }).copyTo(enhanced);
    }

    cv.GaussianBlur(
      enhanced,
      denoised,
      new cv.Size(ensureOdd(options.denoiseKernel, 3), ensureOdd(options.denoiseKernel, 3)),
      0,
      0,
      cv.BORDER_REPLICATE
    );
    trace.steps.push({
      step: 'denoise',
      detail: 'Applied Gaussian blur denoise pass.',
      metrics: { kernel: ensureOdd(options.denoiseKernel, 3) },
    });

    if (options.adaptiveThreshold) {
      cv.adaptiveThreshold(
        denoised,
        binary,
        255,
        cv.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv.THRESH_BINARY,
        ensureOdd(options.adaptiveBlockSize, 31),
        options.adaptiveC
      );
      trace.steps.push({
        step: 'adaptive-threshold',
        detail: 'Applied adaptive Gaussian threshold.',
        metrics: {
          blockSize: ensureOdd(options.adaptiveBlockSize, 31),
          c: options.adaptiveC,
        },
      });
    } else {
      const ctx = sourceCanvas.getContext('2d');
      if (!ctx) {
        throw new Error('Could not read source canvas context for fallback threshold.');
      }
      const fallback = preprocessCanvasOnly(sourceCanvas, options);
      return {
        canvas: fallback.canvas,
        trace: {
          ...fallback.trace,
          variantId: options.variantId,
          steps: [
            ...trace.steps,
            ...fallback.trace.steps,
          ],
        },
      };
    }

    if (options.morphology !== 'none') {
      const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
      const op = options.morphology === 'open' ? cv.MORPH_OPEN : cv.MORPH_CLOSE;
      cv.morphologyEx(binary, morph, op, kernel);
      trace.steps.push({
        step: 'morphology',
        detail: 'Applied morphology cleanup.',
        metrics: { mode: options.morphology },
      });
      working = morph as unknown as typeof working;
    } else {
      working = binary as unknown as typeof working;
    }

    if (options.deskew) {
      cv.findNonZero(working, points);
      const minRows = 18;
      if ((points as { rows?: number }).rows && (points as { rows: number }).rows >= minRows) {
        const rect = cv.minAreaRect(points);
        deskewAngle = rect.angle;
        if (deskewAngle < -45) deskewAngle += 90;
        if (deskewAngle > 45) deskewAngle -= 90;
        if (Math.abs(deskewAngle) > 0.15) {
          const center = new cv.Point(src.cols / 2, src.rows / 2);
          const matrix = cv.getRotationMatrix2D(center, deskewAngle, 1);
          cv.warpAffine(
            working,
            rotated,
            matrix,
            new cv.Size(src.cols, src.rows),
            cv.INTER_LINEAR,
            cv.BORDER_REPLICATE,
            new cv.Scalar()
          );
          working = rotated as unknown as typeof working;
          trace.steps.push({
            step: 'deskew',
            detail: 'Applied deskew rotation from foreground angle.',
            metrics: { angle: deskewAngle },
          });
        }
      }
    }

    const output = document.createElement('canvas');
    output.width = sourceCanvas.width;
    output.height = sourceCanvas.height;
    cv.imshow(output, working);
    const scaled = scaleCanvas(output, options.scale);
    trace.deskewAngle = deskewAngle;
    trace.steps.push({
      step: 'scale',
      detail: 'Scaled preprocessed image for OCR.',
      metrics: { scale: options.scale },
    });

    return { canvas: scaled, trace };
  } catch {
    return preprocessCanvasOnly(sourceCanvas, options);
  } finally {
    src.delete();
    gray.delete();
    enhanced.delete();
    denoised.delete();
    binary.delete();
    morph.delete();
    points.delete();
    rotated.delete();
  }
}

export async function preprocessForOCR(
  sourceCanvas: HTMLCanvasElement,
  options: PreprocessOptions = {}
): Promise<PreprocessResult> {
  const withDefaults = {
    variantId: options.variantId || 'default',
    invert: options.invert ?? true,
    threshold: options.threshold ?? 120,
    scale: options.scale ?? 2,
    contrast: options.contrast ?? 1.2,
    useOpenCv: options.useOpenCv ?? true,
    deskew: options.deskew ?? true,
    clahe: options.clahe ?? true,
    adaptiveThreshold: options.adaptiveThreshold ?? true,
    adaptiveBlockSize: options.adaptiveBlockSize ?? 31,
    adaptiveC: options.adaptiveC ?? 12,
    denoiseKernel: options.denoiseKernel ?? 3,
    morphology: options.morphology ?? 'open',
  } satisfies Required<PreprocessOptions>;

  if (!withDefaults.useOpenCv) {
    return preprocessCanvasOnly(sourceCanvas, withDefaults);
  }

  return preprocessWithOpenCv(sourceCanvas, withDefaults);
}

export async function preprocessForOCRCanvas(
  sourceCanvas: HTMLCanvasElement,
  options: PreprocessOptions = {}
): Promise<HTMLCanvasElement> {
  const result = await preprocessForOCR(sourceCanvas, options);
  return result.canvas;
}

export function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}
