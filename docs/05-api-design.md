# API Design — Route Specifications

## Current V2 Additions (Assistant + Mistral)

As of April 18, 2026, the following v2 API surfaces are active for assistant-driven operations:

### Assistant Conversations

- `POST /api/v2/assistant/conversations`
  - Body: `{ workspaceId, title? }`
  - Creates a workspace-scoped assistant conversation.

- `GET /api/v2/assistant/conversations?workspaceId=...`
  - Lists assistant conversations for the workspace.

- `POST /api/v2/assistant/conversations/cleanup`
  - Body: `{ workspaceId, mode: "archive" | "purge", confirm?, includePendingIdentities? }`
  - Owner-only administrative cleanup:
    - `archive` marks all workspace conversations as archived.
    - `purge` hard-deletes assistant conversation history for full workspace reset.
  - `purge` requires `confirm: "RESET_ASSISTANT_WORKSPACE"`.

- `GET /api/v2/assistant/conversations/:id/messages?workspaceId=...`
  - Returns conversation messages, plans, and pending identity records.

- `POST /api/v2/assistant/conversations/:id/messages` (multipart)
  - Multipart fields:
    - `workspaceId`
    - `text` (optional)
    - `file` (0..N screenshot images)
  - Server stores image artifacts, sends base64 image content to Mistral, and creates a proposed plan.

### Assistant Plan Control

- `POST /api/v2/assistant/plans/:id/confirm`
  - Body: `{ workspaceId }`
  - Executes one full confirmed plan.

- `POST /api/v2/assistant/plans/:id/deny`
  - Body: `{ workspaceId }`
  - Rejects a pending/confirmed plan.

### Pending Identity Resolution

- `POST /api/v2/assistant/pending-identities/:id/resolve`
  - Body: `{ workspaceId, governorDbId, eventId?, note? }`
  - Resolves blocked profile-stat writes when governor identity is missing/ambiguous.

### OCR Diagnostics and Internal Extraction

- `POST /api/v2/ocr/run` (multipart)
  - Server-side Mistral diagnostics for uploaded screenshots.

- `POST /api/v2/internal/ingestion-tasks/:taskId/extract` (service-signed)
  - Worker-facing extraction endpoint that returns Mistral profile/ranking payloads while preserving existing ingestion contracts.

## Base URL

```
Production:  https://hamarok.vercel.app/api
Development: http://localhost:3000/api
```

Production smoke expectation for the assistant release:

- `GET https://hamarok.vercel.app/assistant` returns `200`.
- `GET https://hamarok.vercel.app/api/v2/assistant/conversations?...` returns an API auth/validation response (not framework `404`).

## Authentication

**MVP**: No authentication. The app is accessed via a shareable link.
**Future**: Add NextAuth with Discord OAuth (most RoK alliances use Discord).

---

## Endpoints

### 1. Events

#### `GET /api/events`

List all events, sorted by creation date (newest first).

**Response:**
```json
{
  "events": [
    {
      "id": "clx1abc",
      "name": "KvK S3 - Start",
      "description": "Season 3 Kingdom vs Kingdom starting stats",
      "eventType": "KVK_START",
      "snapshotCount": 87,
      "createdAt": "2025-06-01T00:00:00Z"
    }
  ]
}
```

#### `POST /api/events`

Create a new event.

**Request Body:**
```json
{
  "name": "KvK S3 - End",
  "description": "Final stats after KvK Season 3",
  "eventType": "KVK_END"
}
```

**Response:** `201 Created`
```json
{
  "id": "clx2def",
  "name": "KvK S3 - End",
  "eventType": "KVK_END",
  "createdAt": "2025-07-15T00:00:00Z"
}
```

#### `DELETE /api/events/[id]`

Delete an event and all its snapshots (cascade).

**Response:** `204 No Content`

---

### 2. Governors

#### `GET /api/governors`

List all governors.

**Query Parameters:**
| Param    | Type   | Description                |
|----------|--------|----------------------------|
| search   | string | Search by name or ID       |
| limit    | number | Max results (default: 100) |
| offset   | number | Pagination offset          |

**Response:**
```json
{
  "governors": [
    {
      "id": "clx4jkl",
      "governorId": "45678901",
      "name": "HamaWarlord",
      "alliance": "HamA",
      "snapshotCount": 5,
      "latestPower": "85000000",
      "createdAt": "2025-05-01T00:00:00Z"
    }
  ],
  "total": 102
}
```

#### `POST /api/governors`

Create or update a governor (upsert by `governorId`).

**Request Body:**
```json
{
  "governorId": "45678901",
  "name": "HamaWarlord",
  "alliance": "HamA"
}
```

**Response:** `200 OK` or `201 Created`

---

### 3. Snapshots

#### `GET /api/snapshots`

Get snapshots with filtering.

**Query Parameters:**
| Param      | Type   | Description                     |
|------------|--------|---------------------------------|
| eventId    | string | Filter by event                 |
| governorId | string | Filter by governor (internal ID)|
| verified   | boolean| Filter by verification status   |

**Response:**
```json
{
  "snapshots": [
    {
      "id": "clx7s",
      "eventId": "clx1abc",
      "governor": {
        "id": "clx4jkl",
        "governorId": "45678901",
        "name": "HamaWarlord"
      },
      "power": "85000000",
      "killPoints": "150000000",
      "t4Kills": "45000000",
      "t5Kills": "12000000",
      "deads": "30000000",
      "screenshotUrl": "https://blob.vercel-storage.com/...",
      "ocrConfidence": 0.94,
      "verified": true,
      "createdAt": "2025-06-01T12:00:00Z"
    }
  ]
}
```

#### `POST /api/snapshots`

Save a new snapshot (or update existing for same governor+event).

**Request Body:**
```json
{
  "eventId": "clx1abc",
  "governorId": "45678901",
  "governorName": "HamaWarlord",
  "power": "85000000",
  "killPoints": "150000000",
  "t4Kills": "45000000",
  "t5Kills": "12000000",
  "deads": "30000000",
  "screenshotUrl": "https://blob.vercel-storage.com/...",
  "ocrConfidence": 0.94,
  "verified": true
}
```

**Logic:**
1. Upsert Governor by `governorId` (create if not exists, update name if changed)
2. Upsert Snapshot by `[eventId, governorId]` compound unique
3. Return created/updated snapshot

**Response:** `201 Created`

#### `POST /api/snapshots/batch`

Save multiple snapshots at once (after batch OCR review).

**Request Body:**
```json
{
  "eventId": "clx1abc",
  "snapshots": [
    {
      "governorId": "45678901",
      "governorName": "HamaWarlord",
      "power": "85000000",
      "killPoints": "150000000",
      "t4Kills": "45000000",
      "t5Kills": "12000000",
      "deads": "30000000",
      "screenshotUrl": "...",
      "ocrConfidence": 0.94,
      "verified": true
    },
    { ... }
  ]
}
```

**Response:** `201 Created`
```json
{
  "saved": 87,
  "updated": 3,
  "errors": 0
}
```

---

### 4. Screenshot Upload

#### `POST /api/screenshots/upload`

Upload a screenshot to Vercel Blob for storage.

**Request:** `multipart/form-data`
| Field  | Type | Description          |
|--------|------|----------------------|
| file   | File | Screenshot image     |

**Response:**
```json
{
  "url": "https://xyz.public.blob.vercel-storage.com/screenshot-abc123.png",
  "size": 312456,
  "uploadedAt": "2025-06-01T12:00:00Z"
}
```

---

### 5. Comparison & Analytics

#### `GET /api/compare`

Compare two events and calculate deltas + warrior scores.

**Query Parameters:**
| Param   | Type   | Required | Description            |
|---------|--------|----------|------------------------|
| eventA  | string | Yes      | Starting event ID      |
| eventB  | string | Yes      | Ending event ID        |

**Response:**
```json
{
  "eventA": {
    "id": "clx1abc",
    "name": "KvK S3 - Start"
  },
  "eventB": {
    "id": "clx2def",
    "name": "KvK S3 - End"
  },
  "comparisons": [
    {
      "governor": {
        "id": "clx4jkl",
        "governorId": "45678901",
        "name": "HamaWarlord"
      },
      "snapshotA": {
        "power": "85000000",
        "killPoints": "150000000",
        "t4Kills": "45000000",
        "t5Kills": "12000000",
        "deads": "30000000"
      },
      "snapshotB": {
        "power": "82000000",
        "killPoints": "220000000",
        "t4Kills": "65000000",
        "t5Kills": "20000000",
        "deads": "60000000"
      },
      "deltas": {
        "power": "-3000000",
        "killPoints": "70000000",
        "t4Kills": "20000000",
        "t5Kills": "8000000",
        "deads": "30000000"
      },
      "warriorScore": {
        "killScore": 69.6,
        "deadScore": 100.0,
        "powerBonus": 5.0,
        "totalScore": 83.3,
        "tier": "Elite Warrior",
        "rank": 2
      }
    }
  ],
  "summary": {
    "totalGovernors": 87,
    "avgWarriorScore": 45.2,
    "tierDistribution": {
      "War Legend": 5,
      "Elite Warrior": 12,
      "Frontline Fighter": 25,
      "Support Role": 30,
      "Inactive": 15
    }
  }
}
```

#### `GET /api/governors/[id]/timeline`

Get a governor's stats over all events.

**Response:**
```json
{
  "governor": {
    "id": "clx4jkl",
    "governorId": "45678901",
    "name": "HamaWarlord"
  },
  "timeline": [
    {
      "event": { "id": "clx1abc", "name": "KvK S3 - Start" },
      "power": "85000000",
      "killPoints": "150000000",
      "deads": "30000000",
      "date": "2025-06-01T00:00:00Z"
    },
    {
      "event": { "id": "clx2def", "name": "KvK S3 - End" },
      "power": "82000000",
      "killPoints": "220000000",
      "deads": "60000000",
      "date": "2025-07-15T00:00:00Z"
    }
  ]
}
```

---

## Error Handling

All endpoints return consistent error responses:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Governor ID must be 6-12 digits",
    "field": "governorId"
  }
}
```

**Error Codes:**
| Code              | HTTP Status | Description                    |
|-------------------|-------------|--------------------------------|
| VALIDATION_ERROR  | 400         | Invalid request data           |
| NOT_FOUND         | 404         | Resource doesn't exist         |
| DUPLICATE         | 409         | Resource already exists        |
| INTERNAL_ERROR    | 500         | Server error                   |

---

## Rate Limits (Vercel Free Tier)

| Resource               | Limit                    |
|------------------------|--------------------------|
| Serverless Invocations | 100,000/month            |
| Function Duration      | 10 seconds max           |
| Bandwidth              | 100 GB/month             |

These limits are more than sufficient for an alliance of 100+ players.
