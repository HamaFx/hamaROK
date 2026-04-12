/**
 * OCR Image Preprocessor — runs client-side using Canvas API
 * Crops specific regions from RoK screenshots and prepares them for Tesseract
 */

export interface CropRegion {
  x: number;      // percentage from left (0-1)
  y: number;      // percentage from top (0-1)
  width: number;  // percentage of image width (0-1)
  height: number; // percentage of image height (0-1)
}

export interface PreprocessOptions {
  invert?: boolean;
  threshold?: number;
  scale?: number;
  contrast?: number;
}

// Region templates for the "Governor More Info" screen
// These are percentage-based coordinates for resolution independence
export const CROP_REGIONS: Record<string, CropRegion> = {
  governorId: { x: 0.28, y: 0.07, width: 0.44, height: 0.04 },
  governorName: { x: 0.22, y: 0.11, width: 0.56, height: 0.05 },
  power: { x: 0.28, y: 0.21, width: 0.44, height: 0.05 },
  killPoints: { x: 0.48, y: 0.41, width: 0.48, height: 0.04 },
  t4Kills: { x: 0.48, y: 0.53, width: 0.48, height: 0.04 },
  t5Kills: { x: 0.48, y: 0.57, width: 0.48, height: 0.04 },
  deads: { x: 0.48, y: 0.71, width: 0.48, height: 0.04 },
};

/**
 * Load an image File into an HTMLImageElement
 */
export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Crop a specific region from an image using percentage-based coordinates
 */
export function cropRegion(
  img: HTMLImageElement,
  region: CropRegion
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const sx = Math.round(img.naturalWidth * region.x);
  const sy = Math.round(img.naturalHeight * region.y);
  const sw = Math.round(img.naturalWidth * region.width);
  const sh = Math.round(img.naturalHeight * region.height);

  canvas.width = sw;
  canvas.height = sh;

  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  return canvas;
}

/**
 * Full preprocessing pipeline: Grayscale → Invert → Binarize → Scale 2x
 */
export function preprocessForOCR(
  sourceCanvas: HTMLCanvasElement,
  options: PreprocessOptions = {}
): HTMLCanvasElement {
  const invert = options.invert ?? true;
  const threshold = options.threshold ?? 120;
  const scale = options.scale ?? 2;
  const contrast = options.contrast ?? 1;

  const canvas = document.createElement('canvas');
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(sourceCanvas, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    // Grayscale
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const contrasted = Math.max(
      0,
      Math.min(255, (gray - 128) * contrast + 128)
    );
    // Invert (RoK uses light text on dark background)
    const normalized = invert ? 255 - contrasted : contrasted;
    // Binarize with threshold
    const val = normalized > threshold ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = val;
  }

  ctx.putImageData(imageData, 0, 0);

  // Scale 2x for better OCR recognition
  const scaled = document.createElement('canvas');
  scaled.width = Math.max(1, Math.round(canvas.width * scale));
  scaled.height = Math.max(1, Math.round(canvas.height * scale));
  const sCtx = scaled.getContext('2d')!;
  sCtx.imageSmoothingEnabled = false;
  sCtx.drawImage(canvas, 0, 0, scaled.width, scaled.height);

  return scaled;
}

/**
 * Get a data URL from a canvas (for display in review panel)
 */
export function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}
