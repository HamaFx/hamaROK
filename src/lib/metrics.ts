import { isMetricsLoggingEnabled } from '@/lib/env';

interface MetricMeta {
  [key: string]: unknown;
}

export async function recordApiMetric<T>(
  route: string,
  fn: () => Promise<T>,
  meta?: MetricMeta
): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    if (isMetricsLoggingEnabled()) {
      console.info('[metric:api]', {
        route,
        status: 'ok',
        durationMs: Date.now() - started,
        ...meta,
      });
    }
    return result;
  } catch (error) {
    if (isMetricsLoggingEnabled()) {
      console.error('[metric:api]', {
        route,
        status: 'error',
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : 'unknown',
        ...meta,
      });
    }
    throw error;
  }
}

export function recordJobMetric(job: string, status: 'ok' | 'error', meta?: MetricMeta) {
  if (!isMetricsLoggingEnabled()) return;
  const payload = {
    job,
    status,
    ...(meta || {}),
  };
  const logger = status === 'ok' ? console.info : console.error;
  logger('[metric:job]', payload);
}
