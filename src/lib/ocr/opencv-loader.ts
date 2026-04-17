type OpenCvLike = {
  Mat: new () => {
    cols: number;
    rows: number;
    delete: () => void;
  };
  Point: new (x: number, y: number) => unknown;
  Size: new (width: number, height: number) => unknown;
  Scalar: new (...channels: number[]) => unknown;
  CLAHE: new (clipLimit: number, tileGridSize: unknown) => {
    apply: (src: unknown, dst: unknown) => void;
    delete: () => void;
  };
  COLOR_RGBA2GRAY: number;
  CV_32F: number;
  ADAPTIVE_THRESH_GAUSSIAN_C: number;
  THRESH_BINARY: number;
  BORDER_REPLICATE: number;
  INTER_LINEAR: number;
  FILTER_DEFAULT: number;
  MORPH_RECT: number;
  MORPH_OPEN: number;
  MORPH_CLOSE: number;
  imread: (canvas: HTMLCanvasElement) => unknown;
  matFromArray: (rows: number, cols: number, type: number, values: number[]) => unknown;
  cvtColor: (...args: unknown[]) => void;
  GaussianBlur: (...args: unknown[]) => void;
  filter2D: (...args: unknown[]) => void;
  adaptiveThreshold: (...args: unknown[]) => void;
  getStructuringElement: (...args: unknown[]) => unknown;
  morphologyEx: (...args: unknown[]) => void;
  findNonZero: (...args: unknown[]) => void;
  minAreaRect: (points: unknown) => { angle: number };
  getRotationMatrix2D: (...args: unknown[]) => unknown;
  warpAffine: (...args: unknown[]) => void;
  imshow: (canvas: HTMLCanvasElement, src: unknown) => void;
};

declare global {
  interface Window {
    cv?: OpenCvLike & { onRuntimeInitialized?: () => void };
    __cvLoaderPromise?: Promise<OpenCvLike | null>;
  }
}

const OPENCV_URL = 'https://docs.opencv.org/4.x/opencv.js';

export async function loadOpenCv(): Promise<OpenCvLike | null> {
  if (typeof window === 'undefined') return null;
  if (window.cv?.Mat) return window.cv;
  if (window.__cvLoaderPromise) return window.__cvLoaderPromise;

  window.__cvLoaderPromise = new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-ocr-opencv="1"]'
    );

    if (existing && window.cv?.Mat) {
      resolve(window.cv);
      return;
    }

    const script =
      existing ||
      (() => {
        const s = document.createElement('script');
        s.async = true;
        s.src = OPENCV_URL;
        s.setAttribute('data-ocr-opencv', '1');
        document.head.appendChild(s);
        return s;
      })();

    const timeout = window.setTimeout(() => resolve(null), 7000);

    const done = (cv: OpenCvLike | null) => {
      window.clearTimeout(timeout);
      resolve(cv);
    };

    script.addEventListener('error', () => done(null), { once: true });
    script.addEventListener(
      'load',
      () => {
        if (!window.cv) {
          done(null);
          return;
        }
        if (window.cv.Mat) {
          done(window.cv);
          return;
        }
        window.cv.onRuntimeInitialized = () => done(window.cv || null);
      },
      { once: true }
    );
  });

  return window.__cvLoaderPromise;
}
