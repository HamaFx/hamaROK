# Database Schema Design

## Entity-Relationship Diagram

```
┌──────────────┐       ┌──────────────────┐       ┌──────────────┐
│   Governor   │       │     Snapshot     │       │    Event     │
├──────────────┤       ├──────────────────┤       ├──────────────┤
│ id (PK)      │──┐    │ id (PK)          │    ┌──│ id (PK)      │
│ governorId   │  │    │ eventId (FK)     │────┘  │ name         │
│ name         │  └───▶│ governorId (FK)  │       │ description  │
│ alliance     │       │ power            │       │ eventType    │
│ createdAt    │       │ killPoints       │       │ createdAt    │
│ updatedAt    │       │ t4Kills          │       └──────────────┘
└──────────────┘       │ t5Kills          │
                       │ deads            │
                       │ screenshotUrl    │
                       │ ocrConfidence    │
                       │ verified         │
                       │ createdAt        │
                       └──────────────────┘
```

## Relationships

- **Governor → Snapshots**: One-to-Many (a governor has many snapshots across events)
- **Event → Snapshots**: One-to-Many (an event has many governor snapshots)
- **Governor ↔ Event**: Many-to-Many (through Snapshot junction)

## Constraint: `@@unique([eventId, governorId])`

Each governor can only have ONE snapshot per event. If you upload a new screenshot for the same governor in the same event, it **updates** the existing snapshot (not creates a duplicate).

---

## Complete Prisma Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("POSTGRES_PRISMA_URL")
  directUrl = env("POSTGRES_URL_NON_POOLING")
}

// ============================================
// GOVERNOR
// Represents a Rise of Kingdoms player
// ============================================
model Governor {
  id            String      @id @default(cuid())
  governorId    String      @unique     // In-game numeric ID (e.g., "12345678")
  name          String                   // In-game display name
  alliance      String      @default("") // Alliance tag (e.g., "HamA")
  
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt
  
  snapshots     Snapshot[]

  @@index([governorId])
  @@index([name])
}

// ============================================
// EVENT
// A point-in-time marker (e.g., "KvK Start", "KvK End")
// ============================================
model Event {
  id            String      @id @default(cuid())
  name          String                   // e.g., "KvK Season 3 - Start"
  description   String?                  // Optional notes
  eventType     EventType   @default(CUSTOM)
  
  createdAt     DateTime    @default(now())
  
  snapshots     Snapshot[]

  @@index([createdAt])
}

enum EventType {
  KVK_START       // Start of Kingdom vs Kingdom
  KVK_END         // End of Kingdom vs Kingdom
  MGE             // Mightiest Governor Event
  OSIRIS           // Ark of Osiris tracking
  WEEKLY          // Weekly checkup
  CUSTOM          // User-defined event
}

// ============================================
// SNAPSHOT
// A governor's stats at a specific event
// ============================================
model Snapshot {
  id              String    @id @default(cuid())
  
  // Foreign keys
  eventId         String
  governorId      String
  event           Event     @relation(fields: [eventId], references: [id], onDelete: Cascade)
  governor        Governor  @relation(fields: [governorId], references: [id], onDelete: Cascade)
  
  // Core stats (BigInt for large numbers)
  power           BigInt                // Total power
  killPoints      BigInt                // Total kill points
  t4Kills         BigInt    @default(0) // Tier 4 kills
  t5Kills         BigInt    @default(0) // Tier 5 kills
  deads           BigInt                // Total dead troops
  
  // Audit fields
  screenshotUrl   String?              // Vercel Blob URL
  ocrConfidence   Float     @default(0) // 0.0 - 1.0 confidence score
  verified        Boolean   @default(false) // Has user verified OCR results?
  
  createdAt       DateTime  @default(now())
  
  // Compound unique: one snapshot per governor per event
  @@unique([eventId, governorId])
  
  // Performance indexes
  @@index([eventId])
  @@index([governorId])
}
```

---

## Data Types & Decisions

### Why `BigInt` for Stats?

RoK stats can be extremely large:
| Stat        | Typical Range           | Max Possible     |
|-------------|-------------------------|------------------|
| Power       | 1,000,000 – 500,000,000 | ~2 billion       |
| Kill Points | 0 – 2,000,000,000       | ~4 billion       |
| T4 Kills    | 0 – 500,000,000         | ~1 billion       |
| T5 Kills    | 0 – 200,000,000         | ~500 million     |
| Deads       | 0 – 500,000,000         | ~1 billion       |

JavaScript's `Number.MAX_SAFE_INTEGER` is 9,007,199,254,740,991 — technically sufficient, but `BigInt` in Prisma/PostgreSQL ensures:
- No floating-point precision issues
- Future-proof for extreme whale accounts
- Consistent handling across the stack

**Important**: Prisma returns `BigInt` values as JavaScript `BigInt` type. We'll need to serialize these to strings in API responses:
```typescript
// Serialization helper
function serializeBigInt(obj: any): any {
  return JSON.parse(JSON.stringify(obj, (_, v) =>
    typeof v === 'bigint' ? v.toString() : v
  ));
}
```

### Why `cuid()` for IDs?

- Collision-resistant without coordination
- Sortable by creation time (roughly)
- URL-safe (no special characters)
- Shorter than UUIDs

### Why `onDelete: Cascade`?

- Deleting an Event removes all its Snapshots (intended behavior)
- Deleting a Governor removes all their Snapshots (clean removal)
- Prevents orphaned records

---

## Sample Data

### Events Table
| id        | name                   | eventType  | createdAt          |
|-----------|------------------------|------------|--------------------|
| clx1abc   | KvK S3 - Start         | KVK_START  | 2025-06-01 00:00   |
| clx2def   | KvK S3 - End           | KVK_END    | 2025-07-15 00:00   |
| clx3ghi   | Weekly Check - June W1 | WEEKLY     | 2025-06-07 00:00   |

### Governors Table
| id        | governorId | name          | alliance |
|-----------|------------|---------------|----------|
| clx4jkl   | 45678901   | HamaWarlord   | HamA     |
| clx5mno   | 23456789   | DragonSlayer  | HamA     |
| clx6pqr   | 67890123   | SilentBlade   | HamA     |

### Snapshots Table (KvK Start)
| id      | eventId  | governorId | power       | killPoints  | t4Kills   | t5Kills  | deads     | verified |
|---------|----------|------------|-------------|-------------|-----------|----------|-----------|----------|
| clx7s   | clx1abc  | clx4jkl    | 85000000    | 150000000   | 45000000  | 12000000 | 30000000  | true     |
| clx8t   | clx1abc  | clx5mno    | 120000000   | 300000000   | 80000000  | 35000000 | 55000000  | true     |

### Snapshots Table (KvK End)
| id      | eventId  | governorId | power       | killPoints  | t4Kills   | t5Kills  | deads     | verified |
|---------|----------|------------|-------------|-------------|-----------|----------|-----------|----------|
| clx9u   | clx2def  | clx4jkl    | 82000000    | 220000000   | 65000000  | 20000000 | 60000000  | true     |
| clxAv   | clx2def  | clx5mno    | 125000000   | 380000000   | 100000000 | 50000000 | 85000000  | true     |

### Calculated Deltas (KvK Start → End)
| Governor      | Power Δ    | Kill Pts Δ | T4 Kills Δ | T5 Kills Δ | Deads Δ   |
|---------------|------------|------------|------------|------------|-----------|
| HamaWarlord   | -3,000,000 | +70,000,000| +20,000,000| +8,000,000 | +30,000,000|
| DragonSlayer  | +5,000,000 | +80,000,000| +20,000,000| +15,000,000| +30,000,000|

---

## Migration Strategy

### Initial Setup
```bash
# Generate Prisma client
npx prisma generate

# Create initial migration
npx prisma migrate dev --name init

# Push to production (Vercel)
npx prisma migrate deploy
```

### Vercel Build Command
```json
{
  "buildCommand": "prisma generate && prisma migrate deploy && next build"
}
```

This ensures the database schema is always in sync on every deployment.

---

## Indexes Explained

| Index              | Purpose                                                |
|--------------------|--------------------------------------------------------|
| `Governor.governorId` | Fast lookup when OCR matches a governor ID          |
| `Governor.name`       | Search governors by name                             |
| `Event.createdAt`     | Sort events chronologically                          |
| `Snapshot.eventId`    | Fast fetch all snapshots for an event                |
| `Snapshot.governorId` | Fast fetch all snapshots for a governor (timeline)   |

---

## Query Patterns

### Get all snapshots for an event
```sql
SELECT g.name, g."governorId", s.*
FROM "Snapshot" s
JOIN "Governor" g ON s."governorId" = g.id
WHERE s."eventId" = 'clx1abc'
ORDER BY s.power DESC;
```

### Compare two events (delta calculation)
```sql
SELECT 
  g.name,
  (b.power - a.power) as power_delta,
  (b."killPoints" - a."killPoints") as kill_delta,
  (b.deads - a.deads) as dead_delta
FROM "Snapshot" a
JOIN "Snapshot" b ON a."governorId" = b."governorId"
JOIN "Governor" g ON a."governorId" = g.id
WHERE a."eventId" = 'clx1abc'  -- Event A (start)
  AND b."eventId" = 'clx2def'  -- Event B (end)
ORDER BY kill_delta DESC;
```

### Governor timeline (all snapshots over time)
```sql
SELECT e.name as event_name, e."createdAt", s.power, s."killPoints", s.deads
FROM "Snapshot" s
JOIN "Event" e ON s."eventId" = e.id
WHERE s."governorId" = 'clx4jkl'
ORDER BY e."createdAt" ASC;
```
