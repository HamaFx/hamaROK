# Error Reliability Contract (AI Agents)

This project uses a shared translator in `src/lib/api-response.ts` for machine-readable failures.

## Error Envelope

All API failures use:

```json
{
  "data": null,
  "meta": null,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Upstream model provider is temporarily unavailable.",
    "category": "upstream",
    "retryable": true,
    "retryAfterMs": 1500,
    "source": "mistral",
    "requestId": "6f1f0e9c-...",
    "hints": ["Retry with backoff and jitter."],
    "details": {}
  }
}
```

Headers:

- `X-Request-Id` for correlation
- `Retry-After` when retry is recommended

## Retry Matrix

| category | default retryable | typical source |
|---|---:|---|
| `validation` | no | `api`, `mistral` |
| `authentication` | no | `api` |
| `authorization` | no | `api` |
| `not_found` | no | `api`, `prisma`, `blob` |
| `conflict` | no (except idempotency in-progress) | `api`, `idempotency` |
| `precondition` | no | `api`, `prisma` |
| `rate_limit` | yes | `mistral`, `blob`, `api` |
| `timeout` | yes | `timeout`, `mistral` |
| `network` | yes | `network` |
| `database` | mixed | `prisma` |
| `storage` | mixed | `blob` |
| `upstream` | yes | `mistral` |
| `internal` | no | `unknown`, `api` |

## Agent Handling Rules

1. If `retryable=true`, retry with jitter/backoff and preserve idempotency key.
2. If `error.code=CONFLICT` and `details.reason=IDEMPOTENCY_IN_PROGRESS`, retry after `retryAfterMs`.
3. If `category=validation|precondition|authorization`, stop retries and fix request/config.
4. Always log/store `error.requestId` for incident correlation.
