interface DiscordRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
}

export interface DiscordDeliveryResult {
  success: boolean;
  attempts: number;
  rateLimitedCount: number;
  statusCode?: number;
  error?: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(response: Response, bodyText: string): number {
  const headerMs = response.headers.get('retry-after');
  if (headerMs) {
    const asNumber = Number(headerMs);
    if (Number.isFinite(asNumber)) {
      return asNumber * 1000;
    }
  }

  try {
    const body = JSON.parse(bodyText) as { retry_after?: number };
    if (typeof body.retry_after === 'number' && Number.isFinite(body.retry_after)) {
      return body.retry_after * 1000;
    }
  } catch {
    // no-op
  }

  return 1500;
}

export async function sendDiscordWebhookWithRetry(
  webhookUrl: string,
  payload: unknown,
  options?: DiscordRetryOptions
): Promise<DiscordDeliveryResult> {
  const maxAttempts = options?.maxAttempts ?? 5;
  const baseDelayMs = options?.baseDelayMs ?? 700;
  let lastError = 'Unknown error';
  let lastStatusCode: number | undefined;
  let rateLimitedCount = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      lastStatusCode = response.status;
      if (response.ok) {
        return {
          success: true,
          attempts: attempt,
          rateLimitedCount,
          statusCode: response.status,
        };
      }

      const bodyText = await response.text();
      lastError = `Discord webhook rejected payload (HTTP ${response.status})`;

      if (response.status === 429 && attempt < maxAttempts) {
        rateLimitedCount += 1;
        const waitMs = parseRetryAfter(response, bodyText);
        await sleep(waitMs + 100);
        continue;
      }

      if (response.status >= 500 && attempt < maxAttempts) {
        await sleep(baseDelayMs * attempt);
        continue;
      }

      break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Request failed';
      if (attempt < maxAttempts) {
        await sleep(baseDelayMs * attempt);
        continue;
      }
    }
  }

  return {
    success: false,
    attempts: maxAttempts,
    rateLimitedCount,
    statusCode: lastStatusCode,
    error: lastError,
  };
}
